# Design Log 083: Email CTA Highlight Box + Title Tweak
**Status:** [IMPLEMENTED — TESTING]
**Date:** 2026-03-03
**Related Logs:** DL-030 (bilingual email), DL-073 (Type A CTA), DL-076 (WF[03] card layout)

## 1. Context & Problem
The "send documents to: reports@moshe-atsits.co.il" CTA in client emails is styled as muted 14px inline text — easy to miss. Clients need to clearly see WHERE to send their documents. Additionally, the document list title should clarify the purpose: "להכנת הדו״ח" (for preparing the annual report).

## 2. User Requirements
1. **Q:** Which instances to enlarge?
   **A:** WF[03] client email, WF[06] Type B reminder, Batch Status (if rejected docs exist)
2. **Q:** How prominent?
   **A:** Larger text + highlight box (light background card)
3. **Q:** Title change scope?
   **A:** Everywhere — emails + client portal
4. **Q:** Touch noscript/error fallbacks?
   **A:** Skip — edge cases

## 3. Research
### Domain
Email CTA Design, Transactional Email UX

### Sources Consulted
1. **Litmus: Bulletproof Buttons & CTA Guide** — For "do X to this address" instructions, a highlight box (not button) is the correct pattern. Buttons imply click-to-complete; boxes frame an instruction.
2. **NNGroup: Transactional Email UX** — Primary instruction should be visually distinct. Combine color background with bold text and larger font (not color alone).
3. **Email on Acid: Background Colors** — `background-color` on `<td>` works in all major clients. `border-radius` ignored by Outlook desktop (graceful degradation). Use 6-digit hex, inline styles only.

