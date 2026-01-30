# Quickstart: US Market Cache Window

## Goal
Verify that US quote caching follows the 5-minute max during trading hours and extends to the next market open during off-hours.

## Setup

- Ensure environment variables are set in your local `.dev.vars` or Wrangler environment:
  - `US_OPEN` and `US_CLOSE` (defaults to 10:30–05:00 Asia/Taipei)
  - `US_HOLIDAYS` (optional, comma-separated `YYYY-MM-DD`)
  - `SOFT_TTL_TRADING_SEC`, `HARD_TTL_TRADING_SEC`, `SOFT_TTL_OFFHOURS_SEC`

## Validate trading-hour TTL

1. Run tests (or add a focused test in `test/ttl.test.ts` for US trading hours).
2. Validate that `getTtlSeconds('US', now, env)` returns `hard <= 300` during US trading hours.

## Validate off-hours TTL

1. Set `now` to a time outside the US window.
2. Verify that `hard` equals `secondsUntilNextUsOpen(now) + 300` and is not less than `soft`.
3. If `US_HOLIDAYS` includes the current date, verify the next open skips that date.

## Expected Behavior

- Trading hours: KV entries expire in at most 5 minutes.
- Off-hours: KV entries expire at the next US open + 5 minutes buffer.
- Cache status remains `fresh`/`stale` based on soft/hard TTLs.
