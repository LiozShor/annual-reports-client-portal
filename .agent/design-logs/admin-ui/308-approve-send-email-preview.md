# Design Log 308: Approve-and-Send Email Preview (PA Tab + Doc-Manager)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-20
**Related Logs:** DL-289 (live email preview iframe for reply-compose), DL-292 (PA queue tab), DL-297 (doc-manager sticky action bar), DL-298 (PA stacked cards), DL-299 (shared print-questionnaire helper precedent)

## 1. Context & Problem
Office users click "["Approve&Send"]" on the PA card or doc-manager with no way to verify the exact email that will land in the client's inbox — wording changes, rejected-upload callouts, client questions, and bilingual cards can only be eyeballed after the send. We want a read-only preview of the real rendered email (full branded box, logo, doc list) before firing the send, so mistakes get caught pre-send.

## 2. User Requirements
1. **Q:** How should the email preview be triggered before approve-and-send fires?
   **A:** Separate "["Preview"]" button beside the approve button; keep existing confirm flow untouched.
2. **Q:** Where should the email HTML be generated?
   **A:** New `preview=1` dry-run flag on the existing `/webhook/approve-and-send` endpoint — guarantees SSOT parity with the real send.
3. **Q:** Read-only or editable?
   **A:** Read-only WYSIWYG. No editable subject/body.
4. **Q:** Bilingual rendering?
   **A:** Show only the language the client will actually receive (driven by `source_language`).
5. **Q:** Button placement on PA card?
   **A:** In the action row, next to "["Approve&Send"]" (secondary button).
6. **Q:** Button placement on doc-manager?
   **A:** Beside `#approveSendBtn` in the page header + mirror in sticky action bar.
7. **Q:** Modal styling?
   **A:** Reuse DL-289 iframe-in-box shell; factor a shared helper (`frontend/shared/email-preview-modal.js`).

## 3. Research
### Domain
Transactional email UX — pre-send verification, WYSIWYG preview modals, dry-run endpoint patterns.

### Sources Consulted
1. **Postmark "Transactional Email Best Practices"** — Pre-launch test series across clients/devices is standard for transactional email quality control.
2. **MessageGears + Brevo transactional email guides** — Transactional emails must retain brand voice/visual identity; clear subject line is critical and surfaces first in the client preview pane.
3. **Prior DL-289 (reply-compose live preview iframe)** — Internal precedent: `.ai-modal-overlay` + sandboxed `iframe[srcdoc]` delivers identical-to-sent rendering with zero parity drift.

### Key Principles Extracted
- **SSOT for email HTML** — preview must run the exact same builder as the real send; no frontend replication. Applies directly: reuse `buildClientEmailSubject` / `buildClientEmailHtml` from `api/src/lib/email-html.ts`.
- **WYSIWYG trust** — the preview reader must believe "what I see is what is sent." An iframe with the full HTML (srcdoc) is the only way to honor the client's CSS scope.
- **Clear affordance, clear scope** — separate Preview button (not merged into approve flow) avoids ambiguity about whether clicking the button sends anything.

### Patterns to Use
- **Dry-run query flag** (`preview=1`) on the existing route — minimal surface change, guarantees parity.
- **Iframe srcdoc** (sandboxed) — DL-289 precedent; bypasses admin-panel CSS pollution.
- **Shared frontend helper** — one source for both admin script.js and document-manager.js (DL-299 `print-questionnaire.js` precedent).

### Anti-Patterns to Avoid
- **Rebuilding HTML in JS** — violates SSOT rule #1; the template would drift instantly.
- **Wrapping preview inside the confirm dialog** — conflates two actions ("look" vs "send"); users misclick.
- **Caching preview HTML** — preview is cheap; clients and docs can change between preview and send; always refresh.

### Research Verdict
Add a dry-run flag on the existing endpoint and mount a shared modal helper that both admin surfaces call. No CSS, no React — inline vanilla modal matches DL-289 and respects the React-First rule (wiring a button to an existing function is a trivial addition).

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `api/src/routes/approve-and-send.ts:175-176` — builders `buildClientEmailSubject` + `buildClientEmailHtml` already isolated in `api/src/lib/email-html.ts`.
  - `frontend/admin/js/script.js:1154` (`expandReplyCompose`) — DL-289 pattern: `.ai-modal-overlay` → sandboxed iframe with `srcdoc = html`. DOM build is inlined (no helper yet).
  - `frontend/shared/print-questionnaire.js` — DL-299 shared-helper file-layout precedent for anything cross-loaded from both admin + doc-manager.
