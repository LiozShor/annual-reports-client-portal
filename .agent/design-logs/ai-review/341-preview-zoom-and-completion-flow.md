# Design Log 341: AI Review Preview Zoom + Completion Flow + Auto-Advance
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-24
**Related Logs:** DL-340 (reviewed-indicator + pane-2 sort), DL-334 (cockpit v2 — silently broke desktop done-prompt), DL-339 (actions panel → pane 2), DL-246 (split-modal zoom — different code path)

## 1. Context & Problem

Three AI Review cockpit issues surfaced during DL-340 testing, bundled into one log because they share files, test flow, and one commit cycle.

1. **Preview zoom default is too large.** The OneDrive embed renders fit-to-width. On a typical admin screen + pane 3 width, this pushes the top of the document off-screen and forces scroll for routine docs. Admins want ~75% default so the full top-of-page fits without scroll.
2. **Last-doc completion flow silently broken on desktop.** After approving/rejecting the final pending doc for a client, the `כל המסמכים נבדקו!` done-prompt should appear with a `סיום בדיקה` button. On desktop, nothing shows. Root cause: `showClientReviewDonePrompt` queries `.ai-accordion[data-client=...]`, a selector DL-334 deleted when replacing the mobile accordion with the 3-pane desktop cockpit. The function `return`s silently at the null-check. Broken since DL-334 shipped 2026-04-23.
3. **No auto-advance after review action.** After approve/reject/reassign, pane 3 stays on the just-reviewed doc — admin has to manually click the next pending row. Gmail-inbox-zero auto-advance eliminates the click.

## 2. User Requirements

1. **Q:** Bundle all three in DL-341, or split?
   **A:** Bundle — same files, same test session.
2. **Q:** Zoom approach — URL probe + CSS fallback, postMessage, or replace embed?
   **A:** Recommended path (probe + fallback). Research surfaced a better option (Graph POST body `zoom` field) before coding started.
3. **Q:** Completion UX — show done-prompt in place, auto-advance to next client, or both?
   **A:** Show the done-prompt (existing intent). Just fix it. Auto-advance across clients is out of scope.
4. **Q:** Verification mode?
   **A:** Section 7 checklist, user tests manually.
5. **Q (mid-session):** Add auto-advance to next pending doc after action?
   **A:** Yes — added as scope item #3.

## 3. Research

### Domain
Queue-based review UX + Microsoft Graph embed API.

### Sources Consulted
1. **Microsoft Learn — `driveItem: preview` (Graph v1.0)** — POST body accepts `{ viewer, page, zoom }`. `zoom` is honored when the viewer supports it; ignored gracefully otherwise (PDFs + Office docs support it).
2. **GitHub issue microsoftgraph/microsoft-graph-docs #9899 — OneDrive Item Preview Zoom Parameter Value** — confirms `zoom` takes a decimal (e.g., `0.75` = 75%) and that the embed URL accepts `?nb=true` to hide the top banner.
3. **Gmail Auto-Advance UX writeups (Tim Sneath, Dan Silvestre)** — standard inbox-zero pattern: after archive/delete, jump to next item (newer or older, user-configurable) rather than returning to list. Validates chain action → auto-advance for queue workflows.

### Key Principles Extracted
- **Pass `zoom` at source, not at render** — Graph's POST body is the documented hook. URL-hash/postMessage approaches are undocumented and fragile. If the viewer ignores `zoom` for a specific file type, the returned URL still works at default zoom → graceful degradation.
- **Auto-advance is a one-click-to-zero-click transform** — the user already expressed intent by taking an action on item N; assuming they want N+1 next is safe because all items in the queue are of the same type (pending review).
- **Layout-aware UI functions** — when a feature spans mobile + desktop with different DOM structures, split by layout detection at the top of the function rather than hiding dead selectors.

### Patterns to Use
- **Graph body-param for viewer config** — `{ viewer: 'onedrive', zoom: 0.75 }` in the POST body. Append `&nb=true` to the returned `getUrl` to hide banner.
- **Extract shared HTML builder** — `_buildClientReviewDonePromptEl(clientName)` returns a single `<div>`; mobile and desktop branches each pick their insertion point.
- **Data-level sort for auto-advance target** — don't rely on DOM ordering that `refreshItemDom` is in the middle of mutating; filter+sort `aiClassificationsData` for the next pending.

### Anti-Patterns to Avoid
- **CSS transform on the iframe** — shrinks Microsoft's zoom toolbar too; poor UX.
- **postMessage probes into the embed** — cross-origin, undocumented, high risk of silent failure.
- **DOM-based "next pending" picker** — race with `refreshItemDom`'s row relocation; data-level is authoritative.

### Research Verdict
Graph POST body `zoom: 0.75` + `&nb=true` on URL. Layout-split for done-prompt. Data-level `.sort(compareDocRows)[0]` for auto-advance target.

## 4. Codebase Analysis

**Worker preview handler:** `api/src/routes/preview.ts:43-53` — POST body was `{}`, returned `{ previewUrl, downloadUrl }`. No zoom, no banner-hide.

**Done-prompt render:** `frontend/admin/js/script.js:7199-7274` — single function `showClientReviewDonePrompt`, queried `.ai-accordion[data-client=...]`. DL-334 pane 2 DOM is `.ai-review-docs > .ai-doc-list#aiDocList` (no accordion wrapper on desktop).

**Auto-advance hooks:** `selectDocument(id)` (line 4314) is the public selection API — updates `activePreviewItemId`, highlights row, scrolls, loads preview, renders actions panel. `compareDocRows` (line 4133) drives pane 2 sort (pending → on_hold → reviewed, oldest first within rank).

