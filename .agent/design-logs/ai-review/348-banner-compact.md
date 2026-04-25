# Design Log 348: Completion banner — compact layout (reclaim vertical space)
**Status:** [COMPLETED]
**Date:** 2026-04-25
**Related Logs:** DL-210 (banner origin), DL-308 (email preview), DL-323 (user-initiated scroll), DL-333 (off-hours batch questions), DL-335 (held questions / on_hold), DL-341 (desktop banner host), DL-345 (missing-docs send action), DL-346 (two-flow split), DL-347 (filled/outlined/text triad — direct predecessor)

## 1. Context & Problem
DL-346 (two-flow split) and DL-347 (filled/outlined/text triad) got the structure and hierarchy right but the banner is now physically too tall — ~150-180px when both flows are visible. It pushes the doc-list, missing-docs section, and notes-timeline out of view in pane 2, especially at 1080p with the React island docked above. The banner currently:

- Wraps the title and stats onto two lines inside `.ai-review-done-text`.
- Wraps each sub-section in a white `.ai-review-flow-card` (1px border + 12px padding + radius — adds ~30px per card vertically).
- Centers the `סיים בדיקה` primary in its own `.ai-review-done-primary-row` with `margin-top: var(--sp-3)` (12px) and a 160px-min-width pill — extra ~50px claim.
- Outer prompt padding is `var(--sp-3)` top/bottom + `var(--sp-4)` sides → 24-32px of just chrome.

The "all reviewed" status doesn't need this much real estate. It should quietly inform, host the optional offers as inline rows, and stay out of the way. Hierarchy from DL-347 is correct — only the size and density change in this DL.

## 2. User Requirements (from spec + screenshots)
1. **Q:** What are the height targets?
   **A:** Both flows ~80px (acceptable 75-95). One flow ~60px (55-75). Neither ~40px (35-50). If implementation lands above these, it's not compact enough.
2. **Q:** Header layout?
   **A:** Single horizontal line: `[✓ icon] [bold title] · [stats]`. Never wrap. Icon 16px circle, title 13px/500, stats 12px secondary, ` · ` separator, 8px gap.
3. **Q:** Sub-sections?
   **A:** **Inline rows directly inside the green banner** — NO nested white card. Each row is `[context — flex:1] [outlined send] [preview text-link]` on one line, 4px vertical padding. Stack with no separator between rows.
4. **Q:** Primary placement?
   **A:** Always renders. Placement varies:
   - **Neither flow:** inline with header — `[✓ icon] [title] · [stats — flex:1] [finish button]`. Banner becomes one ~40px row.
   - **Any flow visible:** own line at the bottom, hugs content (NOT full-width), aligned to start (right side in RTL), 8px margin-top.
   - **One flow only (optional optimization):** may join the sub-section row if it fits cleanly. If alignment becomes messy with varying context-string widths, fall back to "own line." The height target (~60px) is the must-hit, not the layout shape.
5. **Q:** Outer banner padding?
   **A:** Tighten to 10-12px (was `var(--sp-3) var(--sp-4)` ≈ 12-16px). Same border-radius, same green bg.
6. **Q:** Out of scope?
   **A:** Mobile layout, click handlers, plural-aware Hebrew, DL-345 wording flips, conditional rendering logic, hierarchy decisions from DL-347.

## 3. Research
### Domain
Information density / vertical space economy / progressive disclosure inversion (when the disclosure container itself crowds primary content).

### Sources Consulted
1. **NN/g — *Information Density: Beyond Cramming Pixels* (Aurora Harley)** — High-density UIs aren't bad if hierarchy is intact. Density wins when the user is in operational/scanning mode. Applied: AI-review is operational; the banner is metadata, not the focus.
2. **Edward Tufte — *The Visual Display of Quantitative Information*, "data-ink ratio"** — minimize chrome; every pixel of border/padding that doesn't add information is overhead. Applied: white-card-on-green-banner is double containment for the same info; collapse to inline rows.
3. **Material Design — *Density baselines*** — "regular" rows ~48px, "comfortable" ~56px, "compact" ~32px. Applied: target inline row ~28-32px; primary button at ~32px; banner cap at ~40px when only header visible.
4. **DL-347 (in-repo)** — confirmed filled/outlined/text triad survives any size change. We just shrink the same triad.

### Key Principles Extracted
- **Containers ≠ free.** A white card adds ~30px vertical for ~0 information gain when sitting on a clearly-bounded green parent.
- **Single-line headers.** Title + stats fit on one line at 12-13px font with 8px gap. Forcing them onto two lines doubles the header's height for no reason.
- **Action-button height tracks consequence, not text length.** Send actions go into 24-26px outlined buttons; finish is 28-32px filled. Same hierarchy, smaller absolute heights.

