# Design Log 355: OneDrive Rename — Always Use `short_name_he`, Strip Empty `{issuer}`, Fix Bypass Paths
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-26
**Related Logs:** [137-fix-onedrive-rename-extension-and-title](137-fix-onedrive-rename-extension-and-title.md), [296-wf02-extract-issuer-names](../infrastructure/296-wf02-extract-issuer-names.md), [115-pdf-conversion-before-onedrive-upload](115-pdf-conversion-before-onedrive-upload.md), [049-onedrive-file-ops-rename-move](049-onedrive-file-ops-rename-move.md)

## 1. Context & Problem
OneDrive filenames are inconsistent across the same template. Live observations:

| Observed | Expected |
|---|---|
| `טופס 106 – טופס 106.pdf` (T201) | `טופס 106 – פלייטיקה בעמ.pdf` (or `טופס 106.pdf`) |
| `דוח שנתי מקוצר – אישור שנתי למס הכנסה לשנת {year} (נקרא גם דוח שנתי...).pdf` | `דוח שנתי מקוצר – {issuer}.pdf` |
| `דוח שנתי מקוצר – קרן השתלמות – מור.pdf` ✅ | (already correct — proves the path works when fed bold `<b>...</b>` issuers) |

Two distinct root causes:
1. **No-bold fallback duplication** in `buildShortName` (`api/src/lib/classification-helpers.ts:95-97`): when `issuerName` has no `<b>...</b>` tag, the entire string was pushed into `boldSegments`. Approve passes `matched_doc_name = "טופס 106"` (template name only), which then substitutes into the `{issuer}` slot of a `"טופס 106 – {issuer}"` pattern → `"טופס 106 – טופס 106"`.
2. **Bypass paths not using `buildShortName`**: 4 of 6 OneDrive write paths skipped the canonical helper:
   - admin upload (`upload-document.ts`) — used raw `issuer_name || expected_filename || 'document'`
   - inbound classification (`processor.ts`) — used `HE_TITLE` map directly
   - PDF split initial upload — used `attachment_name`
   - PDF split post-classify rename — used `HE_TITLE + issuer` directly

A separate user complaint surfaced mid-implementation: Documents records show empty `issuer_name`/`expected_filename` after approve. Root cause: the post-rename PATCH only wrote `file_url` + `onedrive_item_id` — never propagated the classification's identity fields to the parent Document record.

## 2. User Requirements
1. **Q:** What should the canonical filename format be?
   **A:** Compact `{short_name_he} – {issuer}.pdf` for every OneDrive write path. The `short_name_he` table in Airtable is correct as-is — only audit it, don't modify.
2. **Q:** How should `{year}` and other unfilled placeholders be handled?
   **A:** No `{year}` should be in `short_name_he`. Strip any leftover `{varName}` cleanly.
3. **Q:** What when no real issuer is available?
   **A:** Strip the `{issuer}` placeholder + dangling separator. Produce just `{short_name_he}.pdf`. Never duplicate the template name as a fake issuer.
4. **Q:** Scope?
   **A:** All OneDrive write paths except reject→archive must use `short_name_he`. Audit Airtable templates (read-only). No backfill of historic OneDrive files.

## 3. Research
### Domain
File-naming pipelines, single-source-of-truth filename derivation, defensive substitution.

### Sources Consulted
- **DL-137** — established `buildShortName` + `HE_TITLE` fallback for approve/reassign. This DL extends to all write paths and fixes the no-bold edge case missed there.
- **DL-115** — every file converted to PDF before storage. Filename always `.pdf`.
- **DL-296** — WF02 extracts true issuers into `issuer_name_suggested`. Out of scope for naming (chip currently disabled per DL-300).
- **MS Graph PATCH /drives/{id}/items/{id}** — `?@microsoft.graph.conflictBehavior=rename` resolves duplicates server-side; we don't need pre-flight existence checks.

### Key Principles Extracted
- **One filename helper.** Every write path goes through one function so behavior is auditable and consistent.
- **Reject empty substitutions early.** When the would-be substitution is the template title itself, don't substitute — strip.
- **Empty stripping > placeholder leaking.** A literal `{year}` in a real filename is worse than a missing year.

### Patterns to Use
- **Centralized resolver** (`resolveOneDriveFilename`) — the single funnel.
- **Echo-detection** — treat `issuerName === HE_TITLE[templateId]` (or `=== name_he` plain) as "no real issuer".

### Anti-Patterns Avoided
- Re-implementing rename logic in each route (current state — being removed here).
- Backfilling historic OneDrive files (user explicitly excluded — high blast radius for low gain).

