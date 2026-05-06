# Design Log 407: Drop matched_doc_name from documents PATCH on AI-review approve
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-06
**Related Logs:** DL-355 (introduced the bug — `feat(documents): unify OneDrive rename via short_name_he`); DL-408 (planned follow-up — inbound dedup gap surfaced during this investigation)

## 1. Context & Problem

After AI-review **approve** or **reassign** in the admin panel, `[review-classification]` was logging this every time, ~15 occurrences over the last 5 days:

```
ERROR [review-classification] File move failed:
Airtable updateRecord error: 422 {"error":{"type":"UNKNOWN_FIELD_NAME","message":"Unknown field name: \"matched_doc_name\""}}
```

`matched_doc_name` is a real field on the `pending_classifications` table (`docs/airtable-schema.md:422`) but **not** on the `documents` table. `api/src/routes/classifications.ts:2244-2248` was copying it from the classification row into the docPatch and then trying to PATCH it onto the documents table. Airtable rejected the entire docPatch with 422 every time.

### Why it looked worse than it was

The catch at the old `classifications.ts:2251-2254` swallowed the 422 as "non-fatal", but the same try block also wrapped the legitimate `file_url` + `onedrive_item_id` post-rename PATCH on line 2248. So when the 422 fired, the documents row never got the **post-rename** OneDrive URL — the row kept the **pre-rename** URL captured at inbound. In practice OneDrive item IDs are stable across rename and SharePoint typically redirects, so the user-facing impact was **cosmetic** (stale path string in Airtable; links still work). User confirmed CPA-YYY links still resolve fine.

User's CPA-XXX "docs went pending" complaint that prompted this DL turned out to be a **separate** issue — duplicate inbound classifications from the same email being processed twice (see §8 / DL-408 follow-up). The 422 doesn't reset doc status; the primary documents PATCH at line 1746 (which sets `status='Received'`, `review_status='confirmed'`) runs **before** the buggy second PATCH and was always succeeding.

## 2. User Requirements (Q&A)

