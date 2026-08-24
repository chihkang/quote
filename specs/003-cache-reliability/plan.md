# Implementation Plan: Quote Cache Reliability

**Branch**: `003-cache-reliability` | **Date**: 2026-08-21  
**Spec**: [spec.md](spec.md)

## Summary

Improve the synchronous quote path in three layers: parallelize independent KV reads, deduplicate concurrent upstream fetches inside a Worker isolate, and add bounded timeout/retry transport handling for Fugle and Finnhub.

## Technical Context

**Language/Version**: TypeScript 5.6.3  
**Runtime**: Cloudflare Workers with Wrangler 4.x  
**Storage**: Cloudflare KV (`QUOTES_KV`) and R2 (`TW_EOD_R2`)  
**Testing**: Vitest 3.x  
**Constraints**: Preserve existing API fields and statuses, TW close-resolution semantics, `MAX_SYNC_FETCH`, and five-way US fetch concurrency.

## Design

### Parallel KV reads

`src/kvCache.ts` exposes an aligned `getQuotes()` helper backed by `Promise.all`. `src/index.ts` first handles TW EOD and L1 branches, then reads all remaining KV candidates concurrently and classifies them using the existing TTL policy.

### Single-flight

`src/index.ts` keeps an isolate-local map of in-flight promises. Keys include the canonical KV key and either `intraday` or `provisional:<targetTradingDate>`. A leader re-checks current-day official EOD for post-close requests, re-checks KV only for a compatible value, writes the shared cache value, and cleans up the map after the shared promise settles.

### Upstream retry

`src/upstream.ts` owns transport concerns. Each attempt uses `AbortController`, retries network/timeout/429/5xx failures, applies exponential backoff with jitter, honors bounded `Retry-After`, and caps attempts/backoff by a request-level deadline before returning the final response for existing provider-specific parsing and error mapping.

## Implementation Order

1. Add shared retry/timeout helper and environment settings.
2. Add aligned parallel KV helper and refactor request lookup.
3. Add single-flight cache/fetch integration for TW and US.
4. Add focused tests for concurrency, retries, timeout, and fallback behavior.
5. Update README and CHANGELOG.
