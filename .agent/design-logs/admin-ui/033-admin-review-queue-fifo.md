# Design Log 033: Admin "Ready for Review" FIFO Queue
**Status:** [COMPLETED]
**Date:** 2026-02-16
**Related Logs:** 032 (UI redesign), 029 (WF02 rebuild)

## 1. Context & Problem
The office has no way to prioritize which clients to review first after all their documents arrive. Stage 4 ("Review") clients appear in the main dashboard table mixed with everyone else, with no completion timestamp and no ordering. The office needs a FIFO queue — first client to finish sending all docs = first to be reviewed.

## 2. User Requirements (The 5 Questions)

1. **Q:** Which page is this for?
   **A:** Admin panel dashboard (`admin/index.html`).

2. **Q:** What defines "sent ALL their docs"? When should the timestamp be set?
   **A:** When `completion_percent` reaches 100% — meaning the client's last needed document was received.

3. **Q:** Which stages should the FIFO view show?
   **A:** Only stage `4-Review`.

4. **Q:** UI vision — new tab, filter, or sort option?
   **A:** New dedicated tab: "Ready for Review" (מוכנים לבדיקה). Match existing design.

5. **Q:** Scope — just frontend, or also backend + Airtable?
   **A:** All three: (a) Add `docs_completed_at` field to Airtable, (b) Automation to set timestamp when 100%, (c) Update dashboard API + frontend.

## 3. Technical Constraints & Risks

* **Dependencies:**
  - Airtable `annual_reports` table (`tbls7m3hmHC4hhQVy`) — new field
  - WF[04] Document Edit Handler (`y7n4qaAUiCS4R96W`) — add nodes
  - Admin Dashboard workflow (`AueLKVnkdNUorWVYfGUMG`) — modify Format Response
  - `completion_percent` formula — relies on rollup fields that Airtable computes from documents table
* **Risks:**
  - Airtable rollups may have slight delay after document status change — the re-fetch in WF[04] should account for this (Airtable processes within the same API call context)
  - `docs_completed_at` must never be overwritten once set (preserves FIFO integrity)
  - Waived documents affect completion calculation — using Airtable's own `completion_percent >= 100` avoids reimplementing this logic

## 4. Proposed Solution (The Blueprint)

### Logic Flow

**Completion detection (added to WF[04]):**
```
[existing flow] → Update Report Timestamp
    ↓
Re-fetch Report (Airtable GET — fresh rollup values)
    ↓
Check Completion (Code: completion_percent >= 100, not already stage 4/5, no existing timestamp)
    ↓
IF Should Advance
  ├─ TRUE → Airtable UPDATE: stage=4-Review, docs_completed_at=ISO timestamp
  └─ FALSE → end
```

**Dashboard API (modified Format Response):**
- Add `docs_completed_at` to each client object
- Add `review_queue` array: stage-4 clients with timestamp, sorted by `docs_completed_at` ASC (FIFO)

**Frontend new tab:**
- Tab button with live count badge
- Header bar with queue count + explanation
- FIFO table: #, name, email, year, docs count, completion date, waiting time (color-coded), actions
- Actions: view docs (→ document-manager), mark complete (→ stage 5)

### Data Structures / Schema Changes

**Airtable: `annual_reports` table — new field:**
| Field | Type | Description |
|-------|------|-------------|
| `docs_completed_at` | dateTime | Set once when completion_percent first reaches 100% |

**Dashboard API response — additions:**
```json
{
    "ok": true,
    "stats": { "total": N, "stage1": N, ..., "review_queue_count": N },
    "clients": [{ ..., "docs_completed_at": "ISO" | null }],
    "review_queue": [{ ... sorted by docs_completed_at ASC }]
}
```

### n8n Architecture

**Modified Workflows:**
- WF[04] (`y7n4qaAUiCS4R96W`): +3 nodes (Re-fetch Report, Check Completion, IF Should Advance, Advance to Review)
- Admin Dashboard (`AueLKVnkdNUorWVYfGUMG`): Modify "Format Response" Code node

**New Workflow:**
- `[Admin] Mark Complete`: Simple webhook (POST /admin-mark-complete) → verify token → Airtable update stage=5-Completed → respond

### Frontend Files
- `admin/index.html` — tab button + tab content HTML
- `admin/js/script.js` — `renderReviewTable()`, `markComplete()`, `exportReviewToExcel()`, `loadDashboard()` update
- `admin/css/style.css` — review tab styles (purple theme matching stage-4 color)

## 5. Validation Plan
* [ ] Add `docs_completed_at` field to Airtable and verify it accepts dateTime values
* [ ] Test WF[04] completion detection: mark last doc as Received → verify stage advances to 4, timestamp is set
* [ ] Test WF[04] edge case: waive last missing doc → verify same completion detection
* [ ] Test WF[04] idempotency: report already at stage 4 → verify no double-advance, no timestamp overwrite
* [ ] Test WF[04] edge case: report with 0 docs → verify no false completion
* [ ] Test Dashboard API: verify `review_queue` array is sorted by `docs_completed_at` ASC
* [ ] Test frontend: verify FIFO tab renders correctly with numbered rows, dates, waiting time badges
* [ ] Test "Mark Complete" button: verify stage advances to 5, row disappears from review tab
* [ ] Verify no regression in existing WF[04] document edit flow
* [ ] Verify no regression in existing dashboard tab functionality

## 6. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
