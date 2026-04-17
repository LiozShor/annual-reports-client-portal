# Design Log 297: Doc-Manager — Sticky Header Merge + Editable Stage
<!-- Note: originally DL-295; renumbered due to parallel-session collision with DL-295 (PA queue improvements) and DL-296 (WF02 extract-issuer-names). -->
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-17
**Related Logs:** DL-293 (doc-manager pencil + inline edit), DL-102 (stage redesign), DL-055 (clickable stage badges on dashboard)

## 1. Context & Problem
Two UX rough edges in the doc-manager page surfaced right after DL-293 shipped:
1. The sticky action bar (`#stickyActionBar`) is `position: fixed; top: 0` and feels visually disconnected from the page-header block below it (logo + title). It reads as a floating overlay, not as part of this page.
2. The stage label in the client-bar (`שלב: ממתין למסמכים`) is read-only. From the dashboard you can click the stage badge to switch stages, but from doc-manager you have to navigate back, hunt the row, and click there.

## 2. User Requirements
1. **Q:** How to fix the top nav disconnect?
   **A:** Merge the sticky bar into the page-header block visually, but keep it sticky (floating on scroll).
2. **Q:** What to do with stage?
   **A:** Make it editable — click to change from inside doc-manager.
3. **Q:** Anything else?
   **A:** No — just these two.

## 3. Research
Cumulative: DL-055 already researched inline stage editing on the admin dashboard (dropdown pattern, optimistic update, toast feedback). DL-293 just shipped inline click-to-edit for contact fields. Both patterns apply directly here — reuse, don't re-research.

**Key principle (from DL-055):** Optimistic UI for stage changes. Revert on API error. Toast feedback. Dropdown anchored at the clicked element.

## 4. Codebase Analysis
- **Sticky bar markup:** `frontend/document-manager.html:182-191` — currently nested inside `#content`. Fixed-positioned via `.sticky-action-bar` (top:0, z-index 100, white bg + shadow). A +44px spacer rule (`.sticky-action-bar + *`) compensates for the fixed positioning.
- **Page-header:** `frontend/document-manager.html:27-50` — header with back button, client switcher, logo, title.
- **Stage label:** `frontend/document-manager.html:108-112` — `<strong id="clientStage">` inside `.client-bar-item`. Populated by `stageEl.textContent = STAGE_LABELS[data.stage] || data.stage` at `frontend/assets/js/document-manager.js:270` and (after restoreFromCache) at `:620`.
- **API endpoint for stage change:** `POST /admin-change-stage` at `api/src/routes/stage.ts:17-100` — accepts `{token, report_id, target_stage}`, handles reminder field clearing on backward moves, audit log. Frontend const: `ENDPOINTS.ADMIN_CHANGE_STAGE`.
- **Dashboard pattern:** `frontend/admin/js/script.js:1750-1794` — optimistic update → fetch → revert on error → toast. Dropdown rendered from `STAGES` map in `frontend/shared/constants.js:13`.
- **Global access:** `STAGES` + `STAGE_LABELS` already loaded in doc-manager via `shared/constants.js`.
- **`CURRENT_STAGE` global** already exists at `frontend/assets/js/document-manager.js:13`.

### Reuse decision
- Reuse `ADMIN_CHANGE_STAGE` endpoint (no API change).
- Mirror dashboard optimistic-update pattern for the stage dropdown.

## 5. Technical Constraints & Risks
- **Sticky positioning:** Moving from `position: fixed` (always pinned) to `position: sticky` requires the parent to be tall enough to contain the scroll range. `.container` is the right parent — it wraps the full page content. Putting the sticky bar as the FIRST child of `.container` (sibling above `.page-header`) guarantees it stays pinned for the whole scroll and visually reads as part of the header stack when at top.
- **Spacer rule:** Must remove `.sticky-action-bar + * { margin-top: 44px }` once bar is no longer fixed — otherwise it double-stacks gap below the bar.
- **Stage backward moves:** `stage.ts:39-59` already handles `docs_completed_at` clear + reminder field reset. Frontend just sends target_stage; backend does the right thing.
- **Audit log:** Already logged server-side via `logAudit` in `stage.ts`. No extra client audit needed.
- **Risk:** Dropdown outside-click close handler might collide with existing page-level click handlers. Mitigate by stopping propagation.

