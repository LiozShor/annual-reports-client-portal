# Design Log 121: Questionnaire Email Ordering + Floating Bar + Client Questions

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-08
**Related Logs:** DL-110 (Questions for Client), DL-116 (Questionnaires Tab), DL-120 (Questionnaires UX)

## Context

Four confirmed issues with the questionnaire system:

1. **Email questionnaire ordering** — Insurance fields don't appear in correct order in office email.
2. **Floating bulk print bar** — Never appears when checkboxing questionnaires (inline `style="display:none"` bug).
3. **DL-110 client questions missing** — `client_questions` not populated in questionnaires tab API (stored on `annual_reports`, not questionnaire table).
4. **WF02 code duplication** — Refactored WF02 to use `[SUB] Format Questionnaire`.

---

## Changes Implemented

### Task 1: WF02 Refactor — Use [SUB] Format Questionnaire

**WF02 (`QqEIWQlRs1oZzEtNxFUcQ`):**
- Added "Format Q&A" Execute Workflow node (calls `9zqfOuniztQc2hEl`) at position (592, 304)
- New chain: `Fetch Record → Format Q&A → Get Mappings → Extract & Map`
- "Extract & Map" updated to read `$('Format Q&A').first().json.answers` and pass as `preordered_qa`

**[SUB] Document Service (`hf7DRQ9fLmQqHv3u`) "Generate HTML":**
- `buildQuestionnaireTable()` now checks `input.preordered_qa` first
- If present (WF02 path): renders rows in sub-workflow order (already filtered, deduped, ordered)
- If absent (WF03/WF04/WF06 path): falls back to existing `Object.entries(answersByKey)` logic
- Backward compatible — no change needed for other callers

### Task 2: Fix Floating Bulk Print Bar

**File:** `github/annual-reports-client-portal/admin/index.html` line 659

Removed `style="display:none;"` from `#questionnaireBulkActions` div. CSS already has `.questionnaire-bulk-actions { display: none; }` and JS adds `.visible` class — the inline style was overriding CSS with higher specificity.

### Task 3: Client Questions from annual_reports

**[API] Admin Questionnaires (`uRG6TGVureMjmJWr`) "Build Response":**

Replaced the always-empty `qa.raw_answers?.client_questions || ''` with:
- Collects unique `report_record_id` values from all questionnaire items
- Makes a single Airtable API call (via `$helpers.httpRequest`) to `annual_reports` table (`tbls7m3hmHC4hhQVy`)
- Fetches `record_id` + `client_questions` fields
- Builds a lookup map `reportId → client_questions`
- Enriches each result item with real `client_questions`

---

## Validation Checklist

- [ ] **Email ordering:** Submit test questionnaire with insurance fields → office email shows them after "סוג כספים שנמשכו"
- [ ] **Email regression:** WF03/WF04/WF06 still work (no `preordered_qa` → fallback used)
- [ ] **Admin tab Q&A:** Open questionnaire detail → Q&A displays correctly
- [ ] **Client questions in UI:** Add questions via Document Manager → open same client in questionnaires tab → DL-110 questions appear in amber section
- [ ] **Client questions in print:** Print questionnaire with DL-110 questions → they appear
- [ ] **Floating bar:** Check 2+ questionnaires → floating bar appears with print button
- [ ] **Bulk print:** Select multiple → click print → new window with Q&A + client questions for all selected
- [ ] **Single print:** Click printer icon → same content as bulk for that single client
