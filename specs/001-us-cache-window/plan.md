# Implementation Plan: US Market Cache Window

**Branch**: `001-us-cache-window` | **Date**: 2026-01-30 | **Spec**: [specs/001-us-cache-window/spec.md](specs/001-us-cache-window/spec.md)
**Input**: Feature specification from [/specs/001-us-cache-window/spec.md](specs/001-us-cache-window/spec.md)

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement US market cache window logic so that during US trading hours the KV cache lives for at most 5 minutes, and during off-hours the KV cache duration matches the time until the next market open. This will be achieved by adding US session-time calculation (in Asia/Taipei time), dynamic TTL computation for US similar to TW, optional holiday handling, and aligning KV expiration with the computed hard TTL.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.6.3  
**Primary Dependencies**: Cloudflare Workers runtime, Wrangler 4.x, Vitest 3.x, Miniflare 4.x, @cloudflare/workers-types  
**Storage**: Cloudflare KV (QUOTES_KV)  
**Testing**: Vitest  
**Target Platform**: Cloudflare Workers (nodejs_compat)  
**Project Type**: Single Worker service  
**Performance Goals**: Maintain existing response latency and throughput; no new explicit targets defined.  
**Constraints**: Must respect MAX_SYMBOLS_PER_REQUEST and MAX_SYNC_FETCH limits; maintain current API shape.  
**Scale/Scope**: Batch quote endpoint serving TW/US symbols; single deployment unit.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No enforceable constitution rules found (template placeholders only). Gate passes.

## Project Structure

### Documentation (this feature)

```text
specs/001-us-cache-window/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
src/
├── index.ts
├── kvCache.ts
├── l1Cache.ts
├── quotePolicy.ts
├── symbols.ts
├── time.ts
└── ttl.ts

test/
├── batchConstraints.test.ts
├── kvCache.test.ts
├── l1Cache.test.ts
├── quotePolicy.test.ts
├── symbols.normalizeSymbol.test.ts
├── symbols.test.ts
├── time.test.ts
├── timeParsing.test.ts
├── ttl.test.ts
└── usFinnhub.test.ts
```

**Structure Decision**: Single Worker project with source under src/ and tests under test/.

## Complexity Tracking

No constitution violations to justify.
