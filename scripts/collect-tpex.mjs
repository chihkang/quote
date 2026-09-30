import { pathToFileURL } from 'node:url';

// Runs on an independent server/runner when the official API rejects Workers' egress.
// Only public official data is uploaded. The credential is limited to TPEX ingestion.
export async function collectTpex({ workerURL, token, requireComplete = false, fetchImpl = fetch }) {
	if (!workerURL?.startsWith('https://') || !token) throw new Error('Configure QUOTE_WORKER_URL and EOD_INGEST_TOKEN');
	const source = await fetchImpl('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
		{ redirect: 'error', signal: AbortSignal.timeout(30000) });
	if (!source.ok) throw new Error('Official source failed: HTTP ' + source.status);
	const raw = await source.text();
	if (new TextEncoder().encode(raw).length > 8 * 1024 * 1024) throw new Error('Official payload too large');
	const rows = JSON.parse(raw);
	if (!Array.isArray(rows) || !rows.length) throw new Error('Official source returned no rows');
	const ingest = await fetchImpl(new URL('/admin/tpex/eod/ingest', workerURL), {
		method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
		headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: raw
	});
	const result = await ingest.json();
	const awaitingPublication = ingest.status === 409 && result.error === 'Source date does not match expected completed session';
	if (!ingest.ok && !awaitingPublication) throw new Error('Archive ingestion failed: HTTP ' + ingest.status);
	if (requireComplete) {
		const health = await fetchImpl(new URL('/health/eod', workerURL),
			{ redirect: 'error', signal: AbortSignal.timeout(30000) });
		if (!health.ok || !(await health.json()).complete) throw new Error('Official archive incomplete after final daily attempt');
	}
	return { awaitingPublication, tradingDate: result.tradingDate ?? null, quoteCount: result.quoteCount ?? 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	collectTpex({ workerURL: process.env.QUOTE_WORKER_URL, token: process.env.EOD_INGEST_TOKEN,
		requireComplete: process.argv.includes('--require-complete') })
		.then(result => console.log(JSON.stringify(result)))
		.catch(error => { console.error(error.message); process.exitCode = 1; });
}
