# Design Log 129: Dynamic Short Names for AI Review Cards
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-09
**Related Logs:** [043-ai-review-card-redesign](043-ai-review-card-redesign.md), [074-live-doc-state-and-card-labels](074-live-doc-state-and-card-labels.md), [088-reassign-card-display-name](088-reassign-card-display-name.md), [109-ai-review-ui-lighten-and-rename-fix](109-ai-review-ui-lighten-and-rename-fix.md)

## 1. Context & Problem

The AI Review tab displays document names using a hardcoded `AI_DOC_NAMES` map (33 entries) for short labels. These labels are too generic — all T401 withdrawals show as "אישור משיכת ביטוח" regardless of whether it's a severance payout, pension fund, or training fund. Meanwhile, the full SSOT name is very long (e.g., "אישור משיכה לשנת 2025 + מס שנוכה – קרן השתלמות – אלצמח קרנות השתלמות").

The Airtable `documents_templates` table already has a `short_name_he` field with variable placeholders (e.g., `משיכת ביטוח – {withdrawal_type}`), but the n8n API only resolves `{issuer}` (last bold segment heuristic). The admin panel ignores this field for card display entirely.

**Two problems:**
1. **Card "AI חושב שזה:" line** shows the full SSOT name (very long) or combines `AI_DOC_NAMES` short label + full name (even longer)
2. **Issuer-mismatch radio options** show the full SSOT name — all T401s start with "משיכת ביטוח –" with the differentiator buried

## 2. User Requirements

1. **Q:** Should short names include the issuer/differentiator?
   **A:** Yes — type + differentiator (e.g., "טופס 867 – בנק הפועלים").

2. **Q:** Fetch from Airtable or embed in API response?
   **A:** Embed in API response — the endpoint already queries Airtable.

3. **Q:** Strip common prefix in radio labels for same-type docs?
   **A:** No — show the full short name everywhere consistently.

4. **Q:** Use short name on cards too?
   **A:** Yes — short name everywhere (cards, radios, lozenges).

5. **Q:** Should `short_name_he` use the same variables as `name_he`?
   **A:** Yes — user controls wording via Airtable using real variable names (`{withdrawal_type}`, `{employer_name}`, etc.), not the generic `{issuer}`.

## 3. Research

### Domain
Label UX for batch review interfaces, SSOT label resolution, admin panel design patterns.

### Sources Consulted
1. **PatternFly - Card View & Primary-Detail** — Cards should show a concise, uniquely identifying label. Full details via click or tooltip. Progressive disclosure over information overload.
2. **Nielsen Norman Group (via LogRocket)** — Label truncation must be intentional: decide which part carries the most distinguishing info (end vs middle). Not everything needs to be visible at all times.
3. **GetStream - Moderation Dashboard** — Review queues show summary lines per item (short label + status badge + key metadata). Full content on expand.
4. **Server-side vs Client-side Templating** — For SSOT systems, resolve all template variables server-side before they reach the client. Never send raw `{variable_name}` to the UI.
5. **UX Magazine - Admin UI Patterns** — Be as brief as possible without sacrificing meaning. Domain-specific shorthand is fine if the team knows it.

### Key Principles Extracted
- **Two-tier label strategy:** Short label for card/list views, full label for detail/tooltip. Both pre-resolved server-side.
- **Server-side resolution:** The API must return ready-to-display strings. Client never resolves template variables (prevents `{withdrawal_type}` leaking to UI).
- **Differentiation over description:** The short label's job is to help the admin DIFFERENTIATE between same-type docs, not describe the doc fully.

### Patterns to Use
- **Template variable resolution at API time:** The n8n Code node already has all data needed (template definitions + resolved doc names). Resolve `short_name_he` variables by extracting bold segments from the full HTML name.
- **Progressive disclosure:** Short name on card, full name accessible via file preview.

### Anti-Patterns to Avoid
- **Client-side label assembly** from parts — breaks uniformity when different surfaces assemble differently (exact problem with current `AI_DOC_NAMES` + `matched_doc_name` concatenation).
- **Hardcoded display maps** — `AI_DOC_NAMES` duplicates template data and can't differentiate same-type docs.

### Research Verdict
Replace the hardcoded `AI_DOC_NAMES` with server-resolved short names from Airtable's `short_name_he` field. The n8n Build Response Code node resolves template variables by extracting bold segments from the full SSOT name, then sends ready-to-display short names in the API response. The admin panel consumes these directly.

## 4. Codebase Analysis

### Existing Solutions Found

**Airtable `documents_templates` table (`tblQTsbhC6ZBrhspc`):**
- Already has `short_name_he` field with variable placeholders (updated this session to use real variable names)
- Already has `variables` field listing variable names per template
- Already has `name_he` field with the full template pattern (bold markers show which variables are bold)

