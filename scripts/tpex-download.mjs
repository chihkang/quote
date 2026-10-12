export const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const MAX_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

async function readExactBytes(response, length) {
	if (!response.body) throw new Error('Official byte range is incomplete');
	const bytes = new Uint8Array(length);
	const reader = response.body.getReader();
	let offset = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value.length > length - offset) {
				await reader.cancel();
				throw new Error('Official byte range exceeds its declared size');
			}
			bytes.set(value, offset);
			offset += value.length;
		}
	} finally {
		reader.releaseLock();
	}
	if (offset !== length) throw new Error('Official byte range is incomplete');
	return bytes;
}

// A failed large transfer must never become a partial official payload. The
// fallback uses small ranges of one strong-ETag representation on the same URL.
export async function downloadTpexRanges({ fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
	const controller = new AbortController();
	const deadline = AbortSignal.timeout(120000);
	const signal = AbortSignal.any([controller.signal, deadline]);
	const readRange = async (start, end, expected) => {
		for (let attempt = 1; attempt <= 2; attempt++) {
			try {
				signal.throwIfAborted();
				const response = await fetchImpl(TPEX_URL, {
					headers: { 'Accept-Encoding': 'identity', Range: `bytes=${start}-${end}`,
						...(expected ? { 'If-Range': expected.etag } : {}) },
					redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)])
				});
				const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
				const etag = response.headers.get('etag');
				const encoding = response.headers.get('content-encoding');
				const total = Number(range?.[3]);
				if (response.status !== 206 || !range || !Number.isSafeInteger(total) || total <= 0 || total > MAX_BYTES
					|| Number(range[1]) !== start || Number(range[2]) !== Math.min(end, total - 1)
					|| !etag || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) || (encoding && encoding.toLowerCase() !== 'identity')
					|| (expected && (etag !== expected.etag || total !== expected.total))) {
					await response.body?.cancel();
					throw new Error('Official byte range metadata is invalid or changed');
				}
				const bytes = await readExactBytes(response, Math.min(end, total - 1) - start + 1);
				signal.throwIfAborted();
				return { bytes, total, etag };
			} catch (error) {
				if (attempt === 2 || signal.aborted) throw error;
				await wait(1000);
			}
		}
	};
	try {
		const first = await readRange(0, CHUNK_BYTES - 1);
		const body = new Uint8Array(first.total);
		body.set(first.bytes);
		let next = first.bytes.length;
		// At most three requests in flight, 32 chunks, two attempts per chunk and
		// two minutes total. If the object changes, discard every accumulated byte.
		await Promise.all(Array.from({ length: 3 }, async () => {
			while (next < first.total) {
				const start = next;
				next += CHUNK_BYTES;
				const result = await readRange(start, Math.min(start + CHUNK_BYTES, first.total) - 1, first);
				body.set(result.bytes, start);
			}
		}));
		return new TextDecoder('utf-8', { fatal: true }).decode(body);
	} finally {
		controller.abort();
	}
}