### Patterns to Use
- **Flex-row inline sub-sections** with `flex: 1` on the context cell so send + preview hug the end.
- **Header-inline primary** when no sub-sections render (collapses banner to one row).
- **Bare text-link previews** — no padding box, no border, no bg.

### Anti-Patterns Avoided
- **Centered full-width primary** — claims a row the banner doesn't need.
- **White nested card on tinted parent** — the parent already provides containment; the inner card is decorative.
- **Two-line header** — wasted 18-20px for cosmetic split.

### Research Verdict
Inline rows + single-line header + content-hug primary. CSS is the heavy lift; markup change is small (drop the `<section class="ai-review-flow-card">` wrapper and the `.ai-review-done-primary-row` flex container).

## 4. Codebase Analysis
* **Function to edit:** `_buildClientReviewDonePromptEl(clientName)` at `frontend/admin/js/script.js:7218` — same surface as DL-345/346/347.
* **Existing handlers reused (no changes):** `dismissClientReview`, `dismissAndSendQuestions`, `previewBatchQuestions`, `openBatchQuestionsModal`, `approveAndSendFromAIReview`, `previewApproveEmail`.
* **Existing flags reused:** `hasPendingQuestions`, `pendingQuestionsCount`, `hasMissingFlow`, `docsMissing`, `reportId` — all already in the function.
* **CSS to delete (DL-346 + DL-347 leftovers that become orphaned):**
  - `.ai-review-flow-card` (white card wrapper)
  - `.ai-review-flow-card__context` (will become `.ai-review-flow-row__context`)
  - `.ai-review-flow-card__actions` (replaced by row-level flex)
  - `.ai-review-flow-card__send-btn` (replaced by `.ai-review-flow-row__send-btn` with smaller padding)
  - `.ai-review-flow-card__link` (replaced by `.ai-review-flow-row__link`)
  - `.ai-review-done-primary-row` (replaced by inline-with-header OR bottom-aligned row)
  - `.ai-review-flows-stack` (kept but tightened — gap 0 since rows have own padding)
* **CSS to tighten:** `.ai-review-done-prompt` — padding `10px 12px` (was `var(--sp-3) var(--sp-4)`), `margin: var(--sp-2) var(--sp-4)` unchanged; `.ai-review-done-content` — flex row with `align-items: center` + `gap: 8px` (currently has wrap allowance + margin); `.ai-review-done-text` — collapse to inline-flex single line with ` · ` separator instead of two flex-column items.
* **Icons:** `check-circle-2`, `send`, `eye`, `pencil`, `check` — all in sprite. `check-circle-2 icon-md` (24px) becomes `check-circle-2 icon-sm` (16px) per spec.
* **Cache-bust:** `style.css?v=316 → 317`, `script.js?v=338 → 339`.

