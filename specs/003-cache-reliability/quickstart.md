# Quickstart: Quote Cache Reliability

## Configuration

The defaults are already present in `wrangler.jsonc`:

```text
UPSTREAM_TIMEOUT_MS=3000
UPSTREAM_MAX_ATTEMPTS=3
UPSTREAM_RETRY_BASE_MS=200
UPSTREAM_RETRY_MAX_DELAY_MS=2000
UPSTREAM_REQUEST_DEADLINE_MS=10000
```

Override these values in `.dev.vars` when testing local failure behavior.

## Validation

Run focused tests:

```bash
npm test -- test/upstream.test.ts test/kvCache.test.ts test/twFallback.test.ts
```

Then run the full suite:

```bash
npm test
```

The public endpoint remains `POST /quotes/batch`; no new response fields or queue behavior are required.
