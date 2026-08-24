# Tasks: Quote Cache Reliability

- [x] Add configurable upstream timeout and retry helper.
- [x] Parallelize independent KV lookups after L1 and TW EOD checks.
- [x] Add isolate-local single-flight registry with cleanup.
- [x] Add and stabilize focused concurrency and retry tests.
- [x] Update README and CHANGELOG with operational details.
- [x] Run targeted and full Vitest validation.

## Review remediation

- [x] Recheck official EOD and validate provisional cache source dates after close.
- [x] Timestamp cache writes after successful upstream completion.
- [x] Bound synchronous upstream work with a request-level deadline.
