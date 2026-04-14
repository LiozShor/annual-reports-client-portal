# Design Log 220: Capital Statement Questionnaire Email + Landing Page
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-29
**Related Logs:** DL-164 (filing type layer), DL-182 (CS Tally questionnaire), DL-219 (second filing type)

## 1. Context & Problem
When sending a CS questionnaire email, the subject correctly shows "שאלון — הצהרת הון 2025" (via dynamic `FILING_LABELS`), but the email body is hardcoded to AR text ("דוח שנתי" everywhere). CS needs completely different body content — explaining the tax authority demand, the 31.12 deadline date, the fee, etc.

Additionally, the landing page header shows hardcoded "📋 שאלון דוח שנתי" and the HTML title says "Annual Tax Report Questionnaire" regardless of filing type.

## 2. User Requirements
1. **Q:** Same template structure or completely separate?
   **A:** Same visual design (layout, colors, CTA button style), different text content.

2. **Q:** Where should the 31.12 date and fee come from?
   **A:** Year-based (31.12.{year}) + hardcoded fee (1,000 ₪ + מע"מ).

3. **Q:** Fix landing page in this DL too?
   **A:** Yes — update header/subtitle/title dynamically from API.

4. **Q:** Single CTA or two links (phone/computer)?
   **A:** Single CTA button — landing page is responsive.

## 3. Research
### Domain
Transactional email design, Hebrew RTL email, tax compliance communication

### Sources Consulted
1. **Modular Email Architecture (Oracle/Dyspatch)** — Same layout shell, branch content by type. Avoids template duplication.
2. **RTL Email Design (Email Almanac/Stripo)** — `dir="rtl"` on all elements. First char in subject must be Hebrew.
3. **Tax Compliance Messaging (J-PAL)** — Professional but warm tone. Simplified language increases compliance 2.6pp vs bureaucratic.

### Research Verdict
Modular approach: shared HTML shell (logo, header bar, CTA, contact block, footer), content helpers return type-specific text. CS tone follows Natan's draft — informative, not threatening.

## 4. Codebase Analysis
- `buildQuestionnaireEmailHtml` in `email-html.ts` — monolithic function with hardcoded AR text
- `QuestionnaireEmailParams` interface already has `filingType?: string` — never used
- `send-questionnaires.ts` correctly reads `filingType` for subject but doesn't pass to body builder
- Landing page `init()` sets header from hardcoded B64 before API response arrives
- API `check-existing-submission` already returns `filing_type_label_he/en` — unused by landing page

## 5. Technical Constraints & Risks
- **No breaking changes** — AR emails remain identical (default path)
- **Security:** No new auth concerns
- **Risks:** Hebrew encoding must stay clean in email body

## 6. Proposed Solution

### Content helper pattern
Two functions (`arQuestionnaireContent`, `csQuestionnaireContent`) return `{ headerText, bodyRows[], footerText }`. Main function assembles shared HTML shell around the content.

### CS email body (from Natan's draft, adapted):
- Header: "שאלון — הצהרת הון ליום 31.12.{year}"
- Tax authority demand explanation
- What CS is (כלי של מס הכנסה להילחם בהון שחור)
- First CS explanation
- Call to fill questionnaire for whole family unit
- After filling → doc list will be sent
- "לא בטוח" option for unclear items
- Fee: 1,000 ₪ + מע"מ

### Landing page
- After API response: update headerTitle, subtitle, document.title with filing type labels
- Defaults changed from "Annual Tax Report Questionnaire" to generic "Questionnaire"

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/email-html.ts` | Modified | Content helpers by filing type, shared HTML shell |
| `api/src/routes/send-questionnaires.ts` | Modified | Pass `filingType` to email builder |
| `github/.../assets/js/landing.js` | Modified | Dynamic header/subtitle/title from API labels |
| `github/.../index.html` | Modified | Generic default title |

## 7. Validation Plan
* [ ] Send CS questionnaire email → body shows הצהרת הון text with 31.12.{year}, fee, etc.
* [ ] Send AR questionnaire email → body unchanged (regression check)
* [ ] CS email subject: "שאלון — הצהרת הון {year} | {name}" (already works)
* [ ] Landing page for CS report → header "📋 שאלון הצהרת הון", subtitle "Capital Statement Questionnaire"
* [ ] Landing page for AR report → header still "📋 שאלון דוח שנתי" (regression)
* [ ] CS landing page loads correct Tally form (7Roovz from API)

## 8. Implementation Notes
- Used content helper pattern: `arQuestionnaireContent()` / `csQuestionnaireContent()` return typed content objects
- CTA split point differs: AR has 2 paragraphs before CTA, CS has 4 (more context needed before action)
- CS fee line uses `&#8362;` (₪) HTML entity for email compatibility
- Landing page JS uses Unicode escapes for Hebrew emoji to avoid encoding issues
