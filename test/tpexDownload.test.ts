import { expect, it, vi } from 'vitest';
// @ts-expect-error Node-only HTTP fixture; application types target Cloudflare Workers.
import { createServer } from 'node:http';
// @ts-expect-error Node-only HTTP fixture; application types target Cloudflare Workers.
import { once } from 'node:events';
// @ts-expect-error plain Node entry point shared with the scheduled collector
import { downloadTpexRanges, TPEX_URL } from '../scripts/tpex-download.mjs';
// @ts-expect-error plain Node entry point shared with the scheduled collector
import { collectTpex } from '../scripts/collect-tpex.mjs';

const payload = JSON.stringify([{ Date: '1151012', SecuritiesCompanyCode: '6488', Close: '100',
	CompanyName: '測試櫃買'.repeat(60000) }]);
const bytes = new TextEncoder().encode(payload);

function rangedResponse(options: any, headers: Record<string, string> = {}, status = 206) {
	const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)!;
	const start = Number(from), end = Math.min(Number(to), bytes.length - 1);
	return new Response(bytes.slice(start, end + 1), { status, headers: {
		'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: '"fixture-v1"', ...headers
	} });
}

it('assembles exact UTF-8 bytes of one strong-ETag representation, using only the public official URL', async () => {
	let active = 0, maxActive = 0;
	const fetchImpl = vi.fn(async (url: string, options: any) => {
		expect(url).toBe(TPEX_URL);
		expect(options.headers.Authorization).toBeUndefined();
		expect(options.headers['Accept-Encoding']).toBe('identity');
		expect(options.redirect).toBe('error');
		if (options.headers.Range !== 'bytes=0-262143') expect(options.headers['If-Range']).toBe('"fixture-v1"');
		maxActive = Math.max(maxActive, ++active);
		await Promise.resolve();
		active--;
		return rangedResponse(options);
	});
	expect(await downloadTpexRanges({ fetchImpl })).toBe(payload);
	expect(fetchImpl).toHaveBeenCalledTimes(Math.ceil(bytes.length / 262144));
	expect(maxActive).toBeLessThanOrEqual(3);
});

it('retries only the interrupted range without restarting valid chunks', async () => {
	let interrupted = false;
	const fetchImpl = vi.fn(async (_url: string, options: any) => {
		if (options.headers.Range === 'bytes=262144-524287' && !interrupted) {
			interrupted = true;
			throw new TypeError('terminated');
		}
		return rangedResponse(options);
	});
	const wait = vi.fn().mockResolvedValue(undefined);
	expect(await downloadTpexRanges({ fetchImpl, wait })).toBe(payload);
	expect(fetchImpl).toHaveBeenCalledTimes(Math.ceil(bytes.length / 262144) + 1);
	expect(wait.mock.calls).toEqual([[1000]]);
});

it.each(['status 200', 'status 302', 'weak ETag', 'missing ETag', 'changed ETag', 'invalid ETag', 'wrong offset',
	'changed total', 'oversized total', 'compressed', 'short body'])
('rejects range corruption or an unverifiable representation: %s', async scenario => {
	const fetchImpl = vi.fn(async (_url: string, options: any) => {
		if (options.headers.Range === 'bytes=0-262143') return rangedResponse(options);
		const response = rangedResponse(options);
		if (scenario === 'status 200') return rangedResponse(options, {}, 200);
		if (scenario === 'status 302') return new Response(null, { status: 302 });
		if (scenario === 'weak ETag') response.headers.set('etag', 'W/"fixture-v1"');
		if (scenario === 'missing ETag') response.headers.delete('etag');
		if (scenario === 'changed ETag') response.headers.set('etag', '"fixture-v2"');
		if (scenario === 'invalid ETag') response.headers.set('etag', '"invalid tag"');
		if (scenario === 'wrong offset') response.headers.set('content-range', `bytes 0-262143/${bytes.length}`);
		if (scenario === 'changed total') response.headers.set('content-range', response.headers.get('content-range')!.replace(`/${bytes.length}`, `/${bytes.length + 1}`));
		if (scenario === 'oversized total') response.headers.set('content-range', response.headers.get('content-range')!.replace(`/${bytes.length}`, '/8388609'));
		if (scenario === 'compressed') response.headers.set('content-encoding', 'gzip');
		if (scenario === 'short body') return new Response('partial', { status: 206, headers: response.headers });
		return response;
	});
	await expect(downloadTpexRanges({ fetchImpl, wait: async () => {} })).rejects.toThrow();
	expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(7);
});

