import { l1Get, l1Set } from './l1Cache';
import { getQuote, getQuotes, putQuote, type QuoteCacheValue } from './kvCache';
import { classify, isStale } from './quotePolicy';
import { normalizeSymbols, type NormalizedSymbol } from './symbols';
import {
	fetchWithRetry,
	HttpStatusError,
	UpstreamDeadlineError,
	waitForDeadline
} from './upstream';
import {
	getNewYorkDateISO,
	getTaipeiDateISO,
	getTaipeiParts,
	isTradingSessionTW,
	parseTimeHHMM
} from './time';
import { getTtlSeconds } from './ttl';
import {
	getLatestTpexEodSnapshot,
	getLatestTwseEodSnapshot,
	getTwEodQuote,
	refreshTpexEodSnapshot,
	refreshTwseEodSnapshot,
	type RefreshResult,
	type TwEodSnapshot
} from './twEod';

export type Env = {
	QUOTES_KV: KVNamespace;
	FUGLE_API_KEY: string;
	FINNHUB_API_KEY: string;
	TW_EOD_R2?: R2Bucket;
	ADMIN_REFRESH_TOKEN?: string;
	DEFAULT_MARKET?: string;
	MAX_SYNC_FETCH?: string;
	MAX_SYMBOLS_PER_REQUEST?: string;
	TW_OPEN?: string;
	TW_CLOSE?: string;
	US_HOLIDAYS?: string;
	SOFT_TTL_TRADING_SEC?: string;
	HARD_TTL_TRADING_SEC?: string;
	SOFT_TTL_OFFHOURS_SEC?: string;
	HARD_TTL_OFFHOURS_SEC?: string;
	OFFHOURS_OPEN_BUFFER_SEC?: string;
	L1_TTL_SEC?: string;
	TWSE_EOD_URL?: string;
	TPEX_EOD_URL?: string;
	TW_EOD_PATCH_ROWS?: string;
	TW_429_BLOCK_SEC?: string;
	TW_EOD_L1_SEC?: string;
	UPSTREAM_TIMEOUT_MS?: string;
	UPSTREAM_MAX_ATTEMPTS?: string;
	UPSTREAM_RETRY_BASE_MS?: string;
	UPSTREAM_RETRY_MAX_DELAY_MS?: string;
	UPSTREAM_REQUEST_DEADLINE_MS?: string;
};

type CloseKind = 'intraday' | 'provisional' | 'official_eod' | 'unavailable';
type QuoteStatus = 'fresh' | 'stale' | 'missing';
type TwEodHitReason = 'TW_EOD_OFFHOURS' | 'TW_EOD_FALLBACK_429';

type QuoteResult = {
	symbol: string;
	canonicalSymbol: string;
	market: 'TW' | 'US';
	price: number | null;
	currency: string | null;
	asOf: string | null;
	fetchedAt: string | null;
	ttlHardSec: number | null;
	expiresAt: string | null;
	status: QuoteStatus;
	isStale: boolean;
	reason: string | null;
	closeKind: CloseKind;
	sourceTradingDate: string | null;
	targetTradingDate: string;
};

type ExtractedQuote = {
	price: number | null;
	currency: string | null;
	asOf: string | null;
	hasExplicitAsOf: boolean;
};

type FetchQuoteResult = Omit<ExtractedQuote, 'hasExplicitAsOf'> & {
	hasExplicitAsOf?: boolean;
};

type SharedQuoteOutcome =
	| {
			cacheValue: QuoteCacheValue;
			fromCache: boolean;
			sourceTradingDate: string | null;
			officialEod?: undefined;
	  }
	| {
			cacheValue: null;
			failure: 'NO_PRICE' | 'SOURCE_DATE_MISMATCH';
			fromCache: false;
			sourceTradingDate: string | null;
			officialEod?: undefined;
	  }
	| {
			cacheValue: null;
			fromCache: false;
			sourceTradingDate: string;
			officialEod: TwEodSnapshot;
			failure?: undefined;
	  };

class CacheReadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CacheReadError';
	}
}

class EodReadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EodReadError';
	}
}

const TW_FUGLE_BLOCK_KEY = 'sys:tw:fugle:block_until';
const DEFAULT_UPSTREAM_REQUEST_DEADLINE_MS = 10_000;
const inFlightQuoteFetches = new Map<string, Promise<SharedQuoteOutcome>>();

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
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

