# US Stock Quotes Support

## Overview
Extend the existing `POST /quotes/batch` endpoint to support US stock batch queries in addition to TW. The endpoint must keep the current response shape and caching behavior while sourcing US quotes from Finnhub.

## Scope
- **In scope**: US market symbols in existing batch endpoint, cache integration (L1 + KV), Finnhub quote API integration, documentation updates.
- **Out of scope**: New endpoints, US trading-hour TTL rules, WebSocket/streaming, authentication beyond API token.

## Inputs
### Request
`POST /quotes/batch`

Body:
```json
{
  "symbols": ["AAPL", "MSFT.US", "US:NVDA"],
  "market": "US"
}
```

Rules:
- `symbols` is required and must be a non-empty array after trimming entries.
- `market` is optional. If provided, it overrides per-symbol market hints, consistent with existing behavior.
- Symbol normalization continues to accept `TICKER`, `TICKER.US`, or `US:TICKER` formats.

## Behavior
### Market routing
- TW symbols continue to use Fugle as before.
- US symbols use Finnhub quote API.

### US quote fetch
For each US symbol, call:
```
GET https://finnhub.io/api/v1/quote?symbol={TICKER}&token={FINNHUB_API_KEY}
```
- The Finnhub API supports single-symbol requests only; batch requests must issue one call per symbol.
- Use parallel fetches with a concurrency limit of **5** Finnhub requests per batch.

### Field mapping (Finnhub response)
Finnhub response example:
```json
{
  "c": 261.74,
  "h": 263.31,
  "l": 260.68,
  "o": 261.07,
  "pc": 259.45,
  "t": 1582641000
}
```
Mapping rules:
- `price` = `c`
- `currency` = `"USD"`
- `asOf` = `t` converted from epoch seconds to ISO string
- `fetchedAt` = time of fetch (ISO)

### Caching
- Use existing L1 and KV cache logic and TTL policies (reuse current TTL settings).
- Cache key format remains `quote:US:{TICKER}`.

### Error handling
- If Finnhub returns non-2xx, network error, or invalid JSON, mark the symbol result as `missing` with `reason = "FINNHUB_ERROR"`.
- If Finnhub returns a response where `c` is missing or not a finite number, treat as missing with `reason = "FINNHUB_ERROR"`.
- TW flow and error reasons remain unchanged.

### Response
Response format remains unchanged; US results must align with existing fields:
```json
{
  "serverTime": "2026-01-30T00:00:00.000Z",
  "results": [
    {
      "symbol": "AAPL",
      "canonicalSymbol": "AAPL.US",
      "market": "US",
      "price": 261.74,
      "currency": "USD",
      "asOf": "2020-02-25T14:30:00.000Z",
      "fetchedAt": "2026-01-30T00:00:00.000Z",
      "status": "fresh",
      "isStale": false,
      "reason": null
    }
  ]
}
```

## Configuration
Add a new environment variable:
- `FINNHUB_API_KEY`: Finnhub API token.

## Documentation updates
Update README:
- Mention US market support.
- Document `FINNHUB_API_KEY` setup.
- Add a US curl example.

## Testing
- Add or update unit tests to cover Finnhub response mapping.
- Add a test for Finnhub error handling resulting in `reason = "FINNHUB_ERROR"`.
