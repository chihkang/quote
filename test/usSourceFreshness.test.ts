import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { l1Clear } from '../src/l1Cache';

const open = '2026-10-16T14:00:00Z';
function setup(at = open) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(at));
  const values = new Map<string, string>();
  const env = { FINNHUB_API_KEY: 'fixture', FUGLE_API_KEY: 'fixture',
    QUOTES_KV: {get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => { values.set(key, value); }}
  } as unknown as Parameters<typeof worker.fetch>[1];
  return {env, values};
}
async function batch(env: Parameters<typeof worker.fetch>[1], symbols = ['TSM']) {
  return (await (await worker.fetch(new Request('https://fixture.invalid/quotes/batch', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({symbols, market: 'US'})
  }), env)).json() as any).results;
}
function provider(at: string | number | null, price = 100) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({c: price,
    t: typeof at === 'string' ? Date.parse(at) / 1000 : at}), {status: 200})));
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); l1Clear(); });

describe('US source age through the batch endpoint', () => {
  it.each([['2026-10-14T00:00:00Z', 'expired'], ['2026-10-16T13:43:00Z', 'delayed']])(
    'separates cache freshness from source %s after fetch or TTL retry', async (source, expected) => {
      const {env} = setup(); provider(source);
      const first = (await batch(env))[0];
      expect(first.status).toBe('fresh'); expect(first.isStale).toBe(false);
      expect(first.reason).toBeNull(); expect(first.sourceStatus).toBe(expected);
      expect(first.cacheOrigin).toBe('provider');
      // L1 and KV hits must retain source-age classification.
      const l1 = (await batch(env))[0];
      expect(l1.status).toBe('fresh'); expect(l1.sourceStatus).toBe(expected);
      expect(l1.cacheOrigin).toBe('l1');
      l1Clear();
      const kv = (await batch(env))[0];
      expect(kv.status).toBe('fresh'); expect(kv.sourceStatus).toBe(expected);
      expect(kv.cacheOrigin).toBe('kv');
      vi.setSystemTime(new Date('2026-10-16T14:06:00Z')); l1Clear();
      const next = (await batch(env))[0];
      expect(next.status).toBe('fresh'); expect(next.sourceStatus).toBe(expected);
      expect(next.asOf).toBe(first.asOf);
      expect(next.fetchedAt).not.toBe(first.fetchedAt);
    });
  it.each([null, 0, -1, '2026-10-16T14:02:00Z'])(
    'preserves cache status and separately rejects source timestamp %s', async source => {
      const {env, values} = setup(); provider(source);
      const q = (await batch(env))[0];
      expect(q.status).toBe('fresh'); expect(q.price).toBe(100);
      expect(q.sourceStatus).toBe('invalid'); expect(q.sourceReason).toBe('SOURCE_TIMESTAMP_INVALID');
      expect(values.size).toBe(1);
    });
  it('does not turn zero price into a usable quote', async () => {
    const {env, values} = setup(); provider(open, 0);
    expect((await batch(env))[0].status).toBe('missing'); expect(values.size).toBe(0);
  });
  it.each([
    ['2026-10-19T12:00:00Z', '2026-10-16T20:00:00Z'], // pre-open after weekend
    ['2026-07-03T14:00:00Z', '2026-07-02T20:00:00Z'], // NYSE holiday
    ['2026-11-27T19:00:00Z', '2026-11-27T18:00:00Z'] // early close
  ])('accepts the last completed provider close at %s', async (now, source) => {
    const {env} = setup(now); provider(source);
    const q = (await batch(env))[0];
    expect(q.status).toBe('fresh'); expect(q.sourceStatus).toBe('recent_close');
    expect(q.closeKind).toBe('intraday');
    expect(q.asOf).toBe(new Date(source).toISOString());
  });
  it('does not label an old intraday print as a valid weekend close', async () => {
    const {env} = setup('2026-10-19T12:00:00Z'); provider('2026-10-16T14:00:00Z');
    const q = (await batch(env))[0];
    expect(q.status).toBe('fresh'); expect(q.sourceStatus).toBe('delayed');
  });
  it('keeps a newer cached source when a renewal returns an older print', async () => {
    const {env, values} = setup();
    const key = 'quote:US:TSM';
    values.set(key, JSON.stringify({symbol: 'TSM', canonicalSymbol: 'TSM.US', market: 'US',
      price: 101, currency: 'USD', asOf: '2026-10-16T13:59:00Z',
      fetchedAt: '2026-10-16T13:50:00Z', sourceTimestampVerified: true}));
    provider('2026-10-16T13:43:00Z', 99);
    const result = (await batch(env))[0];
    expect(result.asOf).toBe('2026-10-16T13:59:00Z');
    expect(result.price).toBe(101); // legacy payload is retained, but cache status stays missing
    expect(result.status).toBe('missing'); expect(result.sourceStatus).toBe('current');
    expect(JSON.parse(values.get(key)!).price).toBe(101);
  });
  it('does not repeatedly fetch a known unverified quote before cache expiry', async () => {
    const {env, values} = setup();
    values.set('quote:US:TSM', JSON.stringify({symbol: 'TSM', canonicalSymbol: 'TSM.US',
      market: 'US', price: 99, currency: 'USD', asOf: '2026-10-16T13:59:00Z',
      fetchedAt: open, sourceTimestampVerified: false}));
    provider(open, 101);
    const result = (await batch(env))[0];
    expect(result.price).toBe(99); expect(result.status).toBe('fresh');
    expect(result.sourceStatus).toBe('invalid');
    expect(result.sourceReason).toBe('SOURCE_TIMESTAMP_INVALID');
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(values.get('quote:US:TSM')!).price).toBe(99);
    await batch(env);
    expect(fetch).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-16T14:06:00Z')); l1Clear();
    provider('2026-10-16T14:06:00Z', 101);
    const renewed = (await batch(env))[0];
    expect(renewed.price).toBe(101);
    expect(renewed.sourceTimestampVerified).toBe(true);
  });
  it('handles partial provider failure and recovery that remains delayed', async () => {
    const {env} = setup(); let failed = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('VTI') && failed) return new Response('{}', {status: 429});
      return new Response(JSON.stringify({c: 100, t: Date.parse(url.includes('VTI')
        ? '2026-10-16T13:43:00Z' : open) / 1000}), {status: 200});
    }));
    const first = await batch(env, ['TSM', 'VTI']);
    expect(first[0].status).toBe('fresh'); expect(first[1].reason).toBe('FINNHUB_ERROR');
    failed = false; l1Clear();
    const recovered = await batch(env, ['TSM', 'VTI']);
    expect(recovered[0].status).toBe('fresh'); expect(recovered[1].status).toBe('fresh');
    expect(recovered[1].sourceStatus).toBe('delayed');
    expect(recovered[1].sourceReason).toBe('SOURCE_DELAYED');
  });
});

