import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { clearTwEodL1Cache } from '../src/twEod';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearTwEodL1Cache(); });
function setup() {
	const objects = new Map<string, string>();
	const env = { EOD_INGEST_TOKEN: 'fixture-secret', TW_EOD_R2: {
		get: async (key: string) => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)!) } : null,
		put: async (key: string, value: string) => { objects.set(key, value); }
	} } as unknown as Parameters<typeof worker.fetch>[1];
	return { env, objects };
}
function request(date: string, token = 'fixture-secret') {
	return new Request('https://fixture.invalid/admin/tpex/eod/ingest', { method: 'POST',
		headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
		body: JSON.stringify([{ Date: date, SecuritiesCompanyCode: '6488', CompanyName: 'test', Close: '100' }]) });
}
it('requires the dedicated ingestion credential before reading or writing data', async () => {
	const { env, objects } = setup();
	expect((await worker.fetch(request('1150924', 'wrong'), env)).status).toBe(401);
	expect(objects.size).toBe(0);
});
it('accepts the actual preceding session during a long holiday and rejects stale dates', async () => {
	vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
	const { env, objects } = setup();
	expect((await worker.fetch(request('1150923'), env)).status).toBe(409);
	expect(objects.size).toBe(0);
	expect((await worker.fetch(request('1150924'), env)).status).toBe(200);
	expect(objects.has('tpex/eod/2026-09-24.json')).toBe(true);
	expect(objects.has('tpex/eod/2026-09-28.json')).toBe(false);
});
it('reports incomplete archive even when only one board exists', async () => {
	vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
	const { env } = setup();
	await worker.fetch(request('1150924'), env);
	const response = await worker.fetch(new Request('https://fixture.invalid/health/eod'), env);
	expect(response.status).toBe(503);
	expect(await response.json()).toMatchObject({ complete: false, expectedTradingDate: '2026-09-24',
		boards: { TWSE: { available: false }, TPEX: { available: true } } });
});
