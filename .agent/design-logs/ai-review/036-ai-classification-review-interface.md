# Design Log 036: AI Classification Review Interface
**Status:** [COMPLETED]
**Date:** 2026-02-18
**Related Logs:** 035 (WF05 AI Classification + OneDrive Upload), 034 (Phase 2 Overview), 033 (Admin Review Queue)

## 1. Context & Problem

WF05 now classifies email attachments using Claude Haiku and uploads to OneDrive. Currently it sends Natan an email notification per batch. Two issues:

1. **No review UI** — Natan wants a web interface to review AI classifications (approve/reject/reassign) instead of email notifications.
2. **JSON parse bug** — Haiku wraps responses in markdown code fences (` ```json ... ``` `) and Hebrew quotes in `issuer_name` (e.g., `בנק לאומי בע"מ`) break `JSON.parse()`, causing correctly-classified documents to be treated as unidentified.

## 2. User Requirements (Discovery Q&A)

1. **Q:** Where to store unmatched/pending classifications — reuse `documents` table or new table?
   **A:** New `pending_classifications` Airtable table (clean separation).

2. **Q:** Embed review UI in existing admin page or standalone?
   **A:** Standalone `document-review.html` (not embedded in admin).

3. **Q:** Upload to OneDrive immediately or wait for review?
   **A:** Keep uploading immediately — review is about classification accuracy, not storage.

4. **Q:** What actions should the review interface support?
   **A:** Approve (confirm AI classification), Reject (mark as wrong), Reassign (change classification to different document type).

5. **Q:** Should approved matched docs auto-update to "Received" status?
   **A:** Yes — approve on matched doc sets `status → Received` and `review_status → confirmed` in documents table.

## 3. Technical Constraints & Risks

* **Dependencies:** WF05 (`cIa23K8v1PrbDJqY`), Airtable base `appqBL5RWQN9cPOyh`, OneDrive API, existing admin auth (localStorage token)
* **Security:** Admin token verification on both API endpoints
* **Risks:**
  - JSON parse bug must be fixed first (Phase 1) — all downstream phases depend on clean classification data
  - Removing email notification means Natan ONLY sees classifications via the web UI — must ensure UI is reliable
  - OneDrive file moves (for reassign) need proper error handling

## 4. Proposed Solution (The Blueprint)

### Implementation Phases

**Phase 1: Fix JSON Parse Bug** — Robust JSON extraction in WF05 "Process and Prepare Upload" node
**Phase 2: Create Airtable Table** — `pending_classifications` with 25 fields
**Phase 3: Modify WF05 Pipeline** — Add classification record creation, remove email notification
**Phase 4: GET API** — New workflow to fetch pending classifications with enrichment
**Phase 5: POST API** — New workflow to handle approve/reject/reassign actions
**Phase 6: Web UI** — `document-review.html` with cards, filters, actions
**Phase 7: Admin Link** — Badge in admin navbar

### Architecture

```
WF05 (modified)
  → Classify → Upload OneDrive → Create pending_classifications record
  → IF matched: also update documents table (review_status: pending_review)

[API] Get Pending Classifications
  → Webhook GET → Verify Token → Query Airtable → Enrich missing docs → Respond JSON

[API] Review Classification
  → Webhook POST → Verify Token → Switch(action) → Update Airtable → Check completion → Respond

document-review.html
  → Auth (localStorage) → Fetch GET API → Render cards grouped by client
  → User actions → POST API → Animate card out → Update stats
```

### Data Flow
```
Email → WF05 → OneDrive upload + pending_classifications record
                                    ↓
                        document-review.html (GET API)
                                    ↓
                        Natan reviews (POST API)
                                    ↓
                        documents table updated (Received/cleared)
```

### New Files
- `document-review.html`
- `assets/css/document-review.css`
- `assets/js/document-review.js`

### Modified Files
- WF05 (`cIa23K8v1PrbDJqY`) — pipeline changes
- `docs/airtable-schema.md` — new table documentation
- `admin/index.html` — nav link addition

### New n8n Workflows
- `[API] Get Pending Classifications` — GET webhook
- `[API] Review Classification` — POST webhook

## 5. Validation Plan

- [ ] Phase 1: Resend test email with XLSX → verify T601 correctly parsed
- [ ] Phase 3: Send test email → verify classification in pending_classifications, no email sent
- [ ] Phase 4: curl GET endpoint → verify JSON response with enrichment
- [ ] Phase 5: curl POST approve → verify Airtable updates
- [ ] Phase 6: Open document-review.html → verify cards load, action works
- [ ] E2E: Email → OneDrive → review page → approve → document Received

## 6. Implementation Notes (Post-Code)

All 7 phases implemented as planned. Key details:

- **JSON parse fix:** Used `rawText.match(/\{[\s\S]*\}/)` instead of regex strip — handles code fences, preamble text, Hebrew quotes. Added `robustJsonParse()` with backwards-scanning quote fixer for unescaped Hebrew quotes (e.g., `בע"מ`).
- **Airtable table:** `tbloiSDN3rwRcl1ii` — primary field is `classification_key` (text), not autoNumber (API limitation)
- **WF05 pipeline:** 25 nodes, 22 connections. Build Summary + Email Natan removed. New pipeline tail: Prep Doc Update → Create Pending Classification → **Route by Match** (Code: flattens `$json.fields.*` to top-level, adds `_is_matched` boolean) → **IF Has Match** (checks `$json._is_matched`) → Update Document Record → Update Email Event. The Route by Match node was necessary because n8n IF node v2.3 `isNotEmpty` operator fails on nested `$json.fields.*` paths despite values being present.
- **GET API:** `kdcWwkCQohEvABX0` — 6 nodes (was 9). Restructured to use a single "Build Response" Code node that queries 3 Airtable tables via HTTP (`this.helpers.httpRequest()`), handling empty results gracefully. The original 7-node approach failed due to n8n zero-item propagation (Airtable returns 0 records → all downstream nodes skip).
- **POST API:** `c1d7zPAmHfHM71nV` — 13 nodes with Switch-like IF chain for approve/reject/reassign actions
- **Frontend:** 3 files (document-review.html, document-review.css, document-review.js) — shared admin auth, cards grouped by client
- **Admin link:** Navbar button with async badge count loading
- **Auth token:** Same as admin panel (`94a08da1fecbb6e8b46990538c7b50b2`), verified in both API workflows
- **Hebrew file rename:** When AI classification matches, file uploaded to OneDrive with Hebrew document title instead of original attachment name (e.g., `טופס 106 לשנת 2025 – אינטל.docx`)
- **E2E verified:** Execution #2483 — full pipeline success with 2 attachments (T601 Bank Leumi + T201 Intel), both classified at 95% confidence, document records updated with `review_status: pending_review`, email event marked Completed.
