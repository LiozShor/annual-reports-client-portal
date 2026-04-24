# Design Log 340: Reviewed-status indicator on preview frame
**Status:** [COMPLETED]
**Date:** 2026-04-24
**Related Logs:** DL-330 (3-pane rework), DL-334 (cockpit middle + actions), DL-335 (on_hold), DL-053 (silent refresh merge-by-id)

## 1. Context & Problem

Once a doc is reviewed (approved / rejected / reassigned), there is no clear signal in the preview area that the decision has already been made. The row-list stripe carries the state, but inside the PDF preview + actions panel the only cue is the button label. This lets reviewers accidentally re-open a decided doc and forces an extra cognitive check per item. Add a lightweight, consistent signal on the preview frame itself — a status badge in the header and a colored inline-start border on the frame container.

NN/G Usability Heuristic #1 (Visibility of System Status) directly applies: whenever the system has decided state for the thing the user is looking at, it should display it. Material 3's semantic color token model is already mirrored in our `--success-*` / `--danger-*` / `--info-*` tokens, so we apply the same role-based coloring.

## 2. User Requirements

1. **Q:** The spec names `.ai-preview-frame` but the real container is `.ai-review-detail`. Which element carries the border?
   **A:** Apply to `.ai-review-detail` — no new wrapper.
2. **Q:** Current header is `space-between` with filename stretching. How to place the badge before filename without disturbing buttons?
   **A:** Group badge + filename in a start-side flex wrapper; action buttons stay at end.
3. **Q:** How should the indicator stay in sync during silent refresh / cross-tab mutation?
   **A:** Sync inside the silent-refresh render path — when the active preview item's fresh `review_status` differs, reapply.
4. **Q:** Should the accent replace or augment the default 1px gray border?
   **A:** Augment — keep the 1px `--gray-200` on other sides, override only `border-inline-start` with 3px semantic color.

## 3. Research

**Domain:** UI state affordance / status indicator design.

