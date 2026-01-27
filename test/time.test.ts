import { describe, expect, it } from 'vitest';
import { isTradingSessionTWParts, secondsUntilNextTwOpen } from '../src/time';

const OPEN = '09:00';
const CLOSE = '13:30';

describe('isTradingSessionTWParts', () => {
  it('returns false before open', () => {
    expect(isTradingSessionTWParts({ weekday: 1, hour: 8, minute: 59 }, OPEN, CLOSE)).toBe(false);
  });

  it('returns true at open', () => {
    expect(isTradingSessionTWParts({ weekday: 1, hour: 9, minute: 0 }, OPEN, CLOSE)).toBe(true);
  });

  it('returns true at close', () => {
    expect(isTradingSessionTWParts({ weekday: 1, hour: 13, minute: 30 }, OPEN, CLOSE)).toBe(true);
  });

  it('returns false after close', () => {
    expect(isTradingSessionTWParts({ weekday: 1, hour: 13, minute: 31 }, OPEN, CLOSE)).toBe(false);
  });

  it('returns false on weekend', () => {
    expect(isTradingSessionTWParts({ weekday: 6, hour: 10, minute: 0 }, OPEN, CLOSE)).toBe(false);
  });
});

describe('secondsUntilNextTwOpen', () => {
  it('returns seconds until same-day open before open', () => {
    const seconds = secondsUntilNextTwOpen(new Date('2026-01-27T00:00:00Z'));
    expect(seconds).toBe(3600);
  });

  it('returns seconds until next weekday open after close', () => {
    const seconds = secondsUntilNextTwOpen(new Date('2026-01-27T06:00:00Z'));
    expect(seconds).toBe(68400);
  });

  it('returns seconds until Monday open after Friday close', () => {
    const seconds = secondsUntilNextTwOpen(new Date('2026-01-30T06:00:00Z'));
    expect(seconds).toBe(241200);
  });

  it('returns seconds until Monday open on Saturday', () => {
    const seconds = secondsUntilNextTwOpen(new Date('2026-01-31T00:00:00Z'));
    expect(seconds).toBe(176400);
  });
});
