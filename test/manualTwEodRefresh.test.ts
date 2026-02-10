import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { clearTwEodL1Cache, TPEX_EOD_LATEST_KEY, TWSE_EOD_LATEST_KEY } from '../src/twEod';

function createKv() {
	return {
		get: async (_key: string) => null,
		put: async (_key: string, _value: string) => undefined
	} as KVNamespace;
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
			},
			list: async (options?: R2ListOptions) => {
				const prefix = options?.prefix ?? '';
				const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
				return {
					objects: keys.map((key) => ({ key } as R2Object)),
					delimitedPrefixes: [],
					truncated: false,
					cursor: ''
				} as unknown as R2Objects;
			},
			delete: async (keys: string | string[]) => {
				const targets = Array.isArray(keys) ? keys : [keys];
				for (const key of targets) {
					objects.delete(key);
				}
			}
		} as unknown as R2Bucket
	};
}

function buildEnv(r2: ReturnType<typeof createR2>, overrides?: Partial<Parameters<typeof worker.fetch>[1]>) {
	return {
		QUOTES_KV: createKv(),
		TW_EOD_R2: r2.bucket,
		FUGLE_API_KEY: 'test',
		FINNHUB_API_KEY: 'test',
		...overrides
	} as unknown as Parameters<typeof worker.fetch>[1];
}

async function callManualRefresh(
	env: Parameters<typeof worker.fetch>[1],
	headers?: Record<string, string>
) {
	const request = new Request('http://localhost/admin/twse/eod/refresh', {
		method: 'POST',
		headers
	});
	return worker.fetch(request, env);
}

const TWSE_CSV = ['日期,證券代號,證券名稱,收盤價', '1150210,50,元大台灣50,75.50', '1150210,2330,台積電,1080'].join(
	'\n'
);

const TPEX_OPENAPI_JSON = [
	{
		Date: '1150210',
		SecuritiesCompanyCode: '006201',
		CompanyName: '元大富櫃50',
		Close: '29.08'
	},
	{
		Date: '1150210',
		SecuritiesCompanyCode: '8069',
		CompanyName: '元太',
		Close: '185.00'
	}
];

