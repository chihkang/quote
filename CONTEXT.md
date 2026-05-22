# Quote Context

This context defines the market-price language used by the quote service. It exists to keep intraday quotes, provisional closes, and official end-of-day closes distinct when Taiwan market data transitions after the close.

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
The condition that official EOD source data for the target trading date contains a valid close for a symbol. It is not implied by regular session close; source data that still reports an older source trading date is not ready.
_Avoid_: session closed, refresh completed

**Close Kind**:
The category that tells consumers whether a price is an intraday quote, provisional close, official EOD close, or unavailable for the requested trading date. It is separate from freshness or cache status; a stale cached intraday quote remains intraday.
_Avoid_: freshness status, stale flag

**Close Resolution**:
The domain choice of which close kind represents a symbol for a target trading date. After regular session close, an official EOD close wins; otherwise a same-day provisional close may be used, and older source data must not stand in for the target trading date.
_Avoid_: cache lookup order, fallback chain

**Unavailable Close**:
A close for the target trading date that cannot be provided because neither an official EOD close nor a same-day provisional close is available. It has no price value; older closes can only be reference data, not the unavailable close itself.
_Avoid_: yesterday's close, stale close, zero close, reference close

**Regular Session Close**:
The market-local boundary after which an intraday quote may become a provisional close if the official EOD close is not yet confirmed. For Taiwan, listed and OTC symbols share the same regular session close boundary.
_Avoid_: EOD ready time, cache expiry

**Source Trading Date**:
The market-local trading date represented by the source data behind a quote or close. Taiwan quotes use the Taipei trading date; US quotes use the New York trading date.
_Avoid_: fetch date, cache date, server date

**Target Trading Date**:
The market-local trading date the consumer is asking the quote service to represent. It is the comparison point for deciding whether source data belongs to the requested trading date.
_Avoid_: request date, server date

**Settlement Close**:
The close price used by downstream portfolio or daily-review flows for a given trading date. It may start as a provisional close, but must remain distinguishable from and replaceable by the official EOD close.
_Avoid_: cached price, display price

## Example Dialogue

Developer: "It is 13:35 and the official EOD close is not available yet. Should we show yesterday's close?"

Domain Expert: "No. Use a provisional close if one is available, and label it as provisional. Once the official EOD close arrives for today, reconcile the settlement close."
