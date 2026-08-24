# Data Model: Quote Cache Reliability

## In-flight quote operation

| Field | Type | Description |
|---|---|---|
| key | `string` | Canonical KV key plus fetch mode and provisional target date when applicable |
| promise | `Promise<SharedQuoteOutcome>` | Shared operation for the leader and joiners |
| cacheValue | `QuoteCacheValue` | Value written once by the leader when upstream succeeds |
| fromCache | `boolean` | Indicates a leader re-check found a usable KV value |
| sourceTradingDate | `string \| null` | Source date calculated using existing market-local rules |

The in-flight registry is process-local and non-durable. Entries are removed in `finally`.

## Retry configuration

| Environment variable | Default | Meaning |
|---|---:|---|
| `UPSTREAM_TIMEOUT_MS` | `3000` | Timeout for each upstream attempt |
| `UPSTREAM_MAX_ATTEMPTS` | `3` | Total attempts, including the initial request |
| `UPSTREAM_RETRY_BASE_MS` | `200` | Initial exponential backoff |
| `UPSTREAM_RETRY_MAX_DELAY_MS` | `2000` | Maximum delay before the next attempt |
| `UPSTREAM_REQUEST_DEADLINE_MS` | `10000` | Total synchronous upstream budget per request |

## Quote cache semantics

`QuoteCacheValue.closeKind` records whether a value was written from an intraday fetch or a provisional post-close fetch. Post-close KV reuse requires `closeKind: "provisional"` and a source trading date equal to the target trading date.
