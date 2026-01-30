# Research: US Market Cache Window

## Decisions

### US trading session window definition
- **Decision**: Define US trading hours in Asia/Taipei time with configurable `US_OPEN` and `US_CLOSE` values, defaulting to 10:30–05:00 per requirement.
- **Rationale**: Requirement explicitly states Taiwan time; current time utilities already use Asia/Taipei.
- **Alternatives considered**: Use America/New_York timezone with DST handling. Rejected due to added complexity and mismatch with the stated requirement.

### US market holidays
- **Decision**: Support an optional `US_HOLIDAYS` environment variable containing a comma-separated list of `YYYY-MM-DD` dates (Taipei calendar date) treated as closed days.
- **Rationale**: Satisfies FR-006 without adding external dependencies or runtime API calls.
- **Alternatives considered**: External holiday API or embedded holiday library. Rejected to keep runtime lightweight and deterministic.

### US TTL mapping during trading hours
- **Decision**: For US trading hours, cap `soft` and `hard` TTL at 300 seconds. Use configured trading TTL values if lower; otherwise clamp to 300 seconds.
- **Rationale**: Enforces “cache at most 5 minutes” while allowing tighter settings.
- **Alternatives considered**: Introduce separate `US_SOFT_TTL_TRADING_SEC` and `US_HARD_TTL_TRADING_SEC`. Rejected for added configuration complexity.

### US TTL mapping during off-hours
- **Decision**: Compute `hard` TTL as seconds until next US open plus a 300-second buffer; `soft` TTL uses `SOFT_TTL_OFFHOURS_SEC` with a floor at `hard` if needed.
- **Rationale**: Aligns with existing TW off-hours behavior and requirement to cache until next open.
- **Alternatives considered**: Continue using static `HARD_TTL_OFFHOURS_SEC` for US. Rejected because it does not satisfy the dynamic requirement.

### KV retention strategy
- **Decision**: Set KV `expirationTtl` to the computed hard TTL when writing quotes (both markets).
- **Rationale**: Matches user expectation that KV entries expire at the cache window boundary.
- **Alternatives considered**: Keep indefinite KV retention and rely only on soft/hard TTL classification. Rejected as it conflicts with the requested KV time behavior.

## Notes

- No explicit performance targets are defined in the repo; this plan keeps current operational limits and API shape.
