# Feature Specification: US Market Cache Window

**Feature Branch**: `001-us-cache-window`  
**Created**: 2026-01-30  
**Status**: Draft  
**Input**: User description: "美股查詢的快取時間或是KV設定的時間邏輯是什麼? 下面是我查詢得到的結果，我預期開盤時間應該快取最多存在五分鐘，非開盤時間(收盤代表股價不會動)，應該計算當下時間至下次開盤時間差(KV時間動態調整) 舉例: 美股當前收盤，距離下次開盤時間差6.5小時，KV應該要設定6.5小時(暫定美股開盤時間為每天10:30-05:00 台灣時間)"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Cache window during market open (Priority: P1)

As a user querying US stock quotes during market open hours, I want results to be cached for a short time so prices stay timely while still reducing repeated upstream requests.

**Why this priority**: Most price movements happen during market open; short cache windows balance freshness and cost.

**Independent Test**: Can be fully tested by issuing repeated quote requests during open hours and verifying cache durations never exceed 5 minutes.

**Acceptance Scenarios**:

1. **Given** the time is within the US market open window, **When** a quote is requested repeatedly, **Then** the cache duration for any stored quote is no more than 5 minutes.
2. **Given** the time is within the US market open window, **When** a quote is requested after 5 minutes elapse, **Then** the system refreshes the quote and stores a new cache duration up to 5 minutes.

---

### User Story 2 - Cache window during market closed (Priority: P2)

As a user querying US stock quotes outside market open hours, I want cached quotes to remain valid until the next market open so results are stable and upstream requests are minimized.

**Why this priority**: Prices do not change while the market is closed, so a long cache duration is safe and cost-effective.

**Independent Test**: Can be fully tested by issuing a quote request during closed hours and verifying the cache duration equals the time until the next open.

**Acceptance Scenarios**:

1. **Given** the time is outside the US market open window, **When** a quote is requested, **Then** the cache duration equals the time remaining until the next market open.
2. **Given** the time is outside the US market open window, **When** a quote is requested multiple times before the next open, **Then** the cached quote remains valid until the next open without shortening the duration.

---

### User Story 3 - Transparent cache status (Priority: P3)

As a user or support operator, I want responses to clearly indicate whether a quote is fresh or stale relative to the cache window so I can understand data timeliness.

**Why this priority**: Clear status reduces confusion when quotes are unchanged during closed hours.

**Independent Test**: Can be fully tested by requesting quotes during open and closed hours and checking the status aligns with the cache window rules.

**Acceptance Scenarios**:

1. **Given** a request during market open hours, **When** a cached quote is served within 5 minutes, **Then** the response indicates the quote is fresh.
2. **Given** a request during market closed hours, **When** a cached quote is served until the next open, **Then** the response indicates the quote is fresh for that closed-window cache period.

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when the current time is exactly at market open or market close?
- How does the system handle weekends or market holidays when there is no open session on the next calendar day?
- What happens when the computed time to next open is zero or negative due to clock skew?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: The system MUST determine whether the current time is within the US market open window or closed window for the requested quote.
- **FR-002**: During the open window, the system MUST set the cache duration for a US quote to a maximum of 5 minutes.
- **FR-003**: During the closed window, the system MUST set the cache duration for a US quote to the remaining time until the next market open.
- **FR-004**: The system MUST calculate the next market open time based on the configured US market session window.
- **FR-005**: The system MUST expose a quote status that reflects whether the cached data is considered fresh under the active cache window rules.
- **FR-006**: The system MUST handle non-trading days (weekends or holidays) by extending the cache duration to the next valid market open.

### Key Entities *(include if feature involves data)*

- **Quote**: A market price snapshot for a symbol with timestamp and freshness status.
- **Market Session Window**: The configured daily open and close times for the US market, plus non-trading days.
- **Cache Policy**: Rules that map the current time and market session to a cache duration.

## Assumptions

- US market open window is 10:30–05:00 Taiwan time, as provided.
- Market open applies to regular trading days; weekends and official market holidays are treated as closed.
- If the next open occurs on a future trading day, cache duration spans until that next open.

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: During market open hours, 95% of repeated quote requests within a 5-minute window return the same cached quote without exceeding the 5-minute cache duration.
- **SC-002**: During market closed hours, 95% of requests return a cached quote that remains valid until the next market open time.
- **SC-003**: 99% of responses correctly label quote freshness according to the cache window rules.
- **SC-004**: Upstream quote fetches during closed hours decrease by at least 80% compared to no caching.