**n8n Build Response Code node (`code-build-response` in workflow `kdcWwkCQohEvABX0`):**
- Already queries `documents_templates` table → builds `templateShortNames` lookup
- Already has `buildShortName()` function — but only resolves `{issuer}` (last bold heuristic)
- Already includes `name_short` in `missing_docs`/`all_docs` arrays
- Does NOT include short name for the classification item itself

**Admin panel (`admin/js/script.js`):**
- `AI_DOC_NAMES` constant (lines 1945-1961): hardcoded, used in 10 places
- `renderDocLabel()` (line ~4828): preserves `<b>` tags for display — reusable as-is
- Card display logic: concatenates `AI_DOC_NAMES[template_id]` + full `matched_doc_name` (makes it LONGER)

### Reuse Decision
- Reuse `templateShortNames` lookup in n8n (extend it)
- Reuse `renderDocLabel()` in admin panel (already handles `<b>` tags)
- Replace `AI_DOC_NAMES` entirely with API data
- Replace `buildShortName()` with proper variable resolution

### Alignment with Research
- Current approach violates "server-side resolution" — `AI_DOC_NAMES` is client-side label assembly
- Current approach violates "differentiation" — generic names can't distinguish same-type docs
- Fix aligns: server resolves everything, client displays ready-made strings

### Dependencies
- Airtable `documents_templates.short_name_he` (already updated this session)
- n8n workflow `kdcWwkCQohEvABX0` (Build Response node)
- Admin panel `admin/js/script.js`

## 5. Technical Constraints & Risks

- **Security:** No new data exposure — short names are derived from existing SSOT data
- **Risks:**
  - Bold extraction from nested `<b>` tags can be tricky. Mitigation: extract leaf-level `<b>` content only, skip known literal bolds.
  - If `short_name_he` has unresolvable variables (e.g., doc has no bold segments), gracefully strip the placeholder and trailing separator.
  - `AI_DOC_NAMES` is used in 10 places — must replace ALL occurrences or cards break.
- **Breaking Changes:** None — `name_short` field already exists in the API response, just improving its content. New `matched_short_name` field is additive.

## 6. Proposed Solution (The Blueprint)

### Part 1: n8n — Improve `buildShortName()` in Build Response

**Build richer template info map:**
```javascript
const templateInfo = {};
for (const t of templateRecords) {
  const nameHe = t.fields.name_he || '';
  const vars = (t.fields.variables || '').split(',').map(v => v.trim()).filter(Boolean);

  // Find which variables are bold in name_he (wrapped in **...**)
  const boldVars = [];
  for (const v of vars) {
    if (nameHe.match(new RegExp('\\*\\*[^*]*\\{' + v + '\\}[^*]*\\*\\*'))) {
      boldVars.push(v);
    }
  }

  // Find literal bolds (** text without {var} inside **)
  const literalBolds = [];
  const litRegex = /\*\*([^{*}]+)\*\*/g;
  let lm;
  while ((lm = litRegex.exec(nameHe)) !== null) {
    literalBolds.push(lm[1].trim());
  }

  templateInfo[t.fields.template_id] = {
    short_name_he: t.fields.short_name_he || null,
    boldVars,
    literalBolds
  };
}
```

**Replace `buildShortName()`:**
```javascript
function buildShortName(templateId, issuerNameHtml) {
  const info = templateInfo[templateId];
  if (!info || !info.short_name_he) return null;

  const shortTemplate = info.short_name_he;
  if (!shortTemplate.match(/\{(\w+)\}/)) return shortTemplate; // no variables

  // Extract leaf-level bold segments from resolved name
  const allBolds = [];
  const regex = /<b>([^<]+)<\/b>/g;
  let m;
  while ((m = regex.exec(issuerNameHtml || '')) !== null) {
    allBolds.push(m[1]);
  }

  // Filter out literal bolds (like "מקוצר" in T501)
  const literalSet = new Set(info.literalBolds);
  const varBoldValues = allBolds.filter(b => !literalSet.has(b));

  // Map bold variable names to values (in order of appearance)
  const varMap = {};
  for (let i = 0; i < info.boldVars.length && i < varBoldValues.length; i++) {
    varMap[info.boldVars[i]] = varBoldValues[i];
  }

  // Resolve short template — wrap values in <b> for display
  let result = shortTemplate;
  for (const [key, value] of Object.entries(varMap)) {
    result = result.replace(`{${key}}`, `<b>${value}</b>`);
  }

  // Strip unresolved placeholders + trailing separators
  result = result.replace(/\s*[\u2013\u2014\-]\s*\{[^}]+\}/g, '');
  result = result.replace(/\{[^}]+\}/g, '');
  return result.trim() || null;
}
```

