# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Changed
- Switched US market session detection to `America/New_York` trading hours so DST changes are handled automatically.
- Refactored `src/time.ts` to reuse cached `Intl.DateTimeFormat` instances and shared session-window helpers, reducing duplicated parsing logic.
- Hardened TTL configuration parsing so invalid or negative numeric env values fall back to defaults instead of leaking negative or `NaN` TTLs into runtime responses.

### Docs
- Updated `README.md` to describe automatic US DST handling and numeric TTL config fallback behavior.
