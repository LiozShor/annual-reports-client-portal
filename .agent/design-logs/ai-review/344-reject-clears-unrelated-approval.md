# Design Log 344: Reject Clears Unrelated Approval on Same Source Doc
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-25
**Related Logs:** DL-248 (same pattern fixed for reassign), DL-205 (clear file fields on status revert), DL-210 (review bugfixes), DL-319 (approve creates required doc)

## 1. Context & Problem

**Bug report:** CPA-XXX. Admin approved `IMG_0557.jpeg` as ID appendix (`T002`). AI-review card shows "אושר" (approved). Admin panel + client portal still list ID appendix as a missing required document with no file.

**Forensic timeline** (Airtable, classifications + doc state):

| time (UTC)   | classification     | action  | file           |
|--------------|--------------------|---------|----------------|
| 15:05:47.301 | recNqeHbaEGIjfW3Y  | approve | IMG_0557.jpeg  |
| 15:06:03.115 | recjyfBaCKTYzsJb4  | reject  | IMG_0558.jpeg  |
| 15:06:13.084 | recZlP8al1HhQZQyU  | reject  | IMG_0559.jpeg  |

All three classifications were AI-matched to `T002` from the same email and pre-linked by WF05 to the same DOCUMENTS row `recpvynrLkdhO1Aiz`. Approve ran `classifications.ts:1455-1481` → flipped doc to `Received` with IMG_0557's `file_url`/`onedrive_item_id`/`file_hash`. The two subsequent rejects ran `classifications.ts:1495-1516`, which **unconditionally** PATCHes `status='Required_Missing'` and nulls `file_url`, `onedrive_item_id`, `file_hash`, `review_status`, `reviewed_at`, etc. — wiping the file IMG_0557 had just put on the doc.

Final doc state matches the wipe: classification `approved`, doc `Required_Missing`, no file. Classification `recNqeHbaEGIjfW3Y.document` still set (it was pre-linked at WF05 time, never touched by reject), so AI-review card shows "approved" but the doc surfaces as missing in required-docs lists.

## 2. User Requirements

No discovery questions needed — deterministic root cause established by inspecting Airtable state. User confirmed:
- ID appendix was already `Required_Missing` before approve.
- Approve button used was the plain "נכון" (regular approve, not the DL-319 add-to-required path).
- Single-filer report (no person dimension).

## 3. Research

### Domain
State-machine side-effects, concurrent-write safety, idempotent state transitions. Same anti-pattern DL-248 fixed for reassign.

### Sources Consulted
1. **DL-248** (prior research on this exact pattern) — Identifies the "blind clear" anti-pattern when multiple classifications share one source doc. Reuses its `srcItemId !== clsItemId` guard verbatim.
2. **Bernstein & Newcomer — *Principles of Transaction Processing*** (chapter on isolation anomalies) — Multi-row writes that "own" a row need ownership predicates; without them, later writers stomp earlier writers' state.
3. **Microsoft — Idempotent Receiver pattern** — Reject is conceptually a *no-op* on a doc whose current file isn't the one being rejected; the operation should still be acknowledged but must not mutate state.

### Key Principles Extracted
- **Ownership predicate before mutation** — A handler that clears a shared resource must verify it owns the resource's current state. The classification's `onedrive_item_id` is the ownership proof.
- **Reject is doc-state-neutral when the rejected file isn't on the doc** — The classification's `review_status` flips to `rejected`, but the doc keeps whatever the latest legitimate approve put on it.
- **Skip ≠ silent failure** — Log a structured message at the skip point so future debugging finds the conditional path immediately (DL-248 mirror).

### Patterns to Use
- **DL-248 guard pattern, copied** to the reject branch — keeps both branches in lock-step semantically; future audits only need to verify two locations match.