function toPositiveNumber(value: string | undefined, fallback: number): number {
	const num = Number(value);
	return Number.isFinite(num) && num > 0 ? num : fallback;
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

function eodAsOf(tradingDate: string): string | null {
	if (!tradingDate) return null;
	const iso = new Date(`${tradingDate}T13:30:00+08:00`);
	if (Number.isNaN(iso.getTime())) return null;
	return iso.toISOString();
}

function parseDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function getMarketDateISO(market: 'TW' | 'US', date: Date): string {
	return market === 'US' ? getNewYorkDateISO(date) : getTaipeiDateISO(date);
}

function getSourceTradingDate(
	market: 'TW' | 'US',
	asOf: string | null | undefined,
	fetchedAt: string | null | undefined
): string | null {
	const sourceDate = parseDate(asOf) ?? parseDate(fetchedAt);
	return sourceDate ? getMarketDateISO(market, sourceDate) : null;
}

function getProvisionalSourceTradingDate(
	asOf: string | null,
	fetchedAt: string,
	hasExplicitAsOf: boolean
): string | null {
	const explicitAsOf = parseDate(asOf);
	if (hasExplicitAsOf) {
		return explicitAsOf ? getTaipeiDateISO(explicitAsOf) : null;
	}

	const fetchedAtDate = parseDate(fetchedAt);
	return fetchedAtDate ? getTaipeiDateISO(fetchedAtDate) : null;
}

function isAfterTwRegularClose(now: Date, close: string): boolean {
	const parts = getTaipeiParts(now);
	if (parts.weekday < 1 || parts.weekday > 5) return false;
	const closeParts = parseTimeHHMM(close);
	const nowMinutes = parts.hour * 60 + parts.minute;
	const closeMinutes = closeParts.hour * 60 + closeParts.minute;
	return nowMinutes > closeMinutes;
}

function extractQuote(data: any): ExtractedQuote {
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
	const hasExplicitAsOf = asOfRaw !== null && asOfRaw !== undefined && asOfRaw !== '';

	let asOf: string | null = null;
	if (typeof asOfRaw === 'string' && asOfRaw) {
		const parsed = new Date(asOfRaw);
		if (!Number.isNaN(parsed.getTime())) {
			asOf = parsed.toISOString();
		}
	} else if (typeof asOfRaw === 'number' && Number.isFinite(asOfRaw)) {
		asOf = toIsoFromEpoch(asOfRaw);
	}
	return { price, currency, asOf, hasExplicitAsOf };
}

function getSingleFlightKey(
	normalized: NormalizedSymbol,
	closeResolution: boolean,
	targetTradingDate: string
): string {
	return closeResolution
		? `${normalized.kvKey}:provisional:${targetTradingDate}`
		: `${normalized.kvKey}:intraday`;
}

function isUsableCachedQuote(
	nowMs: number,
	normalized: NormalizedSymbol,
	cached: QuoteCacheValue,
	env: Env
): boolean {
	const fetchedAtMs = Date.parse(cached.fetchedAt);
	const ttl = getTtlSeconds(normalized.market, new Date(nowMs), env);
	const status = classify(
		nowMs,
		Number.isFinite(fetchedAtMs) ? fetchedAtMs : 0,
		ttl.soft,
		ttl.hard,
		cached.softTtlJitterSec ?? 0
	);
	return status !== 'missing';
}

type OfficialEodRecheck = () => Promise<TwEodSnapshot | null>;
type QuoteFetcher = (deadlineAtMs?: number) => Promise<FetchQuoteResult>;

async function getOrFetchQuote(
	env: Env,
	normalized: NormalizedSymbol,
	targetTradingDate: string,
	closeResolution: boolean,
	fetcher: QuoteFetcher,
	officialEodRecheck?: OfficialEodRecheck,
	deadlineAtMs?: number
): Promise<SharedQuoteOutcome> {
	const key = getSingleFlightKey(normalized, closeResolution, targetTradingDate);
	const existing = inFlightQuoteFetches.get(key);
	if (existing) return waitForDeadline(existing, deadlineAtMs);

	const promise = (async (): Promise<SharedQuoteOutcome> => {
		if (deadlineAtMs !== undefined && deadlineAtMs <= Date.now()) {
			throw new UpstreamDeadlineError();
		}

		if (closeResolution && officialEodRecheck) {
			let officialEod: TwEodSnapshot | null;
			try {
				officialEod = await officialEodRecheck();
			} catch (error) {
				throw new EodReadError(`TW EOD recheck failed for ${normalized.kvKey}: ${String(error)}`);
			}

			if (officialEod) {
				return {
					cacheValue: null,
					fromCache: false,
					sourceTradingDate: officialEod.tradingDate,
					officialEod
				};
			}
		}

		let cached: QuoteCacheValue | null;
		try {
			cached = await getQuote(env, normalized.kvKey);
		} catch (error) {
			throw new CacheReadError(`KV recheck failed for ${normalized.kvKey}: ${String(error)}`);
		}

		if (cached && isUsableCachedQuote(Date.now(), normalized, cached, env)) {
			const sourceTradingDate = getSourceTradingDate(normalized.market, cached.asOf, cached.fetchedAt);
			const closeCompatible =
				!closeResolution ||
				(cached.closeKind === 'provisional' && sourceTradingDate === targetTradingDate);
			if (closeCompatible) {
				return {
					cacheValue: cached,
					fromCache: true,
					sourceTradingDate
				};
			}
		}

		if (deadlineAtMs !== undefined && deadlineAtMs <= Date.now()) {
			throw new UpstreamDeadlineError();
		}

		const fetched = await fetcher(deadlineAtMs);
		const fetchedAt = new Date().toISOString();
		if (fetched.price === null) {
			return {
				cacheValue: null,
				failure: 'NO_PRICE',
				fromCache: false,
				sourceTradingDate: null
			};
		}

		const sourceTradingDate = closeResolution
			? getProvisionalSourceTradingDate(fetched.asOf, fetchedAt, fetched.hasExplicitAsOf === true)
			: getSourceTradingDate(normalized.market, fetched.asOf, fetchedAt);

		if (closeResolution && sourceTradingDate !== targetTradingDate) {
			return {
				cacheValue: null,
				failure: 'SOURCE_DATE_MISMATCH',
				fromCache: false,
				sourceTradingDate
			};
		}

		const ttl = getTtlSeconds(normalized.market, new Date(fetchedAt), env);
		const cacheValue: QuoteCacheValue = {
			symbol: normalized.ticker,
			canonicalSymbol: normalized.canonicalSymbol,
			market: normalized.market,
			price: fetched.price,
			currency: fetched.currency,
			asOf: closeResolution ? fetched.asOf : fetched.asOf ?? fetchedAt,
			fetchedAt,
			ttlHardSec: ttl.hard,
			expiresAt: computeExpiresAt(fetchedAt, ttl.hard),
			softTtlJitterSec: jitterSec(),
			closeKind: closeResolution ? 'provisional' : 'intraday'
		};

		await putQuote(env, normalized.kvKey, cacheValue, ttl.hard);
		return {
			cacheValue,
			fromCache: false,
			sourceTradingDate
		};
	})();

	inFlightQuoteFetches.set(key, promise);
	const cleanup = () => {
		if (inFlightQuoteFetches.get(key) === promise) {
			inFlightQuoteFetches.delete(key);
		}
	};
	promise.then(cleanup, cleanup);
	return waitForDeadline(promise, deadlineAtMs);
}

async function fetchFugleQuote(symbol: string, env: Env, deadlineAtMs?: number) {
	const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(symbol)}`;
	const response = await fetchWithRetry(
		url,
		{
			headers: {
				'X-API-KEY': env.FUGLE_API_KEY
			}
		},
		env,
		{ deadlineAtMs }
	);

	if (!response.ok) {
		throw new HttpStatusError(`Fugle API error: ${response.status}`, response.status);
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

async function fetchFinnhubQuote(symbol: string, env: Env, deadlineAtMs?: number) {
	const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`;
	const response = await fetchWithRetry(url, {}, env, { deadlineAtMs });

	if (!response.ok) {
		throw new HttpStatusError(`Finnhub API error: ${response.status}`, response.status);
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
	cached: QuoteCacheValue,
	targetTradingDate: string,
	closeKind: Extract<CloseKind, 'intraday' | 'provisional'> = 'intraday'
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
		ttlHardSec: cached.ttlHardSec ?? null,
		expiresAt: cached.expiresAt ?? null,
		status,
		isStale: isStale(status),
		reason: status === 'missing' ? 'HARD_EXPIRED' : null,
		closeKind,
		sourceTradingDate: getSourceTradingDate(normalized.market, cached.asOf, cached.fetchedAt),
		targetTradingDate
	};

	l1Set(normalized.kvKey, result, l1TtlSec, nowMs);
	return result;
}

