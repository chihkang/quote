# Implementation Plan: Queue + Rate Limit for Upstream Quote Fetch

**Branch**: `002-queue-rate-limit` | **Date**: 2026-02-06

## Summary
Introduce Cloudflare Queues and a controlled consumer to respect upstream 60/min limits. Requests still return immediately with cached results, while missing symbols are queued for later fetch. The consumer fetches quotes at a capped rate and writes KV so subsequent requests hit cache.

## Goals
- Protect upstream 60/min limits for TW (Fugle) and US (Finnhub).
- Serve cached data immediately; enqueue misses for async backfill.
- Keep API responsive under high concurrency.

## Non-Goals
- Auto DST switching for US session windows.
- Per-user server-side rate limiting (client-controlled in this plan).

## Public API Changes
- `reason` adds `QUEUED` for missing quotes that are queued.
- Add optional `retryAfterSec` to results for queued misses.

## Implementation Steps
1. **Queue binding**
   - Add a new queue binding (e.g., `QUOTE_FETCH_QUEUE`) in `wrangler.jsonc`.
   - Configure a consumer for the same queue.

2. **Message schema**
   - Define message shape:
     - `market`: `TW` | `US`
     - `symbol`: ticker
     - `canonicalSymbol`
     - `requestedAt`: ISO
     - `reason`: `KV_MISS` | `HARD_EXPIRED`

3. **Enqueue on cache miss**
   - Keep immediate response.
   - For missing quotes beyond `MAX_SYNC_FETCH`, enqueue and return:
     - `status: "missing"`
     - `reason: "QUEUED"`
     - `retryAfterSec`: default 60 (configurable)
   - Existing cache hits return as usual.

4. **Consumer: upstream rate limit**
   - Implement token bucket per market in KV (e.g., keys `rate:TW` / `rate:US`).
   - Allow at most 60 fetches/min per market.
   - If tokens depleted, requeue or delay processing.

5. **De-dupe / pending guard**
   - Before fetching, check if KV already has fresh/stale value; if so, skip.
   - Use short-lived `pending:<market>:<symbol>` keys to reduce duplicate queue work.

6. **Write KV on success**
   - Use existing `getTtlSeconds` to compute TTL.
   - Store `ttlHardSec` and `expiresAt` in value.

7. **Docs**
   - Update README with queue behavior, `QUEUED` reason, and `retryAfterSec` semantics.

## Testing
- Unit test: queued miss returns `reason=QUEUED` and `retryAfterSec`.
- Integration test: consumer processes queued items and populates KV.
- Rate limit test: more than 60 items in a minute yields capped upstream calls.

## Assumptions
- Client enforces per-user rate limit (5 minutes per request) as stated.
- Queue name defaults to `QUOTE_FETCH_QUEUE`.
- `retryAfterSec` defaults to 60 seconds.