## 5. Technical Constraints & Risks
* **Hebrew RTL alignment.** With `flex: 1` on the context cell and send + preview after it, the visual order in RTL becomes "context (right) … send … preview (left)". This matches the screenshot mockup. `.ai-review-flow-row` will inherit `direction: rtl` from the prompt; no explicit override needed.
* **Long stat strings.** "4 אושרו · 1 שויכו · 2 נדחו · 3 ממתינים לתשובת" can wrap a single-line header at narrow widths. Mitigations: stats are `flex: 1` + `min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` so they truncate gracefully rather than wrapping. The screenshots show short stats; truncation is acceptable as a degraded view.
* **Button text length.** "שלח רשימת חסרים ללקוח" is fine in 11-12px outlined button; "תצוגה מקדימה" is fine as text-link. The DL-345 idle label remains unchanged (the "שלח שוב" only appears in the confirm-dialog text, not on the button itself, per DL-345's wording flip).
* **Header-inline primary in "neither" case.** This requires changing the primary's container at render time. Cleanest approach: build the primary HTML once, then either inject it inside `.ai-review-done-content` (neither case) or inside a `.ai-review-done-footer` row (any flow case). Two render branches in the template literal — simple to read.
* **Mobile path** uses the same builder; the mobile branch in `showClientReviewDonePrompt` injects this same HTML elsewhere. Spec says mobile out of scope, meaning we don't redesign for narrow widths beyond what flex-wrap already handles. We'll smoke-test that flex-wrap kicks in below ~480px so the row doesn't horizontal-scroll.
* **DL-323 user-initiated scroll** scrolls pane 2 to top after rendering. Banner becoming shorter = less vertical disruption — pure win, no regression.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
- Both flows visible: outer banner ≤95px (target ~80px).
- One flow visible: outer banner ≤75px (target ~60px).
- Neither flow: outer banner ≤50px (target ~40px).
- Header always one line, no wrap.
- No nested white card; sub-sections are inline rows.
- Hierarchy unchanged (single solid green for `סיים בדיקה`, outlined for sends, text-links for previews).
- No content below the banner gets cut off in pane 2 — the original motivation.

### Logic Flow (no change vs DL-347)
1. Compute existing flags and counts.
2. Build header HTML (single line: icon + title + ` · ` + stats).
3. Build flow rows iff their flags are truthy (no white card; one `.ai-review-flow-row` per flow).
4. Always build the primary `סיים בדיקה` button HTML.
5. **Render branch:**
   - If `hasAnyFlow`: prompt = `[header] [flowsStack] [footer-row primary]`.
   - Else: prompt = `[header inlined with primary on the same row]`.

### Markup Sketch (semantic)
- Outer `.ai-review-done-prompt` (existing CSS class, padding tightened).
- `.ai-review-done-header` — flex row with `align-items: center; gap: 8px`. Contains: icon + title-and-stats span (single line, ` · ` separator) + (only when neither) the primary button at the end.
- `.ai-review-flows-stack` — flex column, gap 0 (rows have own 4px vertical padding).
- `.ai-review-flow-row` — flex row, `align-items: center; gap: 8px; padding: 4px 0`. Children: context (flex 1) + send button + preview link (and optional `ערוך` link for questions).
- `.ai-review-done-footer` (only when `hasAnyFlow`) — flex row, `justify-content: flex-start` (start = right in RTL); margin-top 8px. Contains primary button.

### CSS Plan
- `.ai-review-done-prompt` — padding `10px 12px`; bottom margin unchanged; outer green keeps `--success-50` bg + `--success-200` border.
- `.ai-review-done-header` — `display: flex; align-items: center; gap: 8px;`. Title `font-size: 13px; font-weight: 500;`. Stats `font-size: 12px; color: var(--text-secondary, var(--gray-600));`. Title-and-stats wrapper has `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.
- `.ai-review-done-icon` shrinks to `icon-sm` in markup; CSS `flex-shrink: 0;`.
- `.ai-review-flows-stack` — `display: flex; flex-direction: column; gap: 0;`.
- `.ai-review-flow-row` — `display: flex; align-items: center; gap: 8px; padding: 4px 0; direction: rtl;`. Top border `1px solid var(--success-100)` to weakly separate rows from header without re-introducing nested cards (debate — may drop if it adds visual noise; spec says "no separator").
  - **Decision:** drop the top border per spec ("no separator between rows"). The 4px padding is the separator.
- `.ai-review-flow-row__context` — `flex: 1; min-width: 0; font-size: 12px;`.
- `.ai-review-flow-row__send-btn` — same outline style as DL-347, smaller: `padding: 3px 10px; font-size: 11px; border-radius: var(--radius-md);`.
- `.ai-review-flow-row__link` — bare text-link: `background: transparent; border: none; padding: 0 2px; font-size: 11px; color: var(--text-secondary); cursor: pointer;`. Hover: `text-decoration: underline; color: var(--gray-800);`.
- `.ai-review-done-footer` — `display: flex; margin-top: 8px;`. RTL-natural alignment via `justify-content: flex-start`.
- `.ai-review-done-primary` — `padding: 6px 16px; font-size: 12px; min-width: auto;`. Keeps `--success-500` solid bg + white text from DL-347; the previous 160px min-width is dropped.
- **DL-347 leftover removals:** `.ai-review-flow-card`, `.ai-review-flow-card__*`, `.ai-review-done-primary-row`. The `.ai-review-done-content` rule from DL-210 era is replaced by `.ai-review-done-header` (rename for clarity). The `.ai-review-done-text` two-column layout is gone.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Restructure `_buildClientReviewDonePromptEl` per the markup sketch: single-line header, inline flow rows (no card wrapper), conditional primary placement (header-inline vs footer-row). |
| `frontend/admin/css/style.css` | Modify | Replace `.ai-review-done-content` / `.ai-review-flow-card*` / `.ai-review-done-primary-row` blocks with the compact set above. Tighten outer `.ai-review-done-prompt` padding. Keep `.ai-review-done-prompt`'s green chrome. |
| `frontend/admin/index.html` | Modify | Bump `style.css?v=316 → 317`, `script.js?v=338 → 339`. |

### Final Step
* Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section-7 items to `current-status.md`. Mark DL-347 test entry as superseded in presentation by this DL (logic from DL-347 preserved).

## 7. Validation Plan
**For each state below, open dev tools → select the outer `.ai-review-done-prompt` element → record `getBoundingClientRect().height`. Banner must hit the targets.**
* [ ] **State 1 — both flows visible:** ≤95px (target ~80). Single-line header. Two inline flow rows stacked with no card. Footer row containing the solid-green primary, hugged to content (not full-width), right-aligned in RTL.
* [ ] **State 2 — questions only:** ≤75px (target ~60). One flow row + footer primary (or single-line layout if it fits cleanly).
* [ ] **State 3 — missing only:** ≤75px (target ~60). Same shape as State 2 with the missing-docs row.
* [ ] **State 4 — neither flow:** ≤50px (target ~40). Header and primary on a single horizontal row. No flow rows.
* [ ] **Header always one line:** stats string never wraps. Long stats truncate with ellipsis (acceptable degraded view).
* [ ] **Pane 2 content not pushed off-screen:** select a client with notes timeline + missing-docs section + ≥10 doc rows + completion banner — confirm the doc list and notes remain visible/scrollable; banner sits as a thin top strip.
* [ ] **Plural edges:** `1 ממתין לתשובה` and `נותר 1 מסמך שלא התקבל מהלקוח` (n=1) vs the plural forms — no layout breakage at either extreme.
* [ ] **DL-345 idle label "שלח רשימת חסרים ללקוח":** outlined button still contained, doesn't break the row.
* [ ] **DL-345 wording flip:** when `docs_first_sent_at` set, the confirm-dialog still reads "נשלח כבר ב-<date>. לשלוח שוב ל-<client>?" with primary "שלח שוב". Idle button label unchanged.
* [ ] **Live email smoke (`gws`):** click outlined `שלח שאלות ללקוח` → questions email arrives. Click outlined `שלח רשימת חסרים ללקוח` → missing-docs email arrives.
* [ ] **DL-335 held-questions:** clicking primary `סיים בדיקה` keeps `on_hold` items in the queue.
* [ ] **No regression** in DL-308 preview modal, DL-323 user-initiated scroll, DL-341 desktop pane-2 placement, DL-346 conditional rendering, DL-347 hierarchy (still one solid green only).
* [ ] **Console clean** in all states.
* [ ] **Mobile (≤768px) smoke:** rows wrap or stack without horizontal overflow; primary remains tap-target sized; banner doesn't shoot above 80px.

## 8. Implementation Notes (Post-Code)
* **No class renames** (per pre-coding clarification): `.ai-review-done-content` / `.ai-review-done-text` / `.ai-review-done-icon` / `.ai-review-done-stats` retained; only their CSS rules were replaced.
* **Stats at 11px + flex-wrap fallback** (per pre-coding clarification): header is `flex-wrap: wrap` with `min-width: 0` on the text span. In ≤3-counter common case, single line. In pathological 4×2-digit case, stats wrap below title rather than truncate. `text-overflow: clip` (not ellipsis) so any forced truncation doesn't silently drop digits.
* **Primary placement.** Two render branches in the template literal — `primaryBtnHtml` is built once and injected either inline at the end of `.ai-review-done-content` (neither-flow case) or inside a trailing `.ai-review-done-footer` row (any-flow case). CSS uses `> .ai-review-done-primary { margin-inline-start: auto; }` to push the inline primary to the end of the header row in RTL.
* **Flow rows replace cards.** `.ai-review-flow-card` markup + CSS deleted entirely; `.ai-review-flow-row` rules added. Each row is `padding: 4px 0` with no border/background, sitting directly inside the green prompt.
* **Outer banner padding** tightened from `var(--sp-3) var(--sp-4)` (~12px/16px) to a flat `10px 12px`.
* **Primary** loses its 160px min-width and centered alignment; now `padding: 6px 16px; font-size: 12px;` content-hug.
* **Send button** outline tightened: `padding: 3px 10px; font-size: 11px; border-radius: var(--radius-md)`.
* **Preview/edit links** shrunk: `padding: 0 2px; font-size: 11px;`.
* **Out-of-scope cleanup logged**: the legacy `document.querySelector('.ai-review-done-btn')` at script.js:7704 (in `dismissAndSendQuestions`) has been dead since DL-347 deleted the class. Not touched here. Worth a follow-up DL to delete or repoint.
* **Hierarchy from DL-347 preserved.** Still exactly one solid green per banner state (the bottom or inline primary `סיים בדיקה`). Sends still outlined. Previews still text-links.
* **Plural-aware Hebrew** untouched. **DL-345 `שלח שוב` confirm-dialog wording flip** untouched (lives in handler, not in idle button label).
* Research applied: NN/g information density + Tufte data-ink ratio + Material density baselines.
