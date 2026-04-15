# Design Log 271: Dashboard Messages — Load More + Sort Fix
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-15
**Related Logs:** DL-261 (recent messages panel), DL-263 (delete/hide + raw text), DL-266 (reply to messages)

## 1. Context & Problem
The dashboard "הודעות אחרונות מלקוחות" side panel (DL-261) currently shows a fixed 10 messages with no way to see older ones. Office users want to scroll deeper into client message history without leaving the dashboard.

Additionally, messages from the same day appear in random order because the inbound processor stores dates without time (`2026-04-15` instead of `2026-04-15T10:30:00Z`), so `localeCompare` sort can't differentiate within the same day.

## 2. User Requirements
*Q&A from discovery phase:*
1. **Q:** How many messages per "load more" batch?
   **A:** 10 more each time (consistent with initial load)

2. **Q:** Maximum cap on total messages?
   **A:** No cap — keep loading until all messages exhausted

3. **Q:** Cache strategy?
   **A:** Cache full list in API, paginate client-side (frontend reveals 10 at a time from already-fetched data)

4. **Q:** Button placement and style?
   **A:** Subtle "הצג עוד..." text link at bottom of the message list

5. **Q:** (Additional) Sort within same day?
   **A:** Fix the root cause — store full ISO timestamp in inbound processor, and use note `id` (contains `Date.now()` timestamp) as tiebreaker for existing notes

## 3. Research
### Domain
Progressive Disclosure, Activity Feed UX, Client-Side Pagination

### Sources Consulted
1. **Nielsen Norman Group — Infinite Scrolling: When to Use It, When to Avoid It** — "Load more" buttons outperform infinite scroll for goal-directed tasks. Users retain control and can find their position. Best for activity feeds where content is homogeneous but finite.
2. **Smashing Magazine — Infinite Scrolling, Pagination Or "Load More" Buttons? Usability Findings** — "Load more" combined with lazy-loading is superior UX. Threshold of 50-100 items for desktop, 15-30 for mobile.
3. **IxDF — Progressive Disclosure** — Surface critical information first; make additional content available on demand. "Nothing loads until you ask for it" — keeps cognitive load low.

### Key Principles Extracted
- **User control over pace:** "Load more" gives users explicit control vs. infinite scroll's implicit loading. Fits our panel where users triage messages intentionally.
- **Client-side pagination for small datasets:** With <500 messages per year, fetching all and paginating client-side is optimal — instant "load more" with no network delay.
- **Glanceability preserved:** Initial view stays clean (10 messages). Additional messages are opt-in, not forced.

### Patterns to Use
- **Client-side slice & reveal:** Store all messages in a JS array, render slices of 10. "Load more" increments the visible count and appends to DOM.
- **Stable sort with tiebreaker:** When primary sort key (date) ties, use secondary key (note ID timestamp) for deterministic ordering.

### Anti-Patterns to Avoid
- **Server-side pagination for this use case:** Adds API complexity, cache invalidation headaches, and network latency on each "load more" — all unnecessary for <500 items.
- **Infinite scroll in a fixed-height panel:** Would conflict with the sticky panel's `max-height` and make it hard to reach the panel footer.

