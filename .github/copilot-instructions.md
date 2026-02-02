# Copilot instructions for Quote Worker

## Big picture
- Cloudflare Worker serving POST /quotes/batch with TW/US quotes and freshness status.
- Two-layer cache: in-memory L1 in [src/l1Cache.ts](src/l1Cache.ts) and KV in [src/kvCache.ts](src/kvCache.ts). L1 uses short TTL; KV uses soft/hard TTL logic from [src/ttl.ts](src/ttl.ts).
- Request flow in [src/index.ts](src/index.ts): normalize symbols → try L1 → try KV → classify via [src/quotePolicy.ts](src/quotePolicy.ts) → fetch missing (Fugle TW, Finnhub US) → write KV + L1.
- Symbol normalization lives in [src/symbols.ts](src/symbols.ts). Canonical key format: quote:{MARKET}:{TICKER}.
- Time zone and market-session logic is in [src/time.ts](src/time.ts) and used by TTL selection.

## Key behaviors to preserve
- Response statuses: `fresh`, `stale`, `missing` with `reason` (`KV_MISS`, `HARD_EXPIRED`, `FUGLE_ERROR`, `FINNHUB_ERROR`).
- US fetch concurrency is limited to 5 per batch in [src/index.ts](src/index.ts).
- Off-hours hard TTL is computed to next market open + buffer; trading hours hard TTL is capped (US max 300s).

## Developer workflows
- Install: `npm install`
- Dev server: `npm run dev` (uses Wrangler)
- Tests: `npm test` (Vitest)
- Env config: edit [wrangler.jsonc](wrangler.jsonc) and local `.dev.vars` with `FUGLE_API_KEY`, `FINNHUB_API_KEY`.

## Integration points
- External APIs: Fugle (TW) and Finnhub (US) in [src/index.ts](src/index.ts).
- KV namespace `QUOTES_KV` must be wired in [wrangler.jsonc](wrangler.jsonc).
- For production, set secrets via `wrangler secret put FUGLE_API_KEY` and `wrangler secret put FINNHUB_API_KEY`.

## Project conventions
- Use `normalizeSymbols()` before any cache access; do not accept empty symbols after normalization.
- Cache payload shape is `QuoteCacheValue` in [src/kvCache.ts](src/kvCache.ts); keep fields in sync with API response mapping.
- Use `getTtlSeconds()` for TTL decisions; do not hardcode TTLs elsewhere.
