# Design Log 039: Searchable Categorized Document Dropdown
**Status:** [COMPLETED]
**Date:** 2026-02-19
**Related Logs:** 036 (AI Classification Review Interface), 037 (Admin Portal UX Refactor)

## 1. Context & Problem
The AI Review tab's document reassign dropdown shows a flat list of 55+ raw document names. No categories, no search, no grouping — makes it nearly impossible to find the right document quickly. Template IDs were also showing instead of names (fixed separately). Need a proper UX for document selection.

## 2. User Requirements (The 5 Questions)

1. **Q:** Both dropdowns or just the modal?
   **A:** Both — the inline `<select>` on unmatched cards AND the modal popup for matched card reassignment.

2. **Q:** Search behavior — combobox or separate input?
   **A:** Combobox — single input field, click to open, typing filters the list. Compact.

3. **Q:** Category display — collapsible or flat?
   **A:** Flat with headers, all expanded. Category headers always visible.

4. **Q:** Empty category handling?
   **A:** Hide categories with no matching docs entirely.

5. **Q:** Highlight currently matched doc?
   **A:** Yes — when using "שייך מחדש" on a matched card, visually mark the current match.

6. **Q:** Sort within category?
   **A:** Alphabetical by document name.

## 3. Technical Constraints & Risks
* **Dependencies:** GET Pending Classifications API (`kdcWwkCQohEvABX0`) — must add `category` to `missing_docs`
* **Categories table:** 8 categories with emoji + sort_order + name_he. Already in Airtable.
* **Documents table:** Has `category` field (singleLineText) per document record.
* **RTL:** Must work correctly in Hebrew RTL layout.
* **No external libraries:** Custom lightweight component using existing design system tokens.
* **Risk:** The inline combobox on unmatched cards is space-constrained — needs to work within card layout.

## 4. Proposed Solution (The Blueprint)

### 4.1 API Change — Build Response node (`kdcWwkCQohEvABX0`)

Add `category` and `category_emoji` to each `missing_docs` item:

```javascript
// Fetch categories table
const catRecords = await fetchAll(CATEGORIES_TABLE, {});
const categoryInfo = {};
for (const c of catRecords) {
  categoryInfo[c.fields.category_id || c.fields.name_he] = {
    name_he: c.fields.name_he,
    emoji: c.fields.emoji,
    sort_order: c.fields.sort_order
  };
}

// In missingByReport builder, add:
missingByReport[reportId].push({
  doc_record_id: doc.id,
  template_id: f.type,
  name: stripHtml(f.issuer_name) || templateNames[f.type] || f.type,
  issuer_name: stripHtml(f.issuer_name) || null,
  category: f.category || 'כללי',
  category_emoji: categoryInfo[f.category]?.emoji || '📄',
  category_sort: categoryInfo[f.category]?.sort_order || 99
});
```

Sort `missing_docs` by `category_sort`, then alphabetically by `name`.

### 4.2 Frontend — Custom Combobox Component

Build a reusable `DocSearchCombobox` that replaces `<select>` elements.

**HTML structure:**
```html
<div class="doc-combobox" data-record-id="...">
  <input class="doc-combobox-input" placeholder="🔍 חפש מסמך..." />
  <div class="doc-combobox-dropdown">
    <!-- Category header -->
    <div class="doc-combobox-category">💼 הכנסות מעבודה</div>
    <!-- Options -->
    <div class="doc-combobox-option" data-value="T201">טופס 106 – INTEL</div>
    <div class="doc-combobox-option" data-value="T201">טופס 106 – קפה גרג</div>
    <!-- Next category -->
    <div class="doc-combobox-category">🏦 בנקים ושוק ההון</div>
    ...
  </div>
</div>
```

**Behavior:**
- Click input → open dropdown, show all options grouped by category
- Type → filter options (match anywhere in name), hide empty categories
- Click option → select it, close dropdown, update input text
- Escape/click outside → close without selecting
- Currently matched doc (if any) → shown with a subtle indicator (e.g., `◀ נוכחי`)

**Integration points:**
1. **Inline (unmatched cards):** Replace `<select class="ai-assign-select-inline">` with combobox. On selection, enable the "שייך" button with the selected template_id.
2. **Modal (matched card reassign):** Replace `<select id="aiReassignSelect">` with combobox. On selection, enable "שייך" confirm button.

### 4.3 CSS

Add to `admin/css/style.css`:
- `.doc-combobox` — container, relative positioning
- `.doc-combobox-input` — styled like existing form inputs, RTL
- `.doc-combobox-dropdown` — absolute positioned, scrollable (max-height 300px), shadow, border-radius
- `.doc-combobox-category` — sticky header, bold, emoji prefix, muted background
- `.doc-combobox-option` — hover highlight, cursor pointer, padding
- `.doc-combobox-option.current-match` — subtle left border or badge for currently matched doc
- `.doc-combobox-option.selected` — checkmark or background highlight

### Architecture
* **Modified Files:**
  - `admin/js/script.js` — replace `<select>` rendering with combobox init, update event handlers
  - `admin/css/style.css` — combobox styles
  - `admin/index.html` — replace modal `<select>` with combobox container
  - n8n workflow `kdcWwkCQohEvABX0` — add category data to missing_docs

* **No new files** — component lives inline in script.js

## 5. Validation Plan
* [ ] Open AI Review tab with pending classifications
* [ ] Unmatched card: click combobox → see categorized list with emoji headers
* [ ] Type "106" → only טופס 106 entries shown, empty categories hidden
* [ ] Select a doc → "שייך" button enables, confirm assigns correctly
* [ ] Matched card: click "שייך מחדש" → modal opens with combobox
* [ ] Currently matched doc has visual indicator in the list
* [ ] Clear search → all categories/options return
* [ ] Click outside dropdown → closes cleanly
* [ ] RTL layout renders correctly (text aligned right, dropdown anchored right)
* [ ] Verify no regression: approve/reject actions still work

## 6. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
