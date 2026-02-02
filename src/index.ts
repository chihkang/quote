import { l1Get, l1Set } from './l1Cache';
import { getQuote, putQuote, type QuoteCacheValue } from './kvCache';
import { classify, isStale } from './quotePolicy';
import { getTtlSeconds } from './ttl';
import { normalizeSymbols, type NormalizedSymbol } from './symbols';

export type Env = {
	QUOTES_KV: KVNamespace;
	FUGLE_API_KEY: string;
	FINNHUB_API_KEY: string;
	DEFAULT_MARKET?: string;
	MAX_SYNC_FETCH?: string;
	MAX_SYMBOLS_PER_REQUEST?: string;
	TW_OPEN?: string;
	TW_CLOSE?: string;
	US_OPEN?: string;
	US_CLOSE?: string;
	US_HOLIDAYS?: string;
	SOFT_TTL_TRADING_SEC?: string;
	HARD_TTL_TRADING_SEC?: string;
	SOFT_TTL_OFFHOURS_SEC?: string;
	HARD_TTL_OFFHOURS_SEC?: string;
	OFFHOURS_OPEN_BUFFER_SEC?: string;
	L1_TTL_SEC?: string;
};

type QuoteResult = {
	symbol: string;
	canonicalSymbol: string;
	market: 'TW' | 'US';
	price: number | null;
	currency: string | null;
	asOf: string | null;
	fetchedAt: string | null;
	status: 'fresh' | 'stale' | 'missing';
	isStale: boolean;
	reason: string | null;
};

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Max-Age': '86400'
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders
		}
	});
}

function errorResponse(message: string, status = 400): Response {
	return jsonResponse({ error: message }, status);
}

function toNumber(value: string | undefined, fallback: number): number {
	const num = Number(value);
	return Number.isFinite(num) ? num : fallback;
}