* **Reuse Decision:** Reuse backend builders as-is (zero change); factor a new shared helper for the modal; copy DL-289 DOM build down-scoped (drop textarea pane).
* **Relevant Files:**
  - Backend: `api/src/routes/approve-and-send.ts` — add early-return branch after line 176.
  - Helper: `frontend/shared/email-preview-modal.js` (NEW).
  - Admin PA card: `frontend/admin/js/script.js:5956` (button location), `:7392` (wrapper function location).
  - Admin HTML: `frontend/admin/index.html` — add `<script>` tag for helper.
  - Doc-manager HTML: `frontend/document-manager.html:366` — button beside `#approveSendBtn`.
  - Doc-manager JS: `frontend/assets/js/document-manager.js:2705` (`approveAndSendToClient`), `:3391` (`updateStickyBar`), `:3452` (sticky approve button).
* **Dependencies:** None new — MS Graph + Airtable calls already present but will be skipped by preview branch.

## 5. Technical Constraints & Risks
* **Security:** Preview respects existing auth (Bearer OR report_id+token). No new surface. Token exposure unchanged.
* **Risks:** If the `preview=1` branch accidentally falls through to the send block, office users would silently send emails. Mitigation: `return` explicitly before the send block; spec-review guards this.
* **Breaking Changes:** None. Existing callers of `/approve-and-send` (with and without `?confirm=1`, `?respond=json`) are untouched.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Clicking "["Preview"]" (PA card OR doc-manager) opens a modal showing the exact rendered email (iframe), including subject line, with NO Airtable write, NO MS Graph send, and NO stage change.

### Logic Flow
1. User clicks "["Preview"]".
2. Frontend helper POSTs `GET /webhook/approve-and-send?report_id={id}&preview=1` with Bearer auth.
3. Backend: auth → fetch report/docs/categories → build subject+html → return JSON `{ok, subject, html, language, client_email}` and EARLY-RETURN.
4. Frontend: render `.ai-modal-overlay` with subject line + iframe(srcdoc=html). Close via X, backdrop, Escape.

### Data Structures / Schema Changes
None. Reuses existing Airtable fields and existing builders.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/approve-and-send.ts` | Modify | Add `preview=1` early-return after builders; returns JSON before auth-confirm enforcement (preview is read-only) |
| `frontend/shared/email-preview-modal.js` | Create | `window.showEmailPreviewModal({reportId, clientName, getToken, apiBase})` |
| `frontend/admin/js/script.js` | Modify | PA card `.pa-card__actions`: add "["Preview"]" button; add `previewApproveEmail(reportId, clientName)` wrapper |
| `frontend/admin/index.html` | Modify | `<script src="../shared/email-preview-modal.js">` (path matches `print-questionnaire.js` convention) |
| `frontend/document-manager.html` | Modify | `<script>` for helper; add `#previewApproveBtn` beside `#approveSendBtn` |
| `frontend/assets/js/document-manager.js` | Modify | Add `previewApproveEmail()` top-level wrapper; mirror button into `updateStickyBar()` |
| `.agent/design-logs/admin-ui/308-approve-send-email-preview.md` | Create | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-308 row at top of Active Logs |

### Final Step (Always)
* **Housekeeping:** Update log status → `[IMPLEMENTED — NEED TESTING]`; copy Section 7 items to `.agent/current-status.md`; deploy Worker; push feature branch; pause for merge approval.

## 7. Validation Plan
* [ ] PA card "["Preview"]" opens modal showing exact email (iframe srcdoc); no send, no Airtable write
* [ ] Doc-manager static button (page header) + sticky-bar button both open the modal
* [ ] HE-only client (source_language blank/`he`): single Hebrew card rendered inside preview
* [ ] EN client (source_language=`en`): bilingual side-by-side HE+EN cards rendered inside preview
* [ ] DL-244 rejected-uploads callout renders inside preview identically to sent email
* [ ] DL-259 client questions block renders inside preview
* [ ] Off-hours timing does NOT schedule a deferred send when preview is used
* [ ] Loading spinner visible while fetching; inline error state on 500 (no crash)
* [ ] Close via X, backdrop click, Escape all dismiss the modal
* [ ] Zero-docs "["No docs needed"]" subject/body variant renders correctly
* [ ] End-to-end: open preview → close → click real "["Approve&Send"]" → email actually sent, stage advances `Pending_Approval` → `Collecting_Docs`, Airtable `docs_first_sent_at` populated
* [ ] `curl …?preview=1` returns JSON without mutating Airtable (verify `docs_first_sent_at` unchanged before/after)

## 8. Implementation Notes (Post-Code)
* *To be filled by implementer wave subagents.*
