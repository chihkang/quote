import { describe, expect, it } from 'vitest';
import { isTradingSessionTWParts } from '../src/time';

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
