# Design Log 194: Remove Batch Status Feature
**Status:** IMPLEMENTED — NEED TESTING
**Date:** 2026-03-26
**Related Logs:** DL-086 (persistent batch review), DL-093 (batch completion), DL-108 (remove bilingual), DL-174 (Workers migration)

## 1. Context & Problem
The batch status feature was built as part of the AI review workflow — after an admin reviewed all documents for a client, a "batch action bar" appeared with options to send a summary email to the client or dismiss without sending. The feature is being removed entirely as it's no longer needed.

## 2. User Requirements
1. **Q:** What scope should be removed?
   **A:** Entire batch status flow — UI (action bar, send/dismiss buttons, ready-to-send badges), API endpoint, n8n workflow.

2. **Q:** Should AI review card states (approved/rejected lozenges) be removed too?
   **A:** No — keep the review card visual states. Only remove the batch send/dismiss actions.

3. **Q:** What about the `airtable.batchUpdate()` utility?
   **A:** Keep it — it's a generic helper used by reminders and edit-documents routes.

4. **Q:** What about the n8n workflow?
   **A:** Deactivate it (not delete) so it can be restored if needed.

## 3. Research
### Domain
Feature deprecation, dead code elimination, API endpoint retirement.

### Sources Consulted
1. **Meta Engineering — Automating Dead Code Cleanup** — Work at symbol level, combine static + dynamic analysis, delete entire subgraphs of mutually-dependent dead code in one pass.
2. **vFunction — Dead Code Detection & Elimination** — Delete one module/feature at a time, run tests after each chunk. Best timing: when team has fresh knowledge.
3. **Zuplo — Deprecating REST APIs** — For internal APIs with no external consumers, a clean removal is fine. Use HTTP 410 for retired endpoints.

### Key Principles Extracted
- Remove in layers: UI first, then backend, then endpoint — matches our plan structure
- One module at a time with verification between steps
- For closed systems (no public API), clean removal is preferred over gradual deprecation

### Research Verdict
Straightforward removal. No external consumers, no gradual sunset needed. Delete code, deactivate workflow, verify build.

## 4. Codebase Analysis
* **Existing Solutions Found:** The batch status feature spans 3 layers: frontend (script.js ~200 lines, style.css ~120 lines), API (batch-status.ts 112 lines), n8n workflow.
* **Reuse Decision:** N/A — this is a removal.
* **Relevant Files:** `api/src/routes/batch-status.ts`, `api/src/index.ts`, `shared/endpoints.js`, `admin/js/script.js`, `admin/css/style.css`, `api/README.md`
* **Dependencies:** `batchReviewTracker` is self-contained. `airtable.batchUpdate()` is independent and used elsewhere.
* **Note:** `showBatchCompleteModal` is called but never defined — likely a dead reference from a previous refactor.

## 5. Technical Constraints & Risks
* **Security:** No security concerns — removing an endpoint reduces attack surface.
* **Risks:** Low. The batch flow is self-contained. Review card states are independent CSS classes.
* **Breaking Changes:** None — no external consumers of the batch-status endpoint.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Delete `api/src/routes/batch-status.ts`
2. Remove import + route mount from `api/src/index.ts`
3. Remove `SEND_BATCH_STATUS` from `shared/endpoints.js`
4. Remove all batch-related JS from `script.js` (~200 lines)
5. Remove all batch-related CSS from `style.css` (~120 lines)
6. Update `api/README.md`
7. Deactivate n8n workflow via MCP
8. Verify build + no remaining references
9. Housekeeping: design log, INDEX, current-status, commit & push

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/batch-status.ts` | Delete | Entire endpoint file |
| `api/src/index.ts` | Modify | Remove import + route mount |
| `shared/endpoints.js` | Modify | Remove SEND_BATCH_STATUS |
| `admin/js/script.js` | Modify | Remove ~200 lines of batch functions/UI |
| `admin/css/style.css` | Modify | Remove ~120 lines of batch CSS |
| `api/README.md` | Modify | Remove endpoint row |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update current-status, commit & push

## 7. Validation Plan
* [ ] `npm run build` passes in `api/`
* [ ] Admin panel loads without JS errors
* [ ] AI Review tab renders — cards display correctly
* [ ] Review actions (approve/reject/reassign) still work
* [ ] No references to `sendBatchStatus`, `dismissBatch`, `batchReviewTracker`, `SEND_BATCH_STATUS` in codebase
* [ ] n8n workflow `QREwCScDZvhF9njF` is deactivated
* [ ] Reviewed card styles still apply (blue/amber backgrounds)

## 8. Implementation Notes (Post-Code)

**Removed:**
- `api/src/routes/batch-status.ts` — deleted (112 lines)
- `api/src/index.ts` — removed import + route mount (2 lines)
- `shared/endpoints.js` — removed `SEND_BATCH_STATUS` (1 line)
- `admin/js/script.js` — removed ~200 lines: `batchReviewTracker` variable, `reconstructBatchTracker()` call, badge-ready-send logic, batch action bar HTML (render + post-review injection), `showBatchCompleteModal` call, 3 `trackReviewAction` call sites, 5 functions (`trackReviewAction`, `reconstructBatchTracker`, `sendBatchStatus`, `dismissBatch`, `removeReviewedCards`)
- `admin/css/style.css` — removed ~120 lines: batch-complete-modal, batch-summary-stats/stat/items, spinning animation, batch-action-bar, badge-ready-send + keyframe, mobile batch styles
- `api/README.md` — removed endpoint row

**Deactivated:** n8n workflow `[API] Send Batch Status` (ID: `QREwCScDZvhF9njF`) via REST API

**Kept:** `airtable.batchUpdate()` utility, reviewed card state CSS (`.reviewed-approved`, `.reviewed-rejected`, `.reviewed-reassigned`), review lozenge badges

**Verification:** `wrangler deploy --dry-run` passes, zero grep hits for batch identifiers
