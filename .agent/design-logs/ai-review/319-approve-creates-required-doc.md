# Design Log 319: Approve-as-Required — flip DL-057 disabled button into active "add-to-required + approve"
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-21
**Related Logs:** 057 (Disable Approve for Unrequested Docs), 058 (Add New Custom Doc from AI Review), 314 (Multi-Template Match)

## 1. Context & Problem

When the AI classifier matches a file to a template that is **not in the client's required-docs list** (`item.is_unrequested === true`), DL-057 disabled the "נכון" (approve) button with a tooltip telling admin to reassign or reject instead. That prevented orphaned files at the time because the approve endpoint had no way to create a required-doc record — it could only update an existing one.

In practice admins hit this case regularly: the AI is often right, but the template just wasn't pre-listed for this client. Admin then has to open the reassign modal and DL-058's "+ add new doc" path just to accept what the AI already got right. That's friction for the common case.

We now want the button to stay **active** with a descriptive label — **"נכון - הוסף מסמך זה לרשימת המסמכים הדרושים"** — and on click, atomically (a) create a required-doc record of the AI-matched template type and (b) run the normal approve flow that attaches the file to that new record.

## 2. User Requirements

1. **Q:** Is the intent to keep the button active (not just relabel the disabled text), and have a single click add-to-required + approve atomically?
   **A:** Yes — relabel + add-then-approve.
2. **Q:** Which template_id gets added to the required list when admin clicks?
   **A:** The AI-classified `matched_template_id` (no admin prompt).
3. **Q:** Which card states get this new active button?
   **A:** Full-match and fuzzy-match only. NOT issuer-mismatch (admin must still reassign). NOT the mobile preview drawer.
4. **Q:** Backend approach?
   **A:** Extend the existing `/webhook/review-classification` approve action with a `create_if_missing: true` flag + `template_id` — single atomic round-trip, no two-step frontend dance.

## 3. Research

### Domain
Admin-panel UX: descriptive action labels for state-changing ops, progressive disclosure (visibility over hiding), atomic composite actions.

