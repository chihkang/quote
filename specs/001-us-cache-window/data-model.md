# Data Model: US Market Cache Window

## Entities

### Quote
Represents a cached quote result stored in KV.

- **symbol**: string (original ticker)
- **canonicalSymbol**: string (`TICKER.US` or `TICKER.TW`)
- **market**: `TW` | `US`
- **price**: number | null
- **currency**: string | null
- **asOf**: ISO timestamp | null
- **fetchedAt**: ISO timestamp (cache write time)
- **softTtlJitterSec**: number | null (optional)

### MarketSessionWindow
Defines the trading session window for a market in Asia/Taipei time.

- **market**: `TW` | `US`
- **open**: string (`HH:MM`)
- **close**: string (`HH:MM`)
- **timezone**: `Asia/Taipei`
- **holidays**: string[] (`YYYY-MM-DD` date list, optional)

### CachePolicy
Defines how cache TTLs are computed.

- **market**: `TW` | `US`
- **softTtlSec**: number
- **hardTtlSec**: number
- **openBufferSec**: number (default 300)
- **l1TtlSec**: number

## Relationships

- **Quote** uses **CachePolicy** to determine freshness.
- **CachePolicy** depends on **MarketSessionWindow** to compute hard TTL during off-hours.
