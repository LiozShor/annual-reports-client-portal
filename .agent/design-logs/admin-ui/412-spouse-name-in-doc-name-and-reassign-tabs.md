# Design Log 412: Spouse Name in Doc Names + Reassign-Picker Tabs

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-11
**Branch:** `DL-412-spouse-name-in-doc-name`
**Related Logs:** DL-411 (parent — scope filter removal), DL-352 (origin of segmented tabs), DL-355 (`buildShortName`), DL-301/336 (PA popover), DL-391 (reassign chip menu).

## 1. Context & Problem

DL-411 dropped the scope filter so the spouse tab on doc-manager and the PA popover both show all templates. Live test on CPA-XXX (`spouse_name = "{spouse}"`) surfaced two follow-ups:

1. **Spouse name doesn't appear in the doc name.** Most CLIENT-scoped templates don't have `{spouse_name}` in their `name_he` / `short_name_he` patterns. Picking one from the spouse tab tags `person='spouse'` but the rendered doc name (e.g. "תעודת זהות מעודכנת") has no spouse marker — both the full name and the server-derived `short_name_he` (via `buildShortName`).
2. **AI Review reassign picker has no client/spouse tabs.** `_buildDocTemplatePicker` powers the chip menu, the AI Review action panel, and contract flows. New docs created via reassign always default `person='client'` server-side.

Both gaps were missed in the DL-411 duplicate-path audit.

## 2. Decision

Single DL covering both:

- **Auto-append `" – {spouse_name}"`** to `issuer_name` (and `name_short` from `buildShortName`) on creation when `person === 'spouse'` AND `spouse_name` non-empty AND the rendered name doesn't already include it. No template data migration; works for every CLIENT-scoped template.
- **Add client/spouse tabs** to `_buildDocTemplatePicker` (the AI Review reassign picker). Plumb `person` through `submitAIReassign` → reassign endpoint → new-doc creation.

## 3. Files Modified

### A. Spouse-name append (4 surfaces)

- `frontend/assets/js/document-manager.js` — `buildDocMeta` appends ` – {SPOUSE_NAME}` to `nameHe`/`nameEn` when `person === 'spouse'` and the marker isn't already present.
- `frontend/admin/js/script.js` — `_paResolveTemplateName(tpl, collected, item, person)` gets a 4th `person` arg; appends suffix inside. PA popover preview at `_paEnterPreview` passes `st.person`. AI Review picker callsites pass `activePerson` (Section B).
- `api/src/lib/classification-helpers.ts` — `buildShortName(templateId, issuerName, templateMap, person?, spouseName?)` appends suffix after Step 9 cleanup, before Step 10 return. `resolveOneDriveFilename` opts accepts `person`/`spouseName` and forwards.
- `api/src/routes/classifications.ts` — `memoShortName` keys by person + spouseName and forwards both to `buildShortName`. Per-doc render at L386 passes `f.person` + `spouseNameMap.get(reportId)`. Docs fetch field list gains `person`. Reassign new-doc paths (general_doc L1885 + templated L1942) and `also_match` additional_targets L1293 honor request `person` and append spouse suffix to all issuer fields.
- `api/src/routes/admin-pending-approval.ts` — `buildShortName` call at L197 passes `d.person` + `reportCtx.spouse_name`.

### B. Reassign-picker tabs (`_buildDocTemplatePicker`)

- `frontend/admin/js/script.js` — `_buildDocTemplatePicker` gains segmented-control tabs above the search input (hidden when `item.spouse_name` is empty). Closure-local `activePerson` defaults to `'client'`, resets per modal open. Tab click rebinds `activePerson` and toggles the `.active` class. `pickTemplate` / `confirmVars` / `submitCustom` thread `activePerson` into the chip payload and into the displayed name via `_paResolveTemplateName(..., activePerson)`.
- `submitAIReassign(recordId, templateId, docRecordId, loadingText, newDocName, forceOverwrite, targetReportId, extras, person)` — new 9th `person` arg, forwarded as `body.person` to `/webhook/review-classification` only when `'client'` or `'spouse'`.
- `confirmAIReassign` expanded-picker submit passes `t.person`. Typed-but-not-clicked fallback reads `[data-picker-person].active` from the DOM, appends spouse suffix to the typed name when on the spouse tab, and passes `pickerPerson` to `submitAIReassign`.
- `confirmAIAlsoMatch` forwards `pickerTarget.person` into the matched `additional_targets[]` entry.

