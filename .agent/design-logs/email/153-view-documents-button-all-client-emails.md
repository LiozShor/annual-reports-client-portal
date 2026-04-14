# Design Log 153: View Documents Button in All Client Emails
**Status:** [COMPLETED]
**Date:** 2026-03-16
**Related Logs:** DL-090 (HMAC Token Architecture), DL-127 (Email CTA+Help Merge)

## 1. Context & Problem

The Batch Status email (`[API] Send Batch Status`) includes a green "צפייה בסטטוס המסמכים" button linking to `view-documents.html?report_id=X` — but **without an HMAC token**. Since `view-documents.js` requires either a `clientToken` (from sessionStorage) or `adminToken` (from localStorage), clicking this button from a fresh browser session shows "Link Expired".

Additionally, WF[03] Approve & Send and WF[06] Reminder Type B send document lists to clients but don't include a view-documents button at all.

All existing client tokens (WF[01], WF[06] Type A) use 14-day expiry — user wants **45 days** for all client-facing links.

## 2. User Requirements

1. **Q:** Token expiry for view-documents links?
   **A:** 45 days for all client-facing HMAC tokens.

2. **Q:** Which emails should get the view-documents button?
   **A:** All client-facing emails: WF[03] Approve & Send, WF[06] Type B Reminder, and WF[API] Batch Status. (WF[04] goes to office — excluded.)

## 3. Research

### Domain
Transactional Email CTA Design, Token-Based Link Authentication

### Sources Consulted
1. **DL-090 (HMAC Token Architecture)** — Established HMAC-SHA256 token pattern with `{expiryUnix}.{hmac}` format, `CLIENT_TOKEN_SECRET`, report-scoped. Already implemented and working.
2. **Litmus / Email on Acid** — CTA buttons should be prominent, above the fold when possible. Secondary CTAs can appear after primary content with visual hierarchy difference.
3. **Nielsen Norman Group** — Action buttons in emails should match user intent at that stage. "View status" is a natural next action after receiving a status update.

### Key Principles Extracted
- Reuse existing HMAC token pattern exactly (DL-090) — just change expiry constant
- View-documents button is a secondary CTA — use the existing green button style from Batch Status
- Token must be passed via URL query param (same as landing page pattern)

### Research Verdict
Straightforward fix: generate HMAC tokens with 45-day expiry in all client email workflows, add view-documents button where missing.

## 4. Codebase Analysis

### Existing Solutions Found
- **Batch Status** already has `ctaButton(reportKey, lang)` function generating the green button — just missing the token in the URL
- **WF[01] and WF[06] Type A** already generate HMAC tokens with `CLIENT_TOKEN_SECRET` — just need expiry changed from 14→45 days
- **Document Service** (`generate-html` node) builds `client_email_html` with `ctaBlock()` for contact info — needs a view-documents button added after `ctaBlock()`
- **`view-documents.js` line 104**: Already reads token from URL param (`params.get('token')`) as fallback — so passing token in URL works

