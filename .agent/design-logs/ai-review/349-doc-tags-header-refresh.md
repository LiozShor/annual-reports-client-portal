# Design Log 349: AI Review — Live Doc-Tag Header + Pane-1 Stats Across All Mutations
**Status:** [COMPLETED]
**Date:** 2026-04-26
**Related Logs:** DL-074 (live doc state), DL-227 (inline waive/receive on tags), DL-330 (3-pane rework), DL-344 (reject clears unrelated approval)

## 1. Context & Problem

User asked whether the missing-docs header bar (`.ai-missing-docs-body` with the colored doc tags) in the AI Review tab gets refreshed when approving/rejecting documents. Investigation found a regression introduced by DL-330's 3-pane rework:

- **Mobile/legacy** still uses `buildClientAccordionHtml` (script.js:4986) → wraps everything in `.ai-accordion[data-client="..."]`. `refreshClientDocTags(clientName)` works.
- **Desktop 3-pane** uses `buildDesktopClientDocsHtml` (script.js:4201) → renders `.ai-missing-docs-body` directly into `#aiDocsPane`, NOT inside any `.ai-accordion`. `refreshClientDocTags`'s `document.querySelector('.ai-accordion[data-client="X"]')` returned `null`, the function silently no-opped, and the header stayed frozen until a tab switch / silent refresh.

Additionally, the per-client row in pane 1 (`.ai-client-row` with the "X/Y נבדקו" progress + pending chip from `buildClientListRowHtml` at script.js:5125) was rebuilt only on full re-render or on full-client dismissal. Single approve/reject mutations left that counter stale.

## 2. User Requirements
1. **Q:** Symptom — header stale after approve/reject?
   **A:** Suspect it's not refreshing in any case (audit needed).
2. **Q:** Should reject refresh the header? DL-344 ("reject clears unrelated approval") may revert a doc to missing.
   **A:** No — keep reject silent on the header (doc-status server-side change is rare and acceptable until next refresh).
3. **Q:** Scope?
   **A:** Audit all paths.
4. **Q:** Server reconcile?
   **A:** No — optimistic only.

## 3. Research
Cumulative — DL-074 + DL-227 already established the optimistic / DOM-SSOT pattern (data-first, surgical DOM updates, no full re-render). This log applies the same patterns to the new 3-pane DOM structure introduced by DL-330. No new domain research needed.

### Key Principles Reapplied
- **Data-first, DOM-second** — `aiClassificationsData` is SSOT; mutations write data, then re-render the affected DOM slice.
- **Surgical DOM updates over full re-render** — preserves scroll position, expansion state, focus.
- **Layout-aware refreshers** — when DOM structure forks (mobile vs desktop), the refresher must handle both branches explicitly. A silent `querySelector` failure is the worst kind of bug because tests still pass.

## 4. Codebase Analysis

### Mutation-path audit (pre-DL-349)

| Path | Calls `refreshClientDocTags`? | Pane-1 stats refreshed? |
|---|---|---|
| `approveAIClassification` (6197) | ✅ via `updateClientDocState` | ❌ |
| `approveAIClassificationAddRequired` (6247) | ✅ | ❌ |
| `submitAIReassign` (6717) | ✅ | ❌ |
| `executeReject` (6583) | ❌ (intentional per user) | ❌ |
| `selectDocTagStatus` → `updateDocStatusInline` (8047) | ✅ | ❌ |
| `restoreDocTagStatus` (8101) | ✅ | ❌ |
| `transitionCardToReviewed` (7161) | ❌ | ❌ |

Even paths that DO call `refreshClientDocTags` were silent no-ops on desktop because of the DOM mismatch.

### Existing Solutions Reused
- `applyDocStatusChange` (script.js:8139) — keeps mutating data only; unchanged.
- `buildClientListRowHtml` (script.js:5125) — already renders a `.ai-client-row[data-client="..."]` element with stats; reused for surgical pane-1 row replacement.
- `renderDocTag` (script.js:7959) — single source for tag HTML.
- `selectedClientName` (script.js:3593) — module-level state used to gate the desktop branch.

