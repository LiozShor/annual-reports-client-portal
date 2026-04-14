# Design Log 238: Unified AI Review Tab (Both AR & CS)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-06
**Related Logs:** DL-166 (Filing Type Tabs), DL-226 (Dual-Filing Classification)

## 1. Context & Problem
The AI Review tab filters by the active entity tab (`filing_type=${activeEntityTab}`). Natan must switch between AR and CS entity tabs to review all pending classifications. For document review this creates unnecessary friction — all classifications should appear in one unified queue.

## 2. User Requirements
1. **Q:** Should AI Review ignore entity tab filter and show both AR+CS?
   **A:** Always show both — AI Review ignores entity tab toggle.
2. **Q:** How to distinguish AR vs CS cards visually?
   **A:** Filing type badge on each document card (not on client accordion).
3. **Q:** Should client accordion combine AR+CS docs for same client?
   **A:** Combined per client — one accordion, badges on individual docs.
4. **Q:** Should tab badge count reflect both filing types?
   **A:** Always show combined count.

## 3. Research
### Domain
Admin Dashboard Filtering UX, Badge Design

### Sources Consulted
1. **Pencil & Paper — Filter UX Design Patterns** — Component-level filters preferred when sections show different data structures; global filters shouldn't force context switching.
2. **SetProduct — Badge UI Design** — Semantic colors for categories; badges should be static, non-interactive indicators. Concise labels.
3. **Prototypr — Design Guide: Classifying Items** — Use visual tags to distinguish item types in mixed lists; consistent placement reduces cognitive load.

### Key Principles Extracted
- Review queues benefit from unified views — context switching between tabs for the same task (reviewing docs) increases error rate and slows throughput.
- Badges should use semantic colors and concise text to distinguish categories without requiring interaction.
- Badge placement should be consistent across card states (pending and reviewed).

### Research Verdict
Simple approach: pass `filing_type=all` to API, add `filing_type` field to response, render a small color-coded badge per card. No structural changes to the accordion grouping.

## 4. Codebase Analysis
* **API (`classifications.ts:131`):** Already accepts `filing_type` query param, filters server-side via `filingTypeMap`. Response shape (lines 272-309) does NOT include `filing_type` — needs adding.
* **Frontend (`script.js:2604`):** `loadAIClassifications()` passes `filing_type=${activeEntityTab}`. Badge count (`loadAIReviewCount`, line 1433) also uses `activeEntityTab`.
* **Card templates:** `renderAICard()` (line 3015) and `renderReviewedCard()` (line 3241) — both have `.ai-file-info` section where badges go.
* **Existing badge pattern:** `.ai-duplicate-badge`, `.ai-unrequested-badge` — small inline spans in `.ai-file-info`.
* **`FILING_TYPE_LABELS`** already exists at line ~18 of script.js.

## 5. Technical Constraints & Risks
* **Security:** None — no new auth or PII concerns.
* **Risks:** Low — additive change. Existing approve/reject/reassign actions use `classification_id`, not `filing_type`.
* **Breaking Changes:** None — `filing_type=all` is a new value; existing `annual_report`/`capital_statement` still work.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
AI Review tab shows all pending classifications from both filing types, each card has a filing type badge, badge count is combined.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | Accept `filing_type=all`, add `filing_type` to response items |
| `github/annual-reports-client-portal/admin/js/script.js` | Modify | Pass `filing_type=all`, add badge to card templates |
| `github/annual-reports-client-portal/admin/css/style.css` | Modify | Add `.ai-filing-type-badge` styles |

### Logic Flow
1. API: When `filing_type=all`, skip the `filteredByType` filter step
2. API: Add `filing_type` field to each response item from `filingTypeMap`
3. Frontend: `loadAIClassifications()` and `loadAIReviewCount()` always pass `filing_type=all`
4. Frontend: `renderAICard()` and `renderReviewedCard()` add filing type badge in `.ai-file-info`
5. CSS: Style badge with color differentiation (blue for AR, purple for CS)

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status, git commit & push

## 7. Validation Plan
* [ ] AI Review tab shows both AR and CS classifications regardless of entity tab
* [ ] Each card has filing type badge (דוח שנתי / הצהרת הון)
* [ ] Reviewed cards also show filing type badge
* [ ] Tab badge count is combined across both filing types
* [ ] Approve/reject/reassign still works correctly
* [ ] Other tabs (dashboard, documents, etc.) still respect entity tab filter

## 8. Implementation Notes (Post-Code)
- Added optimization: `switchEntityTab()` no longer invalidates `aiReviewLoaded` or re-fetches AI Review data, since it always shows all filing types now.
- Badge placed before duplicate/unrequested badges on pending cards, after review lozenge on reviewed cards.
