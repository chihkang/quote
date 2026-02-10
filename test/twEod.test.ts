import { describe, expect, it } from 'vitest';
import { parseTpexDailyCloseJson, parseTwseStockDayAllCsv } from '../src/twEod';

function buildCsv(rows: Array<{ date: string; symbol: string; name: string; close: string }>): string {
	const header = '日期,證券代號,證券名稱,收盤價';
	const lines = rows.map((row) => `${row.date},${row.symbol},${row.name},${row.close}`);
	return [header, ...lines].join('\n');
}

describe('parseTwseStockDayAllCsv', () => {
	it('parses trading date and close prices', () => {
		const csv = buildCsv([
			{ date: '1150210', symbol: '2330', name: '台積電', close: '1080.00' },
			{ date: '1150210', symbol: '2317', name: '鴻海', close: '180.50' }
		]);

		const snapshot = parseTwseStockDayAllCsv(csv, 0, '2026-02-10T06:00:00.000Z');

		expect(snapshot.tradingDate).toBe('2026-02-10');
		expect(snapshot.quotes['2330']?.close).toBe(1080);
		expect(snapshot.quotes['2317']?.close).toBe(180.5);
	});

	it('patches only first 239 rows by prepending 00', () => {
		const rows = Array.from({ length: 240 }, (_, idx) => ({
			date: '1150210',
			symbol: String(idx + 1),
			name: `ETF-${idx + 1}`,
			close: '10'
		}));
		const csv = buildCsv(rows);

		const snapshot = parseTwseStockDayAllCsv(csv, 239, '2026-02-10T06:00:00.000Z');

		expect(snapshot.quotes['001']?.close).toBe(10);
		expect(snapshot.quotes['00239']?.close).toBe(10);
		expect(snapshot.quotes['240']?.close).toBe(10);
		expect(snapshot.quotes['00240']).toBeUndefined();
	});

	it('stores null when close price is invalid', () => {
		const csv = buildCsv([
			{ date: '1150210', symbol: '50', name: '元大台灣50', close: '--' },
			{ date: '1150210', symbol: '6203', name: '元大MSCI台灣', close: '136.40' }
		]);

		const snapshot = parseTwseStockDayAllCsv(csv, 239, '2026-02-10T06:00:00.000Z');

		expect(snapshot.quotes['0050']?.close).toBeNull();
		expect(snapshot.quotes['006203']?.close).toBe(136.4);
	});
});

describe('parseTpexDailyCloseJson', () => {
	it('parses tpex openapi rows and maps code to close', () => {
		const payload = [
			{
				Date: '1150210',
				SecuritiesCompanyCode: '006201',
				CompanyName: '元大富櫃50',
				Close: '29.08'
			},
			{
				Date: '1150210',
				SecuritiesCompanyCode: '020001',
				CompanyName: '富邦存股雙十N',
				Close: ' ---'
			}
		];

		const snapshot = parseTpexDailyCloseJson(payload, '2026-02-10T06:00:00.000Z');

		expect(snapshot.source).toBe('TPEX_OPENAPI_MAINBOARD_DAILY_CLOSE_QUOTES');
		expect(snapshot.tradingDate).toBe('2026-02-10');
		expect(snapshot.quotes['006201']?.close).toBe(29.08);
		expect(snapshot.quotes['020001']?.close).toBeNull();
	});

	it('parses tpex payload and maps code to close', () => {
		const payload = {
			date: '20260210',
			tables: [
				{
					title: '上櫃股票行情',
					fields: ['代號', '名稱', '收盤'],
					data: [
						['006201', '元大富櫃50', '29.08'],
						['8069', '元太', '185.00']
					]
				}
			]
		};

		const snapshot = parseTpexDailyCloseJson(payload, '2026-02-10T06:00:00.000Z');

		expect(snapshot.tradingDate).toBe('2026-02-10');
		expect(snapshot.quotes['006201']?.close).toBe(29.08);
		expect(snapshot.quotes['006201']?.name).toBe('元大富櫃50');
		expect(snapshot.quotes['8069']?.close).toBe(185);
	});

	it('stores null for non-numeric close', () => {
		const payload = {
			date: '20260210',
			tables: [
				{
					title: '上櫃股票行情',
					fields: ['代號', '名稱', '收盤'],
					data: [['020001', '富邦存股雙十N', ' ---']]
				}
			]
		};

		const snapshot = parseTpexDailyCloseJson(payload, '2026-02-10T06:00:00.000Z');
		expect(snapshot.quotes['020001']?.close).toBeNull();
	});

	it('falls back to table roc date', () => {
		const payload = {
			tables: [
				{
					title: '上櫃股票行情',
					date: '115/02/10',
					fields: ['代號', '名稱', '收盤'],
					data: [['006201', '元大富櫃50', '29.08']]
				}
			]
		};

		const snapshot = parseTpexDailyCloseJson(payload, '2026-02-10T06:00:00.000Z');
		expect(snapshot.tradingDate).toBe('2026-02-10');
	});
});
