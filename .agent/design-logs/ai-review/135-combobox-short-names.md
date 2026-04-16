# Design Log 135: Short Names in Document Combobox
**Status:** [DRAFT]
**Date:** 2026-03-09
**Related Logs:** [129-dynamic-short-names-ai-review](129-dynamic-short-names-ai-review.md), [039-searchable-categorized-doc-dropdown](039-searchable-categorized-doc-dropdown.md)

## 1. Context & Problem

DL-129 introduced `name_short` (resolved from Airtable `short_name_he`) for AI review card labels, radio options, and document tags. However, the `createDocCombobox()` function — used in the reassign modal ("מסמך יעד") and inline card comboboxes — still displays the full SSOT name (`doc.name`). These full names are very long (e.g., "אישור משיכה לשנת **2025** + מס שנוכה – **קרן השתלמות** – **אלצמח קרנות השתלמות**") and make the dropdown hard to scan.

The short name (`name_short`) is already available on every `missing_docs` item from the API — it just needs to be used in the combobox.

## 2. User Requirements

1. **Q:** Should search still match against the full name, or only the short name?
   **A:** Search both — display short name, but search matches against both short and full name for wider recall.

2. **Q:** Should the full SSOT name be accessible anywhere (e.g., tooltip on hover)?
   **A:** No tooltip needed — the admin knows the documents.

3. **Q:** Should this cover only the reassign modal, or audit all combobox consumers?
   **A:** Audit all combobox uses — ensure short names are used consistently everywhere.

4. **Q:** Fallback when `name_short` is null/empty?
   **A:** Fall back to full name (`name_short || name`).

## 3. Research

### Domain
Searchable dropdown UX, label brevity, search-behind-display pattern.

### Sources Consulted
1. **NN/g — Drop-Down Menus Design Guidelines** — Keep labels short and scannable. Menu titles provide scope; option labels should be concise enough to differentiate without scrolling.
2. **Mobbin — Combobox UI Best Practices** — Type-ahead with autocomplete is essential for 10+ options. Icons and sub-labels help users skim without typing full queries.
3. **Baymard Institute — Drop-Down Usability** — Avoid long option labels that cause horizontal overflow or wrapping. When items are similar, frontload the distinguishing part.
4. **Carbon Design System — Dropdown** — Keep label text short and concise, limited to a single line. Do not remove labels in favor of placeholder text.

### Key Principles Extracted
- **Display short, search wide:** Show concise labels for scannability, but match search input against richer data (full name) so users can find docs by any keyword.
- **Frontload differentiators:** In a list of similar items (e.g., multiple T401 withdrawals), the distinguishing part (type, company) should come first — exactly what `short_name_he` does.
- **Consistent label surfaces:** If card labels use short names, the combobox should too — otherwise the admin sees "משיכת כספים – קרן השתלמות" on the card but "אישור משיכה לשנת 2025 + מס שנוכה – קרן השתלמות – אלצמח קרנות השתלמות" in the dropdown.

### Patterns to Use
- **Search-behind-display:** `matchesFilter()` checks against `doc.name` (full) for broad matching, while `renderOptions()` displays `doc.name_short || doc.name` for brevity.

### Anti-Patterns to Avoid
- **Truncating the full name with CSS ellipsis** — hides the differentiator which may be at the end. Use a purpose-built short name instead.
- **Showing short name in dropdown but full name in input after selection** — inconsistent. Both should use the same label.

### Research Verdict
Use `name_short || name` for display in dropdown options AND in the input field after selection. Keep `matchesFilter()` searching against the full `name` for broad recall. No tooltip needed.

## 4. Codebase Analysis

### Existing Solutions Found
- `name_short` field already present on every `missing_docs` item from the API (DL-129)
- `renderDocLabel()` (line ~4834) preserves `<b>` tags — but combobox uses `escapeHtml()`, not `renderDocLabel()`. Since short names can contain `<b>` tags, we should use `renderDocLabel()` for the dropdown option HTML.

### Reuse Decision
- Reuse existing `name_short` field — no API changes needed
- Reuse `renderDocLabel()` for dropdown option display (preserves bold tags)
- Extend `matchesFilter()` to accept a second searchable string

### Alignment with Research
- Current combobox violates "display short" principle — showing full SSOT names
- Fix aligns: short display + full-name search

### Dependencies
- `admin/js/script.js` — `createDocCombobox()` function only
- No n8n or Airtable changes needed

## 5. Technical Constraints & Risks

- **Security:** `renderDocLabel()` only allows `<b>`/`</b>` tags (safe allowlist). No XSS risk.
- **Risks:** Call site #4 (line ~4904) parses docs from `el.dataset.docs` JSON — need to verify `name_short` is included when docs are serialized to `dataset.docs`.
- **Breaking Changes:** None — additive change, fallback to `name` when `name_short` is absent.

## 6. Proposed Solution (The Blueprint)

### Changes to `createDocCombobox()` (lines 1478–1678)

**A. Add `displayName` helper** (top of function):
```javascript
const getDisplayName = (doc) => doc.name_short || doc.name || doc.template_id || '';
```

**B. Update `renderOptions()` — line 1549–1561:**

1. **Filter** (line 1549): Search against BOTH names:
   ```javascript
   const filtered = group.docs.filter(d =>
       !filter || matchesFilter(d.name, filter) || matchesFilter(getDisplayName(d), filter)
   );
   ```

2. **Display** (line 1560): Use short name for visible text, keep full name in data attribute:
   ```javascript
   html += `<div class="doc-combobox-option${cls}" data-value="${escapeAttr(doc.template_id)}" data-doc-id="${escapeAttr(doc.doc_record_id || '')}" data-name="${escapeAttr(getDisplayName(doc))}">${renderDocLabel(getDisplayName(doc))}${badge}</div>`;
   ```

**C. Update selection handler** (line 1587):
Already reads `opt.dataset.name` → no change needed (data-name is now the short name).

**D. Update `setValue()` return method** (line 1665):
```javascript
input.value = getDisplayName(doc) || val;
```
(Currently uses `doc.name || val`)

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Update `createDocCombobox()`: add `getDisplayName` helper, update `renderOptions()` display + filter, update `setValue()` |

### Final Step
Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy validation items to `current-status.md`.

## 7. Validation Plan

* [ ] Reassign modal dropdown shows short names (e.g., "משיכת כספים – קרן השתלמות" not full SSOT)
* [ ] Inline card comboboxes (unmatched docs) show short names
* [ ] Search by full-name keyword still finds the document (e.g., typing "אישור" matches even though display shows "משיכת כספים")
* [ ] Search by short-name keyword works (e.g., typing "קרן השתלמות" matches)
* [ ] Selected value in input field shows short name
* [ ] Docs without `name_short` fall back to full name gracefully
* [ ] After reassign, the card updates correctly (existing `matched_short_name` logic)
* [ ] Call site #4 (inline confirm re-init from `dataset.docs` JSON) still works
* [ ] Bold formatting in short names renders correctly in dropdown options
* [ ] "◀ נוכחי" badge still appears on current match

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
