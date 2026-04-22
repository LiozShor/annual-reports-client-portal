# Design Log 330: AI Review 3-Pane Rework + Scroll Isolation + Progress Counter
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-22
**Related Logs:** DL-075 (original master-detail split-view), DL-109 (card lightening + rename), DL-278 (accordion scroll-into-view), DL-306 (PA-banner deep-link), DL-316 (React-port scoping — still DRAFT)

## 1. Context & Problem

User reports the AI Review tab's scrolling is confusing. Specifically:
- **Two scroll areas compete** — with the current 2-pane layout (sticky preview + single scrollable card column of grouped accordions), mouse-wheel events land on the wrong pane depending on cursor position. No `overscroll-behavior` isolation exists.
- **The card list feels endless** — all clients' accordions stack in one long column. No sense of progress, no per-client boundary.

The original layout (DL-075) sits the preview beside one long accordion column. Today that column holds every client for every filter; reviewers jump between clients, so they scroll a lot, and the nested accordion → doc-cards hierarchy in a single scroll surface is unfocused.

## 2. User Requirements

1. **Q:** Which pain point?
   **A:** Two scroll areas competing (wheel on wrong pane) + long card list feels endless.
2. **Q:** Which surface?
   **A:** Desktop split-view only. Mobile modal is fine as-is.
3. **Q:** Review flow?
   **A:** Jump around (not sequential).
4. **Q:** Should preview auto-follow as you scroll cards?
   **A:** No — only change preview on explicit click (current behavior).
5. **Q:** User proposed: switch to 3-col layout (clients | docs of chosen client | preview). Keep the cross-client flat view?
   **A:** Drop it entirely — always pick a client first.
6. **Q:** Client row look?
   **A:** Exactly like today's accordion header (name + stats badges + actions), but clicking opens the client in the middle column instead of expanding an accordion.
7. **Q:** Widths?
   **A:** Fixed 240 / 340 / flex.
8. **Q:** Scope?
   **A:** Everything in one DL — rework + scroll isolation + progress counter.

## 3. Research

### Domain
Three-pane master-detail UX; scroll-chaining control; review-queue progress indicators.

### Sources Consulted
1. **Wikipedia — Three-pane interface** — Popularized by Outlook Express (folders / message list / reading pane). Canonical hierarchical master-detail-with-inspector since the 90s.
2. **Microsoft Learn — List/Details Pattern (Windows)** — Fixed column widths on wide screens; collapse to stacked/overlay on narrow. Breakpoint ~720–1024px common.
3. **Vaadin Master-Detail component + Material Responsive UI** — At narrower widths collapse the far-left pane into a drawer; preserve middle+right panes.
4. **MDN — `overscroll-behavior`** — `contain` on inner scroll containers is the canonical fix for wheel events chaining between nested panes. Universal browser support as of 2026.
5. **Apple HIG Split Views + Cloudscape Split View** — Each pane owns its scroll boundary explicitly; subtle 1px divider signals boundary.
6. **NN/g Bulk Actions** — In 3-pane review workflows, bulk actions live in pane 2 (the list), not the detail. Matches our doc-card approve/waive affordances.

### Key Principles Extracted
- **Scope narrows left→right** — Clients → Docs of one client → One doc. Each pane has one unambiguous job.
- **Every pane owns its scroll** — `overflow-y: auto` + `overscroll-behavior: contain` on each scroll container. Parent grid has `overflow: hidden`.
- **Fixed widths on wide screens, collapse on narrow** — 240 / 340 / flex at ≥1200px; shrink at 1200px; keep existing mobile modal at <768px.
- **Selection persistence** — Auto-select first pending client on tab open; remember the selection across silent-refresh re-renders (in-memory only).
- **Progress indicator next to the thing it describes** — Per-client "X/Y reviewed" in the client row; overall counter in the summary bar.

### Patterns to Use
- **Three-pane master-detail** — de facto standard (Outlook / Mac Mail / Gmail / Linear).
- **`overscroll-behavior: contain`** — prevents scroll chaining without JS.
- **`.active` class on selected row** — highlights current pane-1 selection; style with background + left border.

