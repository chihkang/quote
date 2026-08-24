# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Changed
- Switched US market session detection to `America/New_York` trading hours so DST changes are handled automatically.
- Refactored `src/time.ts` to reuse cached `Intl.DateTimeFormat` instances and shared session-window helpers, reducing duplicated parsing logic.
- Hardened TTL configuration parsing so invalid or negative numeric env values fall back to defaults instead of leaking negative or `NaN` TTLs into runtime responses.
- Parallelized independent KV quote reads and added isolate-local single-flight de-duplication for concurrent upstream fetches.
- Added bounded upstream timeout/retry configuration for Fugle and Finnhub while preserving final TW `429` cooldown and EOD fallback behavior.
- Hardened post-close provisional resolution with official EOD rechecks and source-date validation, timestamped cache writes after upstream completion, and bounded each request with an upstream deadline.

### Docs
- Updated `README.md` to describe automatic US DST handling and numeric TTL config fallback behavior.
