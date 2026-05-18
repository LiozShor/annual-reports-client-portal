# Design Log 421: Bulk Multi-Select in AI Review — Merge + Move-to-Client

**Status:** [BEING IMPLEMENTED — DL-421]
**Date:** 2026-05-18
**Branch:** `claude-session-20260518-093638`
**Related Logs:** DL-222 (2-PDF merge), DL-237 (split + pdf.js thumbnails), DL-257 / DL-236 (bulk caps + bar), DL-382 (batch password pre-checked modal), DL-295 (PA queue inline status), DL-419 (chunked upload OOM fix), DL-404 (Airtable typecast gating), DL-410 (silent refresh)

---

## 1. Context & Problem

Clients regularly send many PDFs that all match a single template — the trigger case is a real client whose AI Review queue showed **12 separate PDFs** all classified as `דוח שנתי` (annual report). Today the admin must approve / reject each card individually. There is no bulk operation: no checkbox, no "merge these N", no "move these N to another client".

Two operational pains:

- **Merge friction:** 12 attachments → 12 clicks → 12 separate doc records (or worse, 11 silent overwrites by DL-222 because approve-conflict only handles pairs). Donations, pay-slips, bank-statements, monthly invoices all hit this.
- **Misrouted attachments:** when WF05 attaches mail to the wrong client (look-alike emails / wrong sender / forwarded chains), the admin must re-route attachments one at a time via the existing `/move-classification-client` endpoint. No bulk.

Goal: one selection model, two bulk actions, **no regressions to single-card approve/reject/reassign**.

## 2. User Requirements (Q&A — answered 2026-05-18)

1. **Q:** Where does the multi-select UI live?
   **A:** **Global checkboxes on every AI-Review card**, with a floating bulk-action bar. Admin picks the final template in the confirm dialog (cross-template merges allowed).
2. **Q:** What happens to the original N classification records after merge?
   **A:** All N are marked **approved** in Airtable; ONE merged doc record holds the merged PDF on Drive; the N originals get `merged_into=<new_doc_record_id>` so audit/undo is preserved (DL-237 "mark, don't delete" pattern). Cards disappear from the AI Review queue.
3. **Q:** Pre-existing approved doc for the target template?
   **A:** **Always merge silently** into the existing file. New pages appended to the existing PDF; existing doc record's `file_url` shape unchanged, content replaced.
4. **Q:** Merge order of the N PDFs?
   **A:** **Admin drags to reorder** in the confirm dialog before merging. Default order = chronological by email received (DL-222 default).
5. **Q:** Cap?
   **A:** **Hard cap 20** per bulk merge action. UI blocks 21st checkbox with a toast.
6. **Q:** Scope?
   **A:** **One client only.** Cross-client checkboxes disabled.
7. **Q:** Second bulk action — Move to another client?
   **A:** Yes. Sibling action on the same bulk bar. Takes N selected attachments (must all belong to one source client) and reassigns them to a target client. Each stays its own classification card on the target client's queue (no merging, same template carries over; admin re-classifies individually after move if needed).

## 3. Research

### Domain

Admin bulk-action UX · PDF batch merge · client-side drag-reorder

### Sources Consulted (Tavily — delta on top of DL-222 + DL-237)

1. **Eleken — Bulk Action UX (8 guidelines)** — bulk-action bar slides in on first selection, sits above the table, persists while scrolling, expands/contracts with count, overflow to "More" menu.
2. **Calendly BulkActionBar / PatternFly Bulk Selection** — left-most bulk selector + split button; persistent count text ("12 selected"); micro-animation on overflow.
3. **freeCodeCamp — Merge PDFs in the browser** — standard UX: upload → preview → drag-reorder via SortableJS → merge. Default sort + admin override is industry pattern.
4. **darins.page — Reorderable list component** + **SortableJS official** — `animation: 150`, `ghostClass`, no framework, ~10KB.

### Key Principles Extracted

- Bulk bar must be tied visually to the table; appear on first checkbox, persist while scrolling, never hide on action.
- Show eligibility clearly: disable ineligible checkboxes instead of silently erroring on submit.
- Default order + drag-to-override = best PDF-merge ordering UX.
- For destructive-ish bulk ops (merge silently overwrites originals), **always show preview list with filenames + page counts before commit**.

