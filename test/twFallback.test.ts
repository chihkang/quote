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