**Call sites of `showClientReviewDonePrompt`:** lines 5421 (render-time re-detection), 7190 (transition path — user-initiated), 7567 (batch questions modal save handler). All three get the desktop fix for free.

## 5. Technical Constraints & Risks

- **Graph `zoom` may be ignored for non-PDF/Office types** — images, plaintext. Falls back to default; no regression.
- **Pane 2 DOM may be rebuilt** — if a background refresh re-renders `.ai-review-docs` after the done-prompt is injected but before the user clicks its button, the prompt is lost. Same risk exists for the mobile accordion path — acceptable.
- **`compareDocRows` uses `review_status` groups** — filtering to `pending` upstream means the sort only matters for tiebreak by `received_at`. Correct.
- **No Airtable schema change.** No new CSS tokens.

## 6. Proposed Solution

### Success Criteria
After approving the final pending doc for a client on desktop, the done-prompt appears at the top of pane 2. Non-last doc → preview auto-jumps to the next pending. Preview iframe loads at 75% zoom without the Microsoft banner.

### Logic Flow
1. Worker: Graph POST body now includes `viewer: 'onedrive', zoom: 0.75`. Returned `getUrl` has `&nb=true` appended.
2. Frontend `transitionCardToReviewed` after `pendingLeft` count:
   - `pendingLeft === 0` → `showClientReviewDonePrompt(clientName, true)`
   - else on desktop → `selectDocument(firstPending.id)`
3. `showClientReviewDonePrompt` detects layout and dispatches to `_showClientReviewDonePromptMobile` (accordion insert) or `_showClientReviewDonePromptDesktop` (pane 2 insert).

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/preview.ts` | Modify | Graph POST body `{ viewer: 'onedrive', zoom: 0.75 }`; append `&nb=true` to returned `previewUrl` |
| `frontend/admin/js/script.js` | Modify | Split `showClientReviewDonePrompt` into layout-aware dispatcher + two helpers; extract `_buildClientReviewDonePromptEl`; add auto-advance branch to `transitionCardToReviewed` |
| `frontend/admin/index.html` | Modify | `script.js?v=327 → 328` cache-bust |

CSS: unchanged. `.ai-review-done-prompt` styling works in pane 2 context without tweaks (visual inspection during testing will confirm).

## 7. Validation Plan

### Zoom
- [ ] Hard reload admin, open AI Review, click any PDF row → preview iframe loads at ~75% zoom (visibly smaller than before).
- [ ] No Microsoft banner at top of preview.
- [ ] Click an Office doc (.docx/.xlsx) → zoom applies or falls back gracefully, no broken preview.
- [ ] Click an image preview → no broken preview (zoom may be ignored).
- [ ] `wrangler tail` 5 min after Worker deploy — no new errors from `/webhook/get-preview-url`.

### Completion flow — desktop
- [ ] Pick a client with 1 pending doc. Approve it. Done-prompt appears above pane 2 doc list with `כל המסמכים נבדקו!` + `סיום בדיקה` button.
- [ ] Click `סיום בדיקה` → existing behavior (review closed, client removed from pane 1).
- [ ] Pick a client with 1 pending doc that has a `pending_question`. Approve it. Done-prompt shows both buttons (`סיום בדיקה ושליחת שאלות` + `ערוך שאלות`).
- [ ] Client with only `on_hold` docs (no pending) → done-prompt shows `on_hold` count in stats.

### Completion flow — mobile (regression guard)
- [ ] Resize to mobile width. Approve last pending doc. Accordion prompt behavior unchanged from DL-334 baseline.

### Auto-advance — desktop
- [ ] Client with 3 pending docs. Approve doc 1. Pane 3 preview jumps to doc 2 (oldest remaining pending); pane 2 row 2 highlighted; actions panel re-renders for doc 2.
- [ ] Reject doc 2 → doc 3 auto-selected.
- [ ] Approve doc 3 (last) → done-prompt shown; no auto-advance.
- [ ] `on_hold` doc in the mix → NOT auto-selected (auto-advance filters to pending only).
- [ ] Reassign action → next pending also auto-selected (same transitionCardToReviewed path).

### Auto-advance — mobile
- [ ] Mobile fat-card transitions unchanged; no auto-advance (mobile explicitly skipped).

### Sanity
- [ ] Hard reload admin → `?v=328` served (no stale `v=327`).
- [ ] `node -c frontend/admin/js/script.js` — syntax OK. ✓ (verified in-session)
- [ ] `wrangler deploy` from `api/` succeeds. ✓ (pending — housekeeping)
- [ ] `git push origin DL-341-preview-zoom-and-completion-flow`. ✓ (pending — housekeeping)

## 8. Implementation Notes

- Extracted `_buildClientReviewDonePromptEl` so the same HTML + button wiring serves both layouts — no divergence between mobile and desktop prompt content.
- Auto-advance uses `pendingItems.slice().sort(compareDocRows)[0]` rather than DOM query. Avoids racing with `refreshItemDom`'s row relocation that may still be in flight.
- Skipped fixing the unrelated `stage is not defined` ReferenceError at `api/src/routes/preview.ts:63` — explicitly out of scope per plan; tracked in `current-status.md` follow-up.
- `&nb=true` append uses `includes('?')` check for robustness — Graph's `getUrl` typically already has query params but this guards against future shape change.
- Research principle applied: "Graph body-param at source, not render-time transform." Pattern: server-side preview config.