## 5. Technical Constraints & Risks
- `selectedClientName` may be stale if user navigates away mid-mutation. Mitigated by `docsPane.offsetParent !== null` visibility check.
- Reject + DL-344: server-side guard means reject is doc-state-neutral in the normal case. The rare cross-classification revert is accepted as eventually-consistent (next silent refresh corrects it). User explicitly chose this trade-off.

## 6. Implemented Solution

### 6.1 New shared helper: `buildDocCategoryTagsHtml(displayDocs)` (script.js:8175)
Single source for the `.ai-missing-category-tags` HTML, used by:
- `buildClientAccordionHtml` (mobile initial render)
- `buildDesktopClientDocsHtml` (desktop initial render)
- `refreshClientDocTags` (refresh on mutation)

### 6.2 Layout-aware `refreshClientDocTags(clientName)` (script.js:8195)
- Desktop branch: queries `#aiDocsPane`, gated by `selectedClientName === clientName && offsetParent !== null`. Updates `.ai-missing-docs-body` and `.ai-section-header` label.
- Mobile branch: existing `.ai-accordion[data-client="..."]` lookup, with combobox + issuer-mismatch radio re-init unchanged.

### 6.3 New `refreshClientRowStats(clientName)` (after script.js:8296)
Surgical replacement of one `.ai-client-row` by re-running `buildClientListRowHtml`. Removes the row entirely if the client has no items left.

### 6.4 Wiring
- `updateClientDocState` (7929) → also calls `refreshClientRowStats` (covers approve/reassign/tag-menu/restore).
- `transitionCardToReviewed` (7161) → calls `refreshClientRowStats(item.client_name)` after `recalcAIStats`. This single hook covers BOTH approve and reject paths since both transition the card.
- `executeReject` deliberately does NOT call `refreshClientDocTags` (per user); only the pane-1 counter updates via `transitionCardToReviewed`.

### 6.5 Cache-bust
`frontend/admin/index.html` `?v=339` → `?v=349`.

## 7. Validation Plan
- [ ] **Desktop — approve:** Tag flips `ai-missing-doc-tag` → `ai-doc-tag-received` immediately; header label "(X/Y התקבלו)" updates.
- [ ] **Desktop — reject:** Header bar UNCHANGED (intentional); pane-1 row "X/Y נבדקו" + pending chip update.
- [ ] **Desktop — reassign:** Both old and new tags reflect; header X/Y updates; pane-1 row updates.
- [ ] **Desktop — tag-menu (waive/receive/restore):** Tag re-renders correctly; header counter + pane-1 update.
- [ ] **Desktop — pane-1 row updates without tab switch** for any mutation.
- [ ] **Mobile/legacy accordion (regression):** Same flows on mobile width — accordion-based refresh unchanged.
- [ ] **Cross-client safety:** Mutating client B while pane-2 shows client A does not corrupt A's header (visibility guard).
- [ ] **Pane-1 row removal:** When the last item for a client is dismissed (full-client done flow), row is removed cleanly.
- [ ] **No console errors** during any flow.
- [ ] **Live test** with a real client on production data (per CLAUDE.md "Verify With Live Data Before Merging").

## 8. Implementation Notes
- Removed dead `catGroups` build in `buildDesktopClientDocsHtml` after switching to the shared helper (script.js:4271 area).
- The desktop refresher uses `selectedClientName === clientName` rather than a `data-client` attribute on `#aiDocsPane` because `aiDocsPane` is a static container; selection state lives in the JS module.
- `refreshClientRowStats` calls `safeCreateIcons(newRow)` because `buildClientListRowHtml` emits `${icon('folder-open', ...)}` and `${icon('check', ...)}` — without it the SVG sprite refs render unhydrated on the replaced row.
