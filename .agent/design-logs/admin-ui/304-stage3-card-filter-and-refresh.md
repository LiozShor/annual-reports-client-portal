---
title: Stage-3 stat card filter + approve-and-send dashboard sync + PA cards collapsed by default + doc-label pencil shows raw bold tags
status: IMPLEMENTED — NEED TESTING
date: 2026-04-19
branch: DL-304-pa-approve-send-removes-card
---

# DL-304: Dashboard stage-3 + PA queue polish

## 1. Context & Problem

Four small friction bugs on the admin dashboard / PA queue:

1. **Stage-3 stat card hijacks navigation.** The `.stat-card.stage-3` (received-questionnaire / docs-not-sent) was wired to `switchTab('pending-approval')`, jumping the admin to the PA queue tab. Every other stage card on the dashboard just filters the clients table (`toggleStageFilter(n)`). The user wanted stage 3 to behave like the others — filter in place, stay on the dashboard.

2. **Approve-and-send leaves a stale row in the stage-3 list.** After clicking approve-and-send in the PA queue, the PA card is removed locally and the backend moves the report `Pending_Approval` → `Collecting_Docs`. But `clientsData` (the dashboard table source) still had `stage = 'Pending_Approval'`, so the stage-3 count + filtered table still showed the client until a manual refresh. The PA queue did the optimistic local update; the dashboard didn't.

3. **PA cards auto-expanded first 3 on tab navigation.** DL-298 opted-in the first 3 cards of the current page on every render. User asked for all cards to start collapsed.

4. **Pencil-edit strips `<b>` tags from doc label, saves plaintext.** Doc names carry `<b>...</b>` around the emphasized chunk (e.g. the form number or issuer). The pencil input stripped them on open, so the admin couldn't see what was bold — and saving wrote the stripped text back, losing the bold on display. `renderDocLabel()` on the read path is ready to convert `<b>` back to real bold; the edit path just needs to stop stripping.

## 2. Implementation

### Fix 1 — Stage-3 card filters in place
`frontend/admin/index.html:135`

```diff
- <div class="stat-card stage-3" onclick="switchTab('pending-approval', event)" ondblclick="toggleStageFilter('')" title="...">
+ <div class="stat-card stage-3" onclick="toggleStageFilter('3')" ondblclick="toggleStageFilter('')">
```

Matches stage-4's pattern exactly. Dropped the now-wrong title tooltip.

### Fix 2 — Approve-and-send updates `clientsData` locally
`frontend/admin/js/script.js` (`approveAndSendFromQueue` success branch)

After the existing PA-list optimistic removal, also:
- Find the matching `clientsData` entry by `report_id`.
- If it's still in `Pending_Approval`, flip to `Collecting_Docs`.
- `recalculateStats()` to update stage-card counts.
- Reset `_clientsBaseKey = ''` and re-run `toggleStageFilter(currentFilter, false)` to re-render the table.

No network round-trip; mirrors how the PA queue already handles its own optimistic state. Backend is authoritative on next dashboard refresh, so drift would self-heal.

### Fix 3 — PA cards collapsed by default
`frontend/admin/js/script.js` (`renderPendingApprovalCards`)

Removed the DL-298 loop that pre-filled `_paExpanded` with the first 3 cards of the current page. Cards now stay collapsed until the user clicks a chevron.

### Fix 4 — Pencil input shows raw `<b>` tags and keeps bold on save
`frontend/admin/js/script.js` (`openPaIssuerEdit`, ~line 7519)

```diff
- const currentName = (doc && doc.name ? doc.name : '').replace(/<\/?b>/g, '');
+ const currentName = (doc && doc.name ? doc.name : '');
```

The input now shows the literal `<b>` / `</b>` markers so the admin can see which chunk is bold and preserve/adjust it. Save path (`savePaIssuerEdit`) already sends `input.value` verbatim to `EDIT_DOCUMENTS` as `issuer_name`, and the re-render uses `renderDocLabel()` which converts escaped `&lt;b&gt;` back to real `<b>`. So the round-trip is now lossless: raw edit in → raw save → rendered bold on display.

## 3. Files Changed

| File | Action |
|---|---|
| `frontend/admin/index.html` | stage-3 card onclick → `toggleStageFilter('3')` |
| `frontend/admin/js/script.js` | approve-and-send syncs dashboard client row; PA cards no longer auto-expanded; doc-label pencil shows raw `<b>` tags |

## 4. Testing

- [ ] Click stage-3 card — dashboard filter applies, table shows only stage-3 rows, no tab switch.
- [ ] Double-click stage-3 card clears filter.
- [ ] From PA queue, approve-and-send a client — confirm:
  - PA card slides out (existing behavior).
  - Stage-3 count decrements without refresh.
  - Client no longer appears under stage-3 filter.
  - Client appears under stage-4 filter.
- [ ] Hard refresh — counts/filters match the optimistic state (no drift from backend).
- [ ] Navigate to PA queue tab — all cards collapsed (chevron closed). Clicking a chevron expands that card only.
- [ ] Pencil-edit a doc whose label is partially bold — input shows literal `<b>...</b>` wrapping the bold chunk. Change the wrapped text, save. Displayed label shows the new text still bold. No `<b>` visible as plaintext anywhere post-save.

## 5. Notes

Kept scope tight: only the one mutation path (`approveAndSendFromQueue`) updates `clientsData`. Other PA-queue actions that also move the stage (if any appear later) will need the same treatment.

For the pencil-edit fix, the input is a plain textbox — no rich-text affordance. Admins must type `<b>` / `</b>` manually if they want to add/remove bold spans. Good enough for current needs; a WYSIWYG upgrade is out of scope.
