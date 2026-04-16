# Design Log 224: Doc Lookup Fix + Dropdown Dedup + Reassign Conflict Dialog
**Status:** [COMPLETED]
**Date:** 2026-03-29
**Related Logs:** DL-222 (multi-PDF approve conflict), DL-070 (reassign guard)

## 1. Context & Problem
Three issues found during DL-222c testing:

**Bug 1:** When approving a classification with no direct `document` link, the template lookup formula uses `type + report` only with `maxRecords: 1`. For multi-issuer templates like T601 (form 867), this returns an arbitrary match — often an already-Received doc, causing a false conflict.

**Bug 2:** After approving a doc, the reassign dropdown for other cards still shows that doc. `updateClientDocState` uses `approvedItem.matched_doc_record_id` which is null when the backend resolved via template lookup (not direct link).

**Bug 3:** Reassign conflict dialog only showed "override" (DL-070 legacy). Should show the same 3-option dialog as approve (merge/keep-both/override from DL-222c).

**Enhancement:** Reassign/approve dropdown should show ALL client docs (not just missing), with received ones marked with a checkmark badge. Still selectable — selecting a received doc triggers the conflict flow.

## 2. User Requirements
1. **Q:** Should fix apply to keep-both counting too?
   **A:** Yes — fix both lookup and keep-both counting.
2. **Q:** How should received docs appear in dropdown?
   **A:** Show with checkmark badge, muted opacity, still selectable (triggers conflict flow).
3. **Q:** Should reassign conflict have merge/keep-both/override?
   **A:** Yes — same 3-option dialog as approve.

## 3. Research
Skipped — targeted bugfix extending DL-222.

## 4. Codebase Analysis
* **Root cause (Bug 1):** `classifications.ts:413` — formula with `maxRecords: 1` returns arbitrary match among same-type docs
* **Root cause (Bug 2):** `script.js:3297` — uses `approvedItem.matched_doc_record_id` (from initial load) instead of response `doc_id` (resolved by backend)
* **Root cause (Bug 3):** `script.js:3506` — reassign conflict used `showConfirmDialog` (single override button) instead of `showApproveConflictDialog` (3 options)
* **Existing:** Backend already returns `doc_id` in response (line 855). `showApproveConflictDialog` already exists and is reusable.

## 5. Technical Constraints & Risks
* **Risk:** Airtable formula escaping — single quotes in Hebrew issuer names could break formula. Mitigated with `.replace(/'/g, "\\'")`
* **Edge case:** If all docs of a type are already Received, conflict triggers correctly (no Required_Missing to prefer)

## 6. Proposed Solution (The Blueprint)
### Changes

**Backend (`api/src/routes/classifications.ts`):**
1. **Approve template lookup** — Fetch ALL docs of type+report (not `maxRecords: 1`), prefer `Required_Missing` over `Received`. Only falls back to Received doc if none are missing (real conflict).
2. **Keep-both part counting** — Add issuer_name clause so "חלק 2" counts only same-issuer docs.
3. **Reassign conflict guard** — Return `conflict_existing_name` and `conflict_new_name` (was missing, needed for 3-option dialog).
4. **Reassign conflict resolution** — Full merge/keep-both/override branching (mirrors approve logic).

**Frontend (`admin/js/script.js`):**
1. **Dropdown data source** — Feed `all_docs` instead of `missing_docs` to combobox. Received docs get checkmark badge.
2. **Approve response handling** — Use `data.doc_id` from API response for `updateClientDocState` (not stale `matched_doc_record_id`).
3. **Reassign conflict dialog** — Replace `showConfirmDialog` with `showApproveConflictDialog` (3 options).
4. **`resubmitReassign()` function** — New function mirroring `resubmitApprove()` for reassign conflict resolution.

**CSS (`admin/css/style.css`):**
1. `.doc-combobox-option.doc-received` — muted opacity (0.6), hover 0.85
2. `.received-badge` — checkmark emoji badge

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | Prefer Required_Missing in lookup, reassign merge/keep-both/override |
| `github/.../admin/js/script.js` | Modify | All docs in dropdown, response doc_id, 3-option reassign dialog |
| `github/.../admin/css/style.css` | Modify | Received doc badge styles |

## 7. Validation Plan
* [ ] Approve doc → no false conflict when another same-type doc exists with different issuer
* [ ] Approve doc → correct doc is matched (Required_Missing preferred over Received)
* [ ] After approval, reassign dropdown on remaining cards shows approved doc with checkmark
* [ ] Reassign to received doc → 3-option dialog (merge/keep-both/override) appears
* [ ] Reassign merge → merged PDF on OneDrive, doc record updated
* [ ] Reassign keep-both → new doc record with "חלק 2" suffix
* [ ] Reassign override → existing file replaced
* [ ] Keep-both with same issuer → part numbering correct
* [ ] Regression: single-issuer templates still work normally
* [ ] Regression: approve conflict flow still works (3-option dialog)

## 8. Implementation Notes (Post-Code)
* API versions: `ed43c2ec` (initial), `98be408e` (prefer Required_Missing), `39d5442f` (reassign merge/keep-both)
* Frontend commits: `70d35c6` (doc_id dedup), `0e2885c` (all docs + badge), `05392be` (reassign 3-option dialog)
* Template lookup changed from `maxRecords: 1` to fetching all + preferring Required_Missing — this is more correct than issuer matching, since the real concern is approving to an already-received doc, not which issuer it is
* Reassign conflict resolution mirrors approve logic exactly (merge via pdf-lib, keep-both creates new doc record, override overwrites)