### Research Verdict
Add `resolveOneDriveFilename` next to `buildShortName`, fix the no-bold echo case in `buildShortName` itself (so anything reading via `buildShortName` directly also benefits), and route all 4 bypass paths through the new helper.

## 4. Codebase Analysis
### Existing Solutions
- `buildShortName` (`api/src/lib/classification-helpers.ts:67-163`) — already does the placeholder substitution + bold-segment extraction. Reused as the primary path.
- `HE_TITLE` map (`classification-helpers.ts:18-34`) — fallback when `short_name_he` resolution returns null.
- `sanitizeFilename` (`classification-helpers.ts:51-54`) — strips HTML + filesystem-unsafe chars.
- `getCachedOrFetch` (`api/src/lib/cache.ts`) — KV-backed template cache (3600s TTL) reused everywhere.
- `buildTemplateMap` (`api/src/lib/doc-builder.ts`) — converts Airtable template rows → `Map<templateId, TemplateInfo>`.

### Reuse Decision
- **Reuse:** `buildShortName`, `HE_TITLE`, `sanitizeFilename`, `getCachedOrFetch`, `buildTemplateMap`.
- **Build new:** `resolveOneDriveFilename` wrapper; echo-detection branch in `buildShortName`.

### Relevant Files
| File | Why |
|---|---|
| `api/src/lib/classification-helpers.ts` | Helper changes |
| `api/src/lib/inbound/types.ts` | Add optional `templateMap` to ProcessingContext |
| `api/src/lib/inbound/processor.ts` | Inbound rename path + thread templateMap through |
| `api/src/routes/upload-document.ts` | Admin upload rename path |
| `api/src/routes/classifications.ts` | Approve / reassign / split rename paths + missing-fields PATCH |
| `scripts/audit-short-name-he.mjs` | Read-only Airtable audit |

### Dependencies
- Airtable `documents_templates` table (`tblQTsbhC6ZBrhspc`) — read for `short_name_he` / `name_he`.
- KV `CACHE_KV` — `cache:templates` key (3600s TTL).
- MS Graph PATCH on DriveItem — existing path, no new permissions.

## 5. Technical Constraints & Risks
- **Security:** No new auth surface. Inbound and admin paths already authenticated.
- **Risks:**
  - Behavior change: approve previously skipped rename for `exact`/`single` matches → those files kept their original `attachment_name`. Now they get the canonical short-name format. **This is the intended fix** but worth flagging — admins may notice the change.
  - Inbound `templateMap` fetch adds ~1 cached-KV read per email (warm) or 1 Airtable list (cold). Already done by classifier path; effectively free.
- **Breaking changes:** None at API level. File-naming is a presentation concern.

## 6. Proposed Solution

### Success Criteria
Every new OneDrive file (admin upload, inbound, approve, reassign, split) lands with `{short_name_he resolved}.pdf` — no `{year}` literal, no `template – template` duplication. Documents records carry the same `issuer_name` + `matched_doc_name` + `expected_filename` as their classification.

### Logic Flow
1. `buildShortName` adds an "issuer-is-template-echo" check at Step 3 — if input has no `<b>` tags AND equals `HE_TITLE[templateId]` / `name_he` plain / pattern with placeholders stripped, do NOT push it as a bold segment. Step 7 then strips the unfilled `{issuer}` placeholder; Step 9 cleans the dangling ` – `.
2. New `resolveOneDriveFilename({templateId, issuerName, attachmentName, templateMap, suffix?})` returns a `.pdf` filename via:
   - `buildShortName(templateId, issuerName, templateMap)` → if non-null, use.
   - Else `HE_TITLE[templateId]` (+ issuer suffix, only when issuer is not a title-echo).
   - Else sanitized `attachmentName` stem.
   - Else literal `מסמך`.
   - Optional `suffix` (e.g. T901/T902 rental period) appended before `.pdf`.
3. `ProcessingContext.templateMap` (optional) — populated once at the top of `processInboundEmail`; per-attachment `buildExpectedFilename` defers to `resolveOneDriveFilename` when present.
4. All 4 bypass paths swapped to `resolveOneDriveFilename`.
5. Approve path no longer guards behind `matchQuality !== 'exact'` — every approve normalizes the filename.
6. Documents PATCH at the end of approve/reassign also writes `issuer_name`, `matched_doc_name`, `expected_filename` (skipped on `reassign` for `issuer_name` since the target Doc already has its own).

