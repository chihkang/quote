# Quote Worker

Cloudflare Worker that serves batch TW and US stock quotes via Fugle (TW) and Finnhub (US) with KV-backed caching. The worker returns results immediately with a freshness status (`fresh`, `stale`, or `missing`) and only fetches from external APIs for a limited number of cache misses per request.

## What the project does

- Provides a single HTTP endpoint to fetch batch quotes for TW and US markets.
- Normalizes symbols (supports input like `2330`, `2330.TW`, or `TW:2330` for Taiwan; `AAPL`, `AAPL.US`, or `US:AAPL` for US).
- Uses two-layer caching: in-memory L1 and Cloudflare KV.
- Applies soft/hard TTL policies that change during TW trading hours.
- Fetches TW quotes from Fugle API and US quotes from Finnhub API with a concurrency limit of 5 for US requests.

## Why the project is useful

- Low-latency batch quote responses suitable for downstream services.
- Predictable cache behavior with clear freshness signaling.
- Simple configuration through Worker environment variables.

## How users can get started

### Prerequisites

- Node.js 18+ (recommended).
- Cloudflare Wrangler CLI (installed via dev dependencies).
- A Fugle API key (for TW market).
- A Finnhub API key (for US market).

### Setup

1. Install dependencies.

	 ```bash
	 npm install
	 ```

2. Create a `.dev.vars` file with your API keys:

	 ```bash
	 FUGLE_API_KEY=your_fugle_api_key_here
	 FINNHUB_API_KEY=your_finnhub_api_key_here
	 ```

3. Update KV namespace IDs in [wrangler.jsonc](wrangler.jsonc).

4. Start the local dev server:

	 ```bash
	 npm run dev
	 ```

### Usage

`POST /quotes/batch`

Request body (TW example):

```json
{
	"symbols": ["2330", "2317.TW"],
	"market": "TW"
}
```

Request body (US example):

```json
{
	"symbols": ["AAPL", "MSFT", "NVDA.US"],
	"market": "US"
}
```

Response:

```json
{
	"serverTime": "2026-01-26T00:00:00.000Z",
	"results": [
		{
			"symbol": "2330",
			"canonicalSymbol": "2330.TW",
			"market": "TW",
			"price": 590,
			"currency": "TWD",
			"asOf": "2026-01-26T00:00:00.000Z",
			"fetchedAt": "2026-01-26T00:00:01.000Z",
			"status": "fresh",
			"isStale": false,
			"reason": null
		}
	]
}
```

#### Response fields

- `serverTime`: Server response time in ISO format.
- `results`: Array of quote results by symbol.
- `symbol`: Original input symbol.
- `canonicalSymbol`: Normalized symbol (`TICKER.TW` or `TICKER.US`).
- `market`: Market (`TW` or `US`).
- `price`: Latest price (or `null`).
- `currency`: Currency (TW defaults to `TWD`, US defaults to `USD`).
- `asOf`: Quote timestamp from the source (ISO).
- `fetchedAt`: Cache write time (ISO).
- `status`: `fresh`, `stale`, or `missing`.
- `isStale`: Whether the value exceeded the soft TTL.
- `reason`: One of `KV_MISS`, `HARD_EXPIRED`, `FUGLE_ERROR`, `FINNHUB_ERROR`, or `null`.

### Curl example

TW market:

```bash
curl -X POST http://127.0.0.1:8787/quotes/batch \
	-H "Content-Type: application/json" \
	-d '{"symbols":["2330","2317"],"market":"TW"}'
```

US market:

```bash
curl -X POST http://127.0.0.1:8787/quotes/batch \
	-H "Content-Type: application/json" \
	-d '{"symbols":["AAPL","MSFT","NVDA"],"market":"US"}'
```

### Configuration

Environment variables are defined in [wrangler.jsonc](wrangler.jsonc). Key settings:

- **L1 (in-memory) TTL**
	- `L1_TTL_SEC`: Default 20 seconds (applies both during trading and off hours).

- **KV cache TTL policy (soft/hard)**
	- Trading hours (TW/US): `SOFT_TTL_TRADING_SEC` and `HARD_TTL_TRADING_SEC` are capped at 300 seconds for US trading hours.
	- Off hours (TW/US): `SOFT_TTL_OFFHOURS_SEC` affects freshness; hard TTL is computed dynamically until the next market open + 5 minutes.

- **KV cache retention (how long KV exists)**
	- Trading hours (TW): KV entries live up to `HARD_TTL_TRADING_SEC` (default 300 seconds). Soft TTL (300 seconds) affects freshness only; a per-entry soft TTL jitter up to 300 seconds is applied.
	- Trading hours (US): KV entries live up to 5 minutes (hard TTL capped at 300 seconds).
	- Off hours (TW/US): KV entries live until the next market open time + 5 minutes buffer (dynamic hard TTL). Soft TTL (default 300 seconds) affects freshness only.

- `DEFAULT_MARKET`: Default market when symbols do not specify one.
- `MAX_SYMBOLS_PER_REQUEST`: Max symbols per request.
- `MAX_SYNC_FETCH`: Max cache misses to fetch from Fugle per request.
- `TW_OPEN` / `TW_CLOSE`: TW trading session window (Asia/Taipei).
- `US_OPEN` / `US_CLOSE`: US trading session window (Asia/Taipei).
- `US_HOLIDAYS`: Optional comma-separated `YYYY-MM-DD` dates treated as US market holidays (Asia/Taipei calendar date).
- `SOFT_TTL_TRADING_SEC` / `HARD_TTL_TRADING_SEC`: TTL during trading hours.
- `SOFT_TTL_OFFHOURS_SEC`: Soft TTL outside trading hours.
- `HARD_TTL_OFFHOURS_SEC`: Legacy fallback (not used for TW/US dynamic off-hours TTLs).
- `L1_TTL_SEC`: In-memory cache TTL (seconds).

### Tests

```bash
npm test
```

## Where users can get help

- Review the API section above for request/response behavior.
- Check unit tests in [test](test) for expected edge cases and TTL rules.
- If something is unclear, open an issue in this repository with a minimal repro.

## Who maintains and contributes

Maintained by repository owners and contributors.

Contributions are welcome via pull requests. Please include tests for new behavior and keep changes focused on the current Worker scope.