### Reuse Decision
- Reuse exact HMAC generation pattern from WF[01]
- Reuse `ctaButton()` style from Batch Status (green #059669, centered)
- Add `<!-- VIEW_DOCS_BUTTON -->` placeholder in Document Service for downstream injection (similar to `<!-- CLIENT_QUESTIONS -->` pattern)

### Key Files & Node IDs

| Workflow | Node | Node ID | Change |
|----------|------|---------|--------|
| **[01] Send Questionnaires** | Build Email Data | `c773bfd8-8e03-481b-b1c1-1824f9acf92f` | 14→45 day expiry |
| **[06] Reminder Scheduler** | Build Type A Email | `build_type_a_email` | 14→45 day expiry |
| **[06] Reminder Scheduler** | Build Type B Email | `build_type_b_email` | Add HMAC token gen + view-docs button |
| **[SUB] Document Service** | Generate HTML | `generate-html` | Add view-docs button after ctaBlock in client email |
| **[API] Send Batch Status** | Build Email | `code-build-email` | Add HMAC token gen, fix ctaButton URL |

### How view-documents.js handles tokens (line 96-124)
```
1. Reads clientToken from sessionStorage OR URL ?token= param
2. Reads adminToken from localStorage
3. If neither exists → showLinkExpired()
4. Otherwise → loadDocuments() with token in API call
```

The URL `?token=` fallback (line 104) means we can pass the HMAC token directly in the view-documents link — no need for the landing page redirect flow.

## 5. Technical Constraints & Risks

* **Security:** Token in URL is acceptable — `view-documents.js` already strips it via `history.replaceState()` (line 107-113). Same pattern as landing page.
* **Token scope:** HMAC is report-scoped (`reportId.expiryUnix`), so a token for one report can't access another.
* **Risks:** Changing token expiry from 14→45 days means links stay valid longer. Acceptable for CPA firm context (tax season lasts months).
* **Breaking Changes:** None — `view-documents.js` already handles `?token=` in URL.

## 6. Proposed Solution (The Blueprint)

### Approach: Inject token into view-documents URL across all client emails

**TOKEN_EXPIRY constant:** `45 * 24 * 60 * 60` (45 days in seconds)

### Changes per workflow:

#### A. WF[01] Send Questionnaires — `Build Email Data` node
- Change `14 * 24 * 60 * 60` → `45 * 24 * 60 * 60`
- No other changes (this is a landing page link, not view-documents)

#### B. WF[06] Reminder — `Build Type A Email` node
- Change `14 * 24 * 60 * 60` → `45 * 24 * 60 * 60`
- No other changes (landing page link)

#### C. WF[06] Reminder — `Build Type B Email` node
- Add HMAC token generation (same pattern as Type A)
- Add `ctaButton()` function (copy from Batch Status)
- Insert view-docs button after the `ctaBlock()` in the email HTML
- Button text: HE "צפייה בסטטוס המסמכים" / EN "View Documents Status"

#### D. [SUB] Document Service — `Generate HTML` node
- Add HMAC token generation using `reportRecordId` (already available as input)
- Add `viewDocsButton()` function generating the green button with token in URL
- Insert after `ctaBlock()` in all 3 client email variants (EN card, HE card, HE-only)
- URL: `view-documents.html?report_id=${reportRecordId}&token=${token}`

#### E. [API] Send Batch Status — `Build Email` node
- Add HMAC token generation (report_id from `params.report_key`)
- Fix `ctaButton()` URL to include `&token=${token}`

### Button HTML (consistent across all emails)
```html
<tr><td style="padding-top:24px;" align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="background-color:#059669;border-radius:8px;min-width:200px;text-align:center;">
      <a href="${url}" style="font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;display:block;padding:14px 32px;line-height:1.4;">
        ${text}
      </a>
    </td></tr>
  </table>
</td></tr>
```

### Token generation snippet (same everywhere)
```javascript
const crypto = require('crypto');
const CLIENT_TOKEN_SECRET = 'db3f995dd145fa5d2942bee10b0b17d7e90bb68549c953f812712a6778fa2c8f';
const expiryUnix = Math.floor(Date.now() / 1000) + (45 * 24 * 60 * 60);
const hmac = crypto.createHmac('sha256', CLIENT_TOKEN_SECRET)
    .update(`${reportId}.${expiryUnix}`).digest('hex');
const viewToken = `${expiryUnix}.${hmac}`;
```

### Files to Change

| Location | Action | Description |
|----------|--------|-------------|
| n8n `9rGj2qWyvGWVf9jXhv7cy` node `c773bfd8...` | Modify | WF[01]: 14→45 day expiry |
| n8n `FjisCdmWc4ef0qSV` node `build_type_a_email` | Modify | WF[06] Type A: 14→45 day expiry |
| n8n `FjisCdmWc4ef0qSV` node `build_type_b_email` | Modify | WF[06] Type B: add token + view-docs button |
| n8n `hf7DRQ9fLmQqHv3u` node `generate-html` | Modify | Document Service: add view-docs button to client email |
| n8n `QREwCScDZvhF9njF` node `code-build-email` | Modify | Batch Status: add token to existing button URL |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy test items to `current-status.md`

## 7. Validation Plan
* [ ] **WF[01]:** Send questionnaire to test client → click link → verify landing page works (token valid 45 days)
* [ ] **WF[03]:** Approve & Send for test client → verify email contains green "View Documents Status" button with token in URL
* [ ] **WF[06] Type A:** Trigger reminder → verify landing page link has 45-day token
* [ ] **WF[06] Type B:** Trigger reminder for stage-3 client → verify view-docs button present with token
* [ ] **Batch Status:** Mark docs received → send batch email → click "View Documents Status" → verify page loads (not "Link Expired")
* [ ] **Token expiry:** Verify HMAC validates successfully in `[API] Get Client Documents` and `[API] Check Existing Submission`
* [ ] **Fresh browser:** Open view-documents link from email in incognito → should work (token in URL)

## 8. Implementation Notes (Post-Code)

### Changes Made (2026-03-16)

1. **WF[01] Build Email Data** — Changed token expiry from 14→45 days
2. **WF[06] Build Type A Email** — Changed token expiry from 14→45 days
3. **WF[06] Build Type B Email** — Added `viewDocsButton()` function with HMAC token (45-day), intro text, and green #059669 button. Inserted in all 3 paths (EN card, HE card, HE-only).
4. **[SUB] Document Service Generate HTML** — Added `viewDocsButton()` function with HMAC token (45-day), intro text, and green button. Inserted in all 3 client email paths (EN card, HE card, HE-only). Office email unchanged.
5. **[API] Batch Status Build Email** — Added HMAC token generation, fixed `ctaButton()` URL to include `&token=${viewToken}`, added intro text before button.

### Intro Text (per user request)
- **HE:** "לצפייה בסטטוס המלא של המסמכים והסבר על אופן הפקתם:"
- **EN:** "To view the full status of your documents and learn how to obtain them:"

### Button Style (consistent across all emails)
- Background: `#059669` (green), border-radius: 8px, white bold text
- HE: "צפייה בסטטוס המסמכים"
- EN: "View Documents Status"
- Intro text: 14px, color #6b7280, RTL/LTR-aware
