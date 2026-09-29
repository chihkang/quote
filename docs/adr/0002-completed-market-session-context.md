---
status: accepted
---

# Completed market sessions for civil-date valuations

Portfolio valuations use a Taipei civil date while source quotes retain their market-local trading date. Add `expectedCloseTradingDate`, `marketSessionState` and `calendarVersion` to batch results. `targetTradingDate` remains the request's market-local civil date; this ADR supersedes the source-equals-target comparison in [ADR 0001](0001-separate-close-semantics-from-cache-freshness.md): compare source with the expected completed session, which may be earlier than target. Never relabel an earlier close as today's close.

The versioned TWSE and NYSE calendar covers December 2025 through December 2026, including holidays and US early closes. Requests outside coverage return null expected date and calendar version. Maintain the data before coverage expires and publish emergency closures as a new calendar version. Timezone conversion uses IANA zones including US DST. Trading-session and TTL decisions use this same calendar.

After a real TW trading session ends, require that session's official close, then try same-day provisional data as before. On a holiday, use the expected completed official session and do not fabricate a holiday provisional quote. US Finnhub prices retain `intraday` quality; consumers separately verify the source timestamp against the completed close. Cache freshness and close authority remain distinct.

US responses additionally preserve the provider's raw `asOf` and expose `sourceTimestampVerified`. Legacy or missing source time is unverified, and `fetchedAt` must not replace it. Legacy US KV entries without provenance receive one refresh within `MAX_SYNC_FETCH`; known false entries wait for ordinary expiry. Provider failure preserves ordinary display cache behavior but cannot establish settlement evidence. Consumers accept provider-at-close quality only when verified `asOf` equals the calendar's actual close instant, including early closes; they must not relabel it as official EOD.

`TW_OPEN` / `TW_CLOSE` must be valid HH:mm values with open before close. Context, fetch path and TTL use the same window; a custom window adds `-session-override` to the calendar version. Additional `US_HOLIDAYS` dates outside the published holiday list add `-override`; duplicate published holidays do not change the version. These versions require matching client rules, not automatic acceptance.

References: https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=2026 and https://www.nyse.com/trade/hours-calendars.
