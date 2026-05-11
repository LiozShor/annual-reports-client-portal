# Design Log 411: Spouse Tab — Show All Templates (Drop Scope Filter)

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-11
**Related Logs:** DL-352 (origin of the scope filter being relaxed), DL-408 (multi-instance precedent), DL-301/336 (PA add-doc popover), DL-162 (legacy spouse checkbox)

## 1. Context & Problem

DL-352 introduced segmented "client / spouse" tabs above the add-doc combobox on two surfaces:

- Doc-manager standalone page (`frontend/document-manager.html` + `frontend/assets/js/document-manager.js`)
- PA queue popover in admin (`frontend/admin/js/script.js`)

Both surfaces filter the template list by the template's Airtable `scope` field on `report_required_templates`:

- `scope = CLIENT` → only on client tab
- `scope = SPOUSE` → only on spouse tab
- `scope = PERSON / GLOBAL_SINGLE / empty` → on both

User report (2026-05-11): the spouse tab is missing options that exist on the client tab — most of the `scope = CLIENT` category — and the office wants every template visible on both tabs. When a template is picked from the spouse tab, the resulting doc should be tagged as the spouse's regardless of the template's stored scope.

## 2. User Requirements (Q&A)

1. **Q:** What's the root cause — filter wrong, or templates mis-scoped?
   **A:** Filter is wrong — show all templates on both tabs.
2. **Q:** Which templates are missing on the spouse tab today?
   **A:** The whole `scope = CLIENT` category.