describe('manual TWSE/TPEX EOD refresh endpoint', () => {
	beforeEach(() => {
		clearTwEodL1Cache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		clearTwEodL1Cache();
	});

	it('returns 503 when ADMIN_REFRESH_TOKEN is not configured', async () => {
		const env = buildEnv(createR2());
		const response = await callManualRefresh(env);

		expect(response.status).toBe(503);
	});

	it('returns 401 when token is invalid', async () => {
		const env = buildEnv(createR2(), { ADMIN_REFRESH_TOKEN: 'secret-token' });
		const response = await callManualRefresh(env, { 'x-admin-token': 'wrong-token' });

		expect(response.status).toBe(401);
	});

	it('refreshes both sources, cleans stale files, and is idempotent on same trading date', async () => {
		const r2 = createR2({
			'twse/eod/2026-02-09.json': JSON.stringify({
				tradingDate: '2026-02-09',
				fetchedAt: '2026-02-09T06:00:00.000Z',
				source: 'TWSE_STOCK_DAY_ALL',
				quotes: {}
			}),
			'tpex/eod/2026-02-09.json': JSON.stringify({
				tradingDate: '2026-02-09',
				fetchedAt: '2026-02-09T06:00:00.000Z',
				source: 'TPEX_STK_QUOTE_RESULT',
				quotes: {}
			})
		});
		const env = buildEnv(r2, { ADMIN_REFRESH_TOKEN: 'secret-token' });
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('twse.com.tw')) {
				return new Response(TWSE_CSV, { status: 200 });
			}
			if (url.includes('tpex.org.tw')) {
				return new Response(JSON.stringify(TPEX_OPENAPI_JSON), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			return new Response('not found', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const first = await callManualRefresh(env, { 'x-admin-token': 'secret-token' });
		const firstJson = (await first.json()) as any;

		expect(first.status).toBe(200);
		expect(firstJson.ok).toBe(true);
		expect(firstJson.partial).toBe(false);
		expect(firstJson.twse.updated).toBe(true);
		expect(firstJson.twse.tradingDate).toBe('2026-02-10');
		expect(firstJson.twse.deletedCount).toBe(1);
		expect(firstJson.tpex.updated).toBe(true);
		expect(firstJson.tpex.tradingDate).toBe('2026-02-10');
		expect(firstJson.tpex.deletedCount).toBe(1);
		expect(r2.objects.has(TWSE_EOD_LATEST_KEY)).toBe(true);
		expect(r2.objects.has(TPEX_EOD_LATEST_KEY)).toBe(true);
		expect(r2.objects.has('twse/eod/2026-02-09.json')).toBe(false);
		expect(r2.objects.has('tpex/eod/2026-02-09.json')).toBe(false);

		const second = await callManualRefresh(env, {
			authorization: 'Bearer secret-token'
		});
		const secondJson = (await second.json()) as any;

		expect(second.status).toBe(200);
		expect(secondJson.ok).toBe(true);
		expect(secondJson.partial).toBe(false);
		expect(secondJson.twse.updated).toBe(false);
		expect(secondJson.tpex.updated).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('returns partial success when only one source refreshes', async () => {
		const env = buildEnv(createR2(), { ADMIN_REFRESH_TOKEN: 'secret-token' });
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('twse.com.tw')) {
				return new Response(TWSE_CSV, { status: 200 });
			}
			if (url.includes('tpex.org.tw')) {
				return new Response('upstream error', { status: 500 });
			}
			return new Response('not found', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const response = await callManualRefresh(env, { 'x-admin-token': 'secret-token' });
		const json = (await response.json()) as any;

		expect(response.status).toBe(200);
		expect(json.ok).toBe(true);
		expect(json.partial).toBe(true);
		expect(json.twse.error).toBeUndefined();
		expect(json.tpex.error).toMatch('TPEX EOD fetch failed');
	});

	it('uses cached TPEX snapshot when upstream redirects to error pages', async () => {
		const r2 = createR2({
			[TPEX_EOD_LATEST_KEY]: JSON.stringify({
				tradingDate: '2026-02-10',
				fetchedAt: '2026-02-10T08:40:32.907Z',
				source: 'TPEX_OPENAPI_MAINBOARD_DAILY_CLOSE_QUOTES',
				quotes: {
					'006201': { close: 29.08, name: '元大富櫃50' }
				}
			})
		});
		const env = buildEnv(r2, { ADMIN_REFRESH_TOKEN: 'secret-token' });
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('twse.com.tw')) {
				return new Response(TWSE_CSV, { status: 200 });
			}
			if (url.includes('tpex.org.tw')) {
				return new Response(null, {
					status: 302,
					headers: { Location: 'https://www.tpex.org.tw/errors' }
				});
			}
			return new Response('not found', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const response = await callManualRefresh(env, { 'x-admin-token': 'secret-token' });
		const json = (await response.json()) as any;

		expect(response.status).toBe(200);
		expect(json.ok).toBe(true);
		expect(json.partial).toBe(false);
		expect(json.tpex.error).toBeUndefined();
		expect(json.tpex.updated).toBe(false);
		expect(json.tpex.tradingDate).toBe('2026-02-10');
		expect(json.tpex.quoteCount).toBe(1);
	});

	it('falls back to legacy TPEX endpoint when OpenAPI is redirected', async () => {
		const env = buildEnv(createR2(), { ADMIN_REFRESH_TOKEN: 'secret-token' });
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('twse.com.tw')) {
				return new Response(TWSE_CSV, { status: 200 });
			}
			if (url.includes('/openapi/v1/')) {
				return new Response(null, {
					status: 302,
					headers: { Location: 'https://www.tpex.org.tw/errors' }
				});
			}
			if (url.includes('stk_quote_result.php')) {
				return new Response(
					JSON.stringify({
						date: '20260210',
						tables: [
							{
								title: '上櫃股票行情',
								fields: ['代號', '名稱', '收盤'],
								data: [['006201', '元大富櫃50', '29.08']]
							}
						]
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					}
				);
			}
			return new Response('not found', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const response = await callManualRefresh(env, { 'x-admin-token': 'secret-token' });
		const json = (await response.json()) as any;

		expect(response.status).toBe(200);
		expect(json.ok).toBe(true);
		expect(json.partial).toBe(false);
		expect(json.tpex.error).toBeUndefined();
		expect(json.tpex.updated).toBe(true);
		expect(json.tpex.tradingDate).toBe('2026-02-10');
		expect(json.tpex.quoteCount).toBe(1);
	});

	it('returns 500 when both sources fail', async () => {
		const env = buildEnv(createR2(), { ADMIN_REFRESH_TOKEN: 'secret-token' });
		const fetchMock = vi.fn(async () => new Response('upstream error', { status: 500 }));
		vi.stubGlobal('fetch', fetchMock);

		const response = await callManualRefresh(env, { 'x-admin-token': 'secret-token' });
		const json = (await response.json()) as any;

		expect(response.status).toBe(500);
		expect(json.ok).toBe(false);
		expect(json.partial).toBe(false);
		expect(json.twse.error).toMatch('TWSE EOD fetch failed');
		expect(json.tpex.error).toMatch('TPEX EOD fetch failed');
	});
});