function toNumberValue(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function toIsoFromEpoch(value: unknown): string | null {
	const num = toNumberValue(value);
	if (num === null) return null;
	const ms = num < 1e11 ? num * 1000 : num > 1e14 ? Math.floor(num / 1000) : num;
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

function extractQuote(data: any): { price: number | null; currency: string | null; asOf: string | null } {
	const priceCandidates = [
		data?.lastPrice,
		data?.closePrice,
		data?.openPrice,
		data?.referencePrice,
		data?.data?.quote?.trade?.price,
		data?.data?.quote?.last?.price,
		data?.data?.quote?.price,
		data?.data?.price,
		data?.price
	];
	let price: number | null = null;
	for (const candidate of priceCandidates) {
		const parsed = toNumberValue(candidate);
		if (parsed !== null) {
			price = parsed;
			break;
		}
	}
	const currency =
		data?.data?.quote?.currency ??
		data?.data?.currency ??
		data?.currency ??
		(data?.exchange ? 'TWD' : null) ??
		(price !== null ? 'TWD' : null);

	const asOfRaw =
		data?.lastUpdated ??
		data?.closeTime ??
		data?.lastTrade?.time ??
		data?.lastTrial?.time ??
		data?.total?.time ??
		data?.data?.quote?.trade?.time ??
		data?.data?.quote?.last?.time ??
		data?.data?.quote?.time ??
		data?.data?.time ??
		null;

	let asOf: string | null = null;
	if (typeof asOfRaw === 'string' && asOfRaw) {
		const parsed = new Date(asOfRaw);
		if (!Number.isNaN(parsed.getTime())) {
			asOf = parsed.toISOString();
		}
	} else if (typeof asOfRaw === 'number' && Number.isFinite(asOfRaw)) {
		asOf = toIsoFromEpoch(asOfRaw);
	}
	return { price, currency, asOf };
}

async function fetchFugleQuote(symbol: string, env: Env) {
	const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(symbol)}`;
	const response = await fetch(url, {
		headers: {
			'X-API-KEY': env.FUGLE_API_KEY
		}
	});

	if (!response.ok) {
		throw new Error(`Fugle API error: ${response.status}`);
	}

	const data = await response.json();
	return extractQuote(data);
}

export function mapFinnhubQuote(data: any): { price: number | null; currency: string | null; asOf: string | null } {
	const price = toNumberValue(data?.c);
	if (price === null) {
		return { price: null, currency: null, asOf: null };
	}

	const asOf = toIsoFromEpoch(data?.t);
	return {
		price,
		currency: 'USD',
		asOf
	};
}

async function fetchFinnhubQuote(symbol: string, env: Env) {
	const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`;
	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Finnhub API error: ${response.status}`);
	}

	const data = await response.json();
	return mapFinnhubQuote(data);
}

async function buildFromCache(
	nowMs: number,
	ttlSoft: number,
	ttlHard: number,
	l1TtlSec: number,
	normalized: NormalizedSymbol,
	cached: QuoteCacheValue
): Promise<QuoteResult> {
	const parsedFetchedAt = Date.parse(cached.fetchedAt);
	const fetchedAtMs = Number.isFinite(parsedFetchedAt) ? parsedFetchedAt : 0;
	const status = classify(nowMs, fetchedAtMs, ttlSoft, ttlHard, cached.softTtlJitterSec ?? 0);

	const result: QuoteResult = {
		symbol: normalized.originalSymbol,
		canonicalSymbol: normalized.canonicalSymbol,
		market: normalized.market,
		price: cached.price,
		currency: cached.currency,
		asOf: cached.asOf,
		fetchedAt: cached.fetchedAt,
		status,
		isStale: isStale(status),
		reason: status === 'missing' ? 'HARD_EXPIRED' : null
	};

	l1Set(normalized.kvKey, result, l1TtlSec, nowMs);
	return result;
}

async function buildMissing(normalized: NormalizedSymbol, reason: string): Promise<QuoteResult> {
	return {
		symbol: normalized.originalSymbol,
		canonicalSymbol: normalized.canonicalSymbol,
		market: normalized.market,
		price: null,
		currency: null,
		asOf: null,
		fetchedAt: null,
		status: 'missing',
		isStale: false,
		reason
	};
}

function jitterSec(): number {
	return Math.floor(Math.random() * 301);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		if (request.method !== 'POST') {
			return errorResponse('Method Not Allowed', 405);
		}

		const pathname = new URL(request.url).pathname;
		if (pathname !== '/quotes/batch') {
			return errorResponse('Not Found', 404);
		}

		let body: { symbols?: unknown; market?: string } = {};
		try {
			body = (await request.json()) as { symbols?: unknown; market?: string };
		} catch {
			return errorResponse('Invalid JSON body', 400);
		}

		const symbolsRaw = Array.isArray(body.symbols) ? body.symbols : null;
		if (!symbolsRaw) {
			return errorResponse('symbols must be an array', 400);
		}

		const maxSymbols = toNumber(env.MAX_SYMBOLS_PER_REQUEST, 10);
		if (symbolsRaw.length === 0) {
			return errorResponse('symbols cannot be empty', 400);
		}
		if (symbolsRaw.length > maxSymbols) {
			return errorResponse(`symbols exceeds max ${maxSymbols}`, 400);
		}

		const symbols = symbolsRaw
			.map((item) => String(item).trim())
			.filter((item) => item.length > 0);

		if (symbols.length === 0) {
			return errorResponse('symbols cannot be empty', 400);
		}

		const defaultMarket = env.DEFAULT_MARKET ?? 'TW';
		const normalizedList = normalizeSymbols(symbols, body.market, defaultMarket);
		if (normalizedList.length === 0) {
			return errorResponse('symbols cannot be empty', 400);
		}

		const now = new Date();
		const nowMs = now.getTime();
		const l1TtlSec = toNumber(env.L1_TTL_SEC, 20);
		const maxSyncFetch = toNumber(env.MAX_SYNC_FETCH, 10);

		const results: QuoteResult[] = new Array(normalizedList.length);
		const missingForFetch: Array<{ index: number; item: NormalizedSymbol; reason: string }> = [];

		for (let i = 0; i < normalizedList.length; i += 1) {
			const item = normalizedList[i];

			const l1Hit = l1Get<QuoteResult>(item.kvKey, nowMs);
			if (l1Hit) {
				results[i] = l1Hit;
				continue;
			}

			const cached = await getQuote(env, item.kvKey);
			if (!cached) {
				results[i] = await buildMissing(item, 'KV_MISS');
				missingForFetch.push({ index: i, item, reason: 'KV_MISS' });
				continue;
			}

			const ttl = getTtlSeconds(item.market, now, env);
			const cachedResult = await buildFromCache(nowMs, ttl.soft, ttl.hard, l1TtlSec, item, cached);

			if (cachedResult.status === 'missing') {
				results[i] = { ...cachedResult, reason: 'HARD_EXPIRED' };
				missingForFetch.push({ index: i, item, reason: 'HARD_EXPIRED' });
				continue;
			}

			results[i] = cachedResult;
		}

		if (missingForFetch.length > 0 && maxSyncFetch > 0) {
			const fetchTargets = missingForFetch.slice(0, maxSyncFetch);

			const twTargets = fetchTargets.filter(({ item }) => item.market === 'TW');
			const usTargets = fetchTargets.filter(({ item }) => item.market === 'US');

			const twPromises = twTargets.map(async ({ index, item }) => {
				try {
					const fetchedAt = new Date().toISOString();
					const { price, currency, asOf } = await fetchFugleQuote(item.ticker, env);

					if (price === null) {
						console.warn('Fugle quote missing price', { symbol: item.ticker });
						results[index] = {
							...results[index],
							reason: 'FUGLE_ERROR'
						};
						return;
					}

					const cacheValue: QuoteCacheValue = {
						symbol: item.ticker,
						canonicalSymbol: item.canonicalSymbol,
						market: item.market,
						price,
						currency,
						asOf: asOf ?? fetchedAt,
						fetchedAt,
						softTtlJitterSec: jitterSec()
					};

					const ttl = getTtlSeconds(item.market, new Date(fetchedAt), env);
					await putQuote(env, item.kvKey, cacheValue, ttl.hard);

					const freshResult: QuoteResult = {
						symbol: item.originalSymbol,
						canonicalSymbol: item.canonicalSymbol,
						market: item.market,
						price: cacheValue.price,
						currency: cacheValue.currency,
						asOf: cacheValue.asOf,
						fetchedAt: cacheValue.fetchedAt,
						status: 'fresh',
						isStale: false,
						reason: null
					};

					l1Set(item.kvKey, freshResult, l1TtlSec);
					results[index] = freshResult;
				} catch (error) {
					console.error('Fugle quote failed', { symbol: item.ticker, error });
					results[index] = {
						...results[index],
						reason: 'FUGLE_ERROR'
					};
				}
			});

			const concurrencyLimit = 5;
			const twPromise = Promise.all(twPromises);
			for (let i = 0; i < usTargets.length; i += concurrencyLimit) {
				const batch = usTargets.slice(i, i + concurrencyLimit);
				await Promise.all(
					batch.map(async ({ index, item }) => {
						try {
							const fetchedAt = new Date().toISOString();
							const { price, currency, asOf } = await fetchFinnhubQuote(item.ticker, env);

							if (price === null) {
								console.warn('Finnhub quote missing price', { symbol: item.ticker });
								results[index] = {
									...results[index],
									reason: 'FINNHUB_ERROR'
								};
								return;
							}

							const cacheValue: QuoteCacheValue = {
								symbol: item.ticker,
								canonicalSymbol: item.canonicalSymbol,
								market: item.market,
								price,
								currency,
								asOf: asOf ?? fetchedAt,
								fetchedAt,
								softTtlJitterSec: jitterSec()
							};

							const ttl = getTtlSeconds(item.market, new Date(fetchedAt), env);
							await putQuote(env, item.kvKey, cacheValue, ttl.hard);

							const freshResult: QuoteResult = {
								symbol: item.originalSymbol,
								canonicalSymbol: item.canonicalSymbol,
								market: item.market,
								price: cacheValue.price,
								currency: cacheValue.currency,
								asOf: cacheValue.asOf,
								fetchedAt: cacheValue.fetchedAt,
								status: 'fresh',
								isStale: false,
								reason: null
							};

							l1Set(item.kvKey, freshResult, l1TtlSec);
							results[index] = freshResult;
						} catch (error) {
							console.error('Finnhub quote failed', { symbol: item.ticker, error });
							results[index] = {
								...results[index],
								reason: 'FINNHUB_ERROR'
							};
						}
					})
				);
			}

			await twPromise;
		}

		return jsonResponse({
			serverTime: now.toISOString(),
			results
		});
	}
};