async function buildMissing(
	normalized: NormalizedSymbol,
	reason: string,
	targetTradingDate: string
): Promise<QuoteResult> {
	return {
		symbol: normalized.originalSymbol,
		canonicalSymbol: normalized.canonicalSymbol,
		market: normalized.market,
		price: null,
		currency: null,
		asOf: null,
		fetchedAt: null,
		ttlHardSec: null,
		expiresAt: null,
		status: 'missing',
		isStale: false,
		reason,
		closeKind: 'unavailable',
		sourceTradingDate: null,
		targetTradingDate
	};
}

function buildFromTwEod(
	normalized: NormalizedSymbol,
	snapshot: TwEodSnapshot | null,
	hitReason: TwEodHitReason,
	hitStatus: Exclude<QuoteStatus, 'missing'>,
	targetTradingDate: string
): QuoteResult {
	const quote = getTwEodQuote(snapshot, normalized.ticker);
	if (!snapshot || !quote || quote.close === null) {
		return {
			symbol: normalized.originalSymbol,
			canonicalSymbol: normalized.canonicalSymbol,
			market: normalized.market,
			price: null,
			currency: null,
			asOf: null,
			fetchedAt: snapshot?.fetchedAt ?? null,
			ttlHardSec: null,
			expiresAt: null,
			status: 'missing',
			isStale: false,
			reason: 'TW_EOD_MISS',
			closeKind: 'unavailable',
			sourceTradingDate: null,
			targetTradingDate
		};
	}

	return {
		symbol: normalized.originalSymbol,
		canonicalSymbol: normalized.canonicalSymbol,
		market: normalized.market,
		price: quote.close,
		currency: 'TWD',
		asOf: eodAsOf(snapshot.tradingDate),
		fetchedAt: snapshot.fetchedAt,
		ttlHardSec: null,
		expiresAt: null,
		status: hitStatus,
		isStale: hitStatus === 'stale',
		reason: hitReason,
		closeKind: 'official_eod',
		sourceTradingDate: snapshot.tradingDate,
		targetTradingDate
	};
}

