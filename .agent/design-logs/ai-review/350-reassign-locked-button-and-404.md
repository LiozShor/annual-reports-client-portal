# Design Log 350: AI Review reassign — locked "שייך" button + 404 console errors
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-26
**Related Logs:** DL-334 (3-pane rework), DL-339 (move actions to pane2), DL-330 (inline comboboxes)

## 1. Context & Problem

After the DL-345 → DL-348 merges, two regressions surfaced in the AI Review tab while reassigning a doc:

1. **Locked assign button** — selecting a doc in the reassign combobox does not enable the "שייך" button. The user is stuck on the card.
2. **Console 404s** — DevTools shows three `404` responses on a URL truncated as `…ew-classification`. Live `/webhook/review-classification` actually returns 400/401 (route exists, deployed), so the source path of the 404 is unconfirmed.

Both bugs are scoped to the AI Review reassign flow.

## 2. User Requirements

1. **Q:** Action that triggered the 404? **A:** Clicked "שייך מחדש" and picked a template.
2. **Q:** Exact 404 URL? **A:** Unknown — user forwarded screenshot. Reproducible on CPA-XXX in production.
3. **Q:** Environment? **A:** Production (docs.moshe-atsits.com).
4. **Q:** Regression vs long-standing? **A:** Just appeared today after recent merges.
5. **Q:** Scope of fix? **A:** Bug 1 first (root cause confirmed); Bug 2 deferred until full URL captured.

## 3. Research

### Domain
Frontend DOM scoping after a layout rework — regression caused by an ancestor-class lookup that wasn't updated when the surrounding container class changed.

### Sources Consulted
1. **DL-339 v1.5 audit comment (script.js:7129-7133)** — prior fix for the same class of bug in `assignAIUnmatched`: "audit this desktop-or-mobile call site — the panel scope is `.ai-actions-panel`, the mobile fat-card scope is `.ai-card-actions`. Without this fallback the combobox lookup below throws on every desktop [שייך] click in State D / State B fallback." That fix used `closest('.ai-card-actions') || closest('.ai-actions-panel')`.
2. **DL-334 / DL-339 design logs** — moved actions out of the fat card into the right-pane actions panel on desktop. Mobile fat-card path retained for narrow viewports.
3. **MDN: Element.closest()** — returns `null` when no matching ancestor exists; combined with `?.` it silently no-ops.

### Key Principles Extracted
- **Ancestor-class lookups must enumerate every container the element can live in.** When a layout rework introduces a second container, every `closest()` must be revisited, not just the call sites flagged at audit time.
- **Silent failures from `?.` are footguns** when the right-hand operand has user-visible side effects (here: enabling a button).

### Patterns to Use
- **Multi-scope `closest()` fallback:** `el.closest('.scopeA') || el.closest('.scopeB')` — the same pattern already used in `assignAIUnmatched` (DL-339 v1.5).

### Anti-Patterns to Avoid
- **Branching on viewport (`isAIReviewMobileLayout()`)** for DOM scope — fragile across responsive transitions; falling-back-by-class is robust to either layout.

### Research Verdict
Reuse the existing DL-339 v1.5 pattern verbatim in `initAIReviewComboboxes` `onSelect`. One-line scope change.

## 4. Codebase Analysis

* **Existing Solutions Found:** `assignAIUnmatched` already implements the multi-scope fallback (`script.js:7133`). Pattern is in-tree.
* **Reuse Decision:** Apply the same fallback to the combobox `onSelect` in `initAIReviewComboboxes`.
* **Relevant Files:**
  * `frontend/admin/js/script.js:5168-5190` — `initAIReviewComboboxes` (the bug)
  * `frontend/admin/js/script.js:7128-7158` — `assignAIUnmatched` (existing pattern)
  * `frontend/admin/js/script.js:4431-4486` — `renderActionsPanel` (where desktop combobox is rendered)
  * `frontend/admin/js/script.js:4555,4587` — `.doc-combobox-container.ai-ap-combobox` markup
  * `frontend/admin/js/script.js:4717-4737` — `.btn-ai-assign-confirm` button markup inside `.ai-ap-primary-actions`
  * `frontend/admin/index.html:1524` — script.js cache-bust
* **Existing Patterns:** Combobox + button colocation works on mobile because both share `.ai-card-actions`. Desktop split them into siblings under `.ai-actions-panel`.
* **Alignment with Research:** Direct match — DL-339 already established the cure.
* **Dependencies:** None; pure DOM-scoping fix.

## 5. Technical Constraints & Risks

* **Security:** None — pure UI handler.
* **Risks:** None expected. The fallback only fires when `.ai-card-actions` lookup fails, which is precisely the desktop case currently broken.
* **Breaking Changes:** None. Mobile path unchanged (first branch of the `||` still resolves).

## 6. Proposed Solution (The Blueprint)

### Success Criteria
On both desktop and mobile, selecting a doc in the AI Review reassign combobox immediately enables the "שייך" button and reassign succeeds end-to-end.

### Logic Flow
1. User opens reassign combobox in actions panel.
2. `onSelect(templateId)` fires.
3. Look up scope as `.ai-card-actions || .ai-actions-panel`.
4. Find `.btn-ai-assign-confirm` inside scope.
5. Toggle `disabled` based on `templateId` truthiness.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` (~5180) | Modify | Add `.ai-actions-panel` fallback to combobox onSelect |
| `frontend/admin/index.html` (1524) | Modify | Bump `script.js?v=339` → `?v=340` |

### Final Step (Always)
* **Housekeeping:** Update status → `[IMPLEMENTED — NEED TESTING]`, add Section 7 items to `current-status.md` Active TODOs, commit + push branch, **pause for merge approval** (frontend goes live only after merge to main).

## 7. Validation Plan

* [ ] On production (after merge), AI Review tab → CPA-XXX → unmatched/issuer-mismatch card → open combobox → select a doc → "שייך" button enables immediately.
* [ ] Click "שייך" → confirmation prompt → reassign succeeds → card transitions to "שויך מחדש".
* [ ] Mobile viewport (<768px): same flow on the fat-card layout — button still enables.
* [ ] Issuer-mismatch quick-assign path ("אישור ושיוך", `.btn-ai-comparison-assign`) still works — untouched by this fix, regression check only.
* [ ] **Bug 2:** capture full 404 URL from Network tab; if real, file follow-up; if stale-cache only, close out.

## 8. Implementation Notes (Post-Code)

* Applied the DL-339 v1.5 multi-scope fallback pattern verbatim.
* Bug 2 (404) is **deferred** pending full URL capture from the user's DevTools Network tab. Source-tree grep returned no candidate path; the deployed `/webhook/review-classification` route returns 400/401 (not 404) under direct probe with empty/fake payloads. Most-likely root cause is a stale cached `endpoints.js`/`constants.js` (neither file is cache-busted in `frontend/admin/index.html:1519-1520`) — hardening to add `?v=` query strings to those scripts is out of scope for this log unless the user opts in.
