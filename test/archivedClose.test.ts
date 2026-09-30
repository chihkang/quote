import { describe, expect, it } from 'vitest';
import worker from '../src/index';

function snapshot(date: string, source: string, symbol: string, close: number | null) {
	return JSON.stringify({ tradingDate: date, fetchedAt: `${date}T08:00:00.000Z`, source,
		quotes: { [symbol]: { close, name: symbol } } });
}

function env(files: Record<string, string>) {
	return { TW_EOD_R2: { get: async (key: string) => {
			const raw = files[key];
			return raw === undefined ? null : { json: async () => JSON.parse(raw) };
		} } } as unknown as Parameters<typeof worker.fetch>[1];
}

function closeRequest(valuationDate: string, symbols: string[]) {
	return new Request('http://localhost/quotes/close-by-date', { method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ valuationDate, symbols }) });
}

describe('archived Taiwan close lookup', () => {
	it('returns original listed and OTC closes with source dates and provenance', async () => {
		const files = {
			'twse/eod/2026-09-24.json': snapshot('2026-09-24', 'TWSE_STOCK_DAY_ALL', '2330', 1000),
			'tpex/eod/2026-09-24.json': snapshot('2026-09-24', 'TPEX_OPENAPI_MAINBOARD_DAILY_CLOSE_QUOTES', '6488', 900)
		};
		const response = await worker.fetch(closeRequest('2026-09-24', ['2330', '6488']), env(files));
		const body = await response.json() as any;
		expect(response.status).toBe(200);
		expect(body.results).toMatchObject([
			{ symbol: '2330', canonicalSymbol: '2330.TW', price: 1000, closeKind: 'official_eod', sourceTradingDate: '2026-09-24',
				expectedCloseTradingDate: '2026-09-24', source: 'TWSE_STOCK_DAY_ALL' },
			{ symbol: '6488', canonicalSymbol: '6488.TWO', price: 900, closeKind: 'official_eod', sourceTradingDate: '2026-09-24',
				expectedCloseTradingDate: '2026-09-24', source: 'TPEX_OPENAPI_MAINBOARD_DAILY_CLOSE_QUOTES' }
		]);
	});

	it('uses the last completed close on a Taiwan holiday', async () => {
		const files = { 'twse/eod/2026-09-24.json': snapshot('2026-09-24', 'TWSE_STOCK_DAY_ALL', '2330', 1000) };
		const response = await worker.fetch(closeRequest('2026-09-28', ['2330']), env(files));
		const body = await response.json() as any;
		expect(body.results[0]).toMatchObject({ price: 1000, sourceTradingDate: '2026-09-24',
			targetTradingDate: '2026-09-28', expectedCloseTradingDate: '2026-09-24' });
	});

	it('never substitutes another date or a null close', async () => {
		const files = {
			'twse/eod/2026-09-24.json': snapshot('2026-09-23', 'TWSE_STOCK_DAY_ALL', '2330', 1000),
			'tpex/eod/2026-09-24.json': snapshot('2026-09-24', 'TPEX_OPENAPI_MAINBOARD_DAILY_CLOSE_QUOTES', '6488', null)
		};
		const response = await worker.fetch(closeRequest('2026-09-24', ['2330', '6488']), env(files));
		const body = await response.json() as any;
		expect(body.results.map((item: any) => item.price)).toEqual([null, null]);
	});
});