### Patterns to Use

- Pre-checked selection list in confirm modal (DL-382 password pattern, `script.js:6507`).
- Floating bulk bar with count + cap-aware disable (DL-257 reminder bar, `script.js:13161` + `MAX_BULK_SEND=50` at `:3108`).
- SortableJS loaded from CDN on-demand when the merge modal opens (mirrors `ensurePdfJs()` at `script.js:15418`).
- Generalize `mergePdfs(a, b)` → `mergePdfsN(buffers: ArrayBuffer[])` in `api/src/lib/pdf-merge.ts:7`.

### Anti-Patterns to Avoid

- Adding new code into the script.js monolith — ratchet blocks any bump.
- Sending 20 separate `/review-classification` POSTs from the client — must be ONE bulk endpoint for atomicity.
- Cross-client merging — undefined semantics for client_id on the merged doc.
- Re-classifying on move — surprises the admin who already accepted the classification.

### Research Verdict

Reuse: `pdf-lib` (DL-222), pdf.js CDN loader (DL-237), DL-382 selection-list modal shell, DL-257 floating bar pattern. New: SortableJS CDN, one new module `dl421-bulk-classify.js`, two new API actions (`bulk_merge` on `/review-classification` and `/bulk-move-classification-client`).

## 4. Codebase Analysis

### Existing Reuse Points (verified by Explore agent)

| Purpose | File:Line | Notes |
|---|---|---|
| AI Review grouping | `frontend/admin/js/script.js:5744` (`renderAICards()`) | Where checkbox markup hooks in |
| AI Review card render | `frontend/admin/js/script.js:5985` (`renderAICard()`) | Inject `<input type="checkbox" class="ai-bulk-select" data-id data-client data-template>` at card top |
| Approve handler | `script.js` → `approveAIClassification()` | Keep untouched |
| Reassign template handler | `script.js` → `showAIReassignModal()` | Reuse template picker UI inside merge confirm dialog |
| Move-client endpoint (single) | `api/src/routes/classifications.ts:2646` (`POST /move-classification-client`) | Sibling new route accepts array |
| Approve / reassign / reject router | `api/src/routes/classifications.ts:694` (`POST /review-classification`) | Add `action: 'bulk_merge'` branch |
| Existing 2-PDF merge | `api/src/lib/pdf-merge.ts:7` (`mergePdfs(a,b)`) | Generalize to `mergePdfsN(buffers[])` (keep 2-arg shim) |
| DL-222 merge call site | `api/src/routes/classifications.ts:1746-1798` | Refactor to call shared bulk merge core |
| Drive helpers | `api/src/lib/ms-graph.ts` (`getBinary`, `putBinary`, `delete`) + DL-419 `createUploadSession` | Reuse for download N → merge → upload |
| OneDrive folder resolver | `api/src/lib/inbound/attachment-utils.ts:321` (`resolveOneDriveRoot`) | Reuse for target client folder on move |
| SHA-256 hash | `api/src/lib/inbound/attachment-utils.ts:39` (`computeSha256`) | Reuse for merged file hash |
| pdf.js loader | `script.js:15418` (`ensurePdfJs()`) | Mirror as `ensureSortable()` |
| Password-bulk modal shell | `script.js:6507` (`requestPdfPassword()`) | Reuse selectionList component |
| Reminder bulk bar + cap | `script.js:13108` (`MAX_BULK_SEND`) + `:13161` | Mirror pattern; do not extract a generic component yet |
| Module dir | `frontend/admin/js/modules/` (12 existing modules) | Add `dl421-bulk-classify.js` |
| Cache-bust | `frontend/admin/index.html:1566` (`?v=432`) | Bump to `?v=433` |
| Monolith ratchet baseline | `.claude/script-size-baseline.json` | New code MUST live in module — do not edit baseline |

### Dependencies

- **New JS:** SortableJS via CDN (~10 KB, loaded on-demand). pdf.js already loaded via DL-237.
- **No new API deps.** `pdf-lib` already in `api/package.json` (DL-222).

## 5. Constraints & Risks