### Sources Consulted
1. **NN/G — Visibility of System Status (Heuristic #1)** — the system should always keep users informed about state through appropriate feedback. Decided state for the currently-focused item qualifies.
2. **NN/G — Indicators, Validations, Notifications** — indicators (persistent, intrinsic to an object) are the right pattern for "this document has been reviewed"; validations are input-bound, notifications are transient — neither fit.
3. **Material Design 3 — Badges & Semantic Color Tokens** — role-based color (success / danger / info) mapped to the same token families already in our CSS; light backgrounds for chip fills (`-50`) + dark text (`-700`) for AA contrast. 3px accent line matches our existing stat-card stage pattern (`style.css:215-219`).

### Key Principles Extracted
- **Silent for default state** — no badge / no accent for `pending` and `on_hold`. The UI only speaks when there is a decided state to communicate. (Signal/noise ratio.)
- **Single state source drives two surfaces** — one `preview-reviewed-<state>` class on the container drives both the border (CSS) and the badge (rendered conditionally). Prevents drift between the two surfaces.
- **Role-based color** — tokens, not literal hex. Matches existing `.stat-card.stage-*` and `.ai-stat-item.ai-stat-*` treatment (`style.css:215, 1637-1640`).

### Patterns to Use
- **State class on container:** CSS handles visual outcome; JS only manages class membership. Keeps mutation points minimal.
- **Single helper function:** `applyPreviewReviewState(reviewStatus)` — all callers go through one path. Prevents any surface getting out of sync.

### Anti-Patterns to Avoid
- **Tinted full-background wash** — competes with PDF iframe content. Border-only accent is sufficient.
- **Transient toast** — decided state is persistent context, not a moment-in-time event.
- **Replacing all four borders** — asymmetric inline-start accent matches existing stage-card pattern and is visually lighter.

### Research Verdict
Small persistent indicator on the container that holds the decided item. CSS state classes driven by a single JS helper. Semantic color tokens already in our system. No new tokens, no new patterns.

## 4. Codebase Analysis

**Existing Solutions Found:**
- `.ai-review-detail` (`style.css:3682`, HTML `admin/index.html:1019`) — outer pane-3 container, `1px solid var(--gray-200)` + `var(--radius-md)`. Perfect target for the border accent.
- `.preview-header-bar` (`style.css:3694`, HTML `:1020`) — flex / `space-between` / gap `--sp-3`. Children: `.preview-file-name`, `#previewOpenTab`, `#previewDownload`. Needs a start-side grouping wrapper.
- `resetPreviewPanel()` (`script.js:3625`) — single teardown for active preview.
- `loadDocPreview(recordId)` (`script.js:3642`) — only path that activates a preview; already reads `item.review_status`.
- `transitionCardToReviewed(recordId, newReviewStatus, responseData)` (`script.js:6083`) — single mutation point for approve / reject / reassign.
- Silent-refresh render path: per-item `renderReviewedCard` loop at `script.js:~6253-6264`.

**Reuse Decision:** Extend all three existing hooks (`loadDocPreview`, `resetPreviewPanel`, `transitionCardToReviewed`). No new data fetches; state read directly from `aiClassificationsData`.

**Review status values:**
- `pending` (or missing) — no badge, no accent
- `approved` → green
- `rejected` → red
- `reassigned` → blue (`--info-*`)
- `on_hold` — explicitly no badge, no accent (waiting state, not decided)

**Relevant Files:** `frontend/admin/js/script.js`, `frontend/admin/css/style.css`, `frontend/admin/index.html`

**Existing Patterns:** `.ai-stat-item.ai-stat-matched { border-inline-start: 3px solid var(--success-500); }` (style.css:1637) — identical pattern.

**Dependencies:** None beyond existing `aiClassificationsData` in-memory store and `activePreviewItemId` tracking variable.

## 5. Technical Constraints & Risks

- **Header layout shift:** Wrapping filename + badge in a new start-side container changes flex child count. `space-between` still works with two top-level children (wrapper vs. button group). Filename keeps `min-width: 0` + ellipsis inside the wrapper.
- **Race during load:** State class applied at the same time as `fileName.textContent` — visible during iframe loading. Good: reinforces "this doc is already decided" before content paints.
- **Silent refresh edge case:** if active preview item is removed from `aiClassificationsData`, call `resetPreviewPanel()`. Already handled elsewhere; `find()` returns undefined → `applyPreviewReviewState(null)` safely no-ops.
- **No regression risk to DL-335 on_hold:** `on_hold` returns null badge and no state class added.
- **Cache busting:** script.js + style.css edits require `?v=` bumps in `admin/index.html`.

## 6. Proposed Solution

### Success Criteria
Selecting an approved / rejected / reassigned doc shows a matching-color badge before the filename AND a 3px colored `border-inline-start` on `.ai-review-detail`. Pending and on_hold show no badge and no accent. State updates live on local action, cross-tab refresh, and deselection — without requiring reselection.

### Logic Flow

1. `loadDocPreview(recordId)` reads `item.review_status` from `aiClassificationsData` → calls `applyPreviewReviewState(status)`
2. `applyPreviewReviewState(status)`:
   - Removes all three `preview-reviewed-*` classes from `#aiReviewDetail`
   - If status is approved/rejected/reassigned: adds matching class + renders badge
   - Otherwise: hides badge, removes all classes
3. `resetPreviewPanel()`: calls `applyPreviewReviewState(null)` — clears all
4. `transitionCardToReviewed(...)`: after in-memory update, if `activePreviewItemId === recordId` → calls `applyPreviewReviewState(newReviewStatus)`
5. Silent-refresh render path: after per-item loop, if `activePreviewItemId` is set, re-reads status from fresh data → calls `applyPreviewReviewState`

### CSS additions (`frontend/admin/css/style.css`, after `.ai-review-detail` block ~line 3693)

```css
/* DL-340: Reviewed-state border accent on preview frame */
.ai-review-detail.preview-reviewed-approved   { border-inline-start: 3px solid var(--success-500); }
.ai-review-detail.preview-reviewed-rejected   { border-inline-start: 3px solid var(--danger-500); }
.ai-review-detail.preview-reviewed-reassigned { border-inline-start: 3px solid var(--info-500); }

/* DL-340: Start-side grouping wrapper for badge + filename */
.preview-header-start {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
    flex: 1;
}

/* DL-340: Status badge */
.preview-status-badge {
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 3px;
    line-height: 1.4;
    white-space: nowrap;
    flex-shrink: 0;
}
.preview-status-badge.badge-approved   { background: var(--success-50); color: var(--success-700); }
.preview-status-badge.badge-rejected   { background: var(--danger-50);  color: var(--danger-700); }
.preview-status-badge.badge-reassigned { background: var(--info-50);    color: var(--info-700); }
```

### HTML change (`frontend/admin/index.html`, ~line 1020)

Wrap `#previewStatusBadge` + `#previewFileName` in `.preview-header-start`. Action buttons stay as direct siblings.

### JS changes (`frontend/admin/js/script.js`)

**New helper** (before `resetPreviewPanel`, ~line 3625):
```js
function applyPreviewReviewState(reviewStatus) {
    const frame = document.getElementById('aiReviewDetail');
    const badge = document.getElementById('previewStatusBadge');
    if (!frame || !badge) return;
    frame.classList.remove('preview-reviewed-approved', 'preview-reviewed-rejected', 'preview-reviewed-reassigned');
    const map = {
        approved:   { cls: 'preview-reviewed-approved',   badgeCls: 'badge-approved',   html: '✓ אושר' },
        rejected:   { cls: 'preview-reviewed-rejected',   badgeCls: 'badge-rejected',   html: '⚠ דורש תיקון' },
        reassigned: { cls: 'preview-reviewed-reassigned', badgeCls: 'badge-reassigned', html: '↻ שויך מחדש' },
    };
    const entry = map[reviewStatus];
    if (!entry) {
        badge.style.display = 'none';
        badge.className = 'preview-status-badge';
        badge.innerHTML = '';
        return;
    }
    frame.classList.add(entry.cls);
    badge.className = `preview-status-badge ${entry.badgeCls}`;
    badge.innerHTML = entry.html;
    badge.style.display = '';
}
```

**`resetPreviewPanel`** (~line 3639): add `applyPreviewReviewState(null);` before closing brace.

**`loadDocPreview`** (~line 3694, after `fileName.textContent = ...`): add `applyPreviewReviewState(item.review_status || null);`

**`transitionCardToReviewed`** (~line 6099, after card re-render):
```js
if (activePreviewItemId === recordId) {
    applyPreviewReviewState(newReviewStatus);
}
```

**Silent-refresh sync** (~line 6264, after the per-item merge loop):
```js
if (activePreviewItemId) {
    const active = aiClassificationsData.find(i => i.id === activePreviewItemId);
    if (active) applyPreviewReviewState(active.review_status || null);
    else resetPreviewPanel();
}
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/css/style.css` | Modify | 3 border-accent rules, `.preview-header-start`, 4 badge rules |
| `frontend/admin/index.html` | Modify | Add `.preview-header-start` wrapper + `#previewStatusBadge`; bump cache versions |
| `frontend/admin/js/script.js` | Modify | Add `applyPreviewReviewState` helper; hook into 4 call sites |
| `.agent/design-logs/ai-review/340-reviewed-indicator-on-preview.md` | Create | This file |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-340 entry; bump counts |

### Final Step (Always)
- Update DL status → `[IMPLEMENTED — NEED TESTING]`
- Copy unchecked Section 7 items to `.agent/current-status.md`
- Commit + push `DL-340-reviewed-indicator-preview` (no merge to main)

## 7. Validation Plan

- [x] Select an approved doc → green `✓ אושר` badge + green `border-inline-start` on `.ai-review-detail`
- [x] Select a rejected doc → red `⚠ דורש תיקון` badge + red border
- [x] Select a reassigned doc → blue `↻ שויך מחדש` badge + blue border
- [x] Select a pending doc → no badge, no border accent, default 1px `--gray-200` border intact
- [x] Select an on_hold doc → no badge, no border accent
- [x] Approve a pending doc while actively previewed → preview frame updates to green badge + border without reselection
- [x] Click "שנה החלטה" on an approved previewed doc → badge + border clear immediately
- [x] Click active card again (toggle off) → badge + border both cleared
- [x] Silent refresh while approved doc is selected → badge + border persist (no flicker)
- [x] Header layout: filename still ellipsizes when long; open-tab + download buttons still at the end side (RTL → left)
- [x] Mobile (< 768px): preview uses modal path, no regression

## 8. Implementation Notes (Post-Code)

- CSS added immediately after `.ai-review-detail` block (style.css ~line 3693).
- `applyPreviewReviewState` helper placed before `resetPreviewPanel` (~line 3627).
- 3 call sites: `resetPreviewPanel` (null), `loadDocPreview` (item.review_status), `transitionCardToReviewed` (newReviewStatus when activePreviewItemId matches).
- Cross-tab silent-refresh sync omitted — requires DL-334's merge-by-id; current path calls `resetPreviewPanel()` on fingerprint mismatch which already clears both badge and border cleanly.
- Cache bumped: style.css v=300→301, script.js v=314→315.

### Post-MVP enhancements (same session, same DL)

After the initial implementation landed, three iterative enhancements were added based on live feedback that the signal was "not really clear":

1. **Corner rubber-stamp over the preview iframe.** New `.preview-review-stamp` element in `.ai-preview-frame`, top-start corner, rotated -8°, opacity 0.78, 3px border in state color + faint inner ring via `color-mix` inset shadow, pointer-events none. Text: "אושר" / "דורש תיקון" / "שויך מחדש". Driven by the same `applyPreviewReviewState` helper. After DL-334/339 landed `.ai-preview-frame` as an actual DOM element, the border accent was retargeted from `.ai-review-detail` to `.ai-preview-frame` per the original spec intent. Cache bumped to style.css v=312, script.js v=325.
2. **Pane-2 "done" treatment for reviewed rows.** On rows with review_status ∈ {approved, rejected, reassigned}, filename fades to `--gray-500` and gets a state-colored strikethrough (`color-mix` 55% alpha). The filing-type category swaps for a compact status chip ("אושר" / "לתיקון" / "שויך") in matching state color. Active row restores filename color so it doesn't feel faded while being viewed. Cache bumped to style.css v=313, script.js v=326.
3. **Pane-2 sort by review state.** New `getRowSortRank` + `compareDocRows` helpers. Initial render in `buildDesktopClientDocsHtml` sorts pending (0) → on_hold (1) → reviewed (2), received_at asc within group. `refreshItemDom` relocates the row on transition by walking siblings and inserting before the first higher-rank neighbor — no full re-render, scroll preserved. Cache bumped to script.js v=327.

Final stack: stripe (pane-2 row edge, DL-334) + strike+chip (row body, DL-340 post-MVP #2) + badge (preview header, DL-340 MVP) + border accent (preview frame, DL-340 MVP) + corner stamp (preview iframe, DL-340 post-MVP #1). Each operates at a different viewing distance; each is driven by the same `review_status`.

### Tests

All Section 7 validation items passed in live test 2026-04-24.
