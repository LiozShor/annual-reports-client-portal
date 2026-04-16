# Design Log 061: Fix Broken Questionnaire Link in Type A Reminder Email

**Status:** [COMPLETED]
**Date:** 2026-02-26
**Related Logs:** 059-automated-follow-up-reminder-system.md, 060-reminder-ssot-doc-display.md

## 1. Context & Problem

Execution 3801 of WF[06] Reminder Scheduler sent a Type A reminder email with a broken questionnaire link: `questionnaire.html?token=1236`. Three issues:
1. **Wrong page** — `questionnaire.html` doesn't exist; landing page is at root `/`
2. **Missing params** — Only `?token=` passed, but `landing.js` requires `report_id`, `client_id`, `year`, `token` (4 mandatory) + `full_name`, `email` (used by Tally)
3. **Missing Airtable field** — `client_id` not fetched by Search Due Reminders node

## 2. Changes Made

### n8n Operations (WF[06] `FjisCdmWc4ef0qSV`)

| # | Type | Node | Change |
|---|------|------|--------|
| 1 | updateNode | Search Due Reminders | Added `client_id` to Airtable fields list (15th field) |
| 2 | updateNode | Build Type A Email | Fixed URL: root path + all 6 params (report_id, client_id, year, token, full_name, email) |
| 3 | updateNode | Build Type B Email | Removed dead `const token = inp._questionnaire_token;` line |
| 4 | updateNode | Prepare Type B Input | Removed `_questionnaire_token` passthrough (no longer needed) |

### URL Fix Detail (Build Type A Email)

**Before:**
```javascript
const questionnaireUrl = `https://liozshor.github.io/annual-reports-client-portal/questionnaire.html?token=${r.questionnaire_token || ''}`;
```

**After (matching WF[01] format):**
```javascript
const clientId = Array.isArray(r.client_id) ? r.client_id[0] : (r.client_id || '');
const questionnaireUrl = `https://liozshor.github.io/annual-reports-client-portal/?report_id=${r.id}&client_id=${encodeURIComponent(clientId)}&year=${year}&token=${encodeURIComponent(r.questionnaire_token || '')}&full_name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`;
```

Key: `client_id` is an Airtable lookup field → returns array → handled with `Array.isArray()`.

### Design Log 060 Update

Removed `[5] CTA BUTTON` from section 6's email template structure (was removed in session 48 but DL060 still referenced it). Renumbered remaining items.

## 3. Verification

- [ ] Trigger Send Now for test record (recvQbecOny3Szdpl / CPA-XXX_2025)
- [ ] Verify email URL: `https://liozshor.github.io/annual-reports-client-portal/?report_id=recvQbecOny3Szdpl&client_id=...&year=2025&token=1236&full_name=...&email=...`
- [ ] Click link — landing page loads without "missing params" error
- [ ] Verify Type B email still has NO CTA link

## 4. Out of Scope

- **Token generation:** `questionnaire_token` is currently manually entered as sequential integers (1234-1237). Before 500+ client production, should auto-generate with `crypto.randomBytes(32).toString('hex')`. Separate task.