it('logs only the bounded provider c/t and HTTP status at the fetch boundary', async () => {
  const {env} = setup(); provider(open, 101);
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    await batch(env);
    expect(info).toHaveBeenCalledWith('Finnhub quote response', {
      symbol: 'TSM', httpStatus: 200, c: 101, t: Date.parse(open) / 1000
    });
  } finally { info.mockRestore(); }
});

it('keeps cache provenance and source time visible after a failed renewal', async () => {
  const {env, values} = setup();
  values.set('quote:US:TSM', JSON.stringify({symbol: 'TSM', canonicalSymbol: 'TSM.US',
    market: 'US', price: 101, currency: 'USD', asOf: '2026-10-16T13:59:00Z',
    fetchedAt: '2026-10-16T13:50:00Z', sourceTimestampVerified: true}));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {status: 503})));
  const q = (await batch(env))[0];
  expect(q.status).toBe('missing'); expect(q.reason).toBe('FINNHUB_ERROR');
  expect(q.sourceStatus).toBe('current'); expect(q.cacheOrigin).toBe('kv');
  expect(q.asOf).toBe('2026-10-16T13:59:00Z'); expect(q.fetchedAt).toBe('2026-10-16T13:50:00Z');
  expect(JSON.parse(values.get('quote:US:TSM')!).price).toBe(101);
});
