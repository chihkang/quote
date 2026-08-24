# Research: Quote Cache Reliability

## Existing flow

- `src/index.ts` checks L1, then KV, then fetches unresolved symbols synchronously.
- TW post-close requests bypass ordinary quote cache lookup to resolve official EOD or same-day provisional data.
- US fetches are grouped in batches of five.
- `src/kvCache.ts` provides one-key `getQuote` and `putQuote`.
- Fugle 429 writes `sys:tw:fugle:block_until` and uses R2 fallback.

## Decisions

### Why parallelize at the request-flow level?

Cloudflare KV reads are independent for different canonical symbols. The binding does not require a cross-key transaction for this path, so `Promise.all` reduces aggregate wait without changing cache values or TTL classification.

### Why isolate-local single-flight?

The Worker can receive overlapping requests in one isolate. A short-lived promise registry removes duplicate upstream work without adding a new durable coordination primitive. KV remains the cross-isolate source of truth; the registry is only an optimization.

### Why keep close mode in the key?

An intraday quote and a provisional close have different semantics. Joining them could let one request receive a value that was fetched under the wrong target trading date. The mode/date key prevents that class of semantic collision.

### Why bounded retries?

Retries improve resilience only when they are bounded. A three-attempt default, per-attempt timeout, capped backoff, and existing TW 429 cooldown keep failures visible and prevent a slow upstream from holding a batch indefinitely.
