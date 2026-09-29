# Quote Context

This context defines the market-price language used by the quote service. It keeps close quality, cache freshness, request dates, and completed market sessions distinct. [ADR 0002](docs/adr/0002-completed-market-session-context.md) defines the current date comparison; [ADR 0001](docs/adr/0001-separate-close-semantics-from-cache-freshness.md) preserves the original close-quality rationale.

## Language

**Intraday Quote**:
A market price observed during the regular trading session before the final end-of-day close is available. It may be useful after the session ends only as a provisional source.
_Avoid_: live close, final close

**Provisional Close**:
The best available post-session price for the current trading date before the exchange end-of-day close is confirmed. It must have a same-day source trading date, is explicitly tentative, and can be replaced by the official close.
_Avoid_: official close, final close, yesterday's close, unknown-date quote

**Official EOD Close**:
The exchange-confirmed end-of-day close for a specific trading date. It supersedes any provisional close or cached quote for that trading date.
_Avoid_: provisional close, latest quote, cached quote

**Official EOD Readiness**:
The condition that official EOD source data for `expectedCloseTradingDate` contains a valid close for a symbol. Session close alone does not establish readiness. On a real post-close trading day, expected is today; on a holiday, a prior completed session can be ready. Source data older than expected is not ready.
_Avoid_: session closed, refresh completed

**Close Kind**:
The category that tells consumers whether a price is an intraday quote, provisional close, official EOD close, or unavailable for the expected completed session. It is separate from freshness or cache status; a stale cached intraday quote remains intraday.
_Avoid_: freshness status, stale flag

**Close Resolution**:
The domain choice of close kind for the expected completed session. After a real Taiwan session ends, its official close wins, then same-day provisional data, then unavailable. Pre-open and holidays may resolve the earlier expected official session; source data must retain its actual date and must not be older than expected.
_Avoid_: cache lookup order, fallback chain

**Unavailable Close**:
A required completed close that cannot be provided. After a real Taiwan session ends, neither its official close nor a valid same-day provisional close is available; holiday R2 resolution requires the earlier expected official close and does not try a holiday provisional. It has no price value. Unknown calendar coverage cannot prove a completed close.
_Avoid_: yesterday's close, stale close, zero close, reference close

**Regular Session Close**:
The market-local boundary after which an intraday quote may become a provisional close if the official EOD close is not yet confirmed. For Taiwan, listed and OTC symbols share the same regular session close boundary.
_Avoid_: EOD ready time, cache expiry

**Source Trading Date**:
The market-local trading date represented by the source data behind a quote or close. Taiwan quotes use the Taipei trading date; US quotes use the New York trading date.
_Avoid_: fetch date, cache date, server date

**Target Trading Date**:
The request's market-local civil date, recomputed for each batch response, including cache hits. It is not necessarily a completed trading day and is not the settlement source-date comparison point.
_Avoid_: expected close date, valuation date, server UTC date

**Expected Completed Trading Date**:
`expectedCloseTradingDate` identifies the latest completed session from the versioned market calendar at request time. Compare close sources with this field, not with `targetTradingDate`. Unknown coverage returns no expected date.
_Avoid_: latest cached date, weekday guess

**Valuation Date**:
The consumer's portfolio date, which AssetGuardian defines as a Taipei civil date. Different markets may contribute different completed source trading dates to one valuation.
_Avoid_: source date, request market date

**Session And Calendar Version**:
`marketSessionState` is `pre_open`, `open`, `post_close`, or `closed`; `calendarVersion` identifies the rules used to derive the expected session. Clients must use matching rules and versions. Runtime overrides are not automatically compatible with a client's bundled calendar.
_Avoid_: freshness status, provider timestamp

**US Source Timestamp Provenance**:
`sourceTimestampVerified` records whether a US timestamp came from the provider. Legacy or missing timestamps are unverified; `fetchedAt` must never substitute for US `asOf`. A timestamp must also match the expected session's actual close to prove a provider-at-close input. The separate Taiwan provisional inference exception in ADR 0001 remains in effect.
_Avoid_: official US close, fetch time equals source time

**Settlement Close**:
The validated close input used by downstream valuation or daily-review flows. Taiwan may start as provisional and later upgrade to official for the same session. US Finnhub data remains provider quality even when its verified timestamp matches the calendar close. Cache freshness alone never establishes settlement validity.
_Avoid_: cached price, display price

## Example Dialogue

Developer: "It is 13:35 on a real Taiwan trading day and today's official EOD close is not available yet. Should we use yesterday's close for settlement?"

Domain Expert: "No. Use valid same-day provisional data if available and label it provisional. Once today's official EOD close arrives, reconcile the settlement input."

Developer: "On the 2026/9/28 Taiwan holiday, target is 9/28 but source is 9/24. Is that wrong?"

Domain Expert: "No. Expected completed session is 9/24. That official close can serve the 9/28 valuation while retaining source date 9/24. It is not a 9/28 provisional close."
