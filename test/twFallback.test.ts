import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { l1Clear } from '../src/l1Cache';
import {
	clearTwEodL1Cache,
	TPEX_EOD_LATEST_KEY,
	TWSE_EOD_LATEST_KEY,
	type TwEodSnapshot
} from '../src/twEod';

type KVPutOptions = {
	expirationTtl?: number;
};

function createKv(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		store,
		namespace: {
			get: async (key: string) => store.get(key) ?? null,
			put: async (key: string, value: string, _options?: KVPutOptions) => {
				store.set(key, value);
			}
		}
	};
}

function createR2(initial: Record<string, string> = {}) {
	const objects = new Map(Object.entries(initial));
	return {
		objects,
		bucket: {
			get: async (key: string) => {
				const raw = objects.get(key);
				if (raw === undefined) return null;
				return {
					text: async () => raw,
					json: async () => JSON.parse(raw)
				} as unknown as R2ObjectBody;
			},
			put: async (key: string, value: string) => {
				objects.set(key, value);
			}
		} as unknown as R2Bucket
	};
}

function buildTwEodSnapshot(overrides?: Partial<TwEodSnapshot>): TwEodSnapshot {
	return {
		tradingDate: '2026-02-10',
		fetchedAt: '2026-02-10T06:00:00.000Z',
		source: 'TWSE_STOCK_DAY_ALL',
		quotes: {
			'0050': { close: 75.5, name: '元大台灣50' },
			'2330': { close: 1080, name: '台積電' },
			'2317': { close: 180.5, name: '鴻海' }
		},
		...overrides
	};
}

function makeEnv(args: {
	kv: ReturnType<typeof createKv>;
	r2: ReturnType<typeof createR2>;
	overrides?: Record<string, string>;
}) {
	return {
		QUOTES_KV: args.kv.namespace,
		TW_EOD_R2: args.r2.bucket,
		FUGLE_API_KEY: 'test',
		FINNHUB_API_KEY: 'test',
		DEFAULT_MARKET: 'TW',
		MAX_SYNC_FETCH: '10',
		MAX_SYMBOLS_PER_REQUEST: '10',
		TW_OPEN: '09:00',
		TW_CLOSE: '13:30',
		TW_429_BLOCK_SEC: '60',
		...args.overrides
	} as unknown as Parameters<typeof worker.fetch>[1];
}

async function callTwBatch(env: Parameters<typeof worker.fetch>[1], symbols: string[]) {
	const request = new Request('http://localhost/quotes/batch', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ symbols, market: 'TW' })
	});
	return worker.fetch(request, env);
}

