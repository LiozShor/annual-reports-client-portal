# DL-421 — "+ הוסף מסמך חדש" / "Add new doc" behavior

Exhaustive contract for what happens when an admin picks a template in the
**bulk-merge** modal. The same rules apply to single-card reassign — bulk-merge
mirrors reassign deliberately so the two flows produce identical `documents`
rows.

Last updated: 2026-05-18 (commits up to `728a3ece`).

---

## 1. The three picker outcomes

The template picker (`createDocCombobox` for the basic combobox, `_buildDocTemplatePicker` for the expanded full-template view) can return ONE of three target shapes:

| # | Outcome | UI gesture | What the combobox stores |
|---|---|---|---|
| **A** | Pick an existing chip | Admin clicks a chip in the dropdown (existing doc row on this report) | `selectedValue = <template_id>`, `selectedDocId = <recXXX>` (the existing doc row), `newDocName = ''` |
| **B** | Type a custom name + click "+ הוסף מסמך כללי חדש" / "+ הוסף" | Admin types in the create-new input and submits | `selectedValue = '__NEW__'`, `selectedDocId = ''`, `newDocName = <typed text>` |
| **C** | Pick from expanded picker with variables | Admin clicks "+ הוסף מסמך חדש" → expanded list → picks a templated chip → fills `{var}` inputs → confirms | `_dl421ExpandedTarget = { template_id, new_doc_name: <substituted-name>, _pending: true }` |

In all three outcomes, the frontend sends ONE payload to `POST /webhook/bulk-merge-classifications`:

```json
{
  "action": "bulk_merge",
  "client_id": "<recXXX>",
  "target_template_id": "<T123 | 'general_doc'>",
  "new_doc_name": "<string | undefined>",
  "target_doc_record_id": "<recXXX | undefined>",
  "ordered_classification_ids": ["<id1>", "<id2>", ...]
}
```

Field mapping per outcome:

| Outcome | `target_template_id` | `new_doc_name` | `target_doc_record_id` |
|---|---|---|---|
| A — chip | the chip's `template_id` | the chip's **displayed (substituted)** name (e.g. `אישור תושב – ישוב2 – משה`) | the chip's `doc_record_id` |
| B — custom name (general) | `'general_doc'` | the typed text (e.g. `תרומות`) | — |
| C — expanded picker + vars | the picked template's id | the substituted name (e.g. `אישור תושב – חיפה – לשנת 2025`) | — |

> The frontend captures outcome A's substituted name by reading `combobox-input.value` after select — see `frontend/admin/js/modules/dl421-bulk-classify.js` (`_dl421SubmitMerge`). Without this capture, chip-picks on docs whose `issuer_name` is empty would render the template's raw `{var}` placeholders forever.

---

## 2. Backend resolution priority

`api/src/routes/classifications.ts` → `POST /bulk-merge-classifications`:

1. **`target_doc_record_id` present** → fetch that exact doc record. It IS the target. (PRIORITY 1)
2. **`target_template_id === 'general_doc'` OR `new_doc_name` set OR `lookupReportId` missing** → skip the existing-doc lookup, will create a NEW row. (PRIORITY 2)
3. **Otherwise** → look up the latest `Received` doc of this template on the report. If found → silent-append path (prepend its existing PDF, overwrite same OneDrive item). If not → create new. (PRIORITY 3)

---

## 3. What gets written to `documents`

Regardless of which path runs, the merged-doc row ends up with the **full field set** that single-reassign produces (mirror of `script.js:2279-2292`):

| Field | Always | Notes |
|---|---|---|
| `status` | ✅ `'Received'` | |
| `review_status` | ✅ `'confirmed'` | |
| `reviewed_by` | ✅ `'Natan'` | |
| `reviewed_at` | ✅ ISO now | |
| `file_url` | ✅ | Merged PDF's OneDrive URL |
| `onedrive_item_id` | ✅ | |
| `file_hash` | ✅ | SHA-256 of merged buffer |
| `ai_confidence` | ✅ | From `clsRecords[0].ai_confidence` |
| `ai_reason` | ✅ | `"[bulk_merge] N attachments merged into <template_id>"` |
| `source_attachment_name` | ✅ | Joined list of all N original attachment names |
| `source_sender_email` | ✅ | From `clsRecords[0].sender_email` |
| `uploaded_at` | ✅ | First PC's `received_at` (fallback: now) |

Conditional fields (depend on outcome):

