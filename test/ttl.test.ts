import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/time', () => ({
  isTradingSessionTW: vi.fn()
}));

import { getTtlSeconds } from '../src/ttl';
import { isTradingSessionTW } from '../src/time';

describe('getTtlSeconds', () => {
  it('uses trading ttl when in TW trading session', () => {
    vi.mocked(isTradingSessionTW).mockReturnValue(true);

    const ttl = getTtlSeconds('TW', new Date('2026-01-26T02:00:00Z'), {
      SOFT_TTL_TRADING_SEC: '120',
      HARD_TTL_TRADING_SEC: '600'
    });

    expect(ttl).toEqual({ soft: 120, hard: 600 });
  });

  it('uses offhours ttl when not in trading session', () => {
    vi.mocked(isTradingSessionTW).mockReturnValue(false);

    const ttl = getTtlSeconds('TW', new Date('2026-01-26T02:00:00Z'), {
      SOFT_TTL_OFFHOURS_SEC: '900',
      HARD_TTL_OFFHOURS_SEC: '3600'
    });

    expect(ttl).toEqual({ soft: 900, hard: 3600 });
  });

  it('uses offhours ttl for US market', () => {
    vi.mocked(isTradingSessionTW).mockReturnValue(true);

    const ttl = getTtlSeconds('US', new Date('2026-01-26T02:00:00Z'), {
      SOFT_TTL_OFFHOURS_SEC: '1000',
      HARD_TTL_OFFHOURS_SEC: '2000'
    });

    expect(ttl).toEqual({ soft: 1000, hard: 2000 });
  });

  it('falls back to defaults when env values are missing', () => {
    vi.mocked(isTradingSessionTW).mockReturnValue(true);

    const ttl = getTtlSeconds('TW', new Date('2026-01-26T02:00:00Z'), {});

    expect(ttl).toEqual({ soft: 300, hard: 129600 });
  });
});