| # | Constraint / Risk | Mitigation |
|---|---|---|
| C1 | Monolith ratchet (script.js size baseline is append-only-DOWN) | New module `dl421-bulk-classify.js`; monolith touch ≤ ~30 lines for checkbox markup + module init |
| C2 | Cross-client merge undefined | UI: checkbox disables on cards from a different client once any card is checked; toast "Bulk actions are per-client" |
| C3 | Workers 128 MB memory on bulk merge | Cap 20 + warn if combined size > 60 MB. For merged result >25 MB use DL-419 `createUploadSession` + 5 MiB chunks |
| C4 | Atomicity — partial failure mid-merge | Server-side: build merged buffer first, upload, then Airtable PATCH. On any Drive failure, abort BEFORE Airtable writes. On Airtable failure mid-batch, fail loud + log to activity-logger + leave originals "Pending Approval" |
| C5 | Silent UI refresh after mutation (project rule P6) | After bulk endpoint returns, dispatch AI-Review silent refetch (DL-410 pattern); never instruct user to reload |
| C6 | PII in logs | `logEvent({event_type:'bulk_merge', category:'admin_action', client_id, count, template_id})` — no filenames, no Hebrew names |
| C7 | Audit / undo | Originals KEPT on Drive + Airtable with `merged_into=<new_id>`; undo UI is future work |
| C8 | Duplicate render paths (project rule P1) | Bulk bar lives ONLY in admin AI Review queue. Client portal does not render AI Review cards — no duplicate surface |
| C9 | Move-to-client folder path | Reuse `resolveOneDriveRoot` + existing path construction at `classifications.ts:2716` |
| C10 | DL-222 2-PDF caller regression | Keep `mergePdfs(a, b)` as shim → `mergePdfsN([a, b])`; existing call site unchanged |
| C11 | Airtable typecast (DL-404 lesson) | `merged_into` field created on first PATCH via typecast. Do NOT reference it in `filterByFormula` or `fields:[]` until existence confirmed |

## 6. Proposed Solution

### 6.1 Frontend — `frontend/admin/js/modules/dl421-bulk-classify.js` (NEW)

Exports `initBulkClassify()` called once from `script.js` after `renderAICards()`.

Behavior:

1. **Checkbox injection:** in `renderAICard()` (script.js:5985), append `<input type="checkbox" class="ai-bulk-select" data-id="<classification_id>" data-client="<client_id>" data-template="<template_id>" data-filename="<…>">` at card top-right. ~5 lines monolith edit.
2. **Selection state:** module-local `selectedSet = new Set()`. On change:
   - If first selection, snapshot `firstClientId` and disable checkboxes whose `data-client !== firstClientId`.
   - If size reaches 20, disable unchecked.
   - If size === 0, re-enable everything and hide bar.
3. **Floating bulk bar (`#dl421-bulk-bar`):** persistent sticky bottom-right card, mirrors `.reminder-bulk-actions` styling. Shows `N selected · [Merge into one doc] [Move to another client] [Clear]`.
4. **Merge confirm modal (`openBulkMergeModal()`):**
   - On open, lazy-load SortableJS via `ensureSortable()` (mirror `ensurePdfJs()`).
   - Body: (a) template picker (reuse `showAIReassignModal()` picker), (b) Sortable list of `{filename, page_count, received_at}` rows with drag-handle (☰), default-sorted chronologically, (c) preview "Will create 1 merged PDF with ~X pages", (d) confirm button `Merge N → <template>`.
   - On confirm: POST `/review-classification` `{action:'bulk_merge', client_id, target_template_id, ordered_classification_ids:[…]}`. Inline progress.
   - On success: silent refetch (DL-410), toast.
5. **Move confirm modal (`openBulkMoveModal()`):**
   - Body: (a) target client picker (reuse existing single-move client picker), (b) list of attachments (filename + current template). No drag, no merge.
   - On confirm: POST `/bulk-move-classification-client` `{source_client_id, target_client_id, classification_ids:[…]}`.
   - On success: silent refetch.

### 6.2 Backend — `api/src/routes/classifications.ts`

**New action branch in `/review-classification` (line 694):**