### Research Verdict
Client-side "load more" with full dataset cached in API. Fix the date precision bug at the source (inbound processor) and add a tiebreaker sort for existing date-only notes.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `renderPagination()` in `script.js:40-88` — full pagination component. Not ideal here (page numbers don't fit a feed pattern), but proves the codebase supports pagination state management.
  - `.side-panel-body { overflow-y: auto; }` in `style.css:2706` — panel already scrolls, so appending more items is natural.
  - `safeCreateIcons(container)` pattern used everywhere after DOM injection — must call after appending new rows.

* **Reuse Decision:**
  - NOT reusing `renderPagination()` — page-number pagination doesn't fit a feed. Instead, a simple "load more" link.
  - Reusing the `msg-row` HTML template already in `loadRecentMessages()`.
  - Reusing `.btn-ghost.btn-sm` for the load more link styling.

* **Root Cause of Sort Bug:**
  - `api/src/lib/inbound/processor.ts:349`: `new Date().toISOString().split('T')[0]` — strips time
  - `api/src/routes/dashboard.ts:217-218`: `String(b.date).localeCompare(String(a.date))` — date-only strings tie for same day
  - Note IDs contain `Date.now()` timestamp (e.g., `cn_1713175200000`) which CAN be used as tiebreaker

* **Relevant Files:**
  - `api/src/routes/dashboard.ts:137-226` — API endpoint, remove `slice(0, 10)`
  - `api/src/lib/inbound/processor.ts:349` — Fix date to include time
  - `frontend/admin/js/script.js:770-842` — Refactor to client-side pagination
  - `frontend/admin/css/style.css` — Add `.msg-load-more` styling

* **Dependencies:** KV cache key `cache:recent_messages:{year}` — removing the slice changes the cached payload size

## 5. Technical Constraints & Risks
* **Security:** No change — same auth, same data.
* **Performance:** Returning all messages instead of 10 increases response size. For 500 clients × ~2 messages avg = ~1000 messages. JSON payload ~200KB. Acceptable for a cached endpoint. KV cache TTL stays at 300s.
* **Breaking Changes:** None. Badge count changes from "10" to actual total count — this is an improvement.
* **Sort fix for existing data:** Old notes have date-only strings. The tiebreaker sort using note `id` (cn_{timestamp}) handles this gracefully for existing data. New notes will have full ISO timestamps.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Dashboard messages panel loads first 10 messages, shows "הצג עוד..." link when more exist, each click reveals 10 more. Messages are sorted newest-first including within the same day.

### Logic Flow

**Task 1 — Fix date precision (inbound processor):**
1. `api/src/lib/inbound/processor.ts:349`: Change `.split('T')[0]` → keep full ISO string

**Task 2 — Remove API slice limit + improve sort:**
1. `api/src/routes/dashboard.ts:216-221`: Remove `slice(0, 10)`, return all messages
2. Improve sort: primary key = `date` descending, tiebreaker = numeric timestamp from `id` field (extract from `cn_{timestamp}`)

**Task 3 — Client-side load more (frontend JS):**
1. Add state: `let _allMessages = []; let _messagesVisible = 10;`
2. Refactor `loadRecentMessages()`:
   - Fetch all messages, store in `_allMessages`
   - Call new `renderMessages()` to show first 10
3. New `renderMessages()` function:
   - Slice `_allMessages` to `_messagesVisible`
   - Render message rows (reuse existing HTML template)
   - If more messages exist: append "הצג עוד..." link
   - Update badge with total count
4. "Load more" click: `_messagesVisible += 10`, call `renderMessages()`

**Task 4 — CSS for load more link:**
1. `.msg-load-more` — centered text link, subtle color, hover underline

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/processor.ts` | Modify | Line 349: keep full ISO timestamp |
| `api/src/routes/dashboard.ts` | Modify | Lines 216-221: remove slice(0,10), improve sort tiebreaker |
| `frontend/admin/js/script.js` | Modify | Refactor loadRecentMessages() for client-side pagination |
| `frontend/admin/css/style.css` | Modify | Add `.msg-load-more` class |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] Initial load shows first 10 messages
* [ ] "הצג עוד..." link appears when >10 messages exist
* [ ] Clicking link shows 10 more messages, link moves to bottom
* [ ] Link disappears when all messages are shown
* [ ] Badge shows total count (not just 10)
* [ ] Messages within the same day are sorted newest-first
* [ ] New inbound emails store full ISO timestamp
* [ ] Existing date-only notes still sort correctly (tiebreaker works)
* [ ] Delete/hide (DL-263) still works after load more
* [ ] Reply (DL-266) still works after load more
* [ ] Mobile layout: panel still stacks correctly
* [ ] Panel scroll behavior unchanged
* [ ] No regression: dashboard load time not noticeably slower

## 8. Implementation Notes (Post-Code)
* No deviations from plan — implemented exactly as designed.
* Load more link shows count: "הצג עוד 10 מתוך 35..." — gives user context on remaining messages.
* Delete handler refactored to use `renderMessages()` after removing from `_allMessages` array — cleaner than manual DOM badge/empty-state management.
* Workers deploy blocked by network issue — needs manual `cd api && npx wrangler deploy`.