function jitterSec(): number {
	return Math.floor(Math.random() * 301);
}

function computeExpiresAt(fetchedAt: string, hardTtlSec: number): string {
	const safeHard = Number.isFinite(hardTtlSec) ? Math.max(0, hardTtlSec) : 0;
	const parsedStoredAt = Date.parse(fetchedAt);
	const storedAtMs = Number.isFinite(parsedStoredAt) ? parsedStoredAt : Date.now();
	return new Date(storedAtMs + safeHard * 1000).toISOString();
}

function buildFreshQuoteResult(
	normalized: NormalizedSymbol,
	cacheValue: QuoteCacheValue,
	closeKind: Extract<CloseKind, 'intraday' | 'provisional'>,
	sourceTradingDate: string | null,
	targetTradingDate: string
): QuoteResult {
	return {
		symbol: normalized.originalSymbol,
		canonicalSymbol: normalized.canonicalSymbol,
		market: normalized.market,
		price: cacheValue.price,
		currency: cacheValue.currency,
		asOf: cacheValue.asOf,
		fetchedAt: cacheValue.fetchedAt,
		ttlHardSec: cacheValue.ttlHardSec ?? null,
		expiresAt: cacheValue.expiresAt ?? null,
		status: 'fresh',
		isStale: false,
		reason: null,
		closeKind,
		sourceTradingDate,
		targetTradingDate
	};
}

function isRateLimited(error: unknown): boolean {
	return error instanceof HttpStatusError && error.status === 429;
}

async function getTwFugleBlockUntilMs(env: Env): Promise<number | null> {
	const raw = await env.QUOTES_KV.get(TW_FUGLE_BLOCK_KEY);
	if (!raw) return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

async function setTwFugleBlockUntilMs(env: Env, baseMs: number, blockSec: number): Promise<void> {
	const safeBlockSec = Math.max(1, Math.floor(blockSec));
	const blockUntilMs = baseMs + safeBlockSec * 1000;
	await env.QUOTES_KV.put(TW_FUGLE_BLOCK_KEY, String(blockUntilMs), {
		expirationTtl: safeBlockSec
	});
}

function shouldRunTwEodRefresh(now = new Date()): boolean {
	const parts = getTaipeiParts(now);
	if (parts.weekday < 1 || parts.weekday > 5) return false;
	if (parts.hour === 13) return parts.minute >= 40;
	return parts.hour >= 14 && parts.hour <= 18;
}

function getAdminTokenFromRequest(request: Request): string | null {
	const headerToken = request.headers.get('x-admin-token')?.trim();
	if (headerToken) return headerToken;
	const authHeader = request.headers.get('authorization')?.trim();
	if (!authHeader) return null;
	if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
	const bearerToken = authHeader.slice(7).trim();
	return bearerToken || null;
}

type RefreshResponse = RefreshResult & { error?: string };

function toRefreshError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return 'UNKNOWN_ERROR';
}

