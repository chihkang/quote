import { expect, it, vi } from 'vitest';
// @ts-expect-error plain Node entry point shared with the scheduled collector
import { collectTpex } from '../scripts/collect-tpex.mjs';

function archiveHealth(tpex = false, twse = false) {
	const board = (available: boolean) => ({ available, sourceTradingDate: available ? '2026-09-30' : null,
		fetchedAt: available ? '2026-09-30T08:12:57.124Z' : null, quoteCount: available ? 10 : 0 });
	return { complete: tpex && twse, expectedTradingDate: '2026-09-30', calendarVersion: 'twse-nyse-2026-v1',
		boards: { TWSE: board(twse), TPEX: board(tpex) } };
}

const healthResponse = (tpex = false, twse = false) =>
	Response.json(archiveHealth(tpex, twse), { status: tpex && twse ? 200 : 503 });

it('reports board/date/calendar diagnostics on final failure without credentials', async () => {
	const fetchImpl = async () => healthResponse(true, false);
	const promise = collectTpex({workerURL:'https://archive.invalid',token:'private-fixture-token',requireComplete:true,fetchImpl});
	await expect(promise).rejects.toThrow('expectedTradingDate');
	await expect(promise).rejects.toThrow('2026-09-30');
	await expect(promise).rejects.toThrow('TWSE');
	await expect(promise).rejects.not.toThrow('private-fixture-token');
});

it('reports incomplete polling separately from successful archive completion', async () => {
	const fetchImpl = async () => healthResponse(true, false);
	expect(await collectTpex({workerURL:'https://archive.invalid',token:'fixture',fetchImpl}))
		.toMatchObject({alreadyArchived:true,archiveComplete:false,calendarVersion:'twse-nyse-2026-v1',expectedTradingDate:'2026-09-30'});
});

// Existing download/ingest scenarios start with no archived close.
function withMissingHealth(fetchImpl: (...args: any[]) => any) {
	return (url: URL | string, options: any) => String(url).endsWith('/health/eod')
		? healthResponse() : fetchImpl(url, options);
}

it('uploads the official payload and keeps credentials away from the provider', async () => {
	const body = JSON.stringify([{ Date: '1150929', SecuritiesCompanyCode: '6488', Close: '100' }]);
	const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(body))
		.mockResolvedValueOnce(Response.json({ tradingDate: '2026-09-29', quoteCount: 1 }));
	expect(await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl: withMissingHealth(fetchImpl) }))
		.toMatchObject({ awaitingPublication: false, tradingDate: '2026-09-29' });
	expect(fetchImpl.mock.calls[0][1].headers).toBeUndefined();
	expect(fetchImpl.mock.calls[1][1].body).toBe(body);
	expect(fetchImpl.mock.calls[1][1].redirect).toBe('error');
});

it('fails the final check when either market archive is absent', async () => {
	const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json([{ Date: '1150929' }]))
		.mockResolvedValueOnce(Response.json({ ok: true }))
		.mockResolvedValueOnce(Response.json({ complete: false }, { status: 503 }));
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete: true, fetchImpl: withMissingHealth(fetchImpl) }))
		.rejects.toThrow('incomplete');
});

it('retries a terminated official response body before uploading', async () => {
	const fetchImpl = vi.fn()
		.mockResolvedValueOnce({ ok: true, text: async () => { throw new Error('terminated'); } })
		.mockResolvedValueOnce(Response.json([{ Date: '1150930', Close: '100' }]))
		.mockResolvedValueOnce(Response.json({ tradingDate: '2026-09-30', quoteCount: 1 }));
	const wait = vi.fn().mockResolvedValue(undefined);
	expect(await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl: withMissingHealth(fetchImpl), wait }))
		.toMatchObject({ tradingDate: '2026-09-30' });
	expect(wait).toHaveBeenCalledWith(1000);
	expect(fetchImpl.mock.calls[1][1].headers).toBeUndefined();
});