## 6. Proposed Solution

### A. Sticky header merge
- **HTML:** Move `#stickyActionBar` from `#content` to be the first child of `.container` (directly above `.page-header`).
- **CSS:** Change `.sticky-action-bar` from `position: fixed` to `position: sticky; top: 0; z-index: 100;`. Keep bg + shadow. Remove `.sticky-action-bar + *` margin-top spacer rule. Add a subtle `border-bottom` and smooth the visual transition so at-top view reads "header + bar as one block" and scrolled view reads "bar floating".

### B. Editable stage
- **HTML:** Wrap `<strong id="clientStage">` with `cursor:pointer`, `class="editable-stage"`, `onclick="openStageDropdownDM(event)"`, a small caret `▾` next to the label.
- **New stage dropdown element:** `<div id="stageDropdownDM" class="stage-dropdown-dm" style="display:none"></div>` appended near end of body.
- **JS:** Two new functions in `document-manager.js`:
  - `openStageDropdownDM(event)` — reads `CURRENT_STAGE`, renders 8 options from `STAGES`, positions dropdown below the stage label, installs outside-click close.
  - `selectStageDM(newStageKey)` — optimistic update of `CURRENT_STAGE` + DOM label, POST to `ADMIN_CHANGE_STAGE`, revert on error, toast.
- **CSS:** Style the dropdown like the existing `.status-dropdown` in document-manager.css for visual consistency.

### Files to change
| File | Action | Description |
|------|--------|-------------|
| `frontend/document-manager.html` | Modify | Move `#stickyActionBar` out of `#content` into `.container` (top); add editable-stage markup + caret; add `#stageDropdownDM` element |
| `frontend/assets/css/document-manager.css` | Modify | `.sticky-action-bar` → sticky; remove spacer rule; new `.editable-stage` + `.stage-dropdown-dm` styles |
| `frontend/assets/js/document-manager.js` | Modify | Add `openStageDropdownDM` + `selectStageDM` + outside-click handler; update `clientStage` cell wiring |

No API changes, no Worker deploy.

### Final step (housekeeping)
Status → `[IMPLEMENTED — NEED TESTING]`, INDEX entry, test items to `current-status.md`.

## 7. Validation Plan
- [ ] Sticky bar: at page top, bar sits directly above page-header with no visual gap, reads as header top row.
- [ ] Sticky bar: scroll down → bar stays pinned at top, logo + title scroll away.
- [ ] Sticky bar: no double-margin below bar (spacer rule is gone).
- [ ] Stage: click stage label → dropdown appears below with all 8 stages.
- [ ] Stage: current stage visually highlighted in dropdown.
- [ ] Stage: select a different stage → label updates immediately, toast on success.
- [ ] Stage: backward move (e.g., Collecting_Docs → Waiting_For_Answers) → Airtable reminder fields reset (backend `stage.ts` logic).
- [ ] Stage: API error → label reverts, error toast.
- [ ] Stage: click outside dropdown → closes without change.
- [ ] No console errors on doc-manager page load.
- [ ] Regression: sticky bar progress fill + summary text + actions still render correctly.

## 8. Implementation Notes (Post-Code)
- Sticky bar moved out of `#content` to be direct child of `.container`. This gives it a tall scroll parent so `position: sticky` pins it for the whole page.
- Removed the 44px spacer compensation rule since the bar now flows in normal document order.
- Stage dropdown anchored via `getBoundingClientRect()` + fixed-position for overlay behavior; outside-click closes via document-level handler with capture phase.
- Reuses `ADMIN_CHANGE_STAGE` endpoint; backend already handles reminder field reset on backward moves.
