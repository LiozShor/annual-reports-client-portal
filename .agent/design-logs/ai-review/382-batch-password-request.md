# Design Log 382: Batch Password Request Emails
**Status:** IMPLEMENTED — NEED TESTING
**Date:** 2026-04-29
**Related Logs:** DL-380 (one-click request-password email + auto-detect reply), DL-379 (lock indicator badge)

## 1. Context & Problem

DL-380 shipped a per-card "Request password" kebab action that sends one email per encrypted PDF. When a client uploads N encrypted PDFs (e.g., multiple password-locked files from the same Outlook thread), the admin must click the kebab N times → N separate emails → client receives multiple identical asks ("חופר" = annoying). This degrades client UX and creates unnecessary mailbox noise.

**Goal:** One click → one email listing all selected encrypted PDFs for that client → one reply → fan out the password to all matched `pending_classifications` records automatically.

## 2. User Requirements

1. **Q:** When admin clicks "Request password" on an encrypted card, how should sibling encrypted PDFs be selected?
   **A:** Auto-select all encrypted PDFs for the client; admin unchecks any to exclude. (NN/g airline check-in nested-checkbox pattern.)

2. **Q:** How should one token map to multiple records for inbound fan-out?
   **A:** New singleLineText field `password_request_token` on `pending_classifications`. Inbound matcher filters by `{password_request_token}=token`. Clean schema.

3. **Q:** How should the client communicate per-file passwords in their reply?
   **A:** Don't auto-parse per file — we can't forecast the client's reply format. Store the entire raw reply on every matched record; admin reads raw text in unlock panel and applies manually.

4. **Q:** New encrypted file arriving after batch already sent — what happens?
   **A:** Independent request. New arrival starts a fresh batch with its own token. Avoids "add to existing" complexity.

## 3. Research

### Domain

Bulk-action UX / multi-select checkbox patterns for admin workflows.

### Sources Consulted

1. **NN/g — "Checkboxes: Design Guidelines" (Maddie Brown, 2024-06-28)** — Nested checkboxes recommended exactly when you EXPECT many users to select all (airline check-in pattern). Indeterminate parent state when partial selection. Pre-selected default is fine for workflow defaults (deceptive-pattern caveat only applies to marketing opt-ins).
2. **Eleken — "Bulk action UX: 8 design guidelines for SaaS" (2026-02-23)** — Keep flexibility: single-file flow stays for N=1. Communicate eligibility: disabled rows for already-requested files with tooltip. Per-row feedback after action.
3. **PatternFly — "Bulk selection" pattern reference** — Confirms: parent checkbox with indeterminate state is the standard for partial selections; vertical checkbox layout for scannability.

### Key Principles Extracted

- Nested checkboxes with auto-select-all are appropriate when the common case is selecting everything (our case: admin almost always wants all encrypted PDFs for a client).
- Eligibility communication: already-sent records should appear as disabled rows with a tooltip explaining why (humanRelDate helper already exists).
- Single-file path stays unchanged (N=1 → no checkbox list rendered).
- Debounce re-fetch triggers to avoid excessive preview POSTs on rapid checkbox toggling.

### Patterns to Use

- **Nested checkbox list (NN/g):** Parent "כל הקבצים" checkbox + child checkboxes vertically. Indeterminate state when some-but-not-all checked.
- **Token-field fan-out:** Random 8-char token written to all selected records; inbound matcher queries by token field.

### Anti-Patterns to Avoid

- **Per-file auto-parsing of reply text:** Client reply format is unpredictable — over-engineering this leads to wrong password extractions.
- **"Add to existing batch" flow:** Adds mid-flight state complexity; independent-request approach is simpler and sufficient.
- **Pre-selected marketing opt-ins:** Not applicable here (workflow defaults are fine to pre-select per NN/g).

### Research Verdict

Nested checkbox with auto-select-all + token-field fan-out + independent-request for late arrivals. Matches NN/g airline check-in example directly.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `requestPdfPassword(recordId)` in `script.js` ≈L6403 — to be extended (not rewritten).
  - `showEmailPreviewModal` in `email-preview-modal.js` L21 — additive `selectionList` param, backward-compat.
  - `humanRelDate(isoStr)` in `script.js` ≈L1021 — for disabled-row tooltip ("נשלחה לפני N ימים").
  - `escapeAttr()` in `script.js` L9420 — reuse for XSS-safe label rendering.
  - `esc()` helper in `email-html.ts` (added DL-380) — reuse for HTML escape of filenames.
  - `airtable.listAllRecords(TABLES.PENDING_CLASSIFICATIONS, { filterByFormula })` — same API, new formula.

- **Reuse Decision:** Extend existing functions; no rewrites. Only the preview modal renders a new section when `selectionList` is provided.

- **Relevant Files:** `script.js`, `email-preview-modal.js`, `request-pdf-password.ts`, `processor.ts`, `email-html.ts`.

- **Dependencies:** Airtable Meta API (add field), Airtable Data API (filter by token field), MS Graph sendMail (unchanged), activity-logger logEvent (unchanged).

## 5. Technical Constraints & Risks

- **Security:** Token is 8-char base36 via `crypto.getRandomValues` — adequate entropy for this use. No PII in token or logEvent token field. Worker validates same-client across all `record_ids` (defense-in-depth).

