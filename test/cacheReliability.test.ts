import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { getQuotes } from '../src/kvCache';
import { l1Clear } from '../src/l1Cache';

function makeKv(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		store,
		namespace: {
			get: async (key: string) => store.get(key) ?? null,
			put: async (key: string, value: string) => {
				store.set(key, value);
			}
		}
	};
}

describe('cache reliability', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		l1Clear();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		l1Clear();
	});

	it('starts independent KV reads concurrently', async () => {
		const release = vi.fn();
		let resolveReads: (() => void) | undefined;
		const readsReleased = new Promise<void>((resolve) => {
			resolveReads = resolve;
		});
		const kv = {
			QUOTES_KV: {
				get: vi.fn(async (key: string) => {
					release(key);
					await readsReleased;
					return null;
				}),
				put: vi.fn(async () => undefined)
			}
		} as unknown as { QUOTES_KV: KVNamespace };

		const reads = getQuotes(kv, ['quote:TW:2330', 'quote:US:AAPL']);
		await Promise.resolve();

		expect(release).toHaveBeenCalledTimes(2);
		resolveReads?.();
		await reads;
	});

	it('shares one upstream fetch for concurrent requests of the same symbol', async () => {
		vi.setSystemTime(new Date('2026-02-10T15:00:00.000Z'));
		const kv = makeKv();
		let resolveFetch: ((response: Response) => void) | undefined;
		let resolveStarted: (() => void) | undefined;
		const fetchStarted = new Promise<void>((resolve) => {
			resolveStarted = resolve;
		});
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
					resolveStarted?.();
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const env = {
			QUOTES_KV: kv.namespace,
			FUGLE_API_KEY: 'test',
			FINNHUB_API_KEY: 'test',
			DEFAULT_MARKET: 'TW',
			MAX_SYNC_FETCH: '10',
			MAX_SYMBOLS_PER_REQUEST: '10',
			UPSTREAM_MAX_ATTEMPTS: '1'
		} as unknown as Parameters<typeof worker.fetch>[1];
		const request = () =>
			new Request('http://localhost/quotes/batch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ symbols: ['AAPL'], market: 'US' })
			});

		const first = worker.fetch(request(), env);
		await fetchStarted;
		const second = worker.fetch(request(), env);
		resolveFetch?.(
			new Response(JSON.stringify({ c: 123.45, t: Math.floor(Date.now() / 1000) }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		const [firstResponse, secondResponse] = await Promise.all([first, second]);
		const firstJson = (await firstResponse.json()) as { results: Array<{ price: number }> };
		const secondJson = (await secondResponse.json()) as { results: Array<{ price: number }> };

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(firstJson.results[0].price).toBe(123.45);
		expect(secondJson.results[0].price).toBe(123.45);
	});
});