describe('TW EOD fallback behavior', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		l1Clear();
		clearTwEodL1Cache();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		l1Clear();
		clearTwEodL1Cache();
	});

	it('returns TW EOD data during off-hours without calling Fugle', async () => {
		vi.setSystemTime(new Date('2026-02-10T06:00:00.000Z')); // 14:00 Asia/Taipei
		const kv = createKv();
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(buildTwEodSnapshot())
		});

		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['50']);
		const json = (await response.json()) as any;

		expect(fetchMock).not.toHaveBeenCalled();
		expect(json.results[0].price).toBe(75.5);
		expect(json.results[0].status).toBe('fresh');
		expect(json.results[0].reason).toBe('TW_EOD_OFFHOURS');
	});

	it('returns official EOD close after close even when quote cache has an earlier value', async () => {
		vi.setSystemTime(new Date('2026-02-10T06:00:00.000Z')); // 14:00 Asia/Taipei
		const kv = createKv({
			'quote:TW:2330': JSON.stringify({
				symbol: '2330',
				canonicalSymbol: '2330.TW',
				market: 'TW',
				price: 1090,
				currency: 'TWD',
				asOf: '2026-02-10T05:29:00.000Z',
				fetchedAt: '2026-02-10T05:29:05.000Z',
				ttlHardSec: 300,
				expiresAt: '2026-02-10T05:34:05.000Z',
				softTtlJitterSec: 0
			})
		});
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(buildTwEodSnapshot())
		});

		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['2330']);
		const json = (await response.json()) as any;

		expect(fetchMock).not.toHaveBeenCalled();
		expect(json.results[0].price).toBe(1080);
		expect(json.results[0].closeKind).toBe('official_eod');
		expect(json.results[0].sourceTradingDate).toBe('2026-02-10');
		expect(json.results[0].targetTradingDate).toBe('2026-02-10');
	});

	it('returns official EOD close after close even when quote L1 has an earlier intraday value', async () => {
		vi.setSystemTime(new Date('2026-02-10T05:29:00.000Z')); // 13:29 Asia/Taipei
		const kv = createKv();
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(buildTwEodSnapshot())
		});
		const env = makeEnv({
			kv,
			r2,
			overrides: {
				L1_TTL_SEC: '3600'
			}
		});

		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					lastPrice: 1090,
					lastUpdated: '2026-02-10T05:29:00.000Z'
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				}
			)
		);
		vi.stubGlobal('fetch', fetchMock);

		const intradayResponse = await callTwBatch(env, ['2330']);
		const intradayJson = (await intradayResponse.json()) as any;
		expect(intradayJson.results[0].price).toBe(1090);
		expect(intradayJson.results[0].closeKind).toBe('intraday');

		vi.setSystemTime(new Date('2026-02-10T06:00:00.000Z')); // 14:00 Asia/Taipei
		const closeResponse = await callTwBatch(env, ['2330']);
		const closeJson = (await closeResponse.json()) as any;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(closeJson.results[0].price).toBe(1080);
		expect(closeJson.results[0].closeKind).toBe('official_eod');
		expect(closeJson.results[0].sourceTradingDate).toBe('2026-02-10');
		expect(closeJson.results[0].targetTradingDate).toBe('2026-02-10');
	});

	it('uses a same-day Fugle quote as provisional close when today EOD is not ready after close', async () => {
		vi.setSystemTime(new Date('2026-02-10T06:00:00.000Z')); // 14:00 Asia/Taipei
		const kv = createKv();
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(
				buildTwEodSnapshot({
					tradingDate: '2026-02-09',
					fetchedAt: '2026-02-09T06:00:00.000Z'
				})
			)
		});

		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					lastPrice: 1090,
					lastUpdated: '2026-02-10T05:31:00.000Z'
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				}
			)
		);
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['2330']);
		const json = (await response.json()) as any;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(json.results[0].price).toBe(1090);
		expect(json.results[0].closeKind).toBe('provisional');
		expect(json.results[0].sourceTradingDate).toBe('2026-02-10');
		expect(json.results[0].targetTradingDate).toBe('2026-02-10');
	});

	it('infers provisional source trading date from fetchedAt when Fugle omits asOf after close', async () => {
		vi.setSystemTime(new Date('2026-02-10T06:00:00.000Z')); // 14:00 Asia/Taipei
		const kv = createKv();
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(
				buildTwEodSnapshot({
					tradingDate: '2026-02-09',
					fetchedAt: '2026-02-09T06:00:00.000Z'
				})
			)
		});

		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ lastPrice: 1090 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['2330']);
		const json = (await response.json()) as any;

		expect(json.results[0].price).toBe(1090);
		expect(json.results[0].asOf).toBeNull();
		expect(json.results[0].fetchedAt).toBe('2026-02-10T06:00:00.000Z');
		expect(json.results[0].closeKind).toBe('provisional');
		expect(json.results[0].sourceTradingDate).toBe('2026-02-10');
	});

	it('returns unavailable after close when Fugle quote is not from the target trading date', async () => {
		vi.setSystemTime(new Date('2026-02-10T06:00:00.000Z')); // 14:00 Asia/Taipei
		const kv = createKv();
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(
				buildTwEodSnapshot({
					tradingDate: '2026-02-09',
					fetchedAt: '2026-02-09T06:00:00.000Z'
				})
			)
		});

		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					lastPrice: 1090,
					lastUpdated: '2026-02-09T05:31:00.000Z'
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				}
			)
		);
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['2330']);
		const json = (await response.json()) as any;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(json.results[0].price).toBeNull();
		expect(json.results[0].status).toBe('missing');
		expect(json.results[0].reason).toBe('TW_PROVISIONAL_SOURCE_DATE_MISMATCH');
		expect(json.results[0].closeKind).toBe('unavailable');
		expect(json.results[0].sourceTradingDate).toBeNull();
		expect(json.results[0].targetTradingDate).toBe('2026-02-10');
	});

	it('returns unavailable after close when Fugle provides an unparseable asOf timestamp', async () => {
		vi.setSystemTime(new Date('2026-02-10T06:00:00.000Z')); // 14:00 Asia/Taipei
		const kv = createKv();
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(
				buildTwEodSnapshot({
					tradingDate: '2026-02-09',
					fetchedAt: '2026-02-09T06:00:00.000Z'
				})
			)
		});

		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					lastPrice: 1090,
					lastUpdated: 'not-a-date'
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				}
			)
		);
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['2330']);
		const json = (await response.json()) as any;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(json.results[0].price).toBeNull();
		expect(json.results[0].reason).toBe('TW_PROVISIONAL_SOURCE_DATE_MISMATCH');
		expect(json.results[0].closeKind).toBe('unavailable');
		expect(json.results[0].sourceTradingDate).toBeNull();
		expect(json.results[0].targetTradingDate).toBe('2026-02-10');
	});

	it('keeps a stale TW cache result as intraday during the regular session', async () => {
		vi.setSystemTime(new Date('2026-02-10T02:10:00.000Z')); // 10:10 Asia/Taipei
		const kv = createKv({
			'quote:TW:2330': JSON.stringify({
				symbol: '2330',
				canonicalSymbol: '2330.TW',
				market: 'TW',
				price: 1090,
				currency: 'TWD',
				asOf: '2026-02-10T02:00:00.000Z',
				fetchedAt: '2026-02-10T02:00:00.000Z',
				ttlHardSec: 3600,
				expiresAt: '2026-02-10T03:00:00.000Z',
				softTtlJitterSec: 0
			})
		});
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(buildTwEodSnapshot())
		});

		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(
			makeEnv({
				kv,
				r2,
				overrides: {
					SOFT_TTL_TRADING_SEC: '1',
					HARD_TTL_TRADING_SEC: '3600'
				}
			}),
			['2330']
		);
		const json = (await response.json()) as any;

		expect(fetchMock).not.toHaveBeenCalled();
		expect(json.results[0].status).toBe('stale');
		expect(json.results[0].isStale).toBe(true);
		expect(json.results[0].closeKind).toBe('intraday');
		expect(json.results[0].sourceTradingDate).toBe('2026-02-10');
		expect(json.results[0].targetTradingDate).toBe('2026-02-10');
	});

	it('falls back to TW EOD on 429 and blocks further Fugle calls in same request', async () => {
		vi.setSystemTime(new Date('2026-02-10T02:00:00.000Z')); // 10:00 Asia/Taipei
		const kv = createKv();
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(buildTwEodSnapshot())
		});

		const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }));
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['2330', '2317']);
		const json = (await response.json()) as any;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(json.results[0].reason).toBe('TW_EOD_FALLBACK_429');
		expect(json.results[0].status).toBe('stale');
		expect(json.results[1].reason).toBe('TW_EOD_FALLBACK_429');
		expect(json.results[1].status).toBe('stale');
		expect(kv.store.get('sys:tw:fugle:block_until')).toBeTruthy();
	});

	it('uses existing block key to skip Fugle calls and fallback to TW EOD', async () => {
		vi.setSystemTime(new Date('2026-02-10T02:00:00.000Z')); // 10:00 Asia/Taipei
		const nowMs = Date.now();
		const kv = createKv({
			'sys:tw:fugle:block_until': String(nowMs + 60_000)
		});
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(buildTwEodSnapshot())
		});

		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['2330']);
		const json = (await response.json()) as any;

		expect(fetchMock).not.toHaveBeenCalled();
		expect(json.results[0].reason).toBe('TW_EOD_FALLBACK_429');
		expect(json.results[0].status).toBe('stale');
	});

	it('resumes Fugle calls after block expires', async () => {
		vi.setSystemTime(new Date('2026-02-10T02:00:00.000Z')); // 10:00 Asia/Taipei
		const nowMs = Date.now();
		const kv = createKv({
			'sys:tw:fugle:block_until': String(nowMs - 1)
		});
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(buildTwEodSnapshot())
		});

		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ lastPrice: 1090 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['2330']);
		const json = (await response.json()) as any;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(json.results[0].price).toBe(1090);
		expect(json.results[0].status).toBe('fresh');
		expect(json.results[0].reason).toBeNull();
	});

	it('falls back to TPEX snapshot when TWSE snapshot misses symbol', async () => {
		vi.setSystemTime(new Date('2026-02-10T06:00:00.000Z')); // 14:00 Asia/Taipei
		const kv = createKv();
		const r2 = createR2({
			[TWSE_EOD_LATEST_KEY]: JSON.stringify(
				buildTwEodSnapshot({
					quotes: {
						'2330': { close: 1080, name: '台積電' }
					}
				})
			),
			[TPEX_EOD_LATEST_KEY]: JSON.stringify({
				tradingDate: '2026-02-10',
				fetchedAt: '2026-02-10T06:00:00.000Z',
				source: 'TPEX_STK_QUOTE_RESULT',
				quotes: {
					'006201': { close: 29.08, name: '元大富櫃50' }
				}
			} satisfies TwEodSnapshot)
		});

		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const response = await callTwBatch(makeEnv({ kv, r2 }), ['006201']);
		const json = (await response.json()) as any;

		expect(fetchMock).not.toHaveBeenCalled();
		expect(json.results[0].price).toBe(29.08);
		expect(json.results[0].reason).toBe('TW_EOD_OFFHOURS');
		expect(json.results[0].status).toBe('fresh');
	});
});