| Field | Written when | Notes |
|---|---|---|
| `type` | New row only | `bulkTemplateId` (e.g., `T1201` or `general_doc`) |
| `report` | New row only | Linked record from `clsRecords[0].report` |
| `issuer_name`, `issuer_name_en`, `issuer_key` | (a) Outcome B / C → always on new row · (b) Outcome A → only if existing doc's `issuer_name` is empty OR contains a `{var}` placeholder | Mirrors reassign's chip-pick conservative-overwrite — won't clobber a valid name |
| `person` | New row only | `'client'` (default; spouse not threaded yet — see Out-of-scope) |
| `document_uid`, `document_key` | New row only | `${reportId}_${type}_client_${slug}_${ts}` |
| `category` | New row only when `type === 'general_doc'` | `'general'` |

---

## 4. What gets written to `pending_classifications` (per merged PC)

```json
{
  "review_status": "approved",
  "merged_into": ["<bulkDocId>"],          // multipleRecordLinks → documents
  "matched_template_id": "<bulkTemplateId>",
  "matched_doc_name": "<bulkNewDocName>",  // ONLY when bulkTemplateId === 'general_doc'
  "reviewed_at": "<ISO now>"
}
```

This makes the AI Review "תואם ל:" label render the admin's chosen target (was `לא ידוע` on previously-unmatched PCs before this fix).

---

## 5. OneDrive filename

`mergedFilename` is computed via `resolveOneDriveFilename(...)` from `api/src/lib/classification-helpers.ts:210` — the same SSOT every other rename path uses (DL-355).

Resolution order:
1. `buildShortName(templateId, issuerName, templateMap)` — uses the template's `short_name_he`.
2. `HE_TITLE[templateId]` + optional issuer suffix.
3. Sanitized stem of attachment name.
4. Literal fallback `מסמך.pdf`.

For outcome B/C (`new_doc_name` set), `issuerName` is set to the substituted display name, so the filename embeds the variable values (e.g., `אישור תושב חיפה 2025.pdf`).

For outcome A (chip-pick, no new substitution), `issuerName` stays empty and the template's own short name wins.

For uploads >25 MB the route uses the DL-419 `uploadToOneDrive` helper (which switches to `createUploadSession` chunked PUT). Smaller files use a single `putBinary`.

**DL-425 — rental period suffix in filename:** when the target is T901/T902 and a valid `contract_period` (not full-year) is supplied, the route also passes `suffix: "MM.YYYY-MM.YYYY"` to `resolveOneDriveFilename`. Same mechanism single-reassign uses via `getRentalPeriodLabel().filename` at `classifications.ts:981-997`. The filename then reads e.g. `חוזה שכירות (הכנסה).02.2025-04.2025.pdf`. Skipped automatically when `coversFullYear=true`.

---

## 6. Frontend post-success behavior

After `{ok, doc_id, merged_page_count, doc_title, matched_short_name, matched_template_id}`:

1. **Toast:** `המסמכים מוזגו (<N> עמ')`
2. **Per-card transition** (`window.transitionCardToReviewed(id, 'approved', data)`) — instant in-place DOM swap to the green "אושר" state, no fetch.
3. **Required-docs list refresh** — branched by template type (DL-425):
   - **Rental (T901/T902)** with `contract_period` set → `window.insertReassignedDocAndRefresh(firstItem, data, templateId, {contract_period}, window.aiClassificationsData)` (DL-410). Writes `name`/`name_short` with the `<b>MM.YYYY-MM.YYYY</b>` suffix into the local `all_docs[]` so `renderDocTag` (`script.js:9331-9335`) re-attaches the period in the green badge.
   - **Non-rental** → `window.updateClientDocState(clientName, data.doc_id)` (status-flip only).
4. **Auto-advance** within the same client. If all-on-client done → "client review done" prompt.

Mirrors single-card approve / reassign (`script.js:6818-6823` + `script.js:8048` rental conditional). Backend response shape extended in DL-425 to include `doc_title` / `matched_short_name` / `matched_template_id` so the rental-aware helper can render the chip label without a refetch.

---

## 7. Out of scope (today)

- **Spouse threading.** All bulk-merge new docs are created with `person: 'client'`. Reassign supports a per-pick spouse tab — bulk-merge would need a similar control in the modal. Defer until a real use case lands.
- ~~**T901/T902 contract-period prompts.**~~ **CLOSED — DL-425 (2026-05-18).** Bulk-merge now mirrors single-reassign's DL-397 months prompt and writes `contract_period` to every merged PC plus applies the DL-415 `<b>MM.YYYY-MM.YYYY</b>` suffix to the merged doc.
- **Re-classify on move-to-client.** The sibling `/bulk-move-classification-client` route keeps each attachment's existing template (DL-421 §6.2).
- **Undo button.** Originals are recoverable via the `merged_into` reverse link (auto-created via Schema API on 2026-05-18, field id `fldJ4MsZdxHflXbbf`) — no UI surface yet.