| # | Question | Answer |
|---|---|---|
| 1 | Fix approach? | Drop `matched_doc_name` from the documents PATCH (don't add the field to documents). |
| 2 | Backfill records affected? | Originally yes, then **no** after we proved the impact is cosmetic (links work). |
| 3 | Add a regression guard (type-allowlist on updateRecord)? | Originally yes, **dropped** — overengineered for a 1-field fix. Open as a future DL if a similar drift happens again. |
| 4 | Implementation handoff? | Implement after `ExitPlanMode`, ship from feature branch through main. |

## 3. Research

**Domain:** TypeScript per-table field narrowing for heterogeneous DB write APIs (Airtable wrapper). Researched but **not applied in this DL** — see §6 (Out of scope).

**Sources consulted:**
1. TS Handbook — Indexed Access Types — https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html
2. TS Handbook — Generic Constraints — https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-constraints
3. Kysely — `Kysely<DB>` table-keyed schema — https://kysely.dev/docs/getting-started
4. `airtable-ts` — typed Airtable wrapper — https://github.com/domdomegg/airtable-ts

**Key principle applied here:** silent-failure class — when a catch swallows an error, isolate the catch's scope so it doesn't strand legitimate work in the same try block. Mirrors the project's `Failure Postmortem Rule` and CLAUDE.md "P5 silent UI refresh after DB mutation" — the same disciplines apply server-side.

## 4. Codebase Analysis

- **Bug site:** `api/src/routes/classifications.ts:2225-2255` (pre-fix, single try block wrapping OneDrive PATCH + documents PATCH).
- **Primary documents PATCH (succeeded all along):** `api/src/routes/classifications.ts:1722-1746` — sets `status='Received'`, `review_status='confirmed'`, `reviewed_by='Natan'`, `file_url` (pre-rename), `onedrive_item_id`. This is why docs always showed Received correctly.
- **TABLES constants:** duplicated in `api/src/lib/inbound/types.ts:15-21` (5 tables) and `api/src/routes/classifications.ts:80-87` (6 tables). Out of scope to consolidate — flagged as future cleanup.
- **logError pattern:** existing usage at `classifications.ts:604, 2329, 3025` uses `category: 'DEPENDENCY' | 'VALIDATION' | 'INTERNAL'` and `details: string`. New code conforms.

## 5. Constraints & Risks

- **Cannot change Airtable schema** — user picked "drop field", not "add field to documents".
- **Catch refactor preserves response semantics** — endpoint still returns `ok: true` on Airtable PATCH failure; only the silent-swallow shape changed (now `logError`-tracked).
- **Cache bust:** N/A — Worker change only, no admin/JS edits.
- **Worker deploy required** after merge (CLAUDE.md: "Always deploy after main push").

## 6. Proposed Solution

### 6.1 In scope (this DL)

Single change in `api/src/routes/classifications.ts:2225-2255`:

1. Remove `matched_doc_name` from the documents PATCH (remove the `clsMatched` extraction at old line 2244 and the conditional assignment at old line 2246).
2. Split the single try block into two: one for `msGraph.patch(...)` (the OneDrive rename), one for `airtable.updateRecord(TABLES.DOCUMENTS, ...)` (the post-rename file_url update). A future field-shape error in the Airtable PATCH cannot abandon the OneDrive move result.
3. Funnel the documents-PATCH catch through `logError(..., category: 'DEPENDENCY')` so future silent failures of the same shape page via UptimeRobot.

### 6.2 Out of scope (deferred)

- **Type-level field allowlist** on `airtable.updateRecord` — researched but not applied. Justification: 1-field bug, type lift would balloon the diff, and no other field-shape drift between tables has surfaced. Re-open if similar drift recurs.
- **Backfill of `file_url` for the 13-ish docs that hit the 422** — not needed; OneDrive item-id-based access keeps working, and SharePoint redirects the pre-rename URL.
- **Inbound duplicate dedup** — surfaced during investigation: `api/src/lib/inbound/processor.ts:549-557` correctly detects file-hash duplicates and avoids re-uploading to OneDrive, but **still creates a fresh `pending_classification` row** with the comment "but still create record if duplicate (with warning)". This caused CPA-XXX's queue noise (yesterday's 7 still pending while today's same-hash batch was reviewed and dismissed). **Tracked as DL-408 follow-up.**
- **TABLES constant dedup** between `inbound/types.ts` and `routes/classifications.ts` — flagged for future cleanup.

## 7. Validation Plan

**Pre-deploy**
- [x] `cd api && ./node_modules/.bin/tsc --noEmit` — `classifications.ts` clean (pre-existing errors in `index.ts:132` and `activity-logger.ts:16` are unrelated and out of scope).
- [ ] `npx wrangler deploy --dry-run -c wrangler.toml` from `api/` — confirm shape is deployable.

**Post-deploy (live)**
- [ ] Approve one document via admin AI-review tab on any client. Verify Cloudflare logs show NO `UNKNOWN_FIELD_NAME` for `matched_doc_name`.
- [ ] Verify the documents row receives the post-rename `file_url` (compare to OneDrive `webUrl` after rename).
- [ ] Trigger a reassign flow. Same: no 422, documents row updated.
- [ ] Verify a deliberate documents-PATCH failure (if it ever happens again) gets logged via `logError` → surfaces as `category: 'DEPENDENCY'` in Cloudflare logs.

**Diagnostic byproduct (resolved during investigation, no code action here)**
- [x] Confirmed CPA-XXX's "docs went pending" was NOT caused by this 422 — root cause is the inbound-dedup gap (DL-408).
- [x] Confirmed CPA-YYY links work fine despite stale `file_url` — proves the 422 was cosmetic.
- [x] Identified 9 affected reports / ~13 docs across 5 days from Cloudflare Workers Logs.

## 8. Implementation Notes

**Files modified**
- `api/src/routes/classifications.ts` — bug fix at lines 2225–2255 (was the previous single-try-block shape; now two separate try blocks + `logError` for the documents PATCH catch).
- `.agent/design-logs/ai-review/407-fix-matched-doc-name-422-on-approve.md` — this file.
- `.agent/design-logs/INDEX.md` — entry added.

**Files NOT modified (deliberately)**
- `docs/airtable-schema.md` — schema unchanged.
- `frontend/admin/js/script.js` — server-side fix only.
- `api/src/lib/airtable.ts` — type allowlist deferred (see §6.2).
- `api/src/lib/inbound/processor.ts` — dedup gap tracked separately (DL-408).

**Investigation timeline (compressed)**
1. User reported CPA-XXX docs reverting to pending after AI-review approve.
2. Cloudflare Workers Logs (last 4h) surfaced repeated 422s for `matched_doc_name`.
3. Initial hypothesis: 422 abandoned the documents PATCH → stale state → "pending" symptom.
4. User pushback: "in CPA-YYY all the links work" — forced a re-derivation. Walked the code: primary documents PATCH at line 1746 already sets status=Received before the failing PATCH. The 422's actual impact is cosmetic stale `file_url`.
5. Pulled CPA-XXX's actual data: 6 documents Received with reviewed_by=Natan ✓, 7 pending_classifications all `review_status=pending` from a 2026-05-05 16:27 IL email_event.
6. file_hash comparison: yesterday's 7 pending vs today's 6 documents share 6 identical hashes — same file content arriving twice, second time creating a redundant pending row that gets reviewed and dismissed while the first one rots.
7. Found `processor.ts:549-557` comment confirming dedup is intentionally partial. Spun out as DL-408.
8. Confirmed scope: tiny matched_doc_name + try/catch fix. Skipped type-allowlist + backfill + endpoint as overengineering.

**Deviations from plan**
- Original plan included a type-allowlist on `airtable.updateRecord` and a temp backfill endpoint. Both dropped after proving the impact is cosmetic and a 1-field bug doesn't justify the lift.