```ts
if (body.action === 'bulk_merge') {
  // 1. Validate: classification_ids all belong to body.client_id
  // 2. Fetch N attachments from Drive in declared ordered_classification_ids order
  // 3. mergePdfsN(buffers) → merged Uint8Array
  // 4. Target doc record: existing approved doc for target_template_id? PATCH file_url. Else create new (mirror single-approve)
  // 5. Upload merged: putBinary if <25MB, else createUploadSession (DL-419) with 5MiB chunks
  // 6. Airtable: PATCH target doc (file_url, file_sha256, file_size, page_count); PATCH N classification rows {status:'approved', merged_into:<doc_id>}
  // 7. logEvent({event_type:'bulk_merge', category:'admin_action', client_id, count, template_id, doc_id})
  // 8. Return {ok:true, doc_id, merged_page_count}
}
```

**New route — `POST /bulk-move-classification-client` (sibling of line 2646):**

```ts
// Body: {source_client_id, target_client_id, classification_ids:[]}
// 1. Validate all belong to source_client_id
// 2. resolveOneDriveRoot(target_client) → build target folder path (reuse :2716)
// 3. For each: MS Graph PATCH parentReference (or download+reupload+delete fallback)
// 4. Airtable PATCH each classification {client_id: target}
// 5. logEvent({event_type:'bulk_move_client', category:'admin_action', source_client_id, target_client_id, count})
// 6. Return {ok:true, moved:N, failed:[]}
```

Sequential iteration (cap 20). No `Promise.all` — bounds memory + clean partial-failure reporting.

### 6.3 Library — `api/src/lib/pdf-merge.ts`

```ts
export async function mergePdfsN(buffers: ArrayBuffer[]): Promise<Uint8Array> { /* copyPages loop */ }
export const mergePdfs = (a: ArrayBuffer, b: ArrayBuffer) => mergePdfsN([a, b]);
```

### 6.4 Airtable

- **New field on classifications table:** `merged_into` (link to `documents`, single record). Add via Airtable typecast on first PATCH (DL-404 lesson: gate reads in JS, not query).
- No new field on `documents` table.

### 6.5 Cache-bust + index.html

- Bump `frontend/admin/index.html:1566` `?v=432` → `?v=433`.
- Add `<script src="js/modules/dl421-bulk-classify.js?v=1" type="module"></script>` near existing module imports.

## 7. Validation Plan

Live verification required before `[COMPLETED]` (project rule "Verify With Live Data Before Merging"):

- [ ] **Smoke (golden path):** Client with 3+ attachments classified to same template. Check 3, Merge, accept default order, confirm. Verify Airtable: 3 classifications `status=approved` + `merged_into` populated; 1 new (or updated) doc record; OneDrive has 1 merged PDF with 3 pages chronological.
- [ ] **Drag-reorder:** Drag rows; merged PDF order matches dragged order.
- [ ] **Existing doc target:** Merge into a template that already has 1 approved doc → existing doc's PDF gets appended pages, no new doc record.
- [ ] **Cross-template merge:** Check 2 cards from different templates, pick a 3rd template as target; verify silent merge.
- [ ] **Cross-client guard:** Check a card; other clients' cards' checkboxes disabled with tooltip.
- [ ] **Cap 20:** 21st checkbox blocked with toast.
- [ ] **Large PDFs:** Merge 5 PDFs >30 MB combined; verify `createUploadSession` path succeeds.
- [ ] **Bulk move:** Select 3 on Client A, move to Client B. Airtable client_id flipped + OneDrive files under Client B + cards on Client B's queue.
- [ ] **Cross-client move guard:** Cannot select from 2 source clients.
- [ ] **Silent refresh (P6):** After every bulk action, queue updates in-place; no reload/flicker/scroll-jump.
- [ ] **No regression — single-card path:** Approve / Reassign / Reject on unchecked card works as before; DL-222 2-PDF approve-conflict still fires for legacy pair.
- [ ] **PII in logs:** activity-logs-archive shows IDs + counts only, no filenames / Hebrew names.
- [ ] **Mobile:** Bulk bar + checkboxes usable on mobile width.
- [ ] **Monolith ratchet:** Pre-commit hook passes; new code lives in module.

## 8. Implementation Notes

To fill during Phase D. Will record final endpoint shapes, MS Graph cross-drive move handling (PATCH parentReference vs. download+reupload+delete), any cap adjustment after live testing, and which DL principles were applied.
