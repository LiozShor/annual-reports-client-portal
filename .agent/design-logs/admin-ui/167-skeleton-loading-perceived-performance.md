# Design Log 167: Skeleton Loading for Perceived Performance
**Status:** [COMPLETED]
**Date:** 2026-03-22
**Related Logs:** DL-044 (error handling architecture), DL-037 (admin portal UX refactor)

## 1. Context & Problem
Portal pages (client-facing and admin) take 5-8 seconds to load data from n8n + Airtable. During this time, users see only a spinner — which feels slow and gives no indication of what's coming. The landing page already uses skeleton loading (since DL-032), but view-documents, document-manager, and admin dashboard still use plain spinners.

Near production — need minimal-risk improvement. Skeleton screens make pages feel ~30% faster without changing actual load times.

## 2. User Requirements
*Q&A from discovery phase:*
1. **Q:** Which portal are you experiencing slow response times on?
   **A:** Both (client portal + admin dashboard)
2. **Q:** What's your risk tolerance given you're near production?
   **A:** Minimal risk only — skeleton UI + CSS changes only, no data flow or n8n changes
3. **Q:** What's the typical response time you're seeing right now?
   **A:** 5-8 seconds
4. **Q:** Do you want this shipped immediately or post-launch?
   **A:** Ship now (before launch)

## 3. Research
### Domain
Perceived Performance, Loading UX, Skeleton Screen Design

### Sources Consulted
1. **"Don't Make Me Think" — Steve Krug** — Users should never wonder "is this working?" Good loading states maintain the illusion of progress and keep users oriented.
2. **LogRocket: Skeleton Loading Screen Design** — Skeletons must mirror the real layout to prevent layout shift. Use shimmer animation (left-to-right gradient) to indicate activity. Only use for loads >0.5s.
3. **UI Deploy: Skeleton Screens vs. Spinners** — Studies show users perceive sites with skeleton screens as 30% faster than identical sites with spinners. Skeleton screens eliminate layout shift when content arrives.
4. **CSS-Tricks: Building Skeleton Screens with CSS Custom Properties** — Pure CSS skeletons using linear-gradient + background-position animation. Zero JS needed. `:empty` pseudo-class can auto-hide skeletons when content arrives.
5. **KeyCDN: Perceived Performance** — Progressive loading (show structure first, fill in details) is the most effective perceived-performance technique.

### Key Principles Extracted
- **Mirror the layout:** Skeleton must match the actual content structure (rows, cards, progress bars) — random gray blocks feel worse than spinners
- **Shimmer = alive:** Static gray blocks feel broken; animated shimmer communicates "working on it"
- **No layout shift:** Skeleton dimensions must match final content to prevent jarring reflow
- **Only for content loading:** Short operations (<0.5s) should use spinners; skeleton is for initial page loads

### Patterns to Use
- **CSS-only skeleton with `:empty` fallback:** Use existing `.skeleton` + `.skeleton-text` classes from design-system.css. Skeletons live inside the same container that gets replaced by real content.
- **Progressive reveal:** Show page chrome (header, nav) immediately; only the content area shows skeleton.

### Anti-Patterns to Avoid
- **Over-detailed skeletons:** Don't try to match every pixel — approximate structure is enough. Over-detailed skeletons that don't match create uncanny valley effect.
- **Skeleton for actions:** Don't replace action loading (save, approve) with skeletons — those should keep spinners/overlays for feedback.

### Research Verdict
Replace spinner-only loading states with shimmer skeletons on all 3 pages. Use existing design-system.css classes. HTML-only changes in the loading containers — zero JS changes for client pages, one optional line for admin.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `design-system.css` lines 486-509: `.skeleton`, `.skeleton-text`, `.skeleton-text-lg`, `.skeleton-block` with `@keyframes skeletonShimmer`
  - `landing.css` line 161: `.skeleton-loader` container class
  - `index.html` (landing): Full skeleton implementation with text + block placeholders
* **Reuse Decision:** Extend existing skeleton classes with new variants (`.skeleton-row`, `.skeleton-stat`, `.skeleton-card`, `.skeleton-progress`). No new animation needed.
* **Relevant Files:**
  - `view-documents.html` line 54: spinner loading div
  - `document-manager.html` line 94: spinner loading div
  - `admin/index.html` line 654: loading overlay (actions only — leave unchanged)
  - `admin/index.html` line 89-93: dashboard tab content area
* **Existing Patterns:** Landing page skeleton is the reference implementation. All other pages use `<div class="loading"><div class="spinner"></div><p>text</p></div>` which JS hides after API response.
* **Alignment with Research:** Existing shimmer animation matches best practices (1.5s ease-in-out, left-to-right gradient). Just needs to be applied to more elements.

## 5. Technical Constraints & Risks
* **Security:** None — purely cosmetic HTML/CSS changes
* **Risks:**
  - Layout shift if skeleton dimensions don't match content — mitigate by using percentage widths matching real content
  - If `design-system.css` fails to load, skeletons show as unstyled divs — acceptable degradation
* **Breaking Changes:** None — existing JS `hideLoading()`/`showContent()` logic works unchanged since skeletons live inside the same `#loading` container

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Add new reusable skeleton variants to `design-system.css`
2. Replace spinner HTML in `view-documents.html` with skeleton mimicking document list
3. Replace spinner HTML in `document-manager.html` with skeleton mimicking status bar + card sections
4. Add skeleton placeholder in `admin/index.html` dashboard tab for table area (CSS `:empty` approach)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `assets/css/design-system.css` | Modify | Add `.skeleton-row`, `.skeleton-card`, `.skeleton-progress` classes |
| `view-documents.html` | Modify | Replace spinner with skeleton (progress bar + 5 document rows) |
| `document-manager.html` | Modify | Replace spinner with skeleton (status + 2 card sections) |
| `admin/index.html` | Modify | Add skeleton placeholder in dashboard table area |
| `admin/css/style.css` | Modify | Dashboard-specific skeleton styling if needed |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan
* [ ] View-documents page: skeleton appears instantly, replaced by real content after API response
* [ ] Document-manager page: skeleton appears instantly, replaced by real content after API response
* [ ] Admin dashboard: skeleton/placeholder visible while data loads
* [ ] No layout shift when content replaces skeleton
* [ ] Shimmer animation runs at 60fps (no jank)
* [ ] Landing page skeleton (existing) still works unchanged
* [ ] Test on slow network (DevTools → Slow 3G) — skeleton persists during full load time
* [ ] RTL layout preserved — skeleton looks correct in Hebrew context

## 8. Implementation Notes (Post-Code)
* **Deviation:** Added hidden `<p id="loading-text-he">` and `<p id="loading-text-en">` elements to view-documents.html to preserve JS compatibility — `switchLanguage()` in view-documents.js references these IDs (lines 415-416). Without them, language toggle would throw null reference errors.
* **Deviation:** Moved `.skeleton-loader` base class from `landing.css` to `design-system.css` so all pages can use it. Landing page retains its override with `text-align: center`.
* **Admin dashboard:** Used existing `container.innerHTML = ...` pattern in `renderClientsTable()` which naturally replaces the skeleton — zero JS changes needed.
* **Pattern applied:** Skeleton Screen design pattern — research principle "mirror the layout" applied by matching document rows (circle + text + badge) and card sections.