### Anti-Patterns to Avoid
- **Skipping `rejected_uploads_log` append** when we skip the doc clear — the rejection itself is real and must be logged for the client-facing rejection trail. Only the doc PATCH is conditional.
- **Reverting the classification to `pending`** — admin pressed reject, that's their authoritative answer; their action shouldn't be silently undone because the doc state happens to be already-approved.

### Research Verdict
Add an ownership-predicate guard to the reject branch's doc PATCH, mirroring DL-248. Keep the rest of the reject flow (classification PATCH, OneDrive ops, rejected_uploads_log append) unchanged.

## 4. Codebase Analysis

### Existing Solutions Found
- DL-248 implementation at `api/src/routes/classifications.ts:1582-1612` is a textbook reusable guard. Copy its `srcItemId`/`clsItemId` derivation and skip-log into the reject branch.

### Reuse Decision
- **Backend:** copy DL-248 guard directly into reject branch (5-7 lines). No new helper extraction warranted — two sites, parallel logic, refactoring would over-abstract.
- **Frontend:** unchanged. Reject UX already correct.

### Relevant Files
- `api/src/routes/classifications.ts`
  - Reject branch L1483-1517 (target).
  - Reassign guard reference L1582-1612.
  - Approve standard branch L1442-1481 (writes the state reject was wiping).
  - Step 5 classification PATCH L1775-1786 (always sets `review_status='rejected'`, untouched).
  - Step 6 OneDrive ops L1791-1933 — already correct: `moveToArchive = await isLastReference(...)` at L1843 only archives the rejected file if no other doc references it.

### Existing Patterns
- DL-248 reassign guard.
- DL-314 `isLastReference()` already protects OneDrive deletes — the file-system side is safe.
- WF05 pre-links every AI classification to its matched doc, which is the upstream cause of multiple classifications sharing one doc.

### Alignment with Research
- DL-248 reassign + DL-344 reject = full coverage of the "shared source doc" multi-classification scenarios. Approve doesn't need the guard (it's the writer, not the clearer).

### Dependencies
- Airtable DOCUMENTS table; CLASSIFICATIONS table.
- Cloudflare Workers — Worker deploys independently of main.

## 5. Technical Constraints & Risks

- **Security:** No auth surface change.
- **Risks:**
  - Edge case: classification has no `onedrive_item_id` (e.g., synthetic test row). Behavior: `srcItemId && srcItemId !== clsItemId` short-circuits on `clsItemId` being falsy → guard does NOT trigger → doc clear runs as before. Safe.
  - Edge case: doc has no `onedrive_item_id` (Required_Missing target, never approved). Behavior: `srcItemId` is falsy → guard does NOT trigger → doc clear runs (which is a no-op on already-Required_Missing fields). Safe.
  - Edge case: legitimate "unapprove" (admin rejects the previously-approved file). Behavior: `srcItemId === clsItemId` → guard does NOT trigger → doc clear runs → doc returns to Required_Missing. **Correct** — this is the intended unapprove flow.
- **Breaking changes:** none.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
After deploy, in the 3-classification scenario (approve A → reject B → reject C, all linked to same doc): doc stays `Received` with A's file. Reject branch correctly distinguishes "reject the file currently on the doc" (does the clear) from "reject a different file that happened to be linked to the same doc" (skips the clear).

### Logic Flow

In `api/src/routes/classifications.ts` reject branch (around L1495-1516), before the inline PATCH:

1. Resolve `srcDoc` (use `sourceDoc` if already loaded at L568, else `airtable.getRecord(TABLES.DOCUMENTS, docId)`).
2. Compute `srcItemId = srcDoc.fields.onedrive_item_id`, `clsItemId = clsFields.onedrive_item_id`.
3. If `srcItemId && srcItemId !== clsItemId`: log `[review-classification] reject: skip clear — source doc has different file` with `{docId, srcItemId, clsItemId}`. Skip the doc PATCH.
4. Else: run the existing PATCH (unchanged).
5. Continue to `rejected_uploads_log` append (L1519-1576) — runs in both paths.
6. Continue to Step 5 classification PATCH (L1775) — runs in both paths, sets `review_status='rejected'`.
7. Step 6 OneDrive ops unchanged — `isLastReference()` already protects against archiving a file referenced by other docs.

