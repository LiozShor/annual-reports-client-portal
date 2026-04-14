# Design Log 242: Questionnaires Tab Print — Missing Client Questions & Notes
**Status:** [COMPLETED]
**Date:** 2026-04-07
**Related Logs:** DL-126 (annual report notes feature), DL-232 (filing-type print audit), DL-116 (questionnaires tab with print)

## 1. Context & Problem
Printing a questionnaire from the **document-manager** page renders both the "שאלות הלקוח" (client Q&A) section and the "הערות משרד" (office notes) section. Printing the same questionnaire from the **admin → questionnaires tab** (single-row print or bulk print) produces a PDF where both sections are missing.

## 2. User Requirements
1. **Q:** Office notes — fix on-screen accordion too or print only?
   **A:** Print only.
2. **Q:** Bulk print — should each client's notes + client questions be embedded under their own page?
   **A:** Yes — per client.
3. **Q:** On-screen empty-state behavior (header missing when 0 questions)?
   **A:** Out of scope. doc-manager `_renderQuestionnaire` behaves the same way (hides section when empty); they already match.

## 3. Root Cause
The two print paths use different data sources:

| Surface | Client Questions Source | Notes Source |
|---|---|---|
| `printQuestionnaireFromDocManager` (`assets/js/document-manager.js:2571`) | live module-level `clientQuestions` array | `REPORT_NOTES` global |
| `generateQuestionnairePrintHTML` (`admin/js/script.js:6938`) | `item.client_questions` (API) | `clientsData.find(c => c.report_id === item.report_record_id)?.notes` |

**Two concrete bugs:**

1. **Notes never returned by the API.** `api/src/routes/questionnaires.ts:55-58` only requests `['record_id', 'client_questions', 'filing_type']` from the `annual_reports` table. The print therefore relies on a `clientsData` cross-reference (added by DL-232) that fails whenever `clientsData` is filtered by entity tab, archive state, or year. When the lookup misses, no notes section is rendered.

2. **Client questions parser is silent on errors.** Line 7038-7041 wraps `JSON.parse(rawCQ)` in a try/catch with `[]` fallback. Any parse failure (whitespace, BOM, double-encoded string from Airtable) silently zeros out the section. The on-screen accordion `buildQADetailHTML` (line 6790) has the same fragility but isn't always exercised, so the silent miss only surfaces in print.

## 4. Codebase Analysis
- `api/src/routes/questionnaires.ts` — Worker route that replaced the archived n8n `[API] Admin Questionnaires` workflow. Already does the join against `annual_reports` for `client_questions` + `filing_type`; just needs `notes` added to the field list.
- `api/src/lib/format-questionnaire.ts` — pure formatter, no notes/questions handling, no changes needed.
- `admin/js/script.js:6938` (`generateQuestionnairePrintHTML`) — print HTML builder; the office-notes block (line 7106) and client-questions block (line 7038) both need updates.
- `assets/js/document-manager.js:2571` (`printQuestionnaireFromDocManager`) — already correct, used as the reference behavior.

## 5. Technical Constraints & Risks
- **Security:** None. Notes already authenticated through the same token flow.
- **Risks:** Minimal — additive field on the API response, defensive parsing on the client. No schema changes.
- **Breaking changes:** None.
- **n8n:** No workflow changes — both `[SUB] Format Questionnaire` and `[API] Admin Questionnaires` are archived per `docs/workflow-ids.md`; questionnaires now run entirely in the Worker.

## 6. Proposed Solution

### Success Criteria
Printing from the questionnaires tab (single + bulk) produces output identical to the doc-manager print for clients with notes and client questions.

### Step 1 — Worker API: return `notes` per item
**File:** `api/src/routes/questionnaires.ts`
- Add `'notes'` to the `fields` array on the `annual_reports` fetch.
- Build a parallel `notesMap` alongside `questionsMap` and `filingTypeMap`.
- Include `notes` and `filing_type` on each enriched item so the print no longer needs to cross-reference `clientsData`.

### Step 2 — Admin print: read from `item`
**File:** `github/annual-reports-client-portal/admin/js/script.js` (`generateQuestionnairePrintHTML`)
- Office notes block: read `item.notes || reportClient?.notes` (item-first; cross-reference kept as defensive fallback only).
- Filing-type label: read `item.filing_type || reportClient?.filing_type || activeEntityTab`.
- Client questions parsing: replace the silent try/catch fallback with a defensive parser that warns on bad JSON instead of silently producing `[]`.

### Files to Change
| File | Action | Description |
|---|---|---|
| `api/src/routes/questionnaires.ts` | Modify | Add `notes` to fields list, notesMap, and per-item enrichment |
| `github/annual-reports-client-portal/admin/js/script.js` | Modify | Print: use `item.notes`/`item.filing_type`; harden client_questions JSON parse |

### Final Step
**Housekeeping:** Update status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, copy unchecked Section 7 to `current-status.md`, commit + push.

## 7. Validation Plan
- [x] `cd api && npx wrangler deploy` succeeds
- [x] Admin → questionnaires tab → expand a row with notes + client questions → click printer icon → both sections render
- [x] Admin → questionnaires tab → select 2-3 rows with notes + client questions → bulk print → each client's page shows their own notes + questions
- [x] Doc-manager print regression check — same client, no behavior change
- [x] Empty-state regression: client with no notes / no questions → no empty headers in print

## 8. Implementation Notes (Post-Code)
- API change applied at `api/src/routes/questionnaires.ts` lines 50-77: added `notesMap`, included `notes` field in the fetch, and added `notes` + `filing_type` to the per-item map output.
- Admin print updated at `admin/js/script.js` `generateQuestionnairePrintHTML`: client_questions parser hardened (warn on parse failure instead of silent fallback); office notes now read from `item.notes` with `reportClient?.notes` as defensive fallback; filing-type label resolves from `item.filing_type` first.
- Pattern used: API as single source of truth (eliminates `clientsData` cross-reference fragility — same approach DL-126 should have taken originally).
