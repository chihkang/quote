import calendarData from './data/market-calendar-2026.json';

export type Market = 'TW' | 'US';
export type MarketSessionState = 'pre_open' | 'open' | 'post_close' | 'closed';
export type MarketCloseContext = {
  expectedCloseTradingDate: string | null;
  marketSessionState: MarketSessionState;
  calendarVersion: string | null;
};
export type MarketCalendarData = {
  calendarVersion: string;
  coverageStart: string;
  coverageEnd: string;
  TW: { holidays: string[]; earlyCloses: Record<string, string> };
  US: { holidays: string[]; earlyCloses: Record<string, string> };
};
export const marketCalendar: MarketCalendarData = calendarData;
export type CalendarRelease = { effectiveFrom: string; data: MarketCalendarData };
// Append verified versions here; never change an already published identifier.
export const calendarRevision = 202601;
export const releasedCalendars: readonly CalendarRelease[] = [
  { effectiveFrom: '2025-12-01', data: marketCalendar }
];
export function selectMarketCalendar(at: Date, version?: string,
  releases: readonly CalendarRelease[] = releasedCalendars): MarketCalendarData | undefined {
  const taipeiDay = marketLocalParts('TW', at).date;
  const nyDay = marketLocalParts('US', at).date;
  const eligible = releases.map((release,index) => ({...release,index})).filter(r => r.effectiveFrom <= taipeiDay);
  const selected = version === undefined
    ? [...eligible].sort((a,b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.index - a.index)[0]?.data
    : eligible.find(r => r.data.calendarVersion === version)?.data;
  return selected && hasCalendarCoverage(taipeiDay, selected) && hasCalendarCoverage(nyDay, selected) ? selected : undefined;
}
function calendarForCivilDate(date: string): MarketCalendarData {
  // Unknown coverage still fails closed in hasCalendarCoverage.
  return selectMarketCalendar(new Date(`${date}T13:35:00+08:00`)) ?? marketCalendar;
}
export const marketTimeZone = (market: Market) => market === 'TW' ? 'Asia/Taipei' : 'America/New_York';

export function marketLocalParts(market: Market, now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: marketTimeZone(market), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: +get('hour') * 60 + +get('minute') };
}
export function hasCalendarCoverage(date: string, data = marketCalendar): boolean {
  return date >= data.coverageStart && date <= data.coverageEnd;
}
export function isMarketTradingDay(market: Market, date: string, data = calendarForCivilDate(date)): boolean {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return hasCalendarCoverage(date, data) && weekday !== 0 && weekday !== 6 && !data[market].holidays.includes(date);
}
export function sessionCloseMinutes(market: Market, date: string, data = calendarForCivilDate(date)): number {
  const close = data[market].earlyCloses[date] ?? (market === 'TW' ? '13:30' : '16:00');
  const [hour, minute] = close.split(':').map(Number);
  return hour * 60 + minute;
}
export function previousCivilDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export function isValidTwWindow(window: {open: string; close: string}): boolean {
  const valid = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  return valid(window.open) && valid(window.close) && window.open < window.close;
}
export function resolveMarketCloseContext(market: Market, now: Date, data = selectMarketCalendar(now) ?? marketCalendar,
  twWindow: {open: string; close: string} = {open: '09:00', close: '13:30'}): MarketCloseContext {
  const { date, minutes } = marketLocalParts(market, now);
  if (!hasCalendarCoverage(date, data)) {
    return { expectedCloseTradingDate: null, marketSessionState: 'closed', calendarVersion: null };
  }
  if (market === 'TW' && !isValidTwWindow(twWindow)) {
    return {expectedCloseTradingDate: null, marketSessionState: 'closed', calendarVersion: null};
  }
  const trading = isMarketTradingDay(market, date, data);
  const minutesOf = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const openMinutes = market === 'TW' ? minutesOf(twWindow.open) : 570;
  const closeMinutes = market === 'TW' && twWindow.close !== '13:30' ? minutesOf(twWindow.close) : sessionCloseMinutes(market, date, data);
  const version = market === 'TW' && (twWindow.open !== '09:00' || twWindow.close !== '13:30')
    ? data.calendarVersion + '-session-override' : data.calendarVersion;
  const state: MarketSessionState = !trading ? 'closed' : minutes < openMinutes
    ? 'pre_open' : minutes <= closeMinutes ? 'open' : 'post_close';
  let candidate = state === 'post_close' ? date : previousCivilDate(date);
  // Bounded search must stay inside the published calendar; unknown dates cannot become weekday guesses.
  while (hasCalendarCoverage(candidate, data)) {
    if (isMarketTradingDay(market, candidate, data)) {
      return { expectedCloseTradingDate: candidate, marketSessionState: state, calendarVersion: version };
    }
    candidate = previousCivilDate(candidate);
  }
  return { expectedCloseTradingDate: null, marketSessionState: state, calendarVersion: version };
}
