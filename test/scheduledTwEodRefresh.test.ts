import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { clearTwEodL1Cache } from '../src/twEod';

const now = new Date('2026-09-30T06:00:00Z');
function snapshot(board: 'TWSE' | 'TPEX', date = '2026-09-30') {
	return { tradingDate: date, fetchedAt: '2026-09-30T05:40:00Z',
		source: board === 'TWSE' ? 'TWSE_STOCK_DAY_ALL' : 'TPEX_OPENAPI_MAINBOARD_DAILY_CLOSE_QUOTES',
		quotes: { '2330': { close: 100, name: 'fixture' } } };
}
function setup(initial: Record<string, unknown> = {}) {
	const objects = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
	const downloads: string[] = [];
	vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
		const url = String(input);
		downloads.push(url);
		if (url.includes('twse.com.tw')) return new Response('日期,證券代號,證券名稱,收盤價\n1150930,2330,fixture,101');
		if (url.includes('tpex.org.tw')) return Response.json([
			{ Date: '1150930', SecuritiesCompanyCode: '6488', CompanyName: 'fixture', Close: '102' }
		]);
		throw new Error('Unexpected external request');
	});
	const env = { TW_EOD_PATCH_ROWS: '0', TW_EOD_R2: {
		get: async (key: string) => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)!) } : null,
		put: async (key: string, body: string) => { objects.set(key, body); }
	} } as unknown as Parameters<typeof worker.fetch>[1];
	return { env, objects, downloads };
}
async function run(env: Parameters<typeof worker.fetch>[1]) {
	await worker.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.now() } as ScheduledController, env);
}
beforeEach(() => {
	vi.useFakeTimers(); vi.setSystemTime(now);
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); clearTwEodL1Cache(); });

it('does not download or rewrite either board after the expected session is archived', async () => {
	const { env, objects, downloads } = setup({
		'twse/eod/2026-09-30.json': snapshot('TWSE'),
		'tpex/eod/2026-09-30.json': snapshot('TPEX')
	});
	const before = [...objects];
	await run(env);
	expect(downloads).toEqual([]);
	expect([...objects]).toEqual(before);
});
it.each(['TWSE', 'TPEX'] as const)('only downloads the missing board when %s is already archived', async board => {
	const key = board.toLowerCase() + '/eod/2026-09-30.json';
	const { env, objects, downloads } = setup({ [key]: snapshot(board) });
	const saved = objects.get(key);
	await run(env);
	expect(downloads).toHaveLength(1);
	expect(downloads[0]).toContain(board === 'TWSE' ? 'tpex.org.tw' : 'twse.com.tw');
	expect(objects.get(key)).toBe(saved);
	expect(objects.has(board === 'TWSE' ? 'tpex/eod/2026-09-30.json' : 'twse/eod/2026-09-30.json')).toBe(true);
});
it('stops downloading on the next run after both missing archives are saved', async () => {
	const { env, objects, downloads } = setup();
	await run(env);
	expect(downloads).toHaveLength(2);
	expect(objects.has('twse/eod/2026-09-30.json')).toBe(true);
	expect(objects.has('tpex/eod/2026-09-30.json')).toBe(true);
	downloads.length = 0;
	await run(env);
	expect(downloads).toEqual([]);
});
it.each([
	['wrong date', { ...snapshot('TWSE'), tradingDate: '2026-09-29' }],
	['wrong board source', snapshot('TPEX')],
	['empty quotes', { ...snapshot('TWSE'), quotes: {} }],
	['no positive prices', { ...snapshot('TWSE'), quotes: { '2330': { close: null, name: 'fixture' } } }],
	['invalid quote shape', { ...snapshot('TWSE'), quotes: { '2330': null } }],
	['malformed snapshot', { tradingDate: '2026-09-30' }]
])('repairs a dated archive with %s instead of treating it as success', async (_label, invalid) => {
	const { env, objects, downloads } = setup({
		'twse/eod/2026-09-30.json': invalid,
		'tpex/eod/2026-09-30.json': snapshot('TPEX')
	});
	await run(env);
	expect(downloads).toHaveLength(1);
	expect(downloads[0]).toContain('twse.com.tw');
	expect(JSON.parse(objects.get('twse/eod/2026-09-30.json')!).quotes['2330'].close).toBe(101);
});
it('uses the preceding completed session during morning recovery and holidays', async () => {
	vi.setSystemTime(new Date('2026-09-28T22:00:00Z'));
	const { env, downloads } = setup({
		'twse/eod/2026-09-24.json': snapshot('TWSE', '2026-09-24'),
		'tpex/eod/2026-09-24.json': snapshot('TPEX', '2026-09-24')
	});
	await run(env);
	expect(downloads).toEqual([]);
});
it('does not let previous-session archives suppress collection after a new close', async () => {
	const { env, objects, downloads } = setup({
		'twse/eod/2026-09-29.json': snapshot('TWSE', '2026-09-29'),
		'tpex/eod/2026-09-29.json': snapshot('TPEX', '2026-09-29')
	});
	await run(env);
	expect(downloads).toHaveLength(2);
	expect(objects.has('twse/eod/2026-09-29.json')).toBe(true);
	expect(objects.has('twse/eod/2026-09-30.json')).toBe(true);
});

it.each([
	['empty', { ...snapshot('TWSE'), quotes: {} }],
	['wrong date', { ...snapshot('TWSE'), tradingDate: '2026-09-29' }],
	['unparseable JSON', null]
])('repairs a %s dated archive even when the downloaded quotes equal valid latest data', async (_label, invalid) => {
	const latest = { ...snapshot('TWSE'), quotes: { '2330': { close: 101, name: 'fixture' } } };
	const { env, objects, downloads } = setup({
		'twse/eod/latest.json': latest,
		'twse/eod/2026-09-30.json': invalid,
		'tpex/eod/2026-09-30.json': snapshot('TPEX')
	});
	if (invalid === null) objects.set('twse/eod/2026-09-30.json', '{broken');
	await run(env);
	expect(JSON.parse(objects.get('twse/eod/2026-09-30.json')!)).toEqual(latest);
	downloads.length = 0;
	await run(env);
	expect(downloads).toEqual([]);
});
