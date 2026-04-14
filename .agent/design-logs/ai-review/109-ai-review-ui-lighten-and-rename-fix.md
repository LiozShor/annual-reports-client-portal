# Design Log 109: AI Review UI Polish + OneDrive Rename Fix
**Status:** [IMPLEMENTED]
**Date:** 2026-03-07
**Related Logs:** DL-070 (conflict guard), DL-086 (review status tracking)

## 1. Context & Problem

**Item 4.1 — Lighten AI Review selection UI:**
When the AI classifies a document with issuer mismatch (State B), it shows radio options asking "Is it one of these?" Each option is styled as a bordered card with 16px padding, 1.5px border, and border-radius. With 2-4 options stacked, the result is visually heavy — cards inside a card. Additionally, `escapeHtml()` strips `<b>` tags from SSOT document names, so all text has uniform weight with no visual hierarchy.

**Item 4.2 — Fix OneDrive file rename on reassignment:**
When a user reassigns a document in AI Review, the OneDrive file should be renamed to match the new assignment. The rename infrastructure **already exists** in the `Prepare File Move` node. However, it has gaps: (1) `HE_TITLE` hardcoded map doesn't cover all templates and can't handle new ones, (2) `general_doc` custom docs can never be renamed (map returns empty → skips), (3) no error flagging when rename fails silently.

## 2. User Requirements

Expert consultation (Renzo + Amara + Kofi) conducted. User confirmed:
- Phase 4 from Natan meeting — items 4.1, 4.2 (6.1 already done)
- No discovery questions needed — scope is clear from meeting notes

## 3. Research

### Domain
- Radio button UX for batch review interfaces
- MS Graph API file rename operations

### Sources Consulted
1. **Nielsen Norman Group: Checkboxes vs Radio Buttons** — Vertical stacking with generous spacing; both control and label should be clickable targets
2. **Justinmind: Radio Button Design Patterns** — Cards good for comparison, but text hierarchy via weight/size is key for fast scanning
3. **MS Graph driveItem Update (v1.0)** — PATCH `/drives/{drive-id}/items/{item-id}` with `{"name": "new-name"}`. Returns 200 on success. `conflictBehavior=rename` appends `(1)` on collision.

### Key Principles
- **Text hierarchy > container styling** for scannable batch review options
- **Bold differentiators** in otherwise-similar labels let the eye skip boilerplate
- **MS Graph PATCH is not atomic** when combining rename + move — current workflow handles this correctly (separate operations)

### Research Verdict
4.1: Remove card borders, preserve `<b>` tags with safe sanitizer, tighten spacing. Keep vertical layout.
4.2: Test existing path first. Fix `general_doc` gap and `HE_TITLE` maintenance issue.

## 4. Codebase Analysis

### Item 4.1 — Existing Solutions Found

**CSS (style.css:1748-1794, 3287-3290):**
- `.ai-comparison-radio`: 16px padding, 1.5px border, border-radius — the visual heaviness
- Hover/selected states add border-color + background changes
- Mobile override already reduces padding/font

**JS — Two render paths (MUST stay in sync):**
- Initial: `script.js:2199-2210` in `renderAIClassificationCard()`
- Rebuild: `script.js:3005-3015` in `refreshAccordionDocs()`
- Both use `escapeHtml(docName)` which strips all HTML formatting

**`escapeHtml()` (script.js:4623):** Uses `textContent`/`innerHTML` trick — safe, strips all tags. Cannot be modified globally.

**`handleComparisonRadio()` (script.js:1890):** Manually toggles `.selected` class — redundant with `:has(input:checked)` but harmless.

### Item 4.2 — Existing Solutions Found

**Workflow `[API] Review Classification` (c1d7zPAmHfHM71nV) — 31 nodes:**
- `Prepare File Move` (code-prepare-file-move): Full reassign branch exists
  - Reads `pa.reassign_template_id` → looks up `HE_TITLE[templateId]`
  - Extracts issuer from `Find Target Doc` result
  - Builds `newFilename = sanitize(heTitle + ' – ' + issuer + ext)`
  - Sets `moveToZohu = true` if doc was previously unmatched
