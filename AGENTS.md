# Quote Worker agent guide

## Scope and completion

Deliver the requested change through implementation and relevant verification. Fix failures introduced by the change and continue until the requested outcome is complete or a concrete blocker requires user input. Make routine, reversible choices within scope without repeated approval; surface assumptions that affect the API contract or market-price meaning.

Preserve unrelated working-tree changes. Commit and push when the user requests them, staging only the intended files. Deployment, secret changes, and writes to live KV/R2 or the admin refresh endpoint require authorization covering those actions; a request to push code alone does not cover them. Keep credentials and `.dev.vars` out of commits and output.

## Read according to the task

This is a TypeScript Cloudflare Worker for batch Taiwan and US stock quotes, with L1/KV caching and Taiwan EOD snapshots in R2. Use the following entry points only as needed:

| Task | Reference |
| --- | --- |
| API usage, response fields, setup, configuration, or deployment | [README.md](README.md) and scripts in [package.json](package.json) |
| Close kinds, source/target trading dates, or settlement behavior | [CONTEXT.md](CONTEXT.md), the [completed-session ADR](docs/adr/0002-completed-market-session-context.md), and the [original close-semantics ADR](docs/adr/0001-separate-close-semantics-from-cache-freshness.md) |
| Request routing, provider calls, or fetch limits | [src/index.ts](src/index.ts) |
| Symbol handling | [src/symbols.ts](src/symbols.ts) |
| Cache classification, retention, or market-session timing | [src/quotePolicy.ts](src/quotePolicy.ts), [src/kvCache.ts](src/kvCache.ts), [src/l1Cache.ts](src/l1Cache.ts), [src/ttl.ts](src/ttl.ts), and [src/time.ts](src/time.ts) |
| TWSE/TPEX ingestion, R2 snapshots, or EOD fallback | [src/twEod.ts](src/twEod.ts) and the relevant sections of README.md |
| Earlier feature rationale | The relevant document under `specs/` or `docs/plans/`; check historical assumptions against current code and accepted ADRs |

## Contracts to preserve

- Normalize symbols before cache access. Keep canonical cache keys in `quote:{MARKET}:{TICKER}` form and preserve distinct securities.
- Keep `QuoteCacheValue` and API response mapping consistent. Preserve existing field meanings when extending the response.
- Keep freshness (`fresh`, `stale`, `missing`) independent of `closeKind`. A stale intraday quote remains intraday data.
- Resolve Taiwan official EOD against `expectedCloseTradingDate`, before ordinary L1/KV hits after a real trading session ends. On that day, require its own official close, then same-day provisional data or `price=null`. Pre-open and holiday R2 resolution may use the earlier expected completed official session while preserving its actual source date; never fabricate a holiday provisional quote or accept an older-than-expected close.
- Use market-local trading dates (Taipei for TW, New York for US). Apply the ADR's timestamp rules when establishing a provisional quote's source date, keeping `asOf` and `fetchedAt` distinct.
- US quotes use Finnhub and do not inherit Taiwan R2 EOD fallback or official-close semantics.
- Use `getTtlSeconds()` for quote TTL decisions. Preserve the shared per-request `MAX_SYNC_FETCH` cap and the US provider concurrency limit of 5 unless changing those policies is part of the request.

## Local work and verification

Follow the existing module boundaries and TypeScript ES-module style. Read the affected implementation and tests; expand investigation when dependencies or evidence call for it.

- Install locked dependencies with `npm ci` when needed.
- Run affected Vitest files with `npm test -- test/<file>.test.ts`; use `npm test` for changes spanning shared request, cache, or timing behavior.
- The existing tests use local fixtures, mocked provider calls, and in-memory KV/R2 substitutes. Run them, fix change-related failures, and rerun affected tests without asking at each step. Keep new tests isolated from live services and credentials.
- For TypeScript changes, use the installed compiler with `npx --no-install tsc --noEmit`.
- For documentation-only changes, check accuracy, referenced paths, and `git diff --check`; running the application suite is unnecessary unless behavior or executable examples changed.

Once relevant checks pass, finish the requested delivery. Repeat or broaden checks when new edits, failures, or unresolved risks justify it. Report what changed, checks actually performed, and any remaining limits; local tests do not establish deployed behavior.