it('stops after bounded full and range failures without uploading fabricated data', async () => {
	const fetchImpl = vi.fn().mockRejectedValue(new Error('connection lost'));
	const wait = vi.fn().mockResolvedValue(undefined);
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl: withMissingHealth(fetchImpl), wait }))
		.rejects.toThrow('failed after 3 attempts');
	expect(fetchImpl).toHaveBeenCalledTimes(5);
	expect(wait.mock.calls).toEqual([[1000], [2000], [1000]]);
	expect(fetchImpl.mock.calls.every(call => String(call[0]).startsWith('https://www.tpex.org.tw/'))).toBe(true);
});

it('retries full official downloads without sending credentials', async () => {
	let attempts = 0;
	const fetchImpl = vi.fn(async (url: URL | string, options: any) => {
		if (String(url).includes('tpex.org.tw')) {
			expect(options.headers).toBeUndefined();
			expect(options.redirect).toBe('error');
			expect(options.signal).toBeInstanceOf(AbortSignal);
			if (++attempts < 3) throw new TypeError('terminated');
			return Response.json([{ Date: '1150930', Close: '100' }]);
		}
		return Response.json({ tradingDate: '2026-09-30', quoteCount: 1 });
	});
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture',
		fetchImpl: withMissingHealth(fetchImpl), wait: async () => {} })).resolves.toMatchObject({ quoteCount: 1 });
	expect(attempts).toBe(3);
});

it('retries a syntactically truncated HTTP 200 body and uploads only the complete official JSON', async () => {
	const body = JSON.stringify([{ Date: '1150930', Close: '100' }]);
	const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('[{"Date":"1150930"'))
		.mockResolvedValueOnce(new Response(body))
		.mockResolvedValueOnce(Response.json({ tradingDate: '2026-09-30', quoteCount: 1 }));
	const wait = vi.fn().mockResolvedValue(undefined);
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture',
		fetchImpl: withMissingHealth(fetchImpl), wait })).resolves.toMatchObject({ quoteCount: 1 });
	expect(wait.mock.calls).toEqual([[1000]]);
	expect(fetchImpl.mock.calls[2][1].body).toBe(body);
});

it.each(['[', '[]', '{}', '<html>temporarily unavailable</html>'])
('never uploads an invalid official response after exhausting retries: %s', async body => {
	const fetchImpl = vi.fn(async (_url: URL | string) => new Response(body));
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture',
		fetchImpl: withMissingHealth(fetchImpl), wait: async () => {} })).rejects.toThrow('failed after 3 attempts');
	expect(fetchImpl).toHaveBeenCalledTimes(5);
	expect(fetchImpl.mock.calls.every(call => String(call[0]).includes('tpex.org.tw/'))).toBe(true);
});

it('rejects oversized UTF-8 payloads by byte count before upload', async () => {
	// This is below the limit in UTF-16 code units but exceeds eight MiB in UTF-8.
	const body = JSON.stringify(['櫃'.repeat(3 * 1024 * 1024)]);
	const fetchImpl = vi.fn(async (_url: URL | string) => new Response(body));
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture',
		fetchImpl: withMissingHealth(fetchImpl), wait: async () => {} })).rejects.toThrow('Official payload too large');
	expect(fetchImpl.mock.calls.every(call => String(call[0]).includes('tpex.org.tw/'))).toBe(true);
});

it('retains nested transport failure diagnostics without exposing the full socket object', async () => {
	const cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET', socket: { privateDetail: 'do not log' } });
	const fetchImpl = vi.fn().mockRejectedValue(new TypeError('terminated', { cause }));
	const promise = collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture',
		fetchImpl: withMissingHealth(fetchImpl), wait: async () => {} });
	await expect(promise).rejects.toThrow('terminated: other side closed [UND_ERR_SOCKET]');
	await expect(promise).rejects.not.toThrow('do not log');
});

