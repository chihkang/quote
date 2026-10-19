import { resolveMarketCloseContext, marketLocalParts, isMarketTradingDay, sessionCloseMinutes, type MarketCalendarData } from './marketCalendar';

export type QuoteStatus = 'fresh' | 'stale' | 'missing';

export function classify(
  nowMs: number,
  fetchedAtMs: number,
  softTtlSec: number,
  hardTtlSec: number,
  softTtlJitterSec = 0
): QuoteStatus {
  const ageMs = Math.max(0, nowMs - fetchedAtMs);
  const softMs = Math.max(0, softTtlSec + softTtlJitterSec) * 1000;
  const hardMs = Math.max(0, hardTtlSec) * 1000;

  if (ageMs > hardMs) return 'missing';
  if (ageMs <= softMs) return 'fresh';
  if (ageMs <= hardMs) return 'stale';
  return 'missing';
}

export function isStale(status: QuoteStatus): boolean {
  return status === 'stale';
}

// Source age and cache TTL are separate API dimensions. Provider-at-close data
// remains provider data; this never grants official EOD authority.
export type USSourceStatus = 'current' | 'recent_close' | 'delayed' | 'expired' | 'invalid' | 'unavailable';
export type USSourceAssessment = {
  sourceStatus: USSourceStatus;
  sourceReason: string | null;
  sourceAgeSec: number | null;
};

export function assessUSSource(now: Date, asOf: string | null, calendar: MarketCalendarData,
  verified = true): USSourceAssessment {
  const sourceMs = asOf === null ? NaN : Date.parse(asOf);
  const sourceAgeSec = Number.isFinite(sourceMs) ? Math.floor((now.getTime() - sourceMs) / 1000) : null;
  const result = (sourceStatus: USSourceStatus, sourceReason: string | null): USSourceAssessment =>
    ({sourceStatus, sourceReason, sourceAgeSec});
  if (!verified || !Number.isFinite(sourceMs) || sourceMs <= 0 || sourceMs > now.getTime() + 60_000) {
    return result('invalid', 'SOURCE_TIMESTAMP_INVALID');
  }
  const context = resolveMarketCloseContext('US', now, calendar);
  if (context.calendarVersion === null) return result('unavailable', 'SOURCE_CALENDAR_UNAVAILABLE');
  const source = new Date(sourceMs);
  const sourceParts = marketLocalParts('US', source);
  const expectedDay = context.marketSessionState === 'open'
    ? marketLocalParts('US', now).date : context.expectedCloseTradingDate;
  if (expectedDay === null) return result('unavailable', 'SOURCE_CALENDAR_UNAVAILABLE');
  if (sourceParts.date < expectedDay) return result('expired', 'SOURCE_EXPIRED');
  if (!isMarketTradingDay('US', sourceParts.date, calendar)) return result('delayed', 'SOURCE_OUTSIDE_SESSION');
  const sourceSeconds = sourceParts.minutes * 60 + source.getUTCSeconds();
  const closeSeconds = sessionCloseMinutes('US', sourceParts.date, calendar) * 60;
  const inSession = sourceSeconds >= 570 * 60 && sourceSeconds <= closeSeconds;
  if (context.marketSessionState === 'open') {
    if (sourceParts.date === expectedDay && inSession && now.getTime() - sourceMs <= 300_000) {
      return result('current', null);
    }
  } else if (sourceParts.date === expectedDay && inSession && closeSeconds - sourceSeconds <= 300) {
    return result('recent_close', null);
  }
  return result('delayed', inSession ? 'SOURCE_DELAYED' : 'SOURCE_OUTSIDE_SESSION');
}