**Update call site** — change from `buildShortName(templateShortNames[f.type], f.issuer_name)` to `buildShortName(f.type, f.issuer_name)`.

**Add `matched_short_name` to classification items:**
```javascript
items.push({
  // ... existing fields ...
  matched_short_name: d.matched_template_id
    ? buildShortName(d.matched_template_id, d.matched_doc_name)
    : null,
  // ...
});
```

### Part 2: Admin Panel — Replace `AI_DOC_NAMES` with API data

**Remove `AI_DOC_NAMES` constant** (lines 1945-1961).

**Replace all 10 usages:**

| Line | Current | Replacement |
|------|---------|-------------|
| ~2153 | `d.name \|\| AI_DOC_NAMES[id] \|\| id` | `d.name_short \|\| d.name \|\| id` |
| ~2260 | `AI_DOC_NAMES[item.matched_template_id] \|\| item.matched_template_name` | `item.matched_short_name \|\| item.matched_template_name` |
| ~2289 | Same pattern | Same replacement |
| ~2300 | `d.name \|\| AI_DOC_NAMES[d.template_id]` | `d.name_short \|\| d.name \|\| d.template_id` |
| ~2368 | Same as 2260 | Same replacement |
| ~2490 | Same as 2260 | Same replacement |
| ~2863 | `AI_DOC_NAMES[templateId] \|\| ''` | `data.matched_short_name \|\| data.doc_title \|\| ''` |
| ~3054 | Same as 2153 | Same replacement |
| ~3107 | Same as 2300 | Same replacement |
| ~3124 | Same as 2260 | Same replacement |

**Simplify card display name logic** (State A, C, reviewed):
Currently: `templateLabel && docName && !docName.includes(templateLabel) ? templateLabel + ' – ' + docName : ...`
After: Just use `item.matched_short_name || item.matched_template_name || 'לא ידוע'`

The short name is already concise and includes the differentiator — no need to concatenate.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| n8n `Build Response` (code-build-response) | Modify | Build `templateInfo` map, replace `buildShortName()`, add `matched_short_name` to items |
| `admin/js/script.js` | Modify | Remove `AI_DOC_NAMES`, replace 10 usages with API data, simplify display logic |

### Final Step
Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy validation items to `current-status.md`.

## 7. Validation Plan

* [ ] API returns `matched_short_name` for each classification item (not null for matched docs)
* [ ] API returns proper `name_short` in `missing_docs` array (resolved with real variables, not `{issuer}`)
* [ ] T401 cards show "משיכת ביטוח – קרן השתלמות – אלצמח" (not generic "אישור משיכת ביטוח")
* [ ] T601 cards show "טופס 867 – בנק הפועלים" (not just "טופס 867")
* [ ] T501 cards show "דוח שנתי מקוצר – אובדן כושר עבודה – מגדל ביטוח" (literal bold "מקוצר" skipped correctly)
* [ ] Issuer-mismatch radio options show resolved short names with bold differentiators
* [ ] Reviewed cards show short names (not full SSOT names)
* [ ] Reassign modal combobox still works (uses `d.name`, unaffected)
* [ ] Templates without variables (T002 "ספח ת״ז") display correctly
* [ ] Templates with unresolvable variables gracefully strip placeholders
* [ ] No `{variable_name}` text leaks to the UI
* [ ] No regression: approve/reject/reassign flows still work

## 8. Implementation Notes (Post-Code)

**n8n changes (code-build-response in kdcWwkCQohEvABX0):**
- Replaced simple `templateShortNames` lookup with `templateInfo` map containing `short_name_he`, `boldVars`, `literalBolds`
- New `buildShortName(templateId, issuerNameHtml)` resolves ALL variable placeholders (not just `{issuer}`) by extracting bold segments from the resolved SSOT name, filtering out literal bolds, and mapping to bold variable names in order
- Added `matched_short_name` field to each classification item in the response
- `name_short` in missing_docs/all_docs arrays now properly resolved with the same logic

**Admin panel changes (script.js):**
- Deleted `AI_DOC_NAMES` constant (was 33 hardcoded entries)
- Replaced all 10 usages with API-provided `matched_short_name` / `name_short`
- Simplified State A/C card display: single `renderDocLabel(item.matched_short_name || item.matched_template_name || 'לא ידוע')` instead of complex concatenation logic
- State B (issuer-mismatch): templateName now from `matched_short_name`, radio labels from `d.name_short`
- Reviewed cards: simplified display using `matched_short_name`
- Reassign handler: derives `matched_short_name` from `all_docs` array fallback when API doesn't return it
- All label rendering switched from `escapeHtml()` to `renderDocLabel()` to preserve `<b>` bold tags from short names
