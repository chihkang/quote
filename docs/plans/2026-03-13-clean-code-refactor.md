# Clean Code Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce duplication in the time/session utilities, improve readability of US/TW market window logic, and document the refactor clearly.

**Architecture:** Keep the public behavior of quote fetching and TTL calculation unchanged while extracting shared time-window helpers and cached date-format parsing. Protect the refactor with edge-case tests for DST, holidays, and next-open calculations.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers runtime APIs

---

### Task 1: Add tests that protect the refactor

**Files:**
- Modify: `test/time.test.ts`
- Modify: `test/ttl.test.ts`

**Step 1: Write the failing test**

Add tests that cover:
- US trading session boundaries in both DST and standard time
- US holidays being treated as closed in New York calendar
- TTL using the same US off-hours helper signature after refactor

**Step 2: Run test to verify it fails**

Run: `npm test -- test/time.test.ts`
Expected: FAIL if the current implementation misses one of the new edge cases.

**Step 3: Write minimal implementation**

Refactor only after the new tests fail for the right reason.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/time.test.ts`
Expected: PASS

### Task 2: Refactor time/session utilities

**Files:**
- Modify: `src/time.ts`
- Modify: `src/ttl.ts`

**Step 1: Write the failing test**

Use Task 1 tests as the guard rails for this refactor.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/time.test.ts`
Expected: FAIL before implementation changes.

**Step 3: Write minimal implementation**

Refactor to:
- cache `Intl.DateTimeFormat` instances by timezone/shape
- parse `formatToParts` output once into a lookup map
- extract shared market-session window helpers instead of reusing TW helpers via string reconstruction
- keep the existing exported API stable

**Step 4: Run test to verify it passes**

Run: `npm test -- test/time.test.ts`
Expected: PASS

### Task 3: Update docs

**Files:**
- Modify: `README.md`
- Create: `CHANGELOG.md`

**Step 1: Write the failing test**

Documentation task; no dedicated failing test.

**Step 2: Write minimal implementation**

Document the clean-code refactor and the automatic DST/session behavior clearly.

**Step 3: Run verification**

Run:
- `npm test`
- `npx tsc --noEmit`

Expected: both commands pass