3. **Q:** Scope of the fix — doc-manager only, or also the PA popover?
   **A:** Both — uniformity rule (CLAUDE.md #1 + P1 duplicate-path audit).
4. **Q:** Should the active tab still set `person` metadata even for cross-scope templates?
   **A:** Yes — active tab wins unconditionally.

## 3. Research

Delta-only from DL-352, which already covered segmented-control UX (NN/G, Apple HIG, GitHub Primer), `scope`-field semantics, and the PA popover's prior-art predicate. No new domain.

**Verdict:** DL-352's tab control + person tagging were correct; the scope filter on top of the tabs was over-engineered. Office operations need flexibility — a married couple often shares CLIENT-scoped doc requirements (salary slips, IDs, bank confirmations) and the office shouldn't have to re-scope templates in Airtable case-by-case.

## 4. Codebase Analysis

### Filter sites (the only two)

- `frontend/assets/js/document-manager.js:1796-1801` — `_addDocTemplateMatchesPerson(tpl, person)` called from `renderAddDocDropdown` at line 871.
- `frontend/admin/js/script.js:11263-11268` — `_paTemplateMatchesPerson(tpl, person)` called from `_paRenderAddDocPick` at line 11208.

### Person assignment sites

- `frontend/assets/js/document-manager.js:1854` — `buildDocMeta` derives `person` from `isSpouseDocMode() ? 'spouse' : (tpl.scope === 'SPOUSE') ? 'spouse' : 'client'`. The scope branch needs to go to honor "active tab wins."
- `frontend/admin/js/script.js:11305-11530` — PA popover uses `st.person` (active tab) for both template + custom-doc paths (`_paEnterPreview` L11509, `paAddCustomDocSubmit` L11478). Already correct, no change needed.

### Surfaces verified out of scope

Grepped `spouse` across `frontend/`:
- `frontend/assets/js/view-documents.js` — client portal, read-only.
- `frontend/admin/react/src/types/client.ts` + `ClientDetailModal.test.tsx` — types only, no doc add.
- `frontend/n8n/workflow-processor-n8n.js`, `frontend/n8n/document-display-n8n.js` — n8n display templates, no add UI.
- `frontend/admin/js/modules/merge-clients.js` — DL-404 merge flow, doesn't add docs.
- `script.js:3097` per-row `triggerUpload(docId)` — inherits doc owner from existing row, no tab choice.

P1 duplicate-path audit ✅ — both filter sites patched in one commit.

## 5. Constraints & Risks

- **Monolith size ratchet** — `script.js` net delta is −7 lines (from collapsing the 5-branch comment + scope switch to a 1-line stub). Ratchet auto-shrinks baseline.
- **Dedup invariant from DL-408 retained.** `document-manager.js:779` still hides single-instance templates already present on the report — regardless of tab. A CLIENT-scoped single-instance template already added for the client will not be re-addable on the spouse tab. The office can use multi-instance templates (T901/T902) or templates with variables to add per-person copies. Per-person dedup is **out of scope** for DL-411 — tracked as future work pending a `multi_instance` schema column (DL-408 future work).
- **No Airtable schema change.** `scope` field stays on the templates table — just no longer consumed by the two add-doc UIs. Other surfaces (none today) could still use it.

## 6. Proposed Solution (Implemented)

### Patch 1 — `frontend/assets/js/document-manager.js`

```diff
-// DL-352: scope predicate ported from PA popover (script.js _paTemplateMatchesPerson).
-// Airtable scope values: CLIENT, SPOUSE, PERSON, GLOBAL_SINGLE, empty.
-function _addDocTemplateMatchesPerson(tpl, person) {
-    const scope = (tpl && tpl.scope ? String(tpl.scope) : '').trim().toUpperCase();
-    if (scope === 'CLIENT') return person === 'client';
-    if (scope === 'SPOUSE') return person === 'spouse';
-    return true;
-}
+// DL-411: scope filter dropped — both tabs show all templates. Active tab alone
+// determines `person` metadata on the new doc (see buildDocMeta). Function kept
+// so the L871 call-site is unchanged.
+function _addDocTemplateMatchesPerson(_tpl, _person) {
+    return true;
+}
```

```diff
-    // Determine person based on checkbox override or template scope
-    const person = isSpouseDocMode() ? 'spouse' : (tpl.scope === 'SPOUSE') ? 'spouse' : 'client';
+    // DL-411: active tab alone determines person (scope filter dropped).
+    const person = isSpouseDocMode() ? 'spouse' : 'client';
```

### Patch 2 — `frontend/admin/js/script.js`

```diff
-// DL-301: template scope filter.
-// Airtable `scope` values (verified live): CLIENT, SPOUSE, PERSON, GLOBAL_SINGLE, empty.
-//  - CLIENT       → client only
-//  - SPOUSE       → spouse only
-//  - PERSON       → either (disability/maternity — whoever the event applies to)
-//  - GLOBAL_SINGLE→ either (single-per-report like T002 ID update)
-//  - empty        → either (defensive default)
-function _paTemplateMatchesPerson(tpl, person) {
-    const scope = (tpl.scope || '').toString().trim().toUpperCase();
-    if (scope === 'CLIENT') return person === 'client';
-    if (scope === 'SPOUSE') return person === 'spouse';
-    return true; // PERSON, GLOBAL_SINGLE, empty, unknown → show for either
-}
+// DL-411: scope filter dropped — both tabs show all templates. Active tab alone
+// determines `person` (st.person, see paAddCustomDocSubmit / _paEnterPreview).
+// Function kept so the L11208 call-site is unchanged.
+function _paTemplateMatchesPerson(_tpl, _person) {
+    return true;
+}
```

### Patch 3 — Cache-bust

- `frontend/document-manager.html`: `document-manager.js?v=408` → `?v=411`
- `frontend/admin/index.html`: `script.js?v=422` → `?v=423`

## 7. Validation Plan

- [ ] **Doc-manager — client with `spouse_name` set.** Open doc-manager. Spouse tab shows the same combobox entries as the client tab (minus already-added single-instance templates). Add a previously CLIENT-scoped template from the spouse tab → confirm `(בן/בת זוג)` label appears next to staged entry in `updateSelectedDocs`. Click confirm → POST payload contains `person: 'spouse'`. After save, the doc-manager list row shows the spouse tag.
- [ ] **PA popover — Stage-3 Pending Approval client with spouse.** Click "+ הוסף מסמך" → both tabs show the same templates. Add a CLIENT-scoped template from spouse tab → preview meta shows the spouse name + 👥 emoji → confirm → optimistic add lands in the spouse `doc_groups` bucket.
- [ ] **Client with NO spouse.** Person tabs hidden (existing `renderAddDocPersonTabs` `if (!SPOUSE_NAME)` branch). Combobox shows all templates.
- [ ] **Cache-bust.** Hard-reload (Ctrl+Shift+R), confirm `document-manager.js?v=411` + `script.js?v=423` in Network panel.
- [ ] **Dedup boundary check.** With a CLIENT-scoped single-instance template already on the report for the client, switch to spouse tab → that template is still hidden (DL-408 invariant, documented as out-of-scope). With a multi-instance template (T901), confirm it is addable on either tab.

## 8. Implementation Notes

- Plan file: `C:\Users\liozm\.claude\plans\dreamy-strolling-eclipse.md`.
- Plan mode harness blocked editing `.agent/design-logs/admin-ui/411-...md` during Phase C; this DL file was written immediately after `ExitPlanMode` approval and status moved straight to `[IMPLEMENTED — NEED TESTING]` once the four edits landed.
- No deviation from approved plan: only changes were inline-comment wording and a minor PA-side observation (no person-assignment patch needed there — `st.person` was already correct).
- Net `script.js` delta: −7 lines. Ratchet-safe; baseline auto-shrinks on commit.

## 9. Out of Scope / Future Work

- Per-person dedup of single-instance templates (needs `multi_instance` boolean column on the templates table — DL-408 future work).
- Backfill of historic templates' `scope` field in Airtable (kept for potential future surfaces).
- Removing the `scope` field entirely.
- Client portal, email templates, React `ClientDetailModal.tsx` — none have a spouse-tab add-doc UI.