- **Operational Risks:** Schema migration must run before Worker deploy. Old DL-380 records have no `password_request_token`; inbound matcher drops them gracefully (returns `handled: false` when lookup returns 0 records). Test client record can be manually cleared.

- **Breaking Changes:** `buildPasswordRequestEmailHtml` signature changes from `{ filename }` to `{ filenames }` — only called from `request-pdf-password.ts`, updated together. `buildPasswordRequestEmailSubject` also updated. Modal API is additive (optional param). Worker body is backward-compat (accepts legacy `record_id` single string).

- **Mitigations:** Schema migration before deploy; back-compat on Worker body; zero-downtime (old requests with `record_id` still work during rollout window).

## 6. Proposed Solution

### Success Criteria

When a client has multiple encrypted PDFs, admin clicks "Request password" on any one card and sees a pre-checked list of all encrypted PDFs for that client; one email is sent listing all selected files; when the client replies with the password, all matched `pending_classifications` records get `suggested_password` set.

### Logic Flow

1. Admin clicks "Request password" kebab on an encrypted card.
2. `requestPdfPassword(recordId)` scans `aiClassificationsData` for all encrypted siblings (same `client_id`, regex match on `ai_reason`, no `password_request_sent_at`).
3. If N=1: open modal without checkbox list (DL-380 unchanged). If N≥2: open modal with `selectionList` showing all N files pre-checked.
4. Admin can uncheck files; modal debounces 250ms and re-fetches preview with updated `record_ids`.
5. Admin clicks "שלח בקשה" → `onAction` POSTs `record_ids` to Worker.
6. Worker generates one 8-char token, fetches all records, validates same `client_id`, builds email with bulleted filename list, sends ONE email, writes `password_request_token` + `password_request_sent_at` to ALL records.
7. Client replies → inbound processor matches `[#PWD-token]` in subject OR body → filters `pending_classifications` by `{password_request_token}=token` → writes `suggested_password` + `password_reply_raw` to EACH matched record.
8. All matched AI Review cards show the suggested-password chip.

### Data Structures / Schema Changes

- New field `password_request_token` (singleLineText) on `pending_classifications` (`tbloiSDN3rwRcl1ii`).
- No migration of existing rows (null = no batch, handled gracefully).

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `scripts/dl382-add-token-field.py` | Create | Schema migration: add `password_request_token` field |
| `api/src/routes/request-pdf-password.ts` | Modify | Batch support: `record_ids[]`, token generation, multi-record update |
| `api/src/lib/inbound/processor.ts` | Modify | Lookup by token field; fan-out write to all matched records |
| `api/src/lib/email-html.ts` | Modify | `filenames: string[]`; bulleted list for N≥2; token param replaces recordIdShort |
| `frontend/shared/email-preview-modal.js` | Modify | Optional `selectionList` param; nested checkboxes above preview iframe |
| `frontend/admin/js/script.js` | Modify | `requestPdfPassword`: collect siblings, pass selectionList, update all in-memory |
| `frontend/admin/index.html` | Modify | Cache-bust `script.js?v=382` |

### Final Step

- Update status → `[IMPLEMENTED — NEED TESTING]`
- Update INDEX.md
- Copy Section 7 items to `current-status.md`
- Invoke `git-ship` for commit/push/merge
- Run schema migration, deploy Worker, deploy Pages

## 7. Validation Plan

- [ ] Schema migration runs idempotently (second run prints "already exists")
- [ ] N=1: modal has no checkbox list; DL-380 flow is unchanged
- [ ] N≥2: modal shows parent + child checkboxes all pre-checked; ONE email sent listing all files
- [ ] Uncheck one file → 250ms debounce → preview re-fetches with updated list
- [ ] Inbound reply fans out: both records get `suggested_password` set; both cards show chip
- [ ] Inbound reply + attachment: password written AND normal classification pipeline runs
- [ ] New encrypted file after batch: only the new file appears in kebab selection (sent ones filtered)
- [ ] Mixed-client POST → Worker returns 400 `mixed_clients`
- [ ] Empty `record_ids` POST → Worker returns 400 `no_records`
- [ ] XSS-safe: `<script>` in filename escapes correctly in preview HTML
- [ ] Cache-bust: `docs.moshe-atsits.com` serves `script.js?v=382` post-deploy

## 8. Implementation Notes

- `buildPasswordRequestEmailHtml` signature changed: `{ filename, recordIdShort }` → `{ filenames, token }`. Footer now uses `token` (random 8-char) instead of record ID suffix.
- `buildPasswordRequestEmailSubject` removed (was unused; subject built inline in route).
- Curly-quote bug: the Write tool substituted ASCII single quotes with Unicode curly quotes in `email-html.ts`. Fixed with `python3 -c "data.replace(b'\xe2\x80\x98', b\"'\")..."` before tsc check.
- `processor.ts`: removed the `records.length > 1` guard that blocked multi-record lookups — was necessary for DL-380 safety but is the desired behavior for DL-382 batches.
- `email-preview-modal.js`: `internalSelectedIds` tracks checkbox state; preview fetch always uses the current selection; `selectionList.onChange` callback keeps `currentIds` in `requestPdfPassword` in sync for the eventual send POST.
- Existing callers of `showEmailPreviewModal` (approve-and-send flow, doc-manager) are unaffected — `selectionList` is optional.