---

## 8. Why each fix exists (trail)

Each gotcha cost a deploy cycle during the 2026-05-18 testing session — record so future contributors don't repeat:

| Symptom | Root cause | Fix commit |
|---|---|---|
| 500: `Unknown field name: "file_sha256"` | docs table uses `file_hash`, not `file_sha256` (typecast only auto-creates select-option values, NOT new fields) | `454df8be` |
| 500: `Unknown field name: "client_id_lookup"` | docs table doesn't have that field; filter by `report_record_id` instead | `b93b241d` |
| 422 on PC PATCH: `Unknown field name: "status"` | pending_classifications uses `review_status`, not `status` | `46682828` |
| 422 on PC PATCH: `Unknown field name: "merged_into"` | Field didn't exist; created via Airtable Schema API (multipleRecordLinks → documents) | (schema-only) |
| PC PATCH succeeded but link empty | `merged_into` is multipleRecordLinks → must send `[recId]` array, not bare string | `ae278194` |
| AI Review "תואם ל" showed `לא ידוע` after merge | bulk_merge didn't write `matched_template_id` on the PC | `e4d9802e` |
| Generic filename `merged_T1201_<ts>.pdf` | Wasn't routing through `resolveOneDriveFilename` (DL-355) | `ae278194` |
| Modal closed when clicking a chip option | Combobox close() detaches the option mid-event → browser retargets the click to overlay → `e.target === overlay` matched → modal closed | `7d1cf575` |
| Required-docs green ✓ never updated | Only called `transitionCardToReviewed`; missing the `updateClientDocState(clientName, docId)` companion call (single-approve calls both — `script.js:6820`) | `e0abfa7b` |
| Dropped back to first client after merge | `silentRefresh()` was calling `loadAIClassifications(false, false)` — `silent=false` forces full re-render. Should be `(true, false)` | `7eae82e2` |
| Chip-pick rendered with `{var}` placeholders | Backend ignored `target_doc_record_id`; created a new doc with no `issuer_name`. Fix: respect `target_doc_record_id` + fill `issuer_name` when existing one is empty/placeholder | `728a3ece` |
| docs row missing `review_status`, `source_*`, `ai_*`, `uploaded_at` | Bulk path wasn't writing the full field set that single-reassign writes (`script.js:2279-2292`) | `728a3ece` |
| OneDrive filename doubled the template title (`ניכוי בט"ל – ניכוי בט"ל – לקוח.pdf`) | Passed the already-substituted plain display name as `issuerName` to `resolveOneDriveFilename`. `buildShortName` then substituted it into the template's `… – {issuer}` slot — doubling the prefix. Fix: pass the existing doc's `issuer_name` (which carries `<b>…</b>` tags around the var values so `buildShortName` extracts only the variable, not the prefix). For create-new with no existing doc, pass empty so the template's title is used as-is | `0a9835d7` |
| DL-425: bulk-merge into T901/T902 left `contract_period=null` on every merged PC | Bulk-merge route never accepted `contract_period` in the body and never collected it in the modal. Fix: add a DL-397-style `renderContractMonthsInput` mount in the modal, send `contract_period` in the POST, validate via `buildContractPeriod` and write to each PC + apply `applyPeriodSuffixToDocFields` to the merged doc | `664d99d8` |
| DL-425: OneDrive name missing the period (`חוזה שכירות (הכנסה).pdf` instead of `…02.2025-04.2025.pdf`) | `resolveOneDriveFilename` accepts an optional `suffix:` (single-reassign passes `getRentalPeriodLabel().filename` at L2385) — bulk-merge wasn't passing it. Fix: compute `MM.YYYY-MM.YYYY` from `builtPeriod.contractPeriod` and pass as `suffix:` | `4abd9dfa` |
| DL-425: green chip in required-docs panel showed bare template title without the period | Bulk-merge called the generic `window.updateClientDocState` which only flips status. Single-reassign rentals route through `window.insertReassignedDocAndRefresh` (DL-410) which writes `name`/`name_short` with the `<b>…</b>` suffix into local `all_docs[]` so `renderDocTag` (script.js:9331-9335) re-attaches the period. Fix: mirror the script.js:8048 conditional + extend backend response with `doc_title` / `matched_short_name` / `matched_template_id` so the helper can build the label without a refetch | `4abd9dfa` |
