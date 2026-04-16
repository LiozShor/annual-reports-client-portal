# Design Log 253: Group Rejected Uploads by Reason in Email
**Status:** [COMPLETED]
**Date:** 2026-04-12
**Related Logs:** DL-244 (rejected uploads visibility — original feature)

## 1. Context & Problem
The rejected uploads callout (DL-244) in the doc-request email renders all rejected files as flat rows with `filename · date · reason` concatenated on one line. When multiple files are rejected for different reasons, the reasons blend together and it's hard to scan which file has which problem.

## 2. User Requirements
1. **Q:** How should rejected files be grouped — by reason or individually with better separation?
   **A:** Group by reason. Show reason as a sub-header, then list files under it.

2. **Q:** Should this change update all surfaces (email, portal, admin)?
   **A:** Email only. Client portal and admin panel are out of scope.

3. **Q:** Should admin rejection notes still show to the client?
   **A:** Yes, show notes to client in parentheses after the filename.

## 3. Research
### Domain
Transactional email HTML, grouped list layout patterns.

### Sources Consulted
1. **DL-244** — Original implementation, reuse existing styles.
2. **Email HTML best practices** — Table-based layouts, inline styles, no flexbox (Outlook compatibility).
3. **DL-076 (bilingual card pattern)** — Established bilingual rendering approach.

### Key Principles Extracted
- Nested tables for grouped sections (outer = group header, inner = items)
- All CSS inline — Gmail strips `<head>` styles
- Keep same amber color palette for visual continuity

### Research Verdict
Simple restructure: group entries by `reason_text`, render each group with a bold `⚠` sub-header row followed by bullet-point file rows. No new HTML patterns needed.

## 4. Codebase Analysis
* **Existing Solutions Found:** `buildRejectedUploadsCallout()` in `api/src/lib/email-html.ts:225`
* **Reuse Decision:** Rewrite in-place, same function signature, same callers
* **Relevant Files:** `api/src/lib/email-html.ts` only
* **Dependencies:** `REJECTION_REASONS` in `api/src/lib/classification-helpers.ts` (Hebrew labels), added `REJECTION_REASONS_EN` inline for English

## 5. Technical Constraints & Risks
* **Security:** No new inputs, all values already HTML-escaped
* **Risks:** None — only changes email HTML output, no data or API changes
* **Breaking Changes:** None — same function signature, same callsites

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Rejected uploads in the email callout are visually grouped by reason, with each reason as a bold sub-header and files listed under it.

### Logic Flow
1. Group entries by `reason_text` (Hebrew) or `REJECTION_REASONS_EN[reason_code]` (English)
2. Fallback to "Other" / "אחר" for entries without a reason
3. Render: group header (`⚠ reason`) → bullet rows (`• filename · date (notes)`)
4. 16px vertical spacing between groups

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/email-html.ts` | Modify | Rewrite `buildRejectedUploadsCallout` to group by reason |

## 7. Validation Plan
* [ ] Preview email with multiple rejected uploads having different reasons — verify grouped layout
* [ ] Preview email with single rejected upload — verify still renders correctly
* [ ] Preview bilingual (EN) email — verify English reason labels appear
* [ ] Send test email to Gmail — verify rendering in real email client

## 8. Implementation Notes
* Added `REJECTION_REASONS_EN` map near the function for English labels
* Removed `border-bottom` from individual rows (was `1px solid #FDE68A`) — not needed with grouped layout
* Group spacing: 16px top padding on non-first groups, 4px padding on item rows
