import { expect, it, vi } from 'vitest';
// @ts-expect-error plain Node entry point shared with the scheduled collector
import { collectTpex } from '../scripts/collect-tpex.mjs';

it('uploads the official payload and keeps credentials away from the provider', async () => {
	const body = JSON.stringify([{ Date: '1150929', SecuritiesCompanyCode: '6488', Close: '100' }]);
	const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(body))
		.mockResolvedValueOnce(Response.json({ tradingDate: '2026-09-29', quoteCount: 1 }));
	expect(await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl }))
		.toMatchObject({ awaitingPublication: false, tradingDate: '2026-09-29' });
	expect(fetchImpl.mock.calls[0][1].headers).toBeUndefined();
	expect(fetchImpl.mock.calls[1][1].body).toBe(body);
	expect(fetchImpl.mock.calls[1][1].redirect).toBe('error');
});

it('fails the final check when either market archive is absent', async () => {
	const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json([{ Date: '1150929' }]))
		.mockResolvedValueOnce(Response.json({ ok: true }))
		.mockResolvedValueOnce(Response.json({ complete: false }, { status: 503 }));
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete: true, fetchImpl }))
		.rejects.toThrow('incomplete');
});

it('retries a terminated official response body before uploading', async () => {
	const fetchImpl = vi.fn()
		.mockResolvedValueOnce({ ok: true, text: async () => { throw new Error('terminated'); } })
		.mockResolvedValueOnce(Response.json([{ Date: '1150930', Close: '100' }]))
		.mockResolvedValueOnce(Response.json({ tradingDate: '2026-09-30', quoteCount: 1 }));
	const wait = vi.fn().mockResolvedValue(undefined);
	expect(await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl, wait }))
		.toMatchObject({ tradingDate: '2026-09-30' });
	expect(wait).toHaveBeenCalledWith(1000);
	expect(fetchImpl.mock.calls[1][1].headers).toBeUndefined();
});