### Key Principles
- **Highlight box > button** for "send to this email" — semantically correct
- **16px instruction + 20px email** creates clear visual hierarchy over 14-15px body text
- **Light blue background (#eff6ff)** — already used in our email design system (matches `ACCENT.clientBg`)
- **Outlook-safe:** `background-color` + `padding` on `<td>` = universal support

### Anti-Patterns to Avoid
- **Button for email address** — false affordance (implies click-to-complete)
- **Color alone** — must combine with size + weight for accessibility

## 4. Codebase Analysis

### CTA Locations Found (exact lines)

| Location | Node | Lines | Current Style |
|----------|------|-------|---------------|
| WF[03] EN bilingual | `generate-html` | 403 | 14px, `C.meta` (#6b7280), inline |
| WF[03] HE bilingual | `generate-html` | 416 | 14px, `C.meta` (#6b7280), inline |
| WF[03] HE-only | `generate-html` | 432 | 15px, `C.body` (#374151), inline |
| Type B EN bilingual | `build_type_b_email` | 44→60 | 14px, #6b7280, inline |
| Type B HE bilingual | `build_type_b_email` | 49→71 | 14px, #6b7280, inline |
| Type B HE-only | `build_type_b_email` | 114-116 | 14px, #6b7280, inline |
| Batch Status EN rejected instruction | `code-build-email` | 90 | 14px, embedded in section |
| Batch Status HE rejected instruction | `code-build-email` | 92, 146 | 14px, embedded in section |

### Title Locations Found

| Location | Node | Line | Current Text |
|----------|------|------|-------------|
| WF[03] EN bilingual | `generate-html` | 401 | "Please provide the following X documents for tax year Y:" |
| WF[03] HE bilingual | `generate-html` | 414 | "להלן רשימת X המסמכים הנדרשים לשנת המס Y:" |
| WF[03] HE-only | `generate-html` | 430 | Same as above |
| Client portal HE | `view-documents.html` | 31 | "רשימת מסמכים נדרשים" |
| Client portal EN | `view-documents.html` | 32 | "Required Documents List" |

### Not in scope
- **Type A email** — questionnaire-focused, no "send docs" CTA
- **Noscript/error fallbacks** — user said skip

## 5. Technical Constraints & Risks
- **Outlook desktop:** `border-radius` ignored (graceful degradation to square corners)
- **No breaking changes:** Only visual changes to existing email HTML output
- **Three separate n8n Code nodes** — helper function must be defined inline in each

## 6. Proposed Solution (The Blueprint)

### A. Shared Highlight Box Pattern

Define a `sendDocsBox(dir, lang, font, email)` function in each n8n Code node:

```html
<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="background-color:#eff6ff; padding:20px 24px; border-radius:8px;
               border:1px solid #bfdbfe; direction:{dir}; text-align:{align};">
      <p style="margin:0 0 4px; font-size:16px; color:#1e40af;
               font-weight:600; line-height:1.5;">
        {instruction text}
      </p>
      <p style="margin:0; font-size:20px; font-weight:bold;">
        <a href="mailto:{email}" style="color:#2563eb; text-decoration:none;">
          {email}
        </a>
      </p>
    </td>
  </tr>
</table>
```

- Background: `#eff6ff` (light blue, matches existing `ACCENT.clientBg`)
- Border: `1px solid #bfdbfe` (blue-200 for subtle definition)
- Instruction: 16px, `#1e40af` (brand-dark), semi-bold
- Email: 20px, bold, `#2563eb` brand link, no underline
- Padding: 20px vertical, 24px horizontal

### B. Title Wording Changes

**Hebrew:** "להלן רשימת X המסמכים הנדרשים לשנת המס Y:"
→ "להלן רשימת X המסמכים הנדרשים **להכנת הדו״ח** לשנת המס Y:"

**English:** "Please provide the following X documents for tax year Y:"
→ "Please provide the following X documents **for preparation of the annual report** for tax year Y:"

**Client Portal:**
- HE: "רשימת מסמכים נדרשים" → "רשימת מסמכים נדרשים להכנת הדו״ח"
- EN: "Required Documents List" → "Required Documents for Annual Report"

### C. Per-File Changes

#### 1. WF[03] Document Service (`hf7DRQ9fLmQqHv3u`, node `generate-html`)
- Add `sendDocsBox()` helper after existing shared builders (~line 142)
- **Line 401** (EN bilingual intro): Insert "for preparation of the annual report"
- **Line 403** (EN CTA): Replace inline `<tr><td>` with `sendDocsBox('ltr', 'en')`
- **Line 414** (HE bilingual intro): Insert "להכנת הדו״ח"
- **Line 416** (HE CTA): Replace inline `<tr><td>` with `sendDocsBox('rtl', 'he')`
- **Line 430** (HE-only intro): Insert "להכנת הדו״ח"
- **Line 432** (HE-only CTA): Replace inline `<tr><td>` with `sendDocsBox('rtl', 'he')`

#### 2. WF[06] Type B Email (`FjisCdmWc4ef0qSV`, node `build_type_b_email`)
- Add `sendDocsBox()` helper at top of code
- **Line 44/60** (EN bilingual CTA): Replace inline `<p>` with `sendDocsBox('ltr', 'en')`
- **Line 49/71** (HE bilingual CTA): Replace inline `<p>` with `sendDocsBox('rtl', 'he')`
- **Line 114-116** (HE-only CTA): Replace inline `<p>` with `sendDocsBox('rtl', 'he')`

#### 3. Batch Status Email (`QREwCScDZvhF9njF`, node `code-build-email`)
- Add `sendDocsBox()` helper
- Add highlight box AFTER rejected+approved lists, BEFORE progress one-liner, ONLY when `rejected.length > 0`
- Both EN and HE paths (bilingual cards + HE-only)

#### 4. Client Portal (`github/annual-reports-client-portal/view-documents.html`)
- Line 31: "רשימת מסמכים נדרשים" → "רשימת מסמכים נדרשים להכנת הדו״ח"
- Line 32: "Required Documents List" → "Required Documents for Annual Report"
- Page `<title>` (line 6): Add "להכנת הדו״ח" there too

#### 5. Docs (`docs/email-design-rules.md`)
- Update WF[03] structure section to reflect new CTA styling

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n `generate-html` (hf7DRQ9fLmQqHv3u) | Modify | Add highlight box + title tweak |
| n8n `build_type_b_email` (FjisCdmWc4ef0qSV) | Modify | Add highlight box |
| n8n `code-build-email` (QREwCScDZvhF9njF) | Modify | Add conditional highlight box |
| `view-documents.html` | Modify | Title wording update |
| `docs/email-design-rules.md` | Modify | Update WF[03] structure doc |

## 7. Validation Plan
- [ ] WF[03] HE-only: CTA renders as highlight box (blue bg, 20px email, 16px instruction)
- [ ] WF[03] bilingual: Both EN and HE cards show highlight box
- [ ] WF[03] title includes "להכנת הדו״ח" / "for preparation of the annual report"
- [ ] Type B HE-only: CTA renders as highlight box
- [ ] Type B bilingual: Both cards show highlight box
- [ ] Batch Status with rejections: Highlight box appears
- [ ] Batch Status without rejections: No highlight box
- [ ] Client portal page title updated (both languages)
- [ ] Visual regression: No layout breakage in emails

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