### C. Worker (classifications.ts) — body parse + new-doc creation

- Body destructure adds `person?: string` (top-level) and `additional_targets[].person?: string`. Both validated to `'client'` | `'spouse'` (rejects with 400 otherwise).
- Per-request `getSpouseNameForReport(reportId)` helper with in-memory cache; `appendSpouseSuffix(name, person, spouseName)` helper enforces the `!includes(spouseName)` guard.
- Both reassign new-doc creation paths (`reassign_template_id === 'general_doc'` + templated fallback) compute `personForDoc` from `bodyPerson ?? tmplPerson ?? 'client'`, fetch spouse name on demand, and apply `appendSpouseSuffix` to `issuer_name` / `issuer_name_en` / `issuer_key`. `document_uid` segment uses `personForDoc` instead of hard-coded `'client'`.
- `also_match` additional_targets new-doc path mirrors the same pattern using `t.person`.

### D. Cache-bust

- `frontend/admin/index.html`: `script.js?v=424 → ?v=425` (already at 424 from DL-411 commit).
- `frontend/document-manager.html`: `document-manager.js?v=411 → ?v=412`.

## 4. Out of Scope

- Backfilling existing doc rows in Airtable. Office can re-save manually or live with the existing names.
- Adding `{spouse_name}` placeholder to template patterns in Airtable (the auto-append makes it unnecessary).
- Adding tabs to per-row `triggerUpload(docId)` — still inherits person from the existing row, no choice required.
- Client portal, email templates, React `ClientDetailModal.tsx`.

## 5. Verification

1. **CPA-XXX (live).** Doc-manager → spouse tab → pick a CLIENT-scoped template (e.g. T002). Confirm staged-docs preview reads `"ספח תעודת זהות – {spouse}"`. Save → row in doc-manager list shows that `issuer_name`; `name_short` from Worker also includes "– {spouse}".
2. **PA popover.** Bump CPA-XXX to Stage 3 (or test on another spouse client at Stage 3). Same check on the "+ הוסף מסמך" popover.
3. **AI Review reassign picker.** On a card for a client with spouse, open "שיוך מסמך למסמך אחר" → confirm client/spouse tabs above the search. Pick spouse tab + a template → submit → new doc lands with `person='spouse'` AND `issuer_name` carries spouse suffix.
4. **No-spouse client.** Confirm tabs hidden everywhere.
5. **SPOUSE-scoped template (e.g. T202 with `{spouse_name}` already in pattern).** Pick from spouse tab → name renders ONCE with spouse name (no double-tag).
6. **Cache-bust.** Hard-reload, confirm `script.js?v=425` + `document-manager.js?v=412` in Network panel.
7. **Worker deploy.** Run `.claude/workflows/deploy-worker.sh` from canonical clone after merge.

## 6. Risks

- `buildShortName` memo key change is per-request — no cross-request stickiness regression.
- New per-request report fetches in classifications.ts happen only when (a) a new doc is created via reassign or also_match AND (b) `person === 'spouse'`. Bounded to a handful of network calls per request; cache prevents repeats.
- Spouse marker uses an en-dash separator (` – `) matching the existing `buildShortName` convention; `.includes(spouseName)` guard prevents double-tagging for SPOUSE-scoped templates that already substitute `{spouse_name}` themselves.

## 7. Live Verification

- [ ] CPA-XXX doc-manager spouse tab → save T002 → row reads `… – {spouse}`
- [ ] PA popover spouse tab on a Stage 3 spouse client
- [ ] AI Review reassign picker — tabs visible, spouse pick creates spouse doc with suffix
- [ ] Spouseless client — tabs hidden everywhere
- [ ] SPOUSE-scoped template — single-tag (no `– {spouse} – {spouse}`)
- [ ] `script.js?v=425` + `document-manager.js?v=412` in Network panel post hard-reload
- [ ] Worker `/health` endpoint OK after deploy
