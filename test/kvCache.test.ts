import { describe, expect, it } from 'vitest';
import { getQuote, putQuote, type QuoteCacheValue } from '../src/kvCache';

describe('kvCache', () => {
  it('stores and retrieves cached quote', async () => {
    const store = new Map<string, string>();
    const env = {
      QUOTES_KV: {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => {
          store.set(key, value);
        }
      }
    } as unknown as { QUOTES_KV: KVNamespace };

    const value: QuoteCacheValue = {
      symbol: '2330',
      canonicalSymbol: '2330.TW',
      market: 'TW',
      price: 590,
      currency: 'TWD',
      asOf: '2026-01-26T00:00:00.000Z',
      fetchedAt: '2026-01-26T00:00:01.000Z',
      softTtlJitterSec: 12
    };

    await putQuote(env, 'quote:TW:2330', value);
    const result = await getQuote(env, 'quote:TW:2330');

    expect(result).toEqual(value);
  });

  it('returns null when value is missing', async () => {
    const env = {
      QUOTES_KV: {
        get: async () => null,
        put: async () => undefined
      }
    } as unknown as { QUOTES_KV: KVNamespace };

    const result = await getQuote(env, 'quote:TW:2330');

    expect(result).toBeNull();
  });

  it('returns null when cached value is invalid JSON', async () => {
    const env = {
      QUOTES_KV: {
        get: async () => 'not-json',
        put: async () => undefined
      }
    } as unknown as { QUOTES_KV: KVNamespace };

    const result = await getQuote(env, 'quote:TW:2330');

    expect(result).toBeNull();
  });
});
