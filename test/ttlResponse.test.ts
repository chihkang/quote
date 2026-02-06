import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { l1Clear } from '../src/l1Cache';

describe('API TTL fields', () => {
  it('returns ttlHardSec and expiresAt from cached value', async () => {
    l1Clear();

    const now = new Date();
    const fetchedAt = now.toISOString();
    const ttlHardSec = 1234;
    const expiresAt = new Date(now.getTime() + ttlHardSec * 1000).toISOString();

    const cachedValue = {
      symbol: '2330',
      canonicalSymbol: '2330.TW',
      market: 'TW',
      price: 1775,
      currency: 'TWD',
      asOf: fetchedAt,
      fetchedAt,
      ttlHardSec,
      expiresAt,
      softTtlJitterSec: 0
    };

    const env = {
      QUOTES_KV: {
        get: async () => JSON.stringify(cachedValue),
        put: async () => undefined
      },
      FUGLE_API_KEY: 'test',
      FINNHUB_API_KEY: 'test',
      DEFAULT_MARKET: 'TW',
      MAX_SYNC_FETCH: '0',
      MAX_SYMBOLS_PER_REQUEST: '10'
    } as unknown as Parameters<typeof worker.fetch>[1];

    const request = new Request('http://localhost/quotes/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: ['2330'], market: 'TW' })
    });

    const response = await worker.fetch(request, env);
    const json = await response.json();

    expect(json.results[0].ttlHardSec).toBe(ttlHardSec);
    expect(json.results[0].expiresAt).toBe(expiresAt);
  });
});
