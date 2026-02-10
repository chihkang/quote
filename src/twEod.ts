import { getTaipeiDateISO } from './time';

export type TwEodQuote = {
	close: number | null;
	name: string | null;
};

export type TwEodSnapshot = {
	tradingDate: string;
	fetchedAt: string;
	source: 'TWSE_STOCK_DAY_ALL';
	quotes: Record<string, TwEodQuote>;
};

export type EnvWithTwEod = {
	TW_EOD_R2?: R2Bucket;
	TWSE_EOD_URL?: string;
	TW_EOD_PATCH_ROWS?: string;
	TW_EOD_L1_SEC?: string;
};

export const TW_EOD_LATEST_KEY = 'twse/eod/latest.json';

const DEFAULT_CSV_URL = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data';
const DEFAULT_PATCH_ROWS = 239;
const DEFAULT_L1_SEC = 60;

type L1SnapshotCache = {
	expiresAtMs: number;
	snapshot: TwEodSnapshot;
};

let snapshotCache: L1SnapshotCache | null = null;

function toPositiveInt(raw: string | undefined, fallback: number): number {
	const value = Number(raw);
	if (!Number.isFinite(value)) return fallback;
	return Math.max(0, Math.floor(value));
}

function normalizeHeader(value: string): string {
	return value.replace(/^\uFEFF/, '').trim();
}

