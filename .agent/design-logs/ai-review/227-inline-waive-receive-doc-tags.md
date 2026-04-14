# Design Log 227: Inline Waive/Receive on AI Review Doc Tags
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-30
**Related Logs:** DL-074 (live doc state & card labels), DL-205 (clear file fields on status revert)

## 1. Context & Problem
The AI Review tab shows a collapsible "missing docs" tag list per client, but these tags are **read-only**. To waive or manually mark a document as received, the admin must navigate to the Document Manager — breaking the review flow. The user wants to be able to waive/receive any doc directly from the AI Review tab by clicking the doc tags.

## 2. User Requirements
1. **Q:** Where should the waive/receive actions appear?
   **A:** On the doc tags themselves — click action on each tag in the missing docs list.

2. **Q:** Which status changes should be available?
   **A:** Waive + Receive only (the two most common actions).

3. **Q:** Should the UI update instantly or reload?
   **A:** Instant optimistic update — no page reload.

4. **Q:** Should there be a confirmation step?
   **A:** Direct toggle — one click to waive/receive, can undo by clicking again.

## 3. Research
### Domain
Admin Dashboard UX, Inline Status Actions, Optimistic UI

### Sources Consulted
1. **Material Design — Chips/Filter Chips** — Toggle chips cycle between two states on click; for 3+ states, use a menu. Our pattern (click = toggle to Waived, click again = restore) aligns perfectly.
2. **Carbon Design System — Status Indicators** — Each status must differ by at least 3 properties (color, icon/shape, text, opacity) for WCAG compliance.
3. **Optimistic UI Patterns (various)** — Apply change instantly, fire API in background, roll back only on failure. Show undo toast for reversibility.

### Key Principles Extracted
- **Single-click for happy path** — toggle between Required_Missing ↔ Waived with one click
- **Minimum 3 distinguishing properties per state** — color + icon + opacity/decoration
- **Never hide waived items** — keep them visible but de-emphasized (accounting/legal standard)
- **Reversibility via undo toast** — replaces confirmation dialogs for low-risk actions

### Patterns to Use
- **Toggle chip pattern:** Click missing tag → becomes waived (dimmed + strikethrough). Click waived tag → restores to missing.
- **Optimistic UI:** Update data + DOM immediately, fire API in background, roll back on error.
- **Undo toast:** `showAIToast` with action button for 5-second undo window.

### Anti-Patterns to Avoid
- **Cycling through 3+ states with repeated clicks** — we avoid this by only toggling Missing ↔ Waived on click, and using a separate mechanism for Receive.
- **Color-only state differentiation** — we use color + icon prefix + opacity.
- **Making "Received" casually toggleable** — Received is a system-managed state; clicking a received tag does nothing.

### Research Verdict
Click-to-toggle on tags for Waive/Restore. For "Receive" (mark as manually received without a file), add a small action on right-click or shift+click since it's less common than waive. However, based on user preference for simplicity, we'll use a **two-click pattern**: first click opens a tiny inline menu (Waive / Mark Received), keeping both actions accessible without overloading the single-click.

**Update after reflection:** The user said "direct toggle" — meaning they want minimal friction. Since waive is the more common action from AI Review context, **single click = toggle waive**. For the less-common "mark received" action, we add a **right-click context menu** or a **small icon** on hover. This keeps the happy path (waive) as one click while still supporting receive.

**Final decision:** Click = toggle waive. Hover reveals a small "✓" button for mark-received. This gives both actions without menus or multi-step interactions.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `updateClientDocState()` (script.js:3797) already handles updating `all_docs`/`missing_docs` arrays and re-rendering tags after approve actions — can be extended for waive/receive.
  - `POST /edit-documents` API (edit-documents.ts:282) already supports `status_changes` array — can reuse directly.
  - `showAIToast()` (script.js:3981) supports undo pattern with action button.
  - Tag rendering at script.js:2786-2797 — currently only two states: `ai-missing-doc-tag` and `ai-doc-tag-received`.

* **Reuse Decision:**
  - Reuse `POST /edit-documents` with `status_changes` extension — no new API endpoint needed.
  - Extend `updateClientDocState()` to handle waive/receive (currently only handles approve→received).
  - Add new CSS class `ai-doc-tag-waived` following existing tag pattern.
  - Reuse `showAIToast()` for undo feedback.

* **Relevant Files:**
  - `github/annual-reports-client-portal/admin/js/script.js` — tag rendering (2786-2797), `updateClientDocState()` (3797-3867)
  - `github/annual-reports-client-portal/admin/css/style.css` — tag CSS (2161-2187)
  - `api/src/routes/edit-documents.ts` — already supports status_changes, no changes needed
  - `github/annual-reports-client-portal/shared/endpoints.js` — `EDIT_DOCUMENTS` endpoint already defined

* **Existing Patterns:** Tags use CSS variables, `renderDocLabel()` for safe HTML, `escapeAttr()` for attributes.
* **Alignment with Research:** Current two-state tag pattern aligns with Material Design chips. Adding waived as a third visual state with 3+ differentiators follows Carbon DS guidance.
* **Dependencies:** Airtable DOCUMENTS table (status field), `EDIT_DOCUMENTS` endpoint, `report_record_id` available in classification data.