- `Build Move Body`: Creates `{"name": "new-filename.ext"}` + optional `parentReference`
- `Move/Rename File`: `PATCH /drives/{driveId}/items/{itemId}?@microsoft.graph.conflictBehavior=rename`
- `Update File URLs`: Patches Airtable with new URL after rename

**Gaps identified:**
1. `HE_TITLE` map has ~30 entries but doesn't cover every possible template. `Find Target Doc` already fetches the full Airtable record (with `issuer_name` field containing the Hebrew title) — this data is available but unused as fallback.
2. For `general_doc`: `HE_TITLE['general_doc']` = undefined → empty string → "no target template title, skip rename". Fix: use `pa.new_doc_name` as fallback.
3. No error flagging — rename is fire-and-forget after `Respond Success`.

## 5. Technical Constraints & Risks

* **Security (4.1):** Preserving `<b>` tags requires a safe sanitizer. Doc names come from SSOT (server-generated), not user input. But `general_doc` names are user-provided. Use allowlist-only sanitizer: strip everything except `<b>` and `</b>`.
* **Risk (4.1):** Two render paths must stay in sync. Mitigation: extract shared helper function.
* **Risk (4.2):** `HE_TITLE` map is a SSOT violation. Full fix (fetching from Airtable at runtime) would add latency. Pragmatic fix: use `Find Target Doc` record's `issuer_name` field as fallback when map misses.
* **Risk (4.2):** Rename is async (after webhook response). User sees `{ok: true}` before rename completes. Not changing this — it's acceptable. Just ensure failures are logged clearly.

## 6. Proposed Solution (The Blueprint)

### 4.1 — Lighten Radio Options

#### CSS Changes (style.css)
Remove card borders, reduce padding, add subtle separator:

```css
.ai-comparison-radio {
    display: flex;
    align-items: flex-start;  /* was center — better for multi-line */
    gap: var(--sp-2);         /* was --sp-3 */
    padding: var(--sp-2) 0;   /* was --sp-4 --sp-4 — no horizontal padding */
    border: none;              /* was 1.5px solid --gray-200 */
    border-radius: 0;         /* was --radius-md */
    cursor: pointer;
    transition: color 0.15s;
    font-size: var(--text-sm);
    color: var(--gray-600);    /* was --gray-700 — slightly lighter for boilerplate text */
}
.ai-comparison-radio b { color: var(--gray-800); }  /* bold parts stand out */

.ai-comparison-radio + .ai-comparison-radio {
    border-top: 1px solid var(--gray-100);  /* subtle separator */
    padding-top: var(--sp-2);
}

.ai-comparison-radio:hover { color: var(--brand-600); background: none; }
.ai-comparison-radio.selected,
.ai-comparison-radio:has(input:checked) {
    color: var(--brand-700);
    font-weight: 500;
    background: none;
}

.ai-validation-options { gap: 0; }  /* was --sp-2 */
.ai-validation-title { margin-bottom: var(--sp-1); }  /* was --sp-2 */
```

Mobile override (line 3287): simplify to just font-size since padding is already compact.

#### JS Changes (script.js)

**New helper function** — safe `<b>`-only sanitizer:
```js
function renderDocLabel(name) {
    return escapeHtml(name).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
}
```

**Update both render paths** (lines 2200+2208 and 3006+3014):
- Change `d.name` source to preserve `<b>` tags (currently the `d.name` from `missing_docs` may or may not have them — need to verify)
- Replace `${escapeHtml(docName)}` with `${renderDocLabel(docName)}`

**Also update line 2164** where State A strips `<b>` tags from `matched_doc_name`:
- Currently: `const docName = (item.matched_doc_name || '').replace(/<\/?b>/g, '');`
- This is for the top-level match display, NOT the radio options. Leave it as-is (State A uses `escapeHtml` for the template match label).

