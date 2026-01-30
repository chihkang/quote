# Tasks: US Market Cache Window

**Input**: Design documents from `/specs/001-us-cache-window/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the specification; no test tasks included.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline configuration changes needed before feature work.

- [x] T001 Add US session env defaults (`US_OPEN`, `US_CLOSE`, `US_HOLIDAYS`) in wrangler.jsonc

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Time and configuration primitives required by all user stories.

- [x] T002 Implement US session helpers (overnight window, holiday list parsing, next open calculation) in src/time.ts
- [x] T003 Update TTL configuration typing/defaults to accept US session vars in src/ttl.ts

---

## Phase 3: User Story 1 - Cache window during market open (Priority: P1) 🎯 MVP

**Goal**: Cap US trading-hour cache window to a maximum of 5 minutes.

**Independent Test**: Call `getTtlSeconds('US', now, env)` with a trading-hour time and confirm `hard <= 300` and KV expiration uses that value.

### Implementation

- [x] T004 [US1] Implement US trading-hour TTL clamp to 300 seconds in src/ttl.ts
- [x] T005 [US1] Apply KV expiration TTL on quote writes using computed hard TTL in src/kvCache.ts and src/index.ts

**Checkpoint**: US trading-hour cache duration is capped at 5 minutes and KV entries expire accordingly.

---

## Phase 4: User Story 2 - Cache window during market closed (Priority: P2)

**Goal**: Extend US off-hours cache window until the next market open.

**Independent Test**: Call `getTtlSeconds('US', now, env)` with an off-hours time and confirm `hard == secondsUntilNextUsOpen(now) + 300` and `hard >= soft`.

### Implementation

- [x] T006 [US2] Implement US off-hours dynamic hard TTL using secondsUntilNextUsOpen in src/ttl.ts
- [x] T007 [US2] Wire US_OPEN/US_CLOSE/US_HOLIDAYS env values into getTtlSeconds in src/ttl.ts

**Checkpoint**: US off-hours cache duration matches the time until next open and KV expiration aligns.

---

## Phase 5: User Story 3 - Transparent cache status (Priority: P3)

**Goal**: Document and validate freshness status semantics under the new cache windows.

**Independent Test**: Request quotes during open and closed windows and confirm `status` reflects the cache window rules in the documented response behavior.

### Implementation

- [x] T008 [P] [US3] Document US cache window rules and freshness status behavior in README.md
- [x] T009 [P] [US3] Update US cache validation steps in specs/001-us-cache-window/quickstart.md

**Checkpoint**: Status semantics are documented and aligned with the US cache window rules.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency checks after all user stories.

- [x] T010 [P] Align README configuration defaults with wrangler.jsonc after changes in README.md and wrangler.jsonc

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup
- **User Story 1 (Phase 3)**: Depends on Foundational
- **User Story 2 (Phase 4)**: Depends on Foundational
- **User Story 3 (Phase 5)**: Depends on Foundational
- **Polish (Phase 6)**: Depends on User Stories 1–3

### User Story Dependencies

- **US1 (P1)**: No dependencies on other stories
- **US2 (P2)**: No dependencies on other stories
- **US3 (P3)**: Depends on the cache window behavior defined in US1/US2

---

## Parallel Execution Examples

### User Story 1

- T004 [US1] Implement US trading-hour TTL clamp to 300 seconds in src/ttl.ts
- T005 [US1] Apply KV expiration TTL on quote writes using computed hard TTL in src/kvCache.ts and src/index.ts

### User Story 2

- T006 [US2] Implement US off-hours dynamic hard TTL using secondsUntilNextUsOpen in src/ttl.ts
- T007 [US2] Wire US_OPEN/US_CLOSE/US_HOLIDAYS env values into getTtlSeconds in src/ttl.ts

### User Story 3

- T008 [US3] Document US cache window rules and freshness status behavior in README.md
- T009 [US3] Update US cache validation steps in specs/001-us-cache-window/quickstart.md

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate `hard <= 300` during US trading hours and KV expiration uses that TTL

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate trading-hour cache window
3. US2 → validate off-hours cache window
4. US3 → document and validate status semantics
5. Polish → ensure documentation/config consistency
