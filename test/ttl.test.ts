import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/time', () => ({
  isTradingSessionTW: vi.fn(),
  secondsUntilNextTwOpen: vi.fn(),
  isTradingSessionUS: vi.fn(),
  secondsUntilNextUsOpen: vi.fn()
}));

import { getTtlSeconds } from '../src/ttl';
import {
  isTradingSessionTW,
  isTradingSessionUS,
  secondsUntilNextTwOpen,
  secondsUntilNextUsOpen
} from '../src/time';

describe('getTtlSeconds', () => {
  it('uses trading ttl when in TW trading session', () => {
    vi.mocked(isTradingSessionTW).mockReturnValue(true);

    const ttl = getTtlSeconds('TW', new Date('2026-01-26T02:00:00Z'), {
      SOFT_TTL_TRADING_SEC: '120',
      HARD_TTL_TRADING_SEC: '600'
    });

    expect(ttl).toEqual({ soft: 120, hard: 600 });
  });

  it('uses dynamic offhours hard ttl for TW when not in trading session', () => {
    vi.mocked(isTradingSessionTW).mockReturnValue(false);
    vi.mocked(secondsUntilNextTwOpen).mockReturnValue(3780);

    const ttl = getTtlSeconds('TW', new Date('2026-01-26T02:00:00Z'), {
      SOFT_TTL_OFFHOURS_SEC: '180',
      HARD_TTL_OFFHOURS_SEC: '9999',
      OFFHOURS_OPEN_BUFFER_SEC: '180'
    });

    expect(ttl).toEqual({ soft: 180, hard: 3780 });
    expect(secondsUntilNextTwOpen).toHaveBeenCalledWith(expect.any(Date), '09:00', 180);
  });

  it('uses offhours ttl for US market', () => {
    vi.mocked(isTradingSessionTW).mockReturnValue(true);
    vi.mocked(isTradingSessionUS).mockReturnValue(false);
    vi.mocked(secondsUntilNextUsOpen).mockReturnValue(7380);

    const ttl = getTtlSeconds('US', new Date('2026-01-26T02:00:00Z'), {
      SOFT_TTL_OFFHOURS_SEC: '1000',
      HARD_TTL_OFFHOURS_SEC: '2000',
      OFFHOURS_OPEN_BUFFER_SEC: '180'
    });

    expect(ttl).toEqual({ soft: 1000, hard: 7380 });
    expect(secondsUntilNextUsOpen).toHaveBeenCalledWith(expect.any(Date), '10:30', '', 180);
  });

  it('falls back to defaults when env values are missing', () => {
    vi.mocked(isTradingSessionTW).mockReturnValue(true);

    const ttl = getTtlSeconds('TW', new Date('2026-01-26T02:00:00Z'), {});

    expect(ttl).toEqual({ soft: 300, hard: 300 });
  });
});