### Anti-Patterns to Avoid
- **Scroll-linked preview** — rejected by user; preview only changes on explicit click.
- **Virtualization** — premature; realistic client count per view is ≤ 50.
- **Flat/grouped view toggle** — user chose "drop it entirely"; one pattern keeps UI simple.

### Research Verdict
Switch from the 2-pane sticky-detail layout to a 3-pane master-detail (clients → docs → preview). Add `overscroll-behavior` isolation to each scrollable pane. Show per-client and overall "X/Y reviewed" counters. Keep the mobile modal untouched.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `.ai-accordion-header` markup + styles (script.js:4062–4075, style.css) — reused verbatim as client-row markup (user mandate).
  - The body-building code at script.js:4079–4175 (client notes timeline + missing-docs overview + `renderAICard` loop) — extracted verbatim into a new `renderClientDetailPane()` function.
  - `loadDocPreview()` / `resetPreviewPanel()` / `activePreviewItemId` (script.js:3583–3724) — unchanged; already target `#aiReviewDetail`.
  - Mobile modal (script.js:562–815) — untouched.
- **Reuse Decision:** Keep all three (header markup, body content, preview logic). Only the container hierarchy changes.
- **Relevant Files:**
  - `frontend/admin/index.html` (977–1045) — AI Review tab DOM.
  - `frontend/admin/css/style.css` (3296–3327, 4516–4530) — split-view CSS + mobile breakpoint.
  - `frontend/admin/js/script.js` (3583–3724, 3961–4250, 4811+) — preview + rendering + accordion toggle.
- **Alignment with Research:** Codebase already uses fixed-width CSS Grid (DL-075). Research merely adds a third column and scroll isolation.
- **Dependencies:** None new. No Airtable changes, no workflow changes.

## 5. Technical Constraints & Risks

- **Must preserve** DL-075 preview behavior, DL-109 card lightening, DL-237 split modal, DL-278 scroll-into-view (now scoped to pane 1), DL-306 deep-link (`?client=X` now auto-selects pane 1), DL-053 silent-refresh.
- **RTL:** Hebrew RTL — `grid-template-columns: 240px 340px 1fr` places clients visually on the right, preview on the left in RTL. Matches user's mental model ("right - clients, left - preview").
- **Cache-bust:** Bump `script.js?v=NNN` in index.html (per memory `feedback_admin_script_cache_bust.md`).
- **No React port** — DL-316 scoping is still DRAFT; vanilla refactor keeps risk contained.
- **Breaking changes:** `#aiCardsContainer`, `#aiPagination`, `#aiEmptyState` IDs are removed. `toggleAIAccordion()` is retired (rewired via `selectClient`). Any external code or memo referencing those will need an update — grep confirms only internal references.

## 6. Proposed Solution

### Success Criteria
A reviewer opens AI Review and sees three clearly-bounded panes. Clicking a client populates the middle pane with that client's notes + missing-docs + doc cards. Mouse-wheeling over any pane scrolls only that pane. Per-client and overall "X/Y reviewed" counters are visible.

### Logic Flow
1. `loadAIClassifications()` populates `aiClassificationsData` (unchanged).
2. `renderAICards(items)` groups items by `client_name` (unchanged) then:
   - Calls `renderClientList(groups)` → fills `#aiClientsPane`.
   - Ensures `selectedClientName` still exists in `groups`; if not, picks the first client with pending items.
   - Calls `renderClientDetailPane(selectedClientName, groups[selectedClientName])` → fills `#aiDocsPane`.
3. Click on `.ai-client-row` → `selectClient(name)`:
   - Updates `selectedClientName`.
   - Toggles `.active` class in pane 1 (no re-render of pane 1).
   - Re-renders pane 2 for the new client.
   - Calls `resetPreviewPanel()` so pane 3 clears.
4. Doc-card buttons in pane 2 behave exactly as today (`loadDocPreview`, approve/waive, etc.).

