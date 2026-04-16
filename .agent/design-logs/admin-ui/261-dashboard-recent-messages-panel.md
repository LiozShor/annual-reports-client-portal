# Design Log 261: Dashboard Recent Client Messages Panel
**Status:** [DRAFT]
**Date:** 2026-04-13
**Related Logs:** DL-199 (client communication notes), DL-258 (client messages at all stages), DL-259 (inbound notes at all stages), DL-254 (dashboard load performance)

## 1. Context & Problem
Office users (Natan + Moshe) currently need to open Outlook to see incoming client emails. This is friction — they already have the admin dashboard open throughout the day. Client messages are already being captured by WF05 (inbound processor) via Claude Haiku summarization and stored as `client_notes` JSON in Airtable. The data exists; it's just not surfaced on the dashboard.

**Goal:** Add a side panel to the dashboard showing the 10 most recent client messages across all clients, so office users can triage communications without leaving the admin panel.

## 2. User Requirements
*Q&A from discovery phase:*
1. **Q:** Where should the recent messages section be placed?
   **A:** Side panel next to the clients table (2-column layout)

2. **Q:** How many recent messages to show?
   **A:** Last 10

3. **Q:** What info per message row?
   **A:** Client name + AI summary + relative date. Hover shows raw email snippet as tooltip.

4. **Q:** Click action?
   **A:** Click navigates to client's document-manager page. Hover shows raw snippet.

## 3. Research
### Domain
Dashboard UX, Activity Feed Design, RTL Side Panels

### Sources Consulted
1. **UXPin Dashboard Design Principles** — Prioritize "glanceable" data; don't overload with detail. Activity feeds should show actionable items first.
2. **CSS-Tricks: Dynamically-Sized Sticky Sidebar** — Use `position: sticky` with `max-height` and `overflow-y: auto` for scrollable side panels. Avoids JS complexity.
3. **Pencil & Paper: UX Pattern Analysis for Dashboards** — Side panels work best when they complement (not duplicate) the main content. Keep them narrow (300-380px) and scannable.

### Key Principles Extracted
- **Glanceability:** Each message row must be scannable in <2 seconds — name, summary, when.
- **Progressive disclosure:** Show AI summary upfront; raw snippet only on hover (tooltip).
- **Sticky positioning:** Panel stays visible while scrolling the clients table — proven pattern already used in `.ai-review-detail`.
- **RTL-aware layout:** Side panel goes on the LEFT in RTL context (Hebrew). CSS `grid-template-columns` handles this naturally with `dir="rtl"`.

### Patterns to Use
- **Sticky side panel:** Reuse the `.ai-review-detail` pattern (already in codebase at `style.css:2623`).
- **Relative time formatting:** Use `Intl.RelativeTimeFormat('he')` for Hebrew relative dates.
- **Tooltip for raw snippet:** CSS `title` attribute is simplest; could upgrade to custom tooltip later.

### Anti-Patterns to Avoid
- **Polling/WebSocket for real-time updates:** Overkill — dashboard already has SWR caching. Messages update on page load.
- **Separate API endpoint:** Unnecessary complexity if we can piggyback on the existing dashboard query.

### Research Verdict
Simple CSS Grid 2-column layout with sticky side panel. Reuse existing `.ai-review-split` pattern. Data from a lightweight dedicated API endpoint (avoids bloating the main dashboard query with potentially large JSON fields). Panel collapses to full-width on mobile (<900px).

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `renderClientNotes()` in `document-manager.js:2805` — renders timeline with icons, dates, sender, summary, raw snippet. Can reference its HTML structure for consistency.
  - `.ai-review-split` / `.ai-review-detail` in `style.css:2606-2634` — exact sticky side panel pattern we need.
  - `getCachedOrFetch()` in `api/src/lib/cache.ts` — KV caching for API responses.
  
* **Reuse Decision:**
  - Reuse `.ai-review-split` CSS grid pattern (adapt class names for dashboard context).
  - Reference `renderClientNotes()` HTML structure for consistent note rendering.
  - New lightweight API endpoint for recent messages (keeps dashboard response lean).