## 5. Technical Constraints & Risks
* **Security:** Uses existing Bearer token auth — no new auth needed. Status changes validated server-side.
* **Risks:**
  - Waiving a doc from AI Review while Document Manager is open for same client — could cause stale state. Mitigated: both use same API, Airtable is SSOT.
  - `report_record_id` must be available in classification data — need to verify it's returned by `get-pending-classifications`.
* **Breaking Changes:** None — additive only. Existing tag rendering unchanged for non-interactive contexts.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Admin can click any doc tag in the AI Review missing docs list to toggle its status (waive/restore), and hover to reveal a "mark received" button — with instant visual feedback and API persistence.

### Logic Flow

#### Click-to-Waive/Restore:
1. Admin clicks a `Required_Missing` tag → tag instantly becomes `ai-doc-tag-waived` (dimmed, strikethrough, "—" prefix)
2. API call fires in background: `POST /edit-documents` with `status_changes: [{ id: doc_record_id, new_status: 'Waived' }]`
3. Undo toast appears: "המסמך סומן כלא נדרש" with "ביטול" button
4. If undo clicked within 5s: revert to `Required_Missing` via another API call
5. If admin clicks a `Waived` tag → restores to `Required_Missing` (same flow, reversed)

#### Hover-to-Receive:
1. Admin hovers over a `Required_Missing` or `Waived` tag → small "✓" icon appears on the right
2. Clicking the "✓" marks the doc as `Received` → tag becomes `ai-doc-tag-received` (green, checkmark prefix)
3. API call fires: `status_changes: [{ id: doc_record_id, new_status: 'Received' }]`
4. Undo toast: "המסמך סומן כהתקבל" with "ביטול" button
5. Received tags are NOT toggleable (click does nothing) — consistent with research

#### Data Update (extending `updateClientDocState`):
1. Find all items for this client in `aiClassificationsData`
2. Update doc status in `all_docs` array
3. Update `missing_docs` array (remove if waived/received, add back if restored)
4. Update `docs_received_count` counter
5. Re-render tags section
6. Re-initialize comboboxes (waived docs shouldn't appear in reassign options)

### Visual States
| Status | CSS Class | Background | Text Color | Opacity | Decoration | Prefix | Cursor |
|--------|-----------|------------|------------|---------|------------|--------|--------|
| Required_Missing | `ai-missing-doc-tag` | `gray-100` | `gray-600` | 1.0 | none | none | pointer |
| Waived | `ai-doc-tag-waived` | `gray-100` | `gray-400` | 0.6 | line-through | `—` | pointer |
| Received | `ai-doc-tag-received` | `success-50` | `gray-400` | 1.0 | line-through | `✓` | default |

### Data Structures / Schema Changes
No Airtable schema changes. No API changes. Using existing `status_changes` extension in `POST /edit-documents`.

**Frontend data shape for API call:**
```javascript
{
  data: {
    fields: [{ label: 'report_record_id', type: 'HIDDEN_FIELDS', value: reportRecordId }],
    extensions: {
      status_changes: [{ id: docRecordId, new_status: 'Waived' | 'Required_Missing' | 'Received' }],
      send_email: false  // No email notification for manual status changes from AI Review
    }
  }
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Make tags clickable: add `onclick` to tags, new `toggleDocStatus()` function, new `markDocReceived()` function, extend `updateClientDocState()` for waive/receive |
| `admin/css/style.css` | Modify | Add `.ai-doc-tag-waived` class, hover styles for receive button on tags, cursor:pointer on interactive tags |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Active TODOs"

## 7. Validation Plan
* [ ] Click a Required_Missing tag → visually changes to waived (dimmed + strikethrough + "—" prefix)
* [ ] Click the waived tag again → restores to Required_Missing
* [ ] Hover over a Required_Missing tag → "✓" button appears; click it → tag becomes Received (green + checkmark)
* [ ] Received tags are NOT clickable (no status change)
* [ ] Undo toast appears for both waive and receive actions; clicking "ביטול" reverts the change
* [ ] After waive/receive, the docs counter updates correctly (e.g., "3/10 התקבלו")
* [ ] Waived docs are removed from combobox reassign options
* [ ] API call succeeds — verify in Airtable that document status actually changed
* [ ] Error handling: if API fails, tag reverts to previous state and error toast shown
* [ ] Multiple rapid clicks don't cause duplicate API calls or inconsistent state
* [ ] Mobile: tags are still tappable and hover-to-receive works (or falls back gracefully)

## 8. Implementation Notes (Post-Code)
* Refactored `updateClientDocState()` to delegate to `applyDocStatusChange()` + `refreshClientDocTags()` — eliminates code duplication between approve-flow and inline status changes.
* `refreshClientDocTags()` also rebuilds issuer-mismatch radio lists (consolidated from old `updateClientDocState`).
* Note: Airtable query in `get-pending-classifications` filters out Waived docs (`{status} != 'Waived'`). This means waived docs won't appear on next full reload — only visible during current session after waiving. This is acceptable behavior for AI Review context.
* Research principles applied: Toggle chip pattern (Material Design), 3-property state differentiation (Carbon DS), optimistic UI with undo toast.