it('rejects an oversized first range before allocating or reading a response body', async () => {
	const fetchImpl = vi.fn(async (_url: string, options: any) => rangedResponse(options,
		{ 'Content-Range': 'bytes 0-262143/8388609' }));
	await expect(downloadTpexRanges({ fetchImpl, wait: async () => {} })).rejects.toThrow('metadata');
	expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('rejects invalid UTF-8 instead of silently replacing bytes', async () => {
	const fetchImpl = vi.fn(async () => new Response(new Uint8Array([255]), { status: 206,
		headers: { 'Content-Range': 'bytes 0-0/1', ETag: '"fixture-v1"' } }));
	await expect(downloadTpexRanges({ fetchImpl })).rejects.toThrow();
});

it('cancels an oversized range stream as soon as it exceeds the declared length', async () => {
	const cancel = vi.fn();
	const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
		start(controller) { controller.enqueue(new Uint8Array(2)); }, cancel
	}), { status: 206, headers: { 'Content-Range': 'bytes 0-0/1', ETag: '"fixture-v1"' } }));
	await expect(downloadTpexRanges({ fetchImpl, wait: async () => {} })).rejects.toThrow('exceeds');
	expect(cancel).toHaveBeenCalledTimes(2);
});

it('aborts all in-flight requests at the shared two-minute deadline without starting more retries', async () => {
	const deadline = new AbortController();
	const realTimeout = AbortSignal.timeout.bind(AbortSignal);
	const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 120000 ? deadline.signal : realTimeout(ms));
	const signals: AbortSignal[] = [];
	const fetchImpl = vi.fn(async (_url: string, options: any) => {
		if (options.headers.Range === 'bytes=0-262143') return rangedResponse(options);
		signals.push(options.signal);
		return new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort',
			() => reject(options.signal.reason), { once: true }));
	});
	try {
		const promise = downloadTpexRanges({ fetchImpl, wait: async () => {} });
		const rejected = expect(promise).rejects.toThrow('fixture deadline');
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
		deadline.abort(new Error('fixture deadline'));
		await rejected;
		expect(timeout).toHaveBeenCalledWith(120000);
		expect(signals.every(signal => signal.aborted)).toBe(true);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	} finally {
		timeout.mockRestore();
	}
});

it('recovers a real terminated HTTP response with verified ranges before allowing ingestion', async () => {
	let fullRequests = 0, rangeRequests = 0;
	const server = createServer((request: any, response: any) => {
		const range = request.headers.range;
		if (!range) {
			fullRequests++;
			response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': bytes.length });
			response.write(bytes.slice(0, 100));
			setTimeout(() => response.destroy(), 5);
			return;
		}
		rangeRequests++;
		if (range !== 'bytes=0-262143') expect(request.headers['if-range']).toBe('"fixture-v1"');
		const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
		const start = Number(from), end = Math.min(Number(to), bytes.length - 1);
		response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
			ETag: '"fixture-v1"', 'Content-Length': end - start + 1 });
		response.end(bytes.slice(start, end + 1));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address() as { port: number };
	let uploads = 0;
	try {
		const fetchImpl = async (url: URL | string, options: any) => {
			if (String(url) === TPEX_URL) return fetch(`http://127.0.0.1:${address.port}/official`, options);
			if (String(url).endsWith('/health/eod')) return Response.json({ complete: false }, { status: 503 });
			expect(String(url)).toBe('https://archive.invalid/admin/tpex/eod/ingest');
			expect(options.body).toBe(payload);
			uploads++;
			return Response.json({ tradingDate: '2026-10-12', quoteCount: 1 });
		};
		await expect(collectTpex({ workerURL: 'https://archive.invalid', token: 'fixture',
			fetchImpl, wait: async () => {} })).resolves.toMatchObject({ downloadMethod: 'byte-ranges', quoteCount: 1 });
		expect(fullRequests).toBe(3);
		expect(rangeRequests).toBe(Math.ceil(bytes.length / 262144));
		expect(uploads).toBe(1);
	} finally {
		server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});
