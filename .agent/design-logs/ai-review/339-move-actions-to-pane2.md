# Design Log 339: AI Review — Move Actions Panel to Pane 2 + Bundled Bug Fixes

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-24
**Related Logs:** DL-278 (scroll-into-view), DL-330 (3-pane rework), DL-332 (pane 1 density), DL-334 v2 / v3 / v3.1 / v3.2 / v3.3 (cockpit thin rows + state-aware actions panel)
**Plan source:** `C:\Users\liozm\.claude\plans\c-users-liozm-desktop-moshe-annual-repo-linear-stream.md`

## 1. Context & Problem

DL-334 put the state-aware actions panel in pane 3 beneath the preview iframe, creating a vertical preview / actions split. Field use exposed three friction points:

1. **Panel is too far from the doc row.** User clicks a row in pane 2, then has to traverse their eye across the viewport to pane 3's lower half to act. Two-hand pattern — mouse on row, eye on actions — is bad ergonomics on wide monitors.
2. **Fix A (bidi):** DL-334 v3.2 added `unicode-bidi: isolate` on `.ai-doc-row__filename` paired with `dir="auto"` to stop Hebrew/Latin bleed. Side effect: filenames whose first strong char is Latin (`.pdf`-only names or English senders) flip the *cell's* alignment inside the RTL flex row, producing a ragged right edge in the list.
3. **Fix C (legacy CSS):** the pre-DL-334 `.ai-missing-docs-body` max-height/transition collapse rules coexist with the new thin-rows section header. On initial desktop render the max-height animation timing sometimes measures 0, leaving the section stuck collapsed even when the `.open` class is present.

Plus an implicit:

4. **Fix B (panel redraw):** moving the panel into pane 2 means the show/hide trigger is per-selection. Current `selectDocument` renders into `#aiActionsPanel` inside pane 3; we need the container to toggle visibility based on whether a row is selected (the `.has-selection` class on `.ai-review-docs`).

## 2. Requirements

- Pane 2 splits vertically: doc list (60%) + actions panel (40%) when a row is selected. Full-height doc list when nothing is selected.
- `#aiActionsPanel` relocates from pane 3 into pane 2 (still the same id, still rendered by the same `renderActionsPanel` call).
- Pane 3 shrinks to just `.ai-preview-frame`.
- Mobile (<768px) untouched — pane 2 stays `display:none`, panel stays hidden.
- Fix A: pure-Latin filenames must not flip the row-cell's alignment.
- Fix C: missing-docs body expand must work on both desktop (thin-rows) and mobile (fat-card) paths reliably, first paint included.
- Preserve every class from DL-334 section (all state variants, lozenges, buttons).

## 3. Research (brief)

Only prior-DL research. No new external sources needed — this is a layout relocation, not a new pattern. The preview+actions cockpit pattern (DL-334 research) still holds; DL-339 only changes which pane hosts the actions panel.

## 5. Codebase Analysis

**Primary surfaces (Workstream A scope):**

| File | Lines | What |
|------|-------|------|
| `frontend/admin/index.html` | 13 | CSS cache-bust `?v=304` → `?v=305` |
| `frontend/admin/index.html` | 1019-1048 | Remove `<div class="ai-actions-panel" id="aiActionsPanel"></div>` from inside `.ai-review-detail`. `.ai-preview-frame` becomes the sole child. |
| `frontend/admin/css/style.css` | ~2464-2474 | **Fix C** — replace legacy `max-height: 0` / `.open { max-height: 2000px }` rules with display-toggle. Mobile's `toggleMissingDocs` at script.js:4802 toggles `.ai-missing-docs-group.open`; new desktop hook also matches `.ai-review-docs .ai-section-header.open + .ai-missing-docs-body` so both paths trigger `display: block`. |
| `frontend/admin/css/style.css` | ~9511-9537 | **Fix A** — delete `unicode-bidi: isolate` from `.ai-doc-row__filename` and `.ai-doc-row__category`. Leave comments explaining why. |
| `frontend/admin/css/style.css` | ~9893 (end of DL-334 section) | Append new `/* ============ DL-339 v1 ... */` subsection with: `.ai-review-docs` flex conversion; new `.ai-doc-list` wrapper; `.ai-actions-panel` hidden-by-default + `.has-selection` show rules; new `.ai-doc-row__filename { unicode-bidi: plaintext; text-align: start }`. |

**Fix C decision — display toggle vs max-height:**

> Mobile calls `toggleMissingDocs(el)` (script.js:4802) which only flips the `.open` class on `.ai-missing-docs-group`. The legacy CSS coupled that class to a `max-height 0 → 2000px` transition; we replace it with `display: none → block`. Both the legacy mobile selector (`.ai-missing-docs-group.open .ai-missing-docs-body`) AND a new desktop selector (`.ai-review-docs .ai-section-header.open + .ai-missing-docs-body`) activate `display: block`, so mobile keeps working unchanged while desktop also gains a reliable expand on first paint. The transition is sacrificed — the animation was already broken on first paint; a snap-open is acceptable per spec priority (correctness > motion).

**Mobile media query check:**

`@media (max-width: 768px)` at style.css L9887-9892 explicitly hides `.ai-preview-frame, .ai-actions-panel`. After DL-339 the panel lives inside `.ai-review-docs`, which is itself `display:none` at L4906-4908 — so the panel is implicitly hidden on mobile. The explicit rule remains (harmless redundancy, defensive).

## 6. Constraints

