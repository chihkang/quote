# Dynamic market calendar implementation plan

Goal: publish approved append-only calendars without Worker redeployment.
Architecture: validated R2 catalog, one snapshot per invocation, existing App wire contract.
Spec: ../specs/2026-10-27-dynamic-market-calendar-design.md

Global constraints: no activation of new credentials/permissions without explicit approval; no production deployment of this architecture without separate confirmation; preserve bundled v1/v2 and historical settlement.

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

## Final scope after user direction

GitHub Actions workflow_dispatch owns TW/US exact-date close/reopen with a preview-first flow. App administration UI, Keychain and phone-token code were removed; App downloads calendars at startup/foreground and before manual settlement. Proposed job OIDC permission and Worker audience remain unconfigured. No remote commit retry after the prior denial; separate approval is pending.

New regressions cover signed OIDC scope, real client-to-Worker publication/bootstrap, revision races, uncertain writes without retry, early-close restoration, future-release propagation, distinct TW/US dates, missing previous archives, and dated TW lookup when latest is newer. Complete Worker suite: 283/283; typecheck and whitespace passed. App: 511 unit tests in 81 suites passed excluding PaperAmountLayoutTests, whose failure was reproduced on baseline. Full UI/release verification is not claimed.

Independent follow-up review: preserved official closure state for both orders of future official/manual publication; weekend read-back treats weekends as closed. App accepts only pinned-calendar-validated holiday carry-forward and replaces explicitly versioned obsolete current cache without relaxing anomaly or unversioned timestamp protection. New TW/US successful-cache and anomaly cases passed. Final local verification: Worker 283 tests, typecheck, syntax, diff check and dry-run exit 0; App 511 tests/81 suites (PaperAmountLayoutTests excluded) exit 0, /tmp/quote-calendar-final-unit-v2.xcresult. No new architecture remote commit, permissions, production publication or App release.
