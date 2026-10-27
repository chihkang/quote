# Dynamic market calendar implementation plan

Goal: publish approved append-only calendars without Worker redeployment.
Architecture: validated R2 catalog, one snapshot per invocation, existing App wire contract.
Spec: ../specs/2026-10-27-dynamic-market-calendar-design.md

Global constraints: no new credentials/permissions; no production deployment of this architecture without separate confirmation; preserve bundled v1/v2 and historical settlement.

Review focus: concurrent publishers; malformed stored data; missing archives during closure; future effective dates; individual suspension notices.

## Tasks

- [x] Write failing integration tests in test/dynamicCalendar.test.ts for catalog publishing, preservation, storage errors, health and quote version selection, auth and races.
- [x] Implement src/calendarCatalog.ts with parseCatalog, loadCalendarCatalog and publishCalendar; extend calendarPublication to consume the same catalog.
- [x] Pass invocation snapshot through index.ts/eodRecovery.ts and scheduled. Add health states and structured collector diagnostics without changing completeness criteria.
- [x] Implement official-notice candidate CLI and read-only manual GitHub workflow. Add fixture tests for annual opening rows, individual suspensions, missing data, and source validation.
- [x] Run complete Worker tests, typecheck, syntax and build dry-run. Review full diff. Worker checks take seconds and did not overlap another heavy build.
- [ ] Create a separate draft PR when remote write is available. Leave architecture unmerged/undeployed.

## Execution record

Existing PR #2: 215/215 tests, typecheck, syntax, whitespace and cf dry-run passed on Mac. PR #10 release-note gate passed; full Xcode testing in progress. No new architecture publication performed.

Final independent review found three P2 issues. All reproduced RED and fixed GREEN: latest-calendar coverage gaps no longer fall back to v1; an initialization marker prevents lost-catalog rollback; dated-archive storage errors return structured source_error. Full Worker suite: 250/250, typecheck, syntax, whitespace and cf dry-run passed.

Implementation choice: initialization marker is in the existing R2 bucket. If both catalog and marker are deleted through direct administrator access, there is no external WORM guarantee. No new IAM, secrets or storage services were added. First-time initialization interrupted between marker/catalog requires manual recovery rather than automatic revision reset.
