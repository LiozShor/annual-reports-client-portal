# Design Log 068: Document List Visual Hierarchy Refactor
**Status:** [DRAFT]
**Date:** 2026-02-26
**Related Logs:** 012-centralized-display-library.md, 060-reminder-ssot-doc-display.md

## 1. Context & Problem

Users reported "visual clutter" in the client-facing document request emails. Categories (e.g., "💼 עבודה ושכר") and individual documents (e.g., "טופס 106 – חברה א") are hard to distinguish because both render as table rows with similar styling — same font size, minimal indentation difference, no clear parent-child visual cue.

**Current rendering:**
- `categoryHeader()`: bold 16px, emoji prefix, border-bottom — but no background, no extra padding
- `documentRow()`: 15px, 16px padding-right, plain text (no prefix for missing docs)
- Both sit at nearly the same visual level in the email

## 2. User Requirements

1. **Q:** Which surfaces should get the refactor?
   **A:** All surfaces — change the Document Service display functions (Core Principle #1: Uniformity).

2. **Q:** What checkbox format for missing docs?
   **A:** ☐ (U+2610 ballot box) for missing docs.

3. **Q:** How to handle received/waived docs?
   **A:** ☑ (U+2611) for received docs. Hide waived docs entirely.

4. **Q:** How to create parent-child distinction between categories and documents?
   **A:** Indent document rows (increase padding-right in RTL) while keeping current category header style. Simple approach — bold category with emoji + border stays, docs get 24px additional indentation.

## 3. Research

### Domain
Email UX, visual hierarchy in transactional email checklists, RTL layout

### Sources Consulted
1. **"Don't Make Me Think" — Steve Krug** — Visual hierarchy principle: users scan, don't read. Distinct visual levels (size, weight, indentation, whitespace) create scannable structure. Two levels of indentation is the sweet spot for nested lists.
2. **Email Design Rules (docs/email-design-rules.md)** — Category headers: 16px bold. Body/doc names: 15px normal. Spacing grid: 8px increments. RTL indentation via `padding-right`. No `<ul>/<li>` — use table rows.
3. **Unicode in email clients** — ☐ (U+2610) and ☑ (U+2611) are BMP characters, supported in Gmail, Apple Mail, Outlook 2016+, Yahoo. Older Outlook (2007-2013) may render as empty rectangles but still functional. HTML entity fallbacks: `&#x2610;` and `&#x2611;`.

### Key Principles Extracted
- **Two visual cues minimum**: Don't rely on a single differentiator. Combine indentation + prefix character to separate levels.
- **RTL indentation = padding-right**: In RTL emails, the leading edge is the right side. `padding-right` creates visual nesting.
- **Action-oriented lists**: Hide completed/waived items to reduce noise. Show only what needs action.

### Patterns to Use
- **Checkbox prefix pattern**: ☐ for actionable items, ☑ for completed — universal visual language.
- **Indentation for nesting**: 24px additional right padding on child items creates clear parent-child grouping.

### Anti-Patterns to Avoid
- **Color-only differentiation**: Don't rely solely on color to distinguish categories from docs (accessibility).
- **Over-indentation**: More than 40px total padding in a 600px email wastes horizontal space for Hebrew text.

### Research Verdict
Minimal, targeted changes to two functions (`documentRow` and `generateDocListHtml`/`generateDocListHtmlSplit`). Keep category headers unchanged. Add checkbox prefix + increase indentation on document rows. Hide waived docs.

## 4. Codebase Analysis

* **Canonical rendering location:** `[SUB] Document Service` → "Generate HTML" Code node (v3 table-based design)
* **Key functions to modify:**
  - `documentRow(title, status)` — line in Generate HTML node
  - `generateDocListHtmlSplit(docs, lang)` — waived filtering
* **Functions NOT changing:** `categoryHeader()`, `buildDocSection()`, `generateDocListHtml()`, `personSectionHeader()`
* **GitHub legacy file:** `github/annual-reports-client-portal/n8n/document-display-n8n.js` — old `<ul>/<li>` approach, should be updated to stay conceptually in sync
* **Consumers:** WF[02] office email, WF[03] client email, WF[04] doc_list_html, WF[06] Type B reminder
* **Document Service NOT accessible via n8n MCP** — will need manual JSON update or user to make it MCP-accessible

## 5. Technical Constraints & Risks

* **Unicode support:** ☐/☑ are BMP chars — safe in all modern email clients. Use HTML entities (`&#x2610;`/`&#x2611;`) for safety.
* **RTL padding:** `padding-right` is the leading edge in RTL. Currently 16px → change to 40px for docs.
* **Breaking changes:** None. Visual-only change. No data structure, API, or Airtable schema changes.
* **Waived doc hiding:** `generateDocListHtmlSplit` already excludes waived. `generateDocListHtml` (non-split) only runs on fresh docs with no status, so waived never appears there. Safety fallback: `documentRow` returns '' for Waived.
* **MCP access:** Document Service workflow not found via MCP search. Update requires either: (a) user enables MCP access in workflow settings, or (b) manual JSON edit + reimport.

## 6. Proposed Solution (The Blueprint)

### Changes to `documentRow(title, status)`

**Before:**
```js
// Missing (default): plain text, no prefix
// Received: ✓ green + strikethrough
// Waived: — + strikethrough + opacity 0.5
```

**After:**
```js
// Missing (default): ☐ prefix, 40px padding-right (RTL indent)
// Received: ☑ green + strikethrough, 40px padding-right
// Waived: return '' (hidden)
```

### Changes to `generateDocListHtml(docs, lang)`

Add pre-filter to exclude Waived docs (safety net):
```js
const visibleDocs = docs.filter(d => d.status !== 'Waived');
if (visibleDocs.length === 0) return '';
```

### Changes to GitHub `document-display-n8n.js`

Update `renderDocLi()` to match new prefix pattern (☐/☑/hidden).

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| [SUB] Document Service → "Generate HTML" Code node | Modify | Update `documentRow()` + `generateDocListHtml()` |
| `github/annual-reports-client-portal/n8n/document-display-n8n.js` | Modify | Sync `renderDocLi()` with new pattern |

## 7. Validation Plan

* [ ] Trigger WF[02] with test questionnaire → verify office email has ☐ on missing docs
* [ ] Verify client email (Hebrew) has ☐ + proper RTL indentation
* [ ] Verify client email (English) has ☐ + proper LTR indentation
* [ ] Verify category headers remain bold with emoji, NOT indented
* [ ] Verify visual gap between category row and first doc row
* [ ] Test with married client → verify both client/spouse sections
* [ ] Test with received docs → verify ☑ with strikethrough
* [ ] Test with waived docs → verify they are hidden
* [ ] Verify WF[04] doc_list_html output uses new format

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