it('treats delayed publication as pending during polling but fails the final missing-archive check', async () => {
	const fetchImpl = vi.fn(async (url: URL | string) => {
		if (String(url).includes('tpex.org.tw')) return Response.json([{ Date: '1150929' }]);
		if (String(url).endsWith('/ingest')) return Response.json(
			{ error: 'Source date does not match expected completed session' }, { status: 409 });
		return Response.json({ complete: false }, { status: 503 });
	});
	const options = { workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl: withMissingHealth(fetchImpl) };
	expect(await collectTpex(options)).toMatchObject({ awaitingPublication: true, tradingDate: null });
	await expect(collectTpex({ ...options, requireComplete: true })).rejects.toThrow('incomplete');
});

it('does not mistake invalid credentials for delayed publication', async () => {
	const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json([{ Date: '1150930' }]))
		.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'wrong', fetchImpl: withMissingHealth(fetchImpl) }))
		.rejects.toThrow('Archive ingestion failed: HTTP 401');
});

it.each([false, true])('skips download when the expected TPEX archive exists (final=%s)', async requireComplete => {
	const fetchImpl = vi.fn(async (url: URL | string, options: any) => {
		expect(String(url)).toBe('https://archive.invalid/health/eod');
		expect(options.headers).toBeUndefined();
		return healthResponse(true, true);
	});
	expect(await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete, fetchImpl }))
		.toMatchObject({ alreadyArchived: true, awaitingPublication: false, tradingDate: '2026-09-30', quoteCount: 10 });
});

it('skips an archived TPEX download while TWSE is still pending', async () => {
	const fetchImpl = vi.fn(async (url: URL | string) => {
		expect(String(url)).toBe('https://archive.invalid/health/eod');
		return healthResponse(true, false);
	});
	expect(await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl }))
		.toMatchObject({ alreadyArchived: true, tradingDate: '2026-09-30' });
});

it('fails the final check when TPEX is archived but TWSE is missing', async () => {
	const fetchImpl = vi.fn(async (url: URL | string) => {
		expect(String(url)).toBe('https://archive.invalid/health/eod');
		return healthResponse(true, false);
	});
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete: true, fetchImpl }))
		.rejects.toThrow('incomplete');
});

it.each([false, true])('recovers exhausted downloads when a valid archive appears (final=%s)', async requireComplete => {
	let healthChecks = 0;
	let downloads = 0;
	const fetchImpl = vi.fn(async (url: URL | string) => {
		if (String(url).endsWith('/health/eod')) return healthResponse(++healthChecks > 1, true);
		expect(String(url)).toContain('tpex.org.tw/');
		downloads++;
		return { ok: true, text: async () => { throw new Error('terminated'); } };
	});
	const result = await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete,
		fetchImpl, wait: async () => {} });
	expect(result).toMatchObject({ alreadyArchived: true, tradingDate: '2026-09-30', quoteCount: 10,
		downloadWarning: 'Official source download failed after 3 attempts: terminated' });
	expect(downloads).toBe(3);
});

it.each([false, true])('keeps the final TWSE requirement after download recovery (final=%s)', async requireComplete => {
	let checks = 0;
	const fetchImpl = vi.fn(async (url: URL | string) => {
		if (String(url).endsWith('/health/eod')) return healthResponse(++checks > 1, false);
		expect(String(url)).toContain('tpex.org.tw/');
		throw new Error('terminated');
	});
	const result = collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete,
		fetchImpl, wait: async () => {} });
	if (requireComplete) await expect(result).rejects.toThrow('incomplete');
	else expect(await result).toMatchObject({ alreadyArchived: true, downloadWarning: expect.stringContaining('terminated') });
});