### Data Structures / Schema Changes
None. State: `let selectedClientName = null;` (module-local in script.js).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/index.html` | Modify | Replace the 2-pane DOM (`#aiCardsContainer` + `#aiReviewDetail`) with 3-pane DOM (`#aiClientsPane` + `#aiDocsPane` + `#aiReviewDetail`). Bump `script.js?v=NNN`. |
| `frontend/admin/css/style.css` | Modify | New `.ai-review-clients` / `.ai-review-docs` rules + `overscroll-behavior` + `.ai-client-row.active` state + responsive breakpoints. Retire `.ai-review-master`. |
| `frontend/admin/js/script.js` | Modify | Split `renderAICards`. Add `renderClientList`, `renderClientDetailPane`, `selectClient`, `selectedClientName`. Rewire DL-306 deep-link. Extend summary bar to "N pending · M clients · X/Y reviewed". |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-330 entry. |
| `.agent/current-status.md` | Modify | Add Section 7 TODOs under Active TODOs. |

### Final Step (Always)
- Housekeeping: mark status `[IMPLEMENTED — NEED TESTING]`, mirror Section 7 into `current-status.md`, commit on `DL-330-ai-review-3pane-rework`, push feature branch, pause for merge approval (frontend only goes live after main merge).

## 7. Validation Plan

- [ ] Three panes render at 240/340/flex on ≥1200px screens.
- [ ] Pane 1 shows client rows with same look as today's accordion header plus "X/Y reviewed" sub-label.
- [ ] Clicking a client highlights it in pane 1 and populates pane 2 with client notes + missing-docs + doc cards.
- [ ] Wheel over pane 1 scrolls only pane 1 (no page chain).
- [ ] Wheel over pane 2 scrolls only pane 2.
- [ ] Wheel over preview iframe scrolls only the PDF.
- [ ] Clicking a doc card's preview button loads the preview in pane 3 without changing pane-1 / pane-2 scroll positions.
- [ ] Switching clients resets pane 3 to placeholder (no stale doc).
- [ ] Summary bar shows `"N pending · M clients · X/Y reviewed"` and updates after approve/reject.
- [ ] DL-306 deep-link (`?client=X`) auto-selects that client in pane 1.
- [ ] Silent-refresh (DL-053) preserves `selectedClientName` across polling re-renders.
- [ ] Mobile (<768px) — existing modal + X/Y counter still works, no regression.
- [ ] 1200–1366px laptop: layout usable (no horizontal scroll, preview ≥ 600px wide).
- [ ] `?v=NNN` bumped; hard reload loads new script.
- [ ] No regression on DL-075, DL-109, DL-237, DL-278 tests.

## 8. Implementation Notes (Post-Code)

**2026-04-22 — Initial implementation:**
- Principle applied: **Scope narrows left→right** — pane 1 is compact rows (name + stats + X/Y), pane 2 is the selected client's full accordion (always `.open`), pane 3 is the preview.
- Principle applied: **`overscroll-behavior: contain`** on `.ai-review-clients`, `.ai-review-docs`, `.ai-review-detail`. Parent `.ai-review-split` gets `overscroll-behavior: none`.
- Kept `.ai-accordion` markup on desktop pane 2 rather than unrolling to bare cards — legacy `document.querySelector('.ai-accordion[data-client=...]')` queries (DL-210, DL-306, also-match, edit-documents revert, etc.) still resolve for the selected client, which is ~99% the one being acted on. Clients not currently in pane 2 silently no-op post-action DOM updates and will reflect fresh state on next silent-refresh.
- **Mobile untouched** per user direction — `renderAICards` dispatches on `window.matchMedia('(max-width: 768px)').matches`. Mobile path renders legacy grouped-accordion HTML into `#aiClientsPane`; CSS mobile block makes that pane full-width/borderless to match pre-DL-330 look. `loadMobileDocPreview` modal + X/Y counter unchanged.
- DL-306 deep-link: param is a `client_id`; the old code selected an accordion by `data-client-id`. Rewired to look up `client_name` from `allItems` and call `selectClient(name)` on desktop (or expand accordion on mobile).
- Cache-bust bumped `script.js?v=292` → `?v=293`.
- Deferred follow-ups: keyboard navigation (j/k, 1/2/3), per-pane mini-map of card states — separate DL if user wants them.