### Sources Consulted
1. **NN/g — Split Buttons & Button Labels** ([nngroup.com/articles/split-buttons](https://www.nngroup.com/articles/split-buttons/)) — Descriptive verb+object labels outperform generic "OK". A button's label is the main signifier.
2. **NN/g — Progressive Disclosure** ([nngroup.com/articles/progressive-disclosure](https://www.nngroup.com/articles/progressive-disclosure/)) — Surface actions the user needs; don't hide them when there is a valid path.
3. **LogRocket — Confirmation Dialog UX** ([blog.logrocket.com/ux-design/double-check-user-actions-confirmation-dialog](https://blog.logrocket.com/ux-design/double-check-user-actions-confirmation-dialog/)) — Confirmations are for destructive/irreversible actions. Reversible state changes should click-through.
4. **DL-057** (prior research on disabled states) — `aria-disabled` + inline explanation still holds for the fallback case (unrequested + no matched template).

### Key Principles Extracted
- **Descriptive label > disabled+tooltip** when a valid action path exists. "נכון - הוסף מסמך זה לרשימת המסמכים הדרושים" literally tells admin what the click will do.
- **Atomic composite actions** — when one UI click triggers two backend ops (create + update), perform them in a single backend transaction to avoid partial-state bugs (doc added but approve fails → orphaned required row).
- **Reversible ⇒ no confirm dialog** — adding a required doc + attaching the file is fully reversible (admin can delete the doc or revert status). A modal confirm would add friction without safety value.
- **Preserve the disable-fallback** for the unrecoverable case: `is_unrequested === true` AND `matched_template_id` is empty (unmatched file). There's no template to add in that case — DL-057 behavior still applies.

### Patterns to Use
- **Action flag on existing endpoint**: `create_if_missing: true` + `template_id` on the approve body, same route. Matches DL-314's `also_match` precedent (new action/flag, no new route).
- **Reuse doc-creation helper**: DL-314's also_match branch (`classifications.ts` ~L971-1117) already creates template-based DOCUMENTS rows; reuse that code path.

### Anti-Patterns to Avoid
- **Two-step frontend (create, then approve)** — non-atomic, admin sees partial state on approve failure, harder rollback.
- **Confirm modal** — action is reversible and admin has already read the descriptive label.
- **New route `/approve-as-required`** — fragments the approve surface; one endpoint with action flags is the established pattern here.

### Research Verdict
Flip DL-057's `disabled` to an active button with a descriptive Hebrew label, backed by a single atomic approve+create call. Keep DL-057's disabled behavior as the fallback for the residual unrecoverable case (unrequested + no matched template). This is an evolution of DL-057, not a reversal: the backend's new capability removes the orphan-file risk that motivated the original disable.

## 4. Codebase Analysis

### Existing Solutions Found
- `classifications.ts` approve action (~L1119-1170) already looks up a DOCUMENTS row by `matched_template_id` + `report`; returns 400 if none found. We intercept that 400 branch with the new flag.
- `classifications.ts` also_match action (~L971-1117, DL-314) already creates DOCUMENTS rows for additional targets. Reuse its creation logic.
- `classifications.ts` reassign action (~L1450-1475) has the general_doc and template-based doc creation patterns for reference.
- Frontend `approveAIClassification()` (`frontend/admin/js/script.js` ~L4790-4837) is the wrapping call — new `approveAIClassificationAddRequired(recordId, templateId)` mirrors it with the extra body fields.
- Card render sites: full-match (~L4287) and fuzzy-match (~L4394). Both compute `approveDisabled = item.is_unrequested`. `item.matched_template_id` is already exposed.

### Reuse Decision
- **Backend**: extract the template-doc creation (whether from also_match or reassign branches) into a shared helper if not already; call it from approve when `create_if_missing` is true.
- **Frontend**: duplicate `approveAIClassification` into a thin wrapper passing the new fields — do NOT rewrite the existing function or factor prematurely.

### Relevant Files
- `frontend/admin/js/script.js` — card render (~L4285-4301, ~L4392-4408) and approve fn (~L4790-4837).
- `api/src/routes/classifications.ts` — approve action (~L1119-1170), also_match reference (~L971-1117), reassign reference (~L1406-1475), `is_unrequested` computation (~L339).
- `api/src/lib/airtable.ts` (or equivalent) — `createRecords`/`listAllRecords` helpers already used by this file.

### Existing Patterns
- Body-flag action branching (DL-314 `also_match`, DL-239 `target_report_id`, DL-058 `new_doc_name`) — single POST, action+flag determines behavior.
- Airtable `typecast: true` is supported — unknown template_ids as `type` select options won't crash.
- `createRecords` race winner pattern (DL-112) — relevant if two admins click simultaneously.

### Alignment with Research
- DL-314's action-flag pattern aligns with "atomic composite action" principle.
- DL-057's `aria-disabled` fallback aligns with NN/g visibility-over-hiding for the unmatched case.

### Dependencies
- Airtable DOCUMENTS table (`type`, `report`, `status`, `issuer_name`, `document_uid`, `person`, `category`).
- Airtable CLASSIFICATIONS table (existing approve path).
- Cloudflare Workers deploy (independent of main; frontend needs merge to main for GitHub Pages).

## 5. Technical Constraints & Risks
- **Security**: existing HMAC token check on `/webhook/review-classification` already covers this action. No new auth surface.
- **Risks**:
  - If `template_id` passed from frontend disagrees with the classification's `matched_template_id` server-side, creating the "wrong" required doc is a minor footgun → backend should re-validate: when `create_if_missing` is true, cross-check `body.template_id` against the classification's own `matched_template_id` and prefer the server-side value.
  - Race: two admins clicking near-simultaneously could create duplicate DOCUMENTS rows. Mitigate by re-querying after create, or use `performUpsert` on `document_uid` if the table supports it (per DL-112 pattern).
  - Unknown `type` select option: Airtable `typecast: true` handles it (per MEMORY.md note) but produces a new select option — acceptable.
- **Breaking changes**: none. Existing behavior of `approveAIClassification` unchanged; `create_if_missing` is opt-in.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Admin clicks "נכון - הוסף מסמך זה לרשימת המסמכים הדרושים" on a full-match or fuzzy-match card for an unrequested doc; the classification leaves the review queue, a new DOCUMENTS row with `status='Received'` and the correct template `type` appears linked to that report, and the file is attached with the same semantics as a normal approve — in one click, no modal.

### Logic Flow

**Frontend (script.js):**
1. In full-match card render (~L4285): compute `addToRequired = item.is_unrequested && !!item.matched_template_id`.
2. If `addToRequired`: emit active green button with label "נכון - הוסף מסמך זה לרשימת המסמכים הדרושים" and onclick `approveAIClassificationAddRequired(item.id, item.matched_template_id)`.
3. Else if `item.is_unrequested` (no matched template — unmatched file): keep DL-057's `aria-disabled` button.
4. Else (doc IS required): unchanged — existing `approveAIClassification(item.id)` onclick with plain "נכון" label.
5. Repeat identically in fuzzy-match card render (~L4392).
6. Add `approveAIClassificationAddRequired(recordId, templateId)` near `approveAIClassification` — same POST shape plus `create_if_missing: true` and `template_id: templateId`; same conflict/error/card-transition handling.

**Backend (classifications.ts, approve action ~L1119):**
1. Accept new body fields: `create_if_missing?: boolean`, `template_id?: string`.
2. After fetching the classification record (existing logic), look up target doc by `matched_template_id` + report (existing ~L1133).
3. If no doc found AND `create_if_missing === true`:
   a. Validate `body.template_id` is non-empty; otherwise 400.
   b. Cross-check `body.template_id` against the classification's `matched_template_id` — prefer server-side value if mismatch.
   c. Call `createRequiredDocForTemplate(airtable, reportId, templateId)` — reuses the also_match creation pattern. Row fields: `type`, `report: [reportId]`, `status: 'Required_Missing'`, plus template-derived `issuer_name`/`category`/`person` the same way also_match derives them.
   d. Re-query to handle race (returned row wins).
4. Proceed with the existing approve flow (file attach, status → `Received`, classification `review_status: 'approved'`) — zero change to the success path after the doc exists.
5. If no doc found AND `create_if_missing !== true`: existing 400 behavior (unchanged).

### Data Structures / Schema Changes
No schema changes. New optional body fields on existing endpoint. New DOCUMENTS rows created follow existing column conventions.

### Files to Change

| File | Action | Description |
|---|---|---|
| `frontend/admin/js/script.js` | Modify | Full-match card (~L4285) + fuzzy-match card (~L4392): add `addToRequired` branch with new label + new onclick. Preserve unmatched fallback. |
| `frontend/admin/js/script.js` | Modify | Add `approveAIClassificationAddRequired(recordId, templateId)` near existing `approveAIClassification`. |
| `api/src/routes/classifications.ts` | Modify | Approve action (~L1119-1170): accept `create_if_missing`/`template_id`, create doc row when missing, reuse also_match doc-creation helper (extract if needed). Validate inputs. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-319 entry under ai-review section. |

### Final Step (Always)
- **Housekeeping:** Update DL-319 status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items into `.agent/current-status.md` under "Active TODOs", commit + push feature branch, `wrangler deploy` from `api/` on the feature branch (Workers deploy independently of main), tell user frontend requires merge-to-main for GitHub Pages go-live.

## 7. Validation Plan
- [ ] `wrangler deploy` from feature branch succeeds; `wrangler tail` briefly — no boot errors
- [ ] curl approve endpoint: `{action:'approve', create_if_missing:true, template_id:'T1501', classification_id:...}` → 200, new DOCUMENTS row with `type='T1501'`, `status='Received'`; classification row marked approved
- [ ] curl: `create_if_missing:true` with empty `template_id` → 400 with clear error
- [ ] curl: `create_if_missing:true` when a doc of that template already exists for the report → uses existing row, no duplicate created
- [ ] curl: mismatched `body.template_id` vs classification's `matched_template_id` → server uses `matched_template_id` and logs the mismatch
- [ ] Admin UI: full-match card with unrequested doc shows active green button with "נכון - הוסף מסמך זה לרשימת המסמכים הדרושים"; click completes end-to-end (doc appears in Document Manager as Received, card leaves queue)
- [ ] Admin UI: fuzzy-match card — same end-to-end
- [ ] Admin UI: regular required-doc approve still shows plain "נכון" and uses `approveAIClassification`
- [ ] Admin UI: unmatched card (`is_unrequested=true`, no `matched_template_id`) still shows disabled button (DL-057 fallback)
- [ ] Regression: issuer-mismatch card (~L4654) unchanged — still disabled for unrequested per DL-057
- [ ] Regression: mobile preview drawer (~L667) unchanged
- [ ] Regression: conflict flow (target doc already Received) still returns 409 and surfaces conflict modal

## 8. Implementation Notes (Post-Code)

Implemented 2026-04-21 on branch `claude-session-20260421-091040`.

**Backend (`api/src/routes/classifications.ts`):**
- Added `create_if_missing?: boolean` and `template_id?: string` to the request body schema (L454-472).
- Inserted a DL-319 block (L1155-1195) between the existing template-lookup (L1136) and the "no doc found" 400 return (now further down). Block is guarded on `!approveDocId && create_if_missing === true`.
- Validates `template_id` is a non-empty string → 400. Validates `reportId` exists on the classification → 400.
- Server-side `clsFields.matched_template_id` wins over the client body value; mismatch logged via `console.warn`.
- Race guard: re-queries `TABLES.DOCUMENTS` (same `{report_record_id}` filter as L1136) before create; if a concurrent request already made the row, uses it. Otherwise creates a minimal row with `{type, report: [reportId], status: 'Required_Missing'}` + `typecast: true`.
- **No helper extraction from also_match** — the also_match branch creates `general_doc` rows (different shape), so there was no existing template-doc-creation helper to reuse. Deviation from the plan's "extract-or-call helper" guidance; noted because the new create is 10 lines and doesn't duplicate anything that also_match already does.
- Typecheck: no new errors (2 pre-existing errors unrelated). `wrangler deploy --dry-run` passes.

**Frontend (`frontend/admin/js/script.js`):**
- Full-match card (L4285-4295) and fuzzy-match card (L4396-4407): added `addToRequired`/`fuzzyAddToRequired = item.is_unrequested && !!item.matched_template_id`. Button is a three-way render: addToRequired → active `approveAIClassificationAddRequired` call with full Hebrew label; else approveDisabled → DL-057 disabled fallback (unchanged); else → plain `approveAIClassification` (unchanged).
- `approveAIClassificationAddRequired(recordId, templateId)` added at L4846. Mirrors `approveAIClassification` (same `showInlineConfirm`, `setCardLoading`, `_conflict` / `showApproveConflictDialog`, `transitionCardToReviewed`, `showAIToast`, `showModal('error', ...)` flow) with `create_if_missing: true` + `template_id: templateId` added to the POST body. Inline confirm label: "לאשר ולהוסיף לרשימת המסמכים הדרושים?".
- `node --check frontend/admin/js/script.js` exits 0. Hebrew label appears 2× (one per card render) as expected.
- `approveAIClassification` untouched. Mobile preview drawer (L667) and issuer-mismatch card (L4654) untouched per scope.

**Research principles applied:**
- NN/g descriptive-label principle — the button literally states the two operations it performs.
- Atomic composite action — single backend call rather than two sequential frontend calls; server-side `matched_template_id` enforced to prevent client spoofing.
- DL-057 disabled fallback preserved for the unrecoverable case (`is_unrequested && !matched_template_id`).