### Files Changed
| File | Action | Description |
|---|---|---|
| `api/src/lib/classification-helpers.ts` | Modify | Empty/echo-issuer fix in `buildShortName` Step 3; new `resolveOneDriveFilename` helper at end of file. |
| `api/src/lib/inbound/types.ts` | Modify | Optional `templateMap` on `ProcessingContext`. |
| `api/src/lib/inbound/processor.ts` | Modify | Pre-fetch `templateMap` at start of `processInboundEmail`; `buildExpectedFilename` defers to `resolveOneDriveFilename` when available. |
| `api/src/routes/upload-document.ts` | Modify | Fetch templateMap, route admin upload through `resolveOneDriveFilename`. |
| `api/src/routes/classifications.ts` | Modify | Approve, reassign, split-classify rename → `resolveOneDriveFilename`. Documents PATCH propagates `issuer_name` + `matched_doc_name` + `expected_filename`. |
| `scripts/audit-short-name-he.mjs` | Create | Read-only Airtable audit. |

### Final Step (Always)
- Update DL-355 status → `[IMPLEMENTED — NEED TESTING]` ✅
- Add to INDEX
- Update `current-status.md` test TODOs
- Commit + push feature branch (pause before merge per `feedback_ask_before_merge_push`)
- Deploy Worker via `wrangler deploy` from `api/`

## 7. Validation Plan
- [ ] Run `AIRTABLE_API_KEY=... node scripts/audit-short-name-he.mjs` — confirm Airtable templates table is clean (no `{year}`, no parentheticals, no overlong patterns). Report findings to user.
- [ ] Approve a classification with bold `matched_doc_name = "טופס 106 – <b>פלייטיקה בעמ</b>"` → file renamed to `טופס 106 – פלייטיקה בעמ.pdf`.
- [ ] Approve a classification with `matched_doc_name = "טופס 106"` (no bold) → file renamed to `טופס 106.pdf` (NOT `טופס 106 – טופס 106.pdf`).
- [ ] Reassign to T501 with bold issuer → `דוח שנתי מקוצר – קרן פנסיה – מגדל.pdf`.
- [ ] Reassign with empty issuer → `דוח שנתי מקוצר.pdf` (no trailing dash).
- [ ] Admin upload via doc-manager → file lands with short-name format, NOT raw `issuer_name`.
- [ ] Inbound email → file uses `short_name_he` (not legacy `HE_TITLE` shortcut).
- [ ] PDF split + classify segment → segment renamed via `short_name_he`.
- [ ] Reject → file moved to archive folder unchanged (regression check).
- [ ] No file ends up with literal `{year}`, `{issuer}`, or any `{varName}` substring.
- [ ] After approve/reassign, the Documents record (not just classification) has populated `issuer_name`, `matched_doc_name`, `expected_filename`.
- [ ] T901/T902 still gets period suffix (DL-271 regression check).
- [ ] Build passes: `cd api && ./node_modules/.bin/tsc --noEmit` (3 pre-existing errors unrelated to DL-355).
- [ ] `wrangler deploy` from `api/` succeeds; smoke-test 1 approve via admin.

## 8. Implementation Notes (Post-Code)
**Implemented:** 2026-04-26

- `buildShortName` Step 3 echo guard: strips HTML, compares against `HE_TITLE`, plain `name_he`, and pattern-with-placeholders-stripped. Suppresses the no-bold fallback when input is an echo of the template title.
- `buildShortName` Step 9 cleanup: added double-em-dash collapse + empty-paren stripping for cases where mid-pattern `{issuer}` strip leaves dangling separators.
- `resolveOneDriveFilename` exposed from `classification-helpers.ts`. Single import surface for all 6 paths.
- `ProcessingContext.templateMap` typed as `import('../doc-builder').TemplateInfo` map (optional; legacy callers don't break).
- Approve path no longer gated by `matchQuality !== 'exact'/'single'` — every approve normalizes filename. T271 rental-period suffix flows via `resolveOneDriveFilename({suffix})`.
- Documents PATCH (post-rename) now writes `issuer_name`, `matched_doc_name`, `expected_filename` so admin views aren't blank. `issuer_name` skipped on reassign (target Doc owns its own).
- Audit script `scripts/audit-short-name-he.mjs` created; flags `{year}`, non-issuer placeholders, parentheticals, length>60, empty-when-name_he-set, short==name.
- Inbound `buildExpectedFilename` keeps signature; falls back to legacy HE_TITLE concat only when `templateMap` is not threaded (defensive — happens for callers that haven't populated it).