### 4.2 — Fix OneDrive Rename Gaps

#### Change 1: `general_doc` fallback in `Prepare File Move`

Replace:
```js
const targetHeTitle = HE_TITLE[targetTemplateId] || '';
```
With:
```js
let targetHeTitle = HE_TITLE[targetTemplateId] || '';
if (!targetHeTitle && pa.new_doc_name) {
    // Custom doc — use the user-provided name
    targetHeTitle = pa.new_doc_name.replace(/<[^>]*>/g, '').replace(/\*\*/g, '').trim();
    _log.push(`REASSIGN: using custom doc name: ${targetHeTitle}`);
}
if (!targetHeTitle) {
    // Fallback: extract base title from Find Target Doc record
    try {
        const targetDoc = $('Find Target Doc').first().json;
        const rawName = targetDoc.issuer_name || targetDoc.document_title || '';
        targetHeTitle = rawName.replace(/<[^>]*>/g, '').replace(/\*\*/g, '').split(' – ')[0].trim();
        _log.push(`REASSIGN: fallback to target doc title: ${targetHeTitle}`);
    } catch (e) {
        _log.push(`REASSIGN: fallback failed: ${e.message}`);
    }
}
```

This handles:
1. Known templates → `HE_TITLE` map (fast, no extra lookup)
2. Custom `general_doc` → `pa.new_doc_name` (user-provided name)
3. Unknown template not in map → `Find Target Doc` record's `issuer_name` (Airtable data)

#### Change 2: No other n8n changes needed

The existing rename path (Build Move Body → Move/Rename File → Update File URLs) is complete and correct. The only gap was the filename computation in `Prepare File Move`.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/css/style.css` | Modify | Remove card borders, reduce padding, add separator, update hover/selected states |
| `admin/js/script.js` | Modify | Add `renderDocLabel()` helper, update 2 render paths to use it |
| n8n `Prepare File Move` (code-prepare-file-move) | Modify | Add `general_doc` + Airtable fallback for `targetHeTitle` |

## 7. Validation Plan

### 4.1 — UI
* [ ] Load AI Review tab with issuer-mismatch cards — radio options appear as lightweight list (no borders)
* [ ] Bold parts (year, employer, person name) are visible in radio labels
* [ ] Selecting a radio highlights it (color change, not border)
* [ ] Hover effect is subtle (color only)
* [ ] Separator lines between options are visible but light
* [ ] After approving/rejecting a sibling card, radio list rebuilds correctly (rebuild path)
* [ ] Mobile: options are compact and readable

### 4.2 — OneDrive Rename
* [ ] **Test existing path:** Reassign a known-template doc → check n8n execution log for rename → verify OneDrive filename changed
* [ ] **Test general_doc:** Reassign to custom doc type with new name → verify filename uses the custom name
* [ ] **Test no-regression:** Approve a doc → verify approve rename path still works
* [ ] **Test reject:** Reject a doc → verify it moves to archive (no rename, just move)

## 8. Implementation Notes (Post-Code)

**Session 102 (2026-03-07):**
- CSS: Replaced card-style radio with lightweight list. `align-items: flex-start`, `gap: 0`, `border-top` separator, color-only hover/selected. Mobile override simplified to font-size only.
- JS: Added `renderDocLabel()` after `escapeHtml()` — allowlist sanitizer restoring only `<b>`/`</b>`. Updated both render paths (line ~2208 initial, line ~3014 rebuild).
- n8n: 3-tier fallback in `Prepare File Move` for `targetHeTitle`. Tier 1: HE_TITLE map. Tier 2: `pa.new_doc_name` (strips HTML/bold). Tier 3: `Find Target Doc` record's `issuer_name`/`document_title` (splits on ` – `, takes base title).
- Commit `a23beb9` pushed to main. n8n workflow `c1d7zPAmHfHM71nV` updated (1 op).
