import { describe, expect, it } from 'vitest';
import { resolveMarketCloseContext, marketCalendar } from '../src/marketCalendar';
import { isTradingSessionTW, secondsUntilNextTwOpen } from '../src/time';

describe('official Taiwan holiday calendar', () => {
  it('does not open on Teacher Day', () => {
    expect(isTradingSessionTW(new Date('2026-09-28T02:00:00Z'))).toBe(false);
  });
  it('skips the four-day September holiday for the next open', () => {
    expect(secondsUntilNextTwOpen(new Date('2026-09-24T06:00:00Z'))).toBe(115 * 3600);
  });
});

describe('completed market session context', () => {
  it.each([
    ['TW', '2026-09-28T05:35:00Z', '2026-09-24', 'closed'],
    ['TW', '2026-09-29T05:36:00Z', '2026-09-29', 'post_close'],
    ['US', '2026-09-29T05:35:00Z', '2026-09-28', 'pre_open'],
    ['US', '2026-03-09T13:35:00Z', '2026-03-06', 'open'],
    ['US', '2026-11-27T18:01:00Z', '2026-11-27', 'post_close'],
    ['US', '2026-11-27T17:59:00Z', '2026-11-25', 'open'],
    ['TW', '2026-01-01T05:35:00Z', '2025-12-31', 'closed']
  ] as const)('resolves %s at %s', (market, now, expected, state) => {
    expect(resolveMarketCloseContext(market, new Date(now))).toMatchObject({
      expectedCloseTradingDate: expected, marketSessionState: state
    });
  });
  it('does not guess beyond published coverage', () => {
    expect(resolveMarketCloseContext('TW', new Date('2027-01-04T06:00:00Z')))
      .toMatchObject({ expectedCloseTradingDate: null, calendarVersion: null });
  });
  it('handles an explicitly published emergency closure', () => {
    const calendar = { ...marketCalendar, TW: { ...marketCalendar.TW,
      holidays: [...marketCalendar.TW.holidays, '2026-09-29'] } };
    expect(resolveMarketCloseContext('TW', new Date('2026-09-29T06:00:00Z'), calendar)
      .expectedCloseTradingDate).toBe('2026-09-24');
  });
});
