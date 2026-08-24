# Feature Specification: Quote Cache Reliability

**Feature Branch**: `003-cache-reliability`  
**Status**: Approved  
**Input**: High-priority optimization plan for the Cloudflare KV quote cache and upstream fetch path.

## User Scenarios & Testing

### User Story 1 - Low-latency batch cache lookup (Priority: P1)

As a quote API consumer, I want independent cache lookups in one batch to run concurrently so response latency does not grow linearly with the number of symbols.

**Independent Test**: A batch with multiple L1 misses completes its KV reads concurrently and preserves result ordering.

### User Story 2 - Duplicate request protection (Priority: P1)

As a service operator, I want concurrent requests for the same missing quote to share one upstream fetch so upstream quotas and latency are protected.

**Independent Test**: Concurrent requests for the same canonical symbol produce one Fugle/Finnhub request and all callers receive the shared value.

### User Story 3 - Resilient upstream transport (Priority: P1)

As a quote API consumer, I want transient upstream failures to be retried within a bounded time so temporary network, 429, or 5xx failures do not immediately become missing quotes.

**Independent Test**: Retryable failures are retried up to the configured attempt count; non-retryable failures are not retried; final TW 429 still triggers the existing cooldown and EOD fallback.

## Requirements

### Functional Requirements

- **FR-001**: The general L1-miss path MUST issue independent KV reads concurrently.
- **FR-002**: The response MUST preserve normalized input order and all existing quote status, reason, close kind, and trading-date fields.
- **FR-003**: Concurrent upstream fetches for the same canonical symbol and compatible fetch mode MUST share one in-flight operation per Worker isolate.
- **FR-004**: In-flight entries MUST be removed after both success and failure.
- **FR-005**: Provisional TW close resolution MUST NOT share an operation with an intraday fetch or a different target trading date.
- **FR-006**: Upstream calls MUST have an AbortController timeout.
- **FR-007**: The default retry policy MUST allow at most three total attempts and MUST support configuration overrides.
- **FR-008**: Only network/timeout failures, HTTP 429, and HTTP 5xx responses MUST be retried.
- **FR-009**: Retry delays MUST be bounded and use exponential backoff with jitter; a valid `Retry-After` header MAY influence the delay within the configured cap.
- **FR-010**: After final Fugle HTTP 429, the Worker MUST retain the existing KV cooldown and TWSE → TPEX fallback.
- **FR-011**: Existing US concurrency of five and `MAX_SYNC_FETCH` limits MUST remain unchanged.
- **FR-012**: KV read failures MUST remain explicit failures and MUST NOT be converted into successful quote responses.
- **FR-013**: Post-close provisional cache reuse MUST recheck current-day official EOD and MUST require a matching source trading date.
- **FR-014**: Cache timestamps MUST represent successful upstream completion, not the start of a retry sequence.
- **FR-015**: Synchronous upstream work MUST be bounded by a configurable request-level deadline.

## Non-Goals

- Cloudflare Queues or asynchronous quote backfill.
- New public response reasons such as `QUEUED`.
- Changes to TWSE/TPEX R2 snapshot retention or parsing.
- Client-specific rate limiting.

## Configuration

- `UPSTREAM_TIMEOUT_MS`: Per-attempt timeout; default `3000`.
- `UPSTREAM_MAX_ATTEMPTS`: Maximum total attempts; default `3`.
- `UPSTREAM_RETRY_BASE_MS`: Initial exponential backoff; default `200`.
- `UPSTREAM_RETRY_MAX_DELAY_MS`: Maximum delay for one retry; default `2000`.
- `UPSTREAM_REQUEST_DEADLINE_MS`: Total synchronous upstream budget per request; default `10000`.

## Success Criteria

- **SC-001**: KV lookup time for a batch is bounded by the slowest independent KV read rather than the sum of read times.
- **SC-002**: Concurrent same-key misses issue no more than one upstream request per compatible single-flight key.
- **SC-003**: No upstream attempt exceeds the configured timeout.
- **SC-004**: Retryable failures never exceed the configured total attempt count.
- **SC-005**: Existing quote response semantics and TW 429 fallback tests remain green.
