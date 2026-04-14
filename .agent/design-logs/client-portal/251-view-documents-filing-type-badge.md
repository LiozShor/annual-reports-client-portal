# Design Log 251: View Documents — Filing Type Badge in Header
**Status:** [COMPLETED]
**Date:** 2026-04-12
**Related Logs:** DL-218 (filing type tabs), DL-225 (CS hardcoded AR remediation), DL-250 (entity tab switch badge)

## 1. Context & Problem
Clients with both Annual Report (AR) and Capital Statement (CS) filing types land on the view-documents page and cannot immediately tell which filing type they're viewing. DL-218 added filing type tabs below the header, but these are subtle — especially on first load before scrolling. The page title embeds the filing type in a long sentence ("רשימת מסמכים נדרשים להכנת הדוח שנתי") which is easy to miss. There is no standalone visual indicator.

## 2. User Requirements
1. **Q:** What specifically feels unclear — tab styling, or no indicator on first load?
   **A:** The view-documents page header has no clear filing type indicator.
2. **Q:** Where should the filing type indicator be most visible?
   **A:** In the page header/title area — always visible at the top.
3. **Q:** Should we visually differentiate the page per filing type (accent color)?
   **A:** No — same styling, just add a clear label/badge.

## 3. Research
### Domain
Context indicators / mode indicators in document portals

### Sources Consulted
1. **Nielsen Norman Group (tab usability)** — Active state needs strong visual differentiation, not just subtle color shifts. 20-30% of users miss subtle tab changes.
2. **Material Design (navigation patterns)** — Use a persistent page-level indicator when entire page content changes based on mode. Tabs switch; a banner reinforces where you are.
3. **Baymard Institute (e-commerce UX)** — Redundant encoding: combine at least two signals (color + text label). Text labels far more effective than icons or color alone for non-tech users.

### Key Principles Extracted
- **Redundant encoding:** Badge in header + tab underline = two signals. Never rely on a single cue.
- **Persistent context:** Filing type should be visible without scrolling to tabs.
- **Text label > icon alone:** Especially for non-tech clients — "דוח שנתי" text pill is clearer than an icon.
- **Context on re-entry:** When users land via link/bookmark, the badge is immediately visible.

### Patterns to Use
- **Reuse admin badge pattern:** `.ai-filing-type-badge` + `.ai-ft-annual_report` / `.ai-ft-capital_statement` already exist in admin CSS. Copy the same styles to view-documents.css for visual consistency.

### Anti-Patterns to Avoid
- **Embedding filing type only in title text:** Current approach — too subtle, gets lost in a long sentence.
- **Color-only differentiation:** Would fail accessibility and add unnecessary complexity.

### Research Verdict
Add a standalone color-coded pill badge in the header subtitle area. Reuse the exact admin badge pattern (blue for AR, purple for CS). Show only for dual-filing clients (single-filing clients don't need the distinction). Update badge on tab switch via `renderFromData`.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - Admin badge CSS: `admin/css/style.css:1832-1849` — `.ai-filing-type-badge`, `.ai-ft-annual_report`, `.ai-ft-capital_statement`
  - Admin badge JS: `admin/js/script.js` — `FILING_TYPE_LABELS` constant, inline rendering
  - DL-218 tabs: `view-documents.js:569-583` — `renderFilingTabs()` renders tab row
  - `renderFromData()`: `view-documents.js:244-275` — called on tab switch, updates titles/subtitle but no badge
* **Reuse Decision:** Copy the 3 badge CSS rules (~15 lines) into `view-documents.css`. No need for shared CSS file — admin and client portal are separate deployments.
* **Relevant Files:**
  - `view-documents.html:40` — subtitle div where badge will be injected
  - `view-documents.js:179-185` — initial subtitle rendering
  - `view-documents.js:253-258` — `renderFromData` subtitle rendering (tab switch)
  - `view-documents.css` — needs badge CSS added
* **Alignment with Research:** Current implementation relies on a single cue (tab underline). Adding header badge provides the recommended redundant encoding.

## 5. Technical Constraints & Risks
* **Security:** None — purely visual, no auth or data changes.
* **Risks:** Minimal — additive CSS + a `<span>` in the subtitle. No API changes.
* **Breaking Changes:** None — badge only shows for dual-filing clients.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Dual AR+CS clients see a colored pill badge (blue for AR, purple for CS) in the header subtitle area that immediately identifies the current filing type, and it updates when switching tabs.

### Logic Flow
1. Add badge CSS to `view-documents.css` (copy from admin)
2. Add a `<span id="filing-type-badge">` placeholder in `view-documents.html` subtitle area
3. In JS: after loading data, if the client has multiple reports (detected via `discoverSiblingReports`), show the badge in the subtitle with the filing type label
4. In `renderFromData()`: update badge text and class on tab switch
5. Single-filing clients: badge remains hidden (no visual change for them)

### Data Structures / Schema Changes
None — `filing_type`, `filing_type_label_he`, `filing_type_label_en` already in API response.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/.../assets/css/view-documents.css` | Modify | Add `.ai-filing-type-badge`, `.ai-ft-annual_report`, `.ai-ft-capital_statement` styles |
| `github/.../view-documents.html` | Modify | Add `<span id="filing-type-badge">` in subtitle area |
| `github/.../assets/js/view-documents.js` | Modify | Show badge after sibling discovery; update in `renderFromData()` |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md, git commit & push

## 7. Validation Plan
* [ ] Single-filing AR client: no badge visible, page looks unchanged
* [ ] Dual AR+CS client: badge visible in header showing current filing type
* [ ] Switch tabs: badge updates to match the selected filing type (text + color)
* [ ] Hebrew mode: badge shows "דוח שנתי" / "הצהרת הון"
* [ ] English mode: badge shows "Annual Report" / "Capital Statement"
* [ ] Mobile: badge doesn't break header layout
* [ ] No regression in subtitle text (client name, year still correct)

## 8. Implementation Notes (Post-Code)
* **Deviation:** `discoverSiblingReports()` and `loadSiblingDocs()` originally only supported client token auth. Had to add admin Bearer token auth path (matching `loadDocuments()` pattern) — without this, the API returned 400 when accessed via admin panel (no client token in URL).
* **Admin mode uses `client_id`:** In admin auth, the sibling discovery endpoint uses `?client_id=X` (from `currentData.client_id`) instead of `?report_id=X&token=Y`.
* Research principle applied: Redundant encoding (badge + tabs = two signals for filing type context).
