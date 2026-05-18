# DL-425 — Contract-Months Prompt in Bulk-Merge Modal (T901/T902)

**Status:** `[IMPLEMENTED — NEED TESTING]` — 2026-05-18
**Domain:** ai-review
**Branch:** `claude-session-20260518-093638` (DL-425 reserved via `reserve-dl-number.sh`)
**Related Logs:** DL-397 (contract-months on single reassign), DL-415 (period suffix on doc/issuer fields), DL-421 (bulk multi-select — Section 7 explicitly punted this gap)

---

## 1. Context & Problem

When admin merges N AI-Review attachments into a single rental-contract doc (`T901` rent-income / `T902` rent-expense) via the DL-421 bulk-merge modal, the modal collects the contract **amount** (via the expanded picker's `{rent_income_monthly}` / `{rent_expense_monthly}` variable) but does NOT collect the contract **months**. As a result every bulk-merged rental contract lands in Airtable with `contract_period = null`, breaking:

- The DL-269/270/415 `<b>MM.YYYY-MM.YYYY</b>` suffix on `issuer_name` / `document_key` / `document_uid`
- The DL-271 "request missing period" reviewed-card prompt that fires when `contract_period` is partial-year
- The DL-359 banner swap (full-year badge vs. partial-year banner)

Single-card reassign already collects this via DL-397 (`_dl397ReassignMonthsCtrl` + `renderContractMonthsInput`). Bulk-merge needs the same prompt — same control, same payload shape, same backend storage path. Tight delta on a well-established pattern.

User intent (verbatim 2026-05-18): "while merging and deciding that this whole docs is 1 contract, it should ask you what months it is, after the amount of the contract."

## 2. User Requirements (Q&A)

User invoked `/design-log` in Auto Mode (no clarifying-question phase). Implicit acceptance criteria from the request:

- The contract-months prompt MUST appear in the bulk-merge modal whenever the target template is T901 or T902.
- It MUST appear AFTER (below) the contract-amount input (which is part of the expanded picker's `{rent_income_monthly}` slot).
- The merged result MUST match what single-card reassign produces — same Airtable fields, same period suffix in `issuer_name` / `document_key` / `document_uid`.

## 3. Research

### Cumulative Knowledge

Domain already researched in DL-397 (contract months collection UX) and DL-415 (period propagation to documents row). This DL is a tight delta — no new external research needed per `design-log` skill's "cumulative knowledge" rule.

### Patterns Reused

- DL-397: `renderContractMonthsInput({containerEl, year, idPrefix})` returns `{validate, getValues}`. Validation rejects empty months. Mounted into a hidden div, displayed when template flips to rental.
- DL-415: `applyPeriodSuffixToDocFields(docFields, clsFields)` server helper — strips any prior `<b>MM.YYYY-MM.YYYY</b>` and re-applies based on classification's `contract_period`. DL-415 idempotent.
- DL-421: bulk-merge POST shape `{action, client_id, target_template_id, new_doc_name, target_doc_record_id, ordered_classification_ids}`. Already accepts optional fields — extend with optional `contract_period`.

### Anti-Patterns Avoided

- Don't fork a parallel period-collection control inside the module — reuse `window.renderContractMonthsInput` from script.js so any future fix (DL-397 follow-ups) auto-applies.
- Don't write `contract_period` to the `documents` table — it lives on `pending_classifications`; the documents row gets only the derived suffix in its `issuer_name` / key fields.

## 4. Codebase Analysis

| Purpose | File:Line | Notes |
|---|---|---|
| Bulk-merge modal body | `frontend/admin/js/modules/dl421-bulk-classify.js:283-300` | New `<div id="dl421MergeContractMonths">` after `#dl421ExpandedPicker` |
| Bulk-merge submit | `dl421-bulk-classify.js:325-378` | New `collectExtras(templateId)` mirror of DL-397 (`script.js:7926`) |
| Bulk-merge POST | `dl421-bulk-classify.js:380-410` | Add `contract_period` to body |
| Months UI helper | `script.js:6918` → `renderContractMonthsInput` | Reused; must be exposed on `window` (added here) |
| Rental gate | `script.js:6911` → `isRentalTemplate(letter)` | Reused; must be exposed on `window` (added here) |
| Reference impl | `script.js:7897-7935` (DL-397) | Mirror this pattern |
| Backend bulk_merge | `api/src/routes/classifications.ts:3129-3500` | Accept + validate + write |
| Period validator | `classifications.ts:106` → `buildContractPeriod` | Reused |
| Doc-field suffixer | `classifications.ts:128` → `applyPeriodSuffixToDocFields` | Reused |
| Cache-bust | `frontend/admin/index.html:1567` `?v=12` | Bump after edit |
| Monolith ratchet | `script.js` baseline 16112 | Window-export tacked onto existing line 3734 — 0 net new lines |

## 5. Constraints & Risks

| # | Risk | Mitigation |
|---|---|---|
| C1 | Monolith ratchet | Window exports appended to existing line 3734 (`// DL-421` line) — keeps script.js at 16112 lines. |
| C2 | Admin forgets months | Validation aborts submit + Hebrew toast (DL-397 UX). |
| C3 | Re-mount race on template flip | `collectExtras` returns null → submit aborts cleanly. |
| C4 | Frontend `aiClassificationsData[*].contract_period` stale | Acceptable — N merged PCs flip to `approved` and disappear from queue. |
| C5 | DL-415 idempotency on existing-doc path | Helper strips prior suffix before re-applying. Safe. |
| C6 | PII / logs | `logEvent` details extended with `{has_contract_period: boolean}` only — no date strings. |
| C7 | Backend `bulkContractPeriod` missing when rental | Permissive: log warning + skip suffix; frontend prevention is primary gate. |

## 6. Proposed Solution

### 6.1 Frontend — `frontend/admin/js/modules/dl421-bulk-classify.js`

A. Mount slot in modal body (after `#dl421ExpandedPicker`):
```html
<div id="dl421MergeContractMonths" style="display:none;margin-top:12px;"></div>
```

B. Sync function (module-local, mirrors `_dl397SyncReassignMonths`).

C. Wire to template changes: combobox `onSelect`, expanded-picker `onPick`, plus initial call after `buildTemplatePicker`.

D. Submit validation via new `collectExtras(tplId)` — abort on missing months for rental templates.

E. Extend `_dl421DoMerge` signature with `contractPeriod` → include in JSON body when present.

F. Cache-bust `?v=12 → 13`.

### 6.2 Backend — `api/src/routes/classifications.ts` (POST `/bulk-merge-classifications`)

A. Accept `contract_period?: {startDate?, endDate?}` in body destructure.

B. Validate via `buildContractPeriod` when template is rental. 400 on validator error.

C. Write `contract_period: builtPeriod.json` to every PC PATCH in the loop.

D. Apply `applyPeriodSuffixToDocFields` to both new-doc CREATE and existing-doc PATCH branches.

E. Extend `logEvent` with `has_contract_period` boolean.

### 6.3 Window exports (script.js — 0 net new lines)

Append to existing DL-421 export line:
```js
window.renderContractMonthsInput = renderContractMonthsInput; window.isRentalTemplate = isRentalTemplate; // DL-425
```

## 7. Validation Plan

- [ ] **Smoke (golden):** 2+ rental attachments → bulk-merge → T901 expanded picker → fill amount + months 3-9 → confirm. Verify Airtable PC `contract_period`, merged doc `issuer_name` contains `<b>03.2026-09.2026</b>`, `document_key`/`uid` end `_3-9`.
- [ ] **Full-year (1-12):** `coversFullYear=true` + NO suffix.
- [ ] **Non-rental bypass:** Months section never appears; no `contract_period` in POST.
- [ ] **Validation abort:** T901 + blank months → toast + modal stays open + no writes.
- [ ] **Template flip:** non-rental → T901 → months section appears.
- [ ] **Outcome A (combobox chip):** Existing T901 chip → months prompt mounts.
- [ ] **Outcome C (expanded picker):** T902 + amount + months → both reach Airtable.
- [ ] **No regression — single reassign (DL-397):** Still works.
- [ ] **PII guard:** Activity-logs-archive — no date values, only boolean flag.
- [ ] **Cache-bust:** Hard refresh — new `?v=` served.
- [ ] **Monolith ratchet:** pre-commit passes.

## 8. Implementation Notes

Phase D shipped 2026-05-18 in two passes.

### Pass 1 (commit `664d99d8`)

- **Window exports** (`script.js:3734`): appended `window.renderContractMonthsInput = renderContractMonthsInput; window.isRentalTemplate = isRentalTemplate;` to the existing DL-421 export line. **Zero net line growth** — `script.js` stays at baseline 16112.
- **Module** (`dl421-bulk-classify.js`): added `_dl425MergeMonthsCtrl` state, `_dl425SyncMergeMonths(templateId, refItem)` mount/unmount fn, `<div id="dl421MergeContractMonths">` slot in modal body, hook calls in (a) combobox `onSelect` (both code paths), (b) expanded-picker `onPick`, (c) initial sync after `buildTemplatePicker`, and (d) cleanup in `closeMergeModal`. Submit gate `collectExtras(tplId)` mirrors DL-397's pattern — returns `{}` for non-rental, `{contract_period}` when valid, `null` (with toast) when invalid. `_dl421DoMerge` gained `contractPeriod` parameter; POST body now includes `contract_period: contractPeriod || undefined`.
- **Backend** (`classifications.ts:3129-3500`): body type extended with `contract_period?: {startDate?, endDate?}`. New validation gate after the existing args check — for `T901`/`T902` only, calls `buildContractPeriod` (DL-397 SSOT). 400 on malformed dates. Synthetic `periodClsFields = {matched_template_id, contract_period: builtPeriod.json}` reused by both `applyPeriodSuffixToDocFields` callers — one on `docPatchFields` (existing-doc PATCH path) and one on `newDocRow` (new-doc CREATE path). Per-PC PATCH loop writes `contract_period: builtPeriod.json` when present. `logEvent.details` extended with `has_contract_period: boolean` (no PII).
- **Cache-bust**: `index.html` bumped `dl421-bulk-classify.js?v=12 → ?v=13`.

### Pass 2 — parity fixes (commit `4abd9dfa`)

Live testing surfaced two gaps where the period was correctly stored on the PC + doc rows but **not visible in two of the surfaces users actually read**:

1. **OneDrive filename was missing the period suffix.** The merged file landed as `חוזה שכירות (הכנסה).pdf` instead of `חוזה שכירות (הכנסה).02.2025-04.2025.pdf`. Single-reassign at `classifications.ts:2380-2386` passes the period via the `suffix` parameter of `resolveOneDriveFilename` (computed by `getRentalPeriodLabel().filename` at L981-997). Bulk-merge wasn't doing this. **Fix:** inline a `bulkPeriodSuffix` computed from `builtPeriod.contractPeriod` (`MM.YYYY-MM.YYYY` from start/end month + endDate year, skipping `coversFullYear`) and pass it as `suffix:` to the `resolveOneDriveFilename` call at L3324.

2. **Green chip in the required-docs panel showed the bare template title.** Single-reassign at `script.js:8048` routes rental approvals through `window.insertReassignedDocAndRefresh` (DL-410) which calls `periodLabel(extras.contract_period)` and writes `name`/`name_short` with the suffix into the local `aiClassificationsData[].all_docs[]`. The DL-227 chip renderer (`renderDocTag` at `script.js:9331-9335`) then parses the `<b>MM.YYYY-MM.YYYY</b>` from `d.name` and surfaces it. Bulk-merge called the generic `updateClientDocState` instead, which only flips status and never updates `name`/`name_short`. **Fix:** mirror the script.js:8048 conditional in the module — when `isRentalTemplate(templateId)` is true and `contractPeriod` is set, call `window.insertReassignedDocAndRefresh(firstItem, data, templateId, {contract_period: contractPeriod}, window.aiClassificationsData)` instead.

3. **Backend response shape extended** to feed the helper: `{ok, doc_id, merged_page_count}` → `{ok, doc_id, merged_page_count, doc_title, matched_short_name, matched_template_id}`. `doc_title` + `matched_short_name` are the merged doc's `issuer_name` with `<b>` tags stripped. `insertReassignedDocAndRefresh` reads `data.matched_short_name || data.doc_title` to build the chip label, then re-attaches the period via `periodLabel(extras.contract_period)`. Computed via a single `airtable.getRecord(TABLES.DOCUMENTS, bulkDocId)` after the upload — fail-safe (`.catch(() => null)`).
- **Cache-bust**: `?v=13 → ?v=14`.

### Verification (live, CPA-XXX)

- T901 merge with 02.2025-04.2025: PC `contract_period` = JSON, merged doc `issuer_name` = `... <b>02.2025-04.2025</b>`, OneDrive name = `חוזה שכירות (הכנסה).02.2025-04.2025.pdf`, green chip = `חוזה שכירות – דירה מושכרת (הכנסה) 02.2025-04.2025` ✓.
- DL-415 idempotency carried us — re-merge into an existing T901/T902 doc with a different period replaces the suffix cleanly.