function hasRefreshError(result: RefreshResponse): boolean {
	return typeof result.error === 'string' && result.error.length > 0;
}

async function handleManualTwEodRefresh(request: Request, env: Env): Promise<Response> {
	if (!env.TW_EOD_R2) {
		return errorResponse('TW_EOD_R2 is not configured', 500);
	}

	const expectedToken = env.ADMIN_REFRESH_TOKEN?.trim();
	if (!expectedToken) {
		return errorResponse('ADMIN_REFRESH_TOKEN is not configured', 503);
	}

	const providedToken = getAdminTokenFromRequest(request);
	if (!providedToken || providedToken !== expectedToken) {
		return errorResponse('Unauthorized', 401);
	}

	try {
		const now = new Date();
		const [twseResult, tpexResult] = await Promise.all([
			refreshTwseEodSnapshot(env, now).catch(
				(error) =>
					({
						updated: false,
						tradingDate: null,
						quoteCount: 0,
						deletedCount: 0,
						error: toRefreshError(error)
					}) as RefreshResponse
			),
			refreshTpexEodSnapshot(env, now).catch(
				(error) =>
					({
						updated: false,
						tradingDate: null,
						quoteCount: 0,
						deletedCount: 0,
						error: toRefreshError(error)
					}) as RefreshResponse
			)
		]);

		const twse = twseResult as RefreshResponse;
		const tpex = tpexResult as RefreshResponse;
		const twseOk = !hasRefreshError(twse);
		const tpexOk = !hasRefreshError(tpex);
		const ok = twseOk || tpexOk;
		const partial = twseOk !== tpexOk;

		return jsonResponse(
			{
				ok,
				partial,
				trigger: 'manual',
				serverTime: now.toISOString(),
				twse,
				tpex
			},
			ok ? 200 : 500
		);
	} catch (error) {
		console.error('TWSE/TPEX EOD manual refresh failed', error);
		return errorResponse('TWSE/TPEX EOD manual refresh failed', 500);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		const pathname = new URL(request.url).pathname;
		if (pathname === '/admin/twse/eod/refresh') {
			if (request.method !== 'POST') {
				return errorResponse('Method Not Allowed', 405);
			}
			return handleManualTwEodRefresh(request, env);
		}

		if (request.method !== 'POST') {
			return errorResponse('Method Not Allowed', 405);
		}

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

		const symbols = symbolsRaw.map((item) => String(item).trim()).filter((item) => item.length > 0);

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
		const twClose = env.TW_CLOSE ?? '13:30';
		const twTrading = isTradingSessionTW(now, env.TW_OPEN ?? '09:00', twClose);
		const twPostClose = isAfterTwRegularClose(now, twClose);
		const l1TtlSec = toNumber(env.L1_TTL_SEC, 20);
		const maxSyncFetch = toNumber(env.MAX_SYNC_FETCH, 10);
		const upstreamDeadlineAtMs =
			nowMs + toPositiveNumber(env.UPSTREAM_REQUEST_DEADLINE_MS, DEFAULT_UPSTREAM_REQUEST_DEADLINE_MS);

		const results: QuoteResult[] = new Array(normalizedList.length);
		const missingForFetch: Array<{
			index: number;
			item: NormalizedSymbol;
			reason: string;
			targetTradingDate: string;
			closeResolution: boolean;
		}> = [];
		const kvCandidates: Array<{
			index: number;
			item: NormalizedSymbol;
			targetTradingDate: string;
		}> = [];
		let twseSnapshot: TwEodSnapshot | null | undefined = undefined;
		let tpexSnapshot: TwEodSnapshot | null | undefined = undefined;
		let recheckedTwseSnapshot: TwEodSnapshot | null | undefined = undefined;
		let recheckedTpexSnapshot: TwEodSnapshot | null | undefined = undefined;

		const getTwseSnapshot = async () => {
			if (twseSnapshot === undefined) {
				twseSnapshot = await getLatestTwseEodSnapshot(env, nowMs);
			}
			return twseSnapshot;
		};

		const getTpexSnapshot = async () => {
			if (tpexSnapshot === undefined) {
				tpexSnapshot = await getLatestTpexEodSnapshot(env, nowMs);
			}
			return tpexSnapshot;
		};

		const getRecheckedTwseSnapshot = async () => {
			if (recheckedTwseSnapshot === undefined) {
				recheckedTwseSnapshot = await getLatestTwseEodSnapshot(env, nowMs, true);
			}
			return recheckedTwseSnapshot;
		};

		const getRecheckedTpexSnapshot = async () => {
			if (recheckedTpexSnapshot === undefined) {
				recheckedTpexSnapshot = await getLatestTpexEodSnapshot(env, nowMs, true);
			}
			return recheckedTpexSnapshot;
		};

		const findTwEodSnapshot = async (
			item: NormalizedSymbol,
			requireTradingDate?: string,
			bypassCache = false
		): Promise<TwEodSnapshot | null> => {
			const twse = bypassCache ? await getRecheckedTwseSnapshot() : await getTwseSnapshot();
			const twseReady = !requireTradingDate || twse?.tradingDate === requireTradingDate;
			const twseQuote = twseReady ? getTwEodQuote(twse, item.ticker) : null;
			if (twse && twseReady && twseQuote && twseQuote.close !== null) {
				return twse;
			}

			const tpex = bypassCache ? await getRecheckedTpexSnapshot() : await getTpexSnapshot();
			const tpexReady = !requireTradingDate || tpex?.tradingDate === requireTradingDate;
			const tpexQuote = tpexReady ? getTwEodQuote(tpex, item.ticker) : null;
			if (tpex && tpexReady && tpexQuote && tpexQuote.close !== null) {
				return tpex;
			}

			return null;
		};

		const buildFromTwEodChain = async (
			item: NormalizedSymbol,
			hitReason: TwEodHitReason,
			hitStatus: Exclude<QuoteStatus, 'missing'>,
			targetTradingDate: string,
			requireTradingDate?: string
		): Promise<QuoteResult> => {
			const snapshot = await findTwEodSnapshot(item, requireTradingDate);
			if (snapshot) {
				return buildFromTwEod(item, snapshot, hitReason, hitStatus, targetTradingDate);
			}

			const [twse, tpex] = await Promise.all([getTwseSnapshot(), getTpexSnapshot()]);
			const reason =
				requireTradingDate && (twse?.tradingDate !== requireTradingDate || tpex?.tradingDate !== requireTradingDate)
					? 'TW_EOD_NOT_READY'
					: 'TW_EOD_MISS';

			return {
				symbol: item.originalSymbol,
				canonicalSymbol: item.canonicalSymbol,
				market: item.market,
				price: null,
				currency: null,
				asOf: null,
				fetchedAt: tpex?.fetchedAt ?? twse?.fetchedAt ?? null,
				ttlHardSec: null,
				expiresAt: null,
				status: 'missing',
				isStale: false,
				reason,
				closeKind: 'unavailable',
				sourceTradingDate: null,
				targetTradingDate
			};
		};

		for (let i = 0; i < normalizedList.length; i += 1) {
			const item = normalizedList[i];
			const targetTradingDate = getMarketDateISO(item.market, now);

			if (item.market === 'TW' && twPostClose) {
				const eodResult = env.TW_EOD_R2
					? await buildFromTwEodChain(
							item,
							'TW_EOD_OFFHOURS',
							'fresh',
							targetTradingDate,
							targetTradingDate
						)
					: await buildMissing(item, 'TW_EOD_NOT_CONFIGURED', targetTradingDate);
				if (eodResult.closeKind === 'official_eod') {
					l1Set(item.kvKey, eodResult, l1TtlSec, nowMs);
					results[i] = eodResult;
					continue;
				}

				results[i] = eodResult;
				missingForFetch.push({
					index: i,
					item,
					reason: eodResult.reason ?? 'TW_EOD_NOT_READY',
					targetTradingDate,
					closeResolution: true
				});
				continue;
			}

			// Outside TW trading hours before close resolution, preserve the existing latest-EOD fallback.
			if (item.market === 'TW' && !twTrading && env.TW_EOD_R2) {
				const eodResult = await buildFromTwEodChain(item, 'TW_EOD_OFFHOURS', 'fresh', targetTradingDate);
				if (eodResult.reason !== 'TW_EOD_MISS') {
					l1Set(item.kvKey, eodResult, l1TtlSec, nowMs);
				}
				results[i] = eodResult;
				continue;
			}

			const l1Hit = l1Get<QuoteResult>(item.kvKey, nowMs);
			if (l1Hit) {
				results[i] = l1Hit;
				continue;
			}

			kvCandidates.push({ index: i, item, targetTradingDate });
		}

		const cachedValues = await getQuotes(
			env,
			kvCandidates.map(({ item }) => item.kvKey)
		);

		for (let i = 0; i < kvCandidates.length; i += 1) {
			const { index, item, targetTradingDate } = kvCandidates[i];
			const cached = cachedValues[i];
			if (!cached) {
				results[index] = await buildMissing(item, 'KV_MISS', targetTradingDate);
				missingForFetch.push({
					index,
					item,
					reason: 'KV_MISS',
					targetTradingDate,
					closeResolution: false
				});
				continue;
			}

			const ttl = getTtlSeconds(item.market, now, env);
			const cachedResult = await buildFromCache(
				nowMs,
				ttl.soft,
				ttl.hard,
				l1TtlSec,
				item,
				cached,
				targetTradingDate
			);

			if (cachedResult.status === 'missing') {
				results[index] = { ...cachedResult, reason: 'HARD_EXPIRED' };
				missingForFetch.push({
					index,
					item,
					reason: 'HARD_EXPIRED',
					targetTradingDate,
					closeResolution: false
				});
				continue;
			}

			results[index] = cachedResult;
		}

		if (missingForFetch.length > 0 && maxSyncFetch > 0) {
			const fetchTargets = missingForFetch.slice(0, maxSyncFetch);
			const twTargets = fetchTargets.filter(({ item }) => item.market === 'TW');
			const usTargets = fetchTargets.filter(({ item }) => item.market === 'US');

			let twRateLimited = false;

			if (twTargets.length > 0 && twTrading) {
				const blockedUntilMs = await getTwFugleBlockUntilMs(env);
				twRateLimited = blockedUntilMs !== null && blockedUntilMs > nowMs;
			}

			for (const { index, item, targetTradingDate, closeResolution } of twTargets) {
				if (twRateLimited) {
					results[index] = await buildFromTwEodChain(
						item,
						'TW_EOD_FALLBACK_429',
						'stale',
						targetTradingDate
					);
					continue;
				}

				try {
					const officialEodRecheck =
						closeResolution && env.TW_EOD_R2
							? () => findTwEodSnapshot(item, targetTradingDate, true)
							: undefined;
					const shared = await getOrFetchQuote(
						env,
						item,
						targetTradingDate,
						closeResolution,
						(deadlineAtMs) => fetchFugleQuote(item.ticker, env, deadlineAtMs),
						officialEodRecheck,
						upstreamDeadlineAtMs
					);

					if (shared.officialEod) {
						const eodResult = buildFromTwEod(
							item,
							shared.officialEod,
							'TW_EOD_OFFHOURS',
							'fresh',
							targetTradingDate
						);
						l1Set(item.kvKey, eodResult, l1TtlSec, nowMs);
						results[index] = eodResult;
						continue;
					}

					if (shared.cacheValue) {
						if (shared.fromCache) {
							const ttl = getTtlSeconds(item.market, now, env);
							results[index] = await buildFromCache(
								nowMs,
								ttl.soft,
								ttl.hard,
								l1TtlSec,
								item,
								shared.cacheValue,
								targetTradingDate,
								closeResolution ? 'provisional' : 'intraday'
							);
						} else {
							const freshResult = buildFreshQuoteResult(
								item,
								shared.cacheValue,
								closeResolution ? 'provisional' : 'intraday',
								shared.sourceTradingDate,
								targetTradingDate
							);
							l1Set(item.kvKey, freshResult, l1TtlSec);
							results[index] = freshResult;
						}
						continue;
					}

					if (shared.failure === 'SOURCE_DATE_MISMATCH') {
						results[index] = await buildMissing(
							item,
							'TW_PROVISIONAL_SOURCE_DATE_MISMATCH',
							targetTradingDate
						);
					} else {
						console.warn('Fugle quote missing price', { symbol: item.ticker });
						results[index] = closeResolution
							? await buildMissing(item, 'TW_PROVISIONAL_UNAVAILABLE', targetTradingDate)
							: {
									...results[index],
									reason: 'FUGLE_ERROR'
								};
					}
				} catch (error) {
					if (error instanceof CacheReadError || error instanceof EodReadError) {
						throw error;
					}
					if (error instanceof UpstreamDeadlineError) {
						results[index] = closeResolution
							? await buildMissing(item, 'TW_PROVISIONAL_UNAVAILABLE', targetTradingDate)
							: {
									...results[index],
									reason: 'FUGLE_ERROR'
								};
						continue;
					}
					if (isRateLimited(error)) {
						twRateLimited = true;
						await setTwFugleBlockUntilMs(env, Date.now(), toNumber(env.TW_429_BLOCK_SEC, 60));
						results[index] = closeResolution
							? await buildMissing(item, 'TW_PROVISIONAL_UNAVAILABLE', targetTradingDate)
							: await buildFromTwEodChain(item, 'TW_EOD_FALLBACK_429', 'stale', targetTradingDate);
						continue;
					}

					console.error('Fugle quote failed', { symbol: item.ticker, error });
					results[index] = closeResolution
						? await buildMissing(item, 'TW_PROVISIONAL_UNAVAILABLE', targetTradingDate)
						: {
								...results[index],
								reason: 'FUGLE_ERROR'
							};
				}
			}

			const concurrencyLimit = 5;
			for (let i = 0; i < usTargets.length; i += concurrencyLimit) {
				const batch = usTargets.slice(i, i + concurrencyLimit);
				await Promise.all(
					batch.map(async ({ index, item, targetTradingDate }) => {
						try {
							const shared = await getOrFetchQuote(
								env,
								item,
								targetTradingDate,
								false,
								(deadlineAtMs) => fetchFinnhubQuote(item.ticker, env, deadlineAtMs),
								undefined,
								upstreamDeadlineAtMs
							);

							if (shared.cacheValue) {
								if (shared.fromCache) {
									const ttl = getTtlSeconds(item.market, now, env);
									results[index] = await buildFromCache(
										nowMs,
										ttl.soft,
										ttl.hard,
										l1TtlSec,
										item,
										shared.cacheValue,
										targetTradingDate
									);
								} else {
									const freshResult = buildFreshQuoteResult(
										item,
										shared.cacheValue,
										'intraday',
										shared.sourceTradingDate,
										targetTradingDate
									);
									l1Set(item.kvKey, freshResult, l1TtlSec);
									results[index] = freshResult;
								}
								return;
							}

							console.warn('Finnhub quote missing price', { symbol: item.ticker });
							results[index] = {
								...results[index],
								reason: 'FINNHUB_ERROR'
							};
						} catch (error) {
							if (error instanceof CacheReadError) {
								throw error;
							}
							if (error instanceof UpstreamDeadlineError) {
								results[index] = {
									...results[index],
									reason: 'FINNHUB_ERROR'
								};
								return;
							}
							console.error('Finnhub quote failed', { symbol: item.ticker, error });
							results[index] = {
								...results[index],
								reason: 'FINNHUB_ERROR'
							};
						}
					})
				);
			}
		}

		return jsonResponse({
			serverTime: now.toISOString(),
			results
		});
	},

	async scheduled(event: ScheduledController, env: Env): Promise<void> {
		try {
			const now = new Date();
			console.log('TWSE/TPEX EOD scheduled triggered', {
				cron: event.cron,
				scheduledTime: new Date(event.scheduledTime).toISOString(),
				now: now.toISOString()
			});
			if (!shouldRunTwEodRefresh(now)) {
				console.log('TWSE/TPEX EOD refresh skipped by local time window', { now: now.toISOString() });
				return;
			}

			const [twseResult, tpexResult] = await Promise.all([
				refreshTwseEodSnapshot(env, now).catch(
					(error) =>
						({
							updated: false,
							tradingDate: null,
							quoteCount: 0,
							deletedCount: 0,
							error: toRefreshError(error)
						}) as RefreshResponse
				),
				refreshTpexEodSnapshot(env, now).catch(
					(error) =>
						({
							updated: false,
							tradingDate: null,
							quoteCount: 0,
							deletedCount: 0,
							error: toRefreshError(error)
						}) as RefreshResponse
				)
			]);

			console.log('TWSE/TPEX EOD refresh done', {
				twse: twseResult,
				tpex: tpexResult,
				ok: !hasRefreshError(twseResult as RefreshResponse) || !hasRefreshError(tpexResult as RefreshResponse),
				partial: hasRefreshError(twseResult as RefreshResponse) !== hasRefreshError(tpexResult as RefreshResponse)
			});
		} catch (error) {
			console.error('TWSE/TPEX EOD refresh failed', error);
		}
	}
};