it.each([false, true])('rechecks verified archive health after both full and range recovery fail (final=%s)', async requireComplete => {
	let checks = 0;
	const fetchImpl = vi.fn(async (url: URL | string) => {
		if (String(url).endsWith('/health/eod')) return healthResponse(++checks >= 3, true);
		expect(String(url)).toContain('tpex.org.tw/');
		throw new Error('terminated');
	});
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete,
		fetchImpl, wait: async () => {} })).resolves.toMatchObject({ alreadyArchived: true,
		downloadWarning: expect.stringContaining('range recovery failed') });
});

it.each(['stale date', 'zero prices', 'missing date', 'unavailable', 'invalid JSON', 'HTTP 401', 'network error'])
('does not trust an unverifiable archive: %s', async scenario => {
	const fetchImpl = vi.fn(async (url: URL | string) => {
		if (String(url).endsWith('/health/eod')) {
			if (scenario === 'network error') throw new Error('health unavailable');
			if (scenario === 'invalid JSON') return new Response('{');
			const body = archiveHealth(true, true);
			if (scenario === 'stale date') body.boards.TPEX.sourceTradingDate = '2026-09-29';
			if (scenario === 'zero prices') body.boards.TPEX.quoteCount = 0;
			if (scenario === 'missing date') body.expectedTradingDate = '';
			if (scenario === 'unavailable') body.boards.TPEX.available = false;
			return Response.json(body, { status: scenario === 'HTTP 401' ? 401 : 200 });
		}
		expect(String(url)).toContain('tpex.org.tw/');
		throw new Error('connection lost');
	});
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl, wait: async () => {} }))
		.rejects.toThrow('failed after 3 attempts');
});

it('still collects when the preflight health check is unavailable', async () => {
	const fetchImpl = vi.fn(async (url: URL | string) => {
		if (String(url).endsWith('/health/eod')) throw new Error('health unavailable');
		if (String(url).includes('tpex.org.tw')) return Response.json([{ Date: '1150930', Close: '100' }]);
		return Response.json({ tradingDate: '2026-09-30', quoteCount: 1 });
	});
	expect(await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', fetchImpl }))
		.toMatchObject({ tradingDate: '2026-09-30', quoteCount: 1 });
});

it('rechecks the completed date at the final check instead of reusing the preflight result', async () => {
	let checks = 0;
	const fetchImpl = vi.fn(async (url: URL | string) => {
		expect(String(url)).toBe('https://archive.invalid/health/eod');
		if (++checks === 1) return healthResponse(true, true);
		const health = archiveHealth(false, false);
		health.expectedTradingDate = '2026-10-01';
		return Response.json(health, { status: 503 });
	});
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete: true, fetchImpl }))
		.rejects.toThrow('incomplete');
});


it('passes the final check after uploading when both expected-date archives are valid', async () => {
	let checks = 0;
	const fetchImpl = vi.fn(async (url: URL | string) => {
		if (String(url).endsWith('/health/eod')) return healthResponse(++checks > 1, true);
		if (String(url).includes('tpex.org.tw')) return Response.json([{ Date: '1150930', Close: '100' }]);
		return Response.json({ tradingDate: '2026-09-30', quoteCount: 1 });
	});
	expect(await collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete: true, fetchImpl }))
		.toMatchObject({ tradingDate: '2026-09-30', quoteCount: 1 });
});

it.each(['stale TWSE date', 'zero TWSE prices', 'health unavailable'])
('fails the final check even after a valid preflight: %s', async scenario => {
	let checks = 0;
	const fetchImpl = vi.fn(async (url: URL | string) => {
		expect(String(url)).toBe('https://archive.invalid/health/eod');
		if (++checks === 1) return healthResponse(true, true);
		if (scenario === 'health unavailable') throw new Error('health unavailable');
		const body = archiveHealth(true, true);
		if (scenario === 'stale TWSE date') body.boards.TWSE.sourceTradingDate = '2026-09-29';
		if (scenario === 'zero TWSE prices') body.boards.TWSE.quoteCount = 0;
		return Response.json(body);
	});
	await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture', requireComplete: true, fetchImpl }))
		.rejects.toThrow('incomplete');
});