- Vanilla CSS + HTML only for Workstream A. JS logic (the `.has-selection` class toggle, builder changes) is Workstream B.
- No new tokens.
- Do not delete any DL-334 class.
- Pane 2's existing `overflow-y: auto` (style.css:3527) is left in place. With `display: flex; flex-direction: column; min-height: 0`, the child `.ai-doc-list` takes scroll; the outer remains a scroll container as a fallback on unusually short viewports.

## 7. Proposed Solution + Validation Plan

**Workstream A (this file):**

1. DL file (this one) at `.agent/design-logs/ai-review/339-move-actions-to-pane2.md`.
2. `index.html`: bump CSS cache to `?v=305`; remove actions panel from pane 3.
3. `style.css`: append DL-339 subsection with pane-2 flex, `.ai-doc-list`, `.has-selection` rules, Fix A. Delete two unicode-bidi rules. Replace Fix C legacy rules.

**Workstream B (separate session):**
- Inject `<div class="ai-doc-list">` wrapper + keep `<div class="ai-actions-panel" id="aiActionsPanel">` inside pane 2 via `docsPane.innerHTML` builder.
- `selectDocument` / `resetPreviewPanel` toggle `.has-selection` on `.ai-review-docs`.
- Bump `script.js?v=320` → `?v=321`.

**Workstream C:**
- Bundle commit + push after A+B land.

**Validation plan:**
- Load admin panel in Chrome on 1920x1080. Select client in pane 1 → pane 2 shows doc list full height, pane 3 shows only preview. Click doc row → pane 2 splits 60/40, actions panel renders in lower half. Click empty area → panel hides, list restores to full height.
- Test pure-Latin filename (`test.pdf`) in list — right edge stays aligned with other rows.
- Expand/collapse missing-docs section on desktop + verify mobile accordion still toggles.
- Mobile Chrome DevTools emulator — ensure pane 2 + 3 both hidden, fat-card path still renders.

## 8. Workstream Split

| Workstream | Scope | Files |
|-----------|-------|-------|
| A (this) | DOM shell, CSS layout, bundled fixes | `index.html`, `style.css`, DL file |
| B | JS builder + `.has-selection` toggle + cache bump | `script.js` (builder, `selectDocument`, `resetPreviewPanel`) |
| C | Commit, push, verify, mark COMPLETED | — |

## 11. Risks

- `.ai-review-docs` gains `display: flex` while keeping `overflow-y: auto` from L3527. Risk: double-scroll. Mitigated by `min-height: 0` on outer + `overflow-y: auto` on `.ai-doc-list`; outer overflow is inert while children fit.
- Fix C removal of max-height transition: loses the animated expand on mobile fat-card. Acceptable — it was already unreliable on desktop and users expected-and-get a snap-open.
- `.has-selection` class is set by Workstream B JS; without B, the panel never shows. Expected — A alone ships hidden panel.
- Existing inline style on `#aiActionsPanel` (none observed in current pane-3 markup). No pre-existing conflicts.
- **`flex-basis` transition jank (post-deploy only):** animating `flex-basis` can jank if the parent container's size changes mid-animation. `.ai-review-docs` has a stable `height: 100%` from the pane-grid, so expected smooth. If post-deploy feedback surfaces jitter on lower-end hardware, the fallback is: swap `flex-basis` transition on `.ai-doc-list` for `max-height` (list) + `opacity` (panel). Not pre-implemented — only applied if real-world feedback demands it.

## 12. Implementation Notes (Post-Code)

Landed 2026-04-24 via `/subagent-driven-development` (serial A → B → C).

- **Workstream A (CSS + HTML + DL file):** pane 3 stripped to preview-only (`.ai-actions-panel` removed from `index.html`). `.ai-review-docs` converted to flex column. New `.ai-doc-list` wrapper + `.has-selection` toggle drives the 60/40 split via `flex-basis` (180ms ease-out transition on `.ai-doc-list`, `display: flex` flipped on `.ai-actions-panel`). Legacy `.ai-missing-docs-body { max-height: 0 }` accordion replaced with dual-selector display toggle (mobile `.ai-missing-docs-group.open` + desktop `.ai-review-docs .ai-section-header.open + .ai-missing-docs-body`). Fix A CSS: `unicode-bidi: plaintext; text-align: start` on `.ai-doc-row__filename`; earlier v3.2 `unicode-bidi: isolate` removed since `dir="auto"` is also removed.
- **Workstream B (JS wiring):** `buildDesktopClientDocsHtml` emits rows inside `<div class="ai-doc-list">...</div>` + appended `<div class="ai-actions-panel" id="aiActionsPanel"></div>`. `selectDocument` / `resetPreviewPanel` / silent-refresh "active-item-disappeared" branch toggle `.has-selection` on `.ai-review-docs`. Fix A: `dir="auto"` removed from the filename span. Fix B: new `truncateKeepExtension(name, 45)` helper replaces the deleted `truncateMiddle` (sole caller was `renderDocRow`); end-truncates while preserving extension (Gmail/Finder convention).
- **Workstream C (scroll + housekeeping):** `selectDocument` captures `wasFirstSelection` BEFORE toggling `.has-selection`; on first click (empty → has-selection) schedules `row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })` 200ms after the 180ms list transition so the active row stays visible in the new 60%-height viewport. Subsequent clicks skip the timeout (layout already split, no height change). INDEX.md counters bumped (216 / 118 / ai-review 36) + DL-339 entry added. current-status.md gains DL-339 TODO section at top.
- **Cache-bust:** `style.css?v=305`, `script.js?v=321`.
- **Known follow-up:** if `flex-basis` transition jank surfaces in real use on lower-end hardware, fallback is `max-height` on `.ai-doc-list` + `opacity` on `.ai-actions-panel` — not pre-implemented (see §11).