* **Relevant Files:**
  - `api/src/routes/dashboard.ts` — API endpoint, needs new route for recent messages
  - `admin/index.html:102-274` — Dashboard tab HTML, needs grid wrapper
  - `admin/js/script.js:628-705` — `loadDashboard()`, needs parallel fetch for messages
  - `admin/css/style.css` — needs dashboard split layout CSS

* **Dependencies:** Airtable `reports` table `client_notes` field (JSON string array)

## 5. Technical Constraints & Risks
* **Security:** Messages endpoint uses same Bearer token auth as dashboard.
* **Performance:** Querying `client_notes` across all reports could be expensive. Strategy: Airtable query with `filterByFormula` for current year + `fields: ['client_name', 'client_notes']` + parse/sort/slice in Worker. Cache with 5-min TTL in KV.
* **Data size:** `client_notes` is a JSON string per report — some could be large. We only need the latest 10 across all clients, so we parse and flatten server-side.
* **Breaking Changes:** None — purely additive. Clients table remains fully functional.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Dashboard loads with a sticky side panel showing the 10 most recent client messages, each clickable to the client's doc-manager, with raw snippet on hover.

### Logic Flow
1. **API:** New `GET /webhook/admin-recent-messages` endpoint
   - Query Airtable `reports` with `{year}=YYYY` + `client_notes!=''`
   - Fetch only `client_name`, `client_notes`, `year` fields
   - Parse all `client_notes` JSON, flatten into single array with `report_id` and `client_name` attached
   - Sort by date descending, take top 10
   - Cache result in KV (5-min TTL)
   - Return `{ ok: true, messages: [...] }`

2. **HTML:** Wrap clients table in `.dashboard-split` grid
   - Left (in RTL): clients card (`.dashboard-main`)  
   - Right (in RTL): messages panel (`.dashboard-side-panel`)
   - Panel has header "הודעות אחרונות מלקוחות" + scrollable body

3. **CSS:** Dashboard split layout
   - Grid: `1fr minmax(300px, 360px)` (panel is 300-360px)
   - Panel: sticky, scrollable, max-height `calc(100vh - 100px)`
   - Mobile (<900px): single column, panel moves above table

4. **JS:** Fetch messages in parallel with dashboard load
   - New `loadRecentMessages()` function
   - Renders message rows with: mail icon, client name + year, AI summary, relative date
   - Hover title = raw_snippet (first 200 chars)
   - Click = navigate to `document-manager.html?report_id=...&token=...`
   - Skeleton loader while loading

### Data Structures / Schema Changes
No schema changes. API response shape:
```json
{
  "ok": true,
  "messages": [
    {
      "report_id": "recXXX",
      "client_name": "יוסי כהן",
      "year": 2025,
      "date": "2026-04-13",
      "summary": "שלח אישורי בנק מבנק הפועלים",
      "source": "email",
      "sender_email": "yosi@example.com",
      "raw_snippet": "Hi, attached please find..."
    }
  ]
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/dashboard.ts` | Modify | Add `GET /admin-recent-messages` endpoint |
| `api/src/index.ts` | Verify | Ensure dashboard routes are mounted (should already be) |
| `admin/index.html` | Modify | Wrap table in `.dashboard-split`, add side panel HTML |
| `admin/js/script.js` | Modify | Add `loadRecentMessages()`, call in parallel with `loadDashboard()` |
| `admin/css/style.css` | Modify | Add `.dashboard-split`, `.dashboard-side-panel`, `.msg-*` classes |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] Dashboard loads with side panel visible next to clients table
* [ ] Panel shows up to 10 messages, sorted newest first
* [ ] Each row shows: mail icon, client name + year, AI summary, relative date
* [ ] Hover on a row shows raw email snippet tooltip
* [ ] Click on a row navigates to correct client's document-manager
* [ ] Panel scrolls independently when content exceeds viewport height
* [ ] Panel is sticky (stays visible while scrolling clients table)
* [ ] Mobile (<900px): panel stacks above table as full-width card
* [ ] No regression: clients table still loads, filters, paginates correctly
* [ ] Empty state: shows friendly message when no client messages exist
* [ ] Performance: messages load in parallel with dashboard (no added latency)

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
