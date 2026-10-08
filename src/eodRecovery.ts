import { resolveMarketCloseContext } from './marketCalendar';
import { getArchivedTwEodSnapshots, ingestTpexEodSnapshot, type EnvWithTwEod } from './twEod';

type Env = EnvWithTwEod & { EOD_INGEST_TOKEN?: string };
const json = (value: unknown, status = 200) => Response.json(value, { status,
	headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });

export async function eodHealth(env: Env, now = new Date()): Promise<Response> {
	const context = resolveMarketCloseContext('TW', now);
	const expectedTradingDate = context.expectedCloseTradingDate;
	const snapshots = expectedTradingDate ? await getArchivedTwEodSnapshots(env, expectedTradingDate) : [];
	const boards = Object.fromEntries(['TWSE', 'TPEX'].map(board => {
		const snapshot = snapshots.find(item => item.source.startsWith(board + '_'));
		const quoteCount = snapshot ? Object.values(snapshot.quotes).filter(q => q.close !== null && q.close > 0).length : 0;
		return [board, { available: quoteCount > 0, sourceTradingDate: snapshot?.tradingDate ?? null,
			fetchedAt: snapshot?.fetchedAt ?? null, quoteCount }];
	}));
	const complete = !!expectedTradingDate && boards.TWSE.available && boards.TPEX.available;
	return json({ complete, expectedTradingDate, calendarVersion: context.calendarVersion, boards }, complete ? 200 : 503);
}

export async function ingestTpex(request: Request, env: Env, now = new Date()): Promise<Response> {
	if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
	if (!env.EOD_INGEST_TOKEN) return json({ error: 'Ingestion not configured' }, 503);
	if (request.headers.get('authorization') !== 'Bearer ' + env.EOD_INGEST_TOKEN) return json({ error: 'Unauthorized' }, 401);
	if (!env.TW_EOD_R2) return json({ error: 'Archive not configured' }, 503);
	// Read a bounded body, including requests without Content-Length.
	const reader = request.body?.getReader();
	if (!reader) return json({ error: 'Missing body' }, 400);
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > 8 * 1024 * 1024) { await reader.cancel(); return json({ error: 'Payload too large' }, 413); }
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	let payload: unknown;
	try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
	catch { return json({ error: 'Invalid JSON' }, 400); }
	const expected = resolveMarketCloseContext('TW', now).expectedCloseTradingDate;
	if (!expected) return json({ error: 'Calendar unavailable' }, 503);
	try {
		const result = await ingestTpexEodSnapshot(env, payload, expected, now);
		return json({ ok: true, ...result });
	} catch (error) {
		// Provider data is public; never include request headers or credentials in errors.
		return json({ error: error instanceof Error ? error.message : 'Invalid official data' }, 409);
	}
}
