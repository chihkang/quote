---
status: accepted
---

# Separate Close Semantics From Cache Freshness

The quote service distinguishes close semantics from cache freshness so consumers can tell whether a price is an intraday quote, provisional close, official EOD close, or unavailable for the target trading date. After regular session close, an official EOD close wins when the source trading date matches the target trading date; otherwise a same-day provisional close may be used, and older EOD data must not stand in for the target trading date. This avoids downstream settlement flows treating a fresh cache hit or stale fallback as a confirmed current-day close.

## Considered Options

- Use freshness status and reason codes only: rejected because cache freshness does not say whether the price is a provisional or official close.
- Return older EOD data until the current-day EOD source is ready: rejected because it can make yesterday's close look like today's settlement close.
- Change the meaning of existing response fields: rejected because existing consumers may already depend on `status`, `reason`, `isStale`, and `price` semantics.

## Consequences

Consumers must handle an explicit unavailable close instead of assuming every post-session quote has a usable price. Provisional settlement values must remain replaceable when the official EOD close arrives. The API should evolve additively by preserving existing response-field semantics and adding close-specific fields such as close kind, source trading date, and target trading date. Target trading date should be returned consistently so consumers do not have to infer market-local trading dates themselves. Older EOD closes must not be returned as the current price when their source trading date does not match the target trading date; if needed later, they should be exposed separately as previous or reference close data.

Close kind must remain independent from cache freshness. During the regular trading session, cached or stale-cached quote data is still intraday data; it must not become provisional merely because its cache status is stale.

Initial implementation scope is Taiwan market close resolution. US market close semantics can use the same language later, but should not be treated as official EOD reconciliation until an official EOD source exists.

For Taiwan, regular session close must not automatically bypass same-day quote providers. After regular session close, the service should prefer a current-day official EOD close when ready; if it is not ready, it should try a same-day quote-provider price as a provisional close before returning unavailable.

For a target trading date, an official EOD close is authoritative over any provisional quote or cached quote. After Taiwan regular session close, close resolution must check official EOD readiness before returning ordinary quote-cache hits so a stale provisional value cannot mask a ready official close.

Once a Taiwan official EOD close is ready, ordinary quote caches must not hide it. Implementations may bypass ordinary quote L1/KV for post-close close resolution or invalidate affected Taiwan quote-cache entries, but the returned close kind must reflect the ready official EOD close.

A quote-provider price may be used as a Taiwan provisional close only when its source trading date matches the target trading date. If the provider timestamp is older or the source trading date cannot be established, the service should not use it as the current provisional close. When the provider does not supply a reliable quote timestamp but the service successfully fetches the quote after Taiwan regular session close on the target trading date, the fetch time may establish the source trading date; consumers must still receive the quote timestamp and fetch timestamp so they can treat the value as provisional.
