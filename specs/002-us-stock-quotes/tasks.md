# Tasks: US Stock Quotes Support

- [X] Verify baseline tests (`npm test`).
- [X] Add Finnhub API integration for US symbols with concurrency limit (5).
- [X] Map Finnhub response (c, t) into price/asOf, set currency USD, and cache values.
- [X] Extend error handling with `FINNHUB_ERROR` reason for US failures.
- [X] Update configuration (`wrangler.jsonc`) to include `FINNHUB_API_KEY`.
- [X] Update README with US support, env var, and curl example.
- [X] Add/adjust tests for US quote mapping and error handling.
- [X] Run tests after changes (`npm test`).