function parseRows(csv: string): string[][] {
	const rows: string[][] = [];
	let currentRow: string[] = [];
	let currentCell = '';
	let inQuotes = false;

	for (let i = 0; i < csv.length; i += 1) {
		const char = csv[i];
		const next = i + 1 < csv.length ? csv[i + 1] : '';

		if (char === '"') {
			if (inQuotes && next === '"') {
				currentCell += '"';
				i += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (!inQuotes && char === ',') {
			currentRow.push(currentCell);
			currentCell = '';
			continue;
		}

		if (!inQuotes && (char === '\n' || char === '\r')) {
			if (char === '\r' && next === '\n') {
				i += 1;
			}
			currentRow.push(currentCell);
			rows.push(currentRow);
			currentRow = [];
			currentCell = '';
			continue;
		}

		currentCell += char;
	}

	currentRow.push(currentCell);
	if (currentRow.length > 1 || currentRow[0].trim().length > 0) {
		rows.push(currentRow);
	}

	return rows;
}

function parseTradingDate(raw: string): string | null {
	const cleaned = raw.trim();
	if (!cleaned) return null;

	if (/^\d{8}$/.test(cleaned)) {
		const year = Number(cleaned.slice(0, 4));
		const month = Number(cleaned.slice(4, 6));
		const day = Number(cleaned.slice(6, 8));
		if (year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
			return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		}
	}

	if (/^\d{7}$/.test(cleaned)) {
		const rocYear = Number(cleaned.slice(0, 3));
		const month = Number(cleaned.slice(3, 5));
		const day = Number(cleaned.slice(5, 7));
		if (rocYear > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
			const year = rocYear + 1911;
			return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		}
	}

	return null;
}

function parseClosePrice(raw: string): number | null {
	const cleaned = raw.trim().replace(/,/g, '');
	if (!cleaned || cleaned === '--') return null;
	const value = Number(cleaned);
	return Number.isFinite(value) ? value : null;
}

export function parseTwseStockDayAllCsv(
	csv: string,
	patchRows = DEFAULT_PATCH_ROWS,
	fetchedAt = new Date().toISOString()
): TwEodSnapshot {
	const rows = parseRows(csv).filter((row) => row.some((cell) => cell.trim().length > 0));
	if (rows.length < 2) {
		throw new Error('TWSE CSV has no data rows');
	}

	const headers = rows[0].map(normalizeHeader);
	const dateIndex = headers.indexOf('日期');
	const symbolIndex = headers.indexOf('證券代號');
	const nameIndex = headers.indexOf('證券名稱');
	const closeIndex = headers.indexOf('收盤價');

	if (dateIndex < 0 || symbolIndex < 0 || nameIndex < 0 || closeIndex < 0) {
		throw new Error('TWSE CSV header missing required fields');
	}

	const quotes: Record<string, TwEodQuote> = {};
	let tradingDate: string | null = null;
	let dataRowIndex = 0;

	for (let i = 1; i < rows.length; i += 1) {
		const row = rows[i];
		const rawSymbol = (row[symbolIndex] ?? '').trim().toUpperCase();
		if (!rawSymbol) continue;

		if (!tradingDate) {
			tradingDate = parseTradingDate((row[dateIndex] ?? '').trim());
		}

		let symbol = rawSymbol;
		if (dataRowIndex < patchRows && !symbol.startsWith('00')) {
			symbol = `00${symbol}`;
		}

		const close = parseClosePrice(row[closeIndex] ?? '');
		const name = (row[nameIndex] ?? '').trim() || null;
		quotes[symbol] = { close, name };
		dataRowIndex += 1;
	}

	if (!tradingDate) {
		tradingDate = getTaipeiDateISO(new Date(fetchedAt));
	}

	return {
		tradingDate,
		fetchedAt,
		source: 'TWSE_STOCK_DAY_ALL',
		quotes
	};
}

function parseSnapshot(raw: unknown): TwEodSnapshot | null {
	if (!raw || typeof raw !== 'object') return null;
	const data = raw as Partial<TwEodSnapshot>;
	if (typeof data.tradingDate !== 'string' || typeof data.fetchedAt !== 'string') return null;
	if (data.source !== 'TWSE_STOCK_DAY_ALL') return null;
	if (!data.quotes || typeof data.quotes !== 'object') return null;
	return data as TwEodSnapshot;
}

async function readLatestFromR2(env: EnvWithTwEod): Promise<TwEodSnapshot | null> {
	if (!env.TW_EOD_R2) return null;
	const object = await env.TW_EOD_R2.get(TW_EOD_LATEST_KEY);
	if (!object) return null;
	const parsed = parseSnapshot(await object.json());
	return parsed;
}

function getL1TtlSec(env: EnvWithTwEod): number {
	return toPositiveInt(env.TW_EOD_L1_SEC, DEFAULT_L1_SEC);
}

export function clearTwEodL1Cache(): void {
	snapshotCache = null;
}

export async function getLatestTwEodSnapshot(
	env: EnvWithTwEod,
	nowMs = Date.now()
): Promise<TwEodSnapshot | null> {
	if (!env.TW_EOD_R2) return null;

	if (snapshotCache && nowMs < snapshotCache.expiresAtMs) {
		return snapshotCache.snapshot;
	}

	const snapshot = await readLatestFromR2(env);
	if (!snapshot) {
		snapshotCache = null;
		return null;
	}

	snapshotCache = {
		snapshot,
		expiresAtMs: nowMs + getL1TtlSec(env) * 1000
	};
	return snapshot;
}

export function getTwEodDateKey(tradingDate: string): string {
	return `twse/eod/${tradingDate}.json`;
}

export function getTwEodQuote(snapshot: TwEodSnapshot | null, ticker: string): TwEodQuote | null {
	if (!snapshot) return null;
	const key = ticker.trim().toUpperCase();
	if (!key) return null;

	const candidates = [key];
	if (!key.startsWith('00')) {
		candidates.push(`00${key}`);
	}
	if (/^\d+$/.test(key) && key.length < 4) {
		candidates.push(key.padStart(4, '0'));
	}

	for (const candidate of candidates) {
		const quote = snapshot.quotes[candidate];
		if (quote) return quote;
	}

	return null;
}

export async function refreshTwEodSnapshot(
	env: EnvWithTwEod,
	now = new Date()
): Promise<{ updated: boolean; tradingDate: string | null; quoteCount: number; deletedCount: number }> {
	if (!env.TW_EOD_R2) {
		return { updated: false, tradingDate: null, quoteCount: 0, deletedCount: 0 };
	}

	const url = env.TWSE_EOD_URL ?? DEFAULT_CSV_URL;
	const patchRows = toPositiveInt(env.TW_EOD_PATCH_ROWS, DEFAULT_PATCH_ROWS);
	const fetchedAt = now.toISOString();

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`TWSE EOD fetch failed: ${response.status}`);
	}

	const csv = await response.text();
	const snapshot = parseTwseStockDayAllCsv(csv, patchRows, fetchedAt);
	const latest = await readLatestFromR2(env);
	const cleanupStaleSnapshots = async (keepTradingDate: string): Promise<number> => {
		const keep = new Set<string>([TW_EOD_LATEST_KEY, getTwEodDateKey(keepTradingDate)]);
		const staleKeys: string[] = [];
		let cursor: string | undefined;

		do {
			const listed = await env.TW_EOD_R2!.list({
				prefix: 'twse/eod/',
				cursor
			});

			for (const object of listed.objects) {
				const key = object.key;
				if (keep.has(key)) continue;

				const suffix = key.slice('twse/eod/'.length);
				if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(suffix)) continue;
				staleKeys.push(key);
			}

			cursor = listed.truncated ? listed.cursor : undefined;
		} while (cursor);

		if (staleKeys.length === 0) return 0;
		await env.TW_EOD_R2!.delete(staleKeys);
		return staleKeys.length;
	};

	if (latest && latest.tradingDate === snapshot.tradingDate) {
		const deletedCount = await cleanupStaleSnapshots(latest.tradingDate);
		snapshotCache = {
			snapshot: latest,
			expiresAtMs: now.getTime() + getL1TtlSec(env) * 1000
		};
		return {
			updated: false,
			tradingDate: latest.tradingDate,
			quoteCount: Object.keys(latest.quotes).length,
			deletedCount
		};
	}

	const body = JSON.stringify(snapshot);
	await Promise.all([
		env.TW_EOD_R2.put(TW_EOD_LATEST_KEY, body, {
			httpMetadata: { contentType: 'application/json' }
		}),
		env.TW_EOD_R2.put(getTwEodDateKey(snapshot.tradingDate), body, {
			httpMetadata: { contentType: 'application/json' }
		})
	]);
	const deletedCount = await cleanupStaleSnapshots(snapshot.tradingDate);

	snapshotCache = {
		snapshot,
		expiresAtMs: now.getTime() + getL1TtlSec(env) * 1000
	};

	return {
		updated: true,
		tradingDate: snapshot.tradingDate,
		quoteCount: Object.keys(snapshot.quotes).length,
		deletedCount
	};
}