### Data Structures / Schema Changes
None.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | Reject branch L1495-1516: wrap PATCH in DL-248-style guard. ~7 lines added. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-344 entry under ai-review. |
| `.agent/design-logs/ai-review/344-reject-clears-unrelated-approval.md` | Create | This file. |

### Final Step (Always)
- Update DL-344 status → `[IMPLEMENTED — NEED TESTING]`.
- Copy unchecked Section 7 items into `.agent/current-status.md` under "Active TODOs".
- Commit + push feature branch `DL-344-ai-review-approve-not-clearing`.
- `wrangler deploy` from `api/` on the feature branch.
- Manually repair CPA-XXX doc `recpvynrLkdhO1Aiz` via direct Airtable PATCH (data preserved on classification `recNqeHbaEGIjfW3Y`).
- Tell user frontend isn't affected; backend deployed; pause for merge approval.

## 7. Validation Plan

- [ ] `wrangler deploy --dry-run` from `api/` passes; type-check clean.
- [ ] `wrangler deploy` from feature branch + brief `wrangler tail` — no boot errors.
- [ ] Curl trace: synthetic 3 classifications pre-linked to same doc → approve A → reject B → reject C → doc remains `Received` with A's file. Each reject also produces a `rejected_uploads_log` entry.
- [ ] Curl: reject the same classification that was approved → doc DOES clear (regression: legitimate unapprove still works).
- [ ] Curl: reject when classification has no `onedrive_item_id` → doc clears (guard short-circuits on falsy).
- [ ] Manual repair of `recpvynrLkdhO1Aiz` post-deploy: PATCH with status=Received + IMG_0557's file_url/item_id/hash from `recNqeHbaEGIjfW3Y`. Verify admin panel + client portal show ID appendix as Received.
- [ ] Regression: typical reject (single classification on doc, wrong file) still clears the doc and adds `rejected_uploads_log`.
- [ ] Regression: DL-248 reassign guard still works as before (untouched code path).

## 8. Implementation Notes (Post-Code)

Implemented 2026-04-25 on branch `DL-344-ai-review-approve-not-clearing` (worktree `claude-session-20260425-083530`).

**Backend (`api/src/routes/classifications.ts`):**
- Reject branch (around L1511-1535): wrapped the inline doc PATCH in a DL-344 guard. Resolves `srcDocForGuard` (reuses `sourceDoc` if loaded at L568, else fetches), compares `srcItemId` vs `clsItemId`, sets `rejectSkipClear = true` and logs the skip when they differ. Doc PATCH only runs when `!rejectSkipClear`.
- `docTitle` assignment kept at original location (after the guard block, regardless of skip) — preserves existing response shape.
- `rejected_uploads_log` append (L1519-1576) untouched — runs in both paths.
- Step 5 classification PATCH (L1775) untouched — `review_status='rejected'` still set in both paths.
- Step 6 OneDrive ops untouched — `isLastReference()` already protects the file from being archived if other docs reference it.
- `wrangler deploy --dry-run` from `api/` clean. `tsc --noEmit` reports only pre-existing unrelated errors (backfill.ts, edit-documents.ts, preview.ts) — no new errors in the touched region.

**Manual repair (CPA-XXX):** Pending — to be done post-deploy by PATCHing `recpvynrLkdhO1Aiz` with IMG_0557 file data still preserved on classification `recNqeHbaEGIjfW3Y`. See Section 7.

**Research principles applied:**
- DL-248 ownership-predicate guard pattern, copied verbatim to reject. Two-site-mirror chosen over helper extraction — readability over premature abstraction.
- Reject is doc-state-neutral when the rejected file isn't on the doc — guard skips doc mutation but classification still flips to `rejected`.
