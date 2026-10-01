import { pathToFileURL } from 'node:url';

async function readArchiveHealth(workerURL, fetchImpl) {
	try {
		const response = await fetchImpl(new URL('/health/eod', workerURL),
			{ redirect: 'error', signal: AbortSignal.timeout(30000) });
		// A 503 can still contain a valid TPEX archive while TWSE is pending.
		if (response.status !== 200 && response.status !== 503) return null;
		return { ok: response.ok, body: await response.json() };
	} catch {
		// An unavailable health check must not prevent collection or prove success.
		return null;
	}
}

function hasArchivedBoard(health, board) {
	const expectedDate = health?.body?.expectedTradingDate;
	const archive = health?.body?.boards?.[board];
	return typeof expectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expectedDate)
		&& archive?.available === true && archive.sourceTradingDate === expectedDate
		&& Number.isFinite(archive.quoteCount) && archive.quoteCount > 0;
}

function requireCompleteArchive(health) {
	if (!health?.ok || health.body?.complete !== true
		|| !hasArchivedBoard(health, 'TWSE') || !hasArchivedBoard(health, 'TPEX')) {
		throw new Error('Official archive incomplete after final daily attempt');
	}
}

// Runs on an independent server/runner when the official API rejects Workers' egress.
// Only public official data is uploaded. The credential is limited to TPEX ingestion.
export async function collectTpex({ workerURL, token, requireComplete = false, fetchImpl = fetch,
	wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
	if (!workerURL?.startsWith('https://') || !token) throw new Error('Configure QUOTE_WORKER_URL and EOD_INGEST_TOKEN');
	const archivedResult = async (health, downloadWarning) => {
		if (requireComplete) {
			// Recheck both boards and the current completed date even on a skipped download.
			health = await readArchiveHealth(workerURL, fetchImpl);
			requireCompleteArchive(health);
		}
		return { alreadyArchived: true, awaitingPublication: false,
			tradingDate: health.body.expectedTradingDate, quoteCount: health.body.boards.TPEX.quoteCount,
			...(downloadWarning ? { downloadWarning } : {}) };
	};
	const initialHealth = await readArchiveHealth(workerURL, fetchImpl);
	if (hasArchivedBoard(initialHealth, 'TPEX')) return archivedResult(initialHealth);
	let raw;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const source = await fetchImpl('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
				{ redirect: 'error', signal: AbortSignal.timeout(30000) });
			if (!source.ok) throw new Error('HTTP ' + source.status);
			// Retry the entire download if the server terminates a partially read body.
			raw = await source.text();
			break;
		} catch (error) {
			if (attempt === 3) {
				const warning = 'Official source download failed after 3 attempts: ' + error.message;
				const recoveredHealth = await readArchiveHealth(workerURL, fetchImpl);
				if (hasArchivedBoard(recoveredHealth, 'TPEX')) return archivedResult(recoveredHealth, warning);
				throw new Error(warning);
			}
			await wait(attempt * 1000);
		}
	}
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
		requireCompleteArchive(await readArchiveHealth(workerURL, fetchImpl));
	}
	return { awaitingPublication, tradingDate: result.tradingDate ?? null, quoteCount: result.quoteCount ?? 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	collectTpex({ workerURL: process.env.QUOTE_WORKER_URL, token: process.env.EOD_INGEST_TOKEN,
		requireComplete: process.argv.includes('--require-complete') })
		.then(result => {
			if (result.downloadWarning) console.warn(result.downloadWarning);
			console.log(JSON.stringify(result));
		})
		.catch(error => { console.error(error.message); process.exitCode = 1; });
}
