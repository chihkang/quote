---
status: accepted
---

# Completed market sessions for civil-date valuations

Portfolio valuations use a Taipei civil date while source quotes retain their market-local trading date. Add `expectedCloseTradingDate`, `marketSessionState` and `calendarVersion` to batch results. `targetTradingDate` remains the request's market-local civil date; this ADR supersedes the previous source-equals-target rule only when a published calendar identifies an earlier completed session. Never relabel an earlier close as today's close.

The versioned TWSE and NYSE calendar covers December 2025 through December 2026, including holidays and US early closes. Requests outside coverage return null expected date and calendar version. Maintain the data before coverage expires and publish emergency closures as a new calendar version. Timezone conversion uses IANA zones including US DST. Trading-session and TTL decisions use this same calendar.

After a real TW trading session ends, require that session's official close, then try same-day provisional data as before. On a holiday, use the expected completed official session and do not fabricate a holiday provisional quote. US Finnhub prices retain `intraday` quality; consumers separately verify the source timestamp against the completed close. Cache freshness and close authority remain distinct.

References: https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=2026 and https://www.nyse.com/trade/hours-calendars.
