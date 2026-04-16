# Design Log 232: Complete Email & Print Filing Type Audit + Fix
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-31
**Related Logs:** DL-222 (email AR/CS audit — partial), DL-220 (CS questionnaire email), DL-225 (CS hardcoded AR remediation), DL-164 (filing type layer)

## 1. Context & Problem
DL-222 audited all 9 email types but incorrectly assessed Type A and Type B reminders as "DUAL". Only their **subjects** use `FILING_LABELS` — the **body and header** text still hardcodes "הדוח השנתי" and "שאלון שנתי". Additionally:
- The Client Doc Request "has docs" case has no filing type in subject or body
- The questionnaire print system has zero filing type indicators
- The WhatsApp pre-filled message hardcodes "הדוח השנתי" across all emails

## 2. User Requirements
1. **Q:** Audit only or audit + fix?
   **A:** Audit + Fix — implement all corrections.

2. **Q:** Should generic emails (Batch Status, Edit Notification, Digest) add filing type?
   **A:** Leave generic — they work for both without confusion.

3. **Q:** Should Client Doc Request "has docs" case mention filing type?
   **A:** Yes — add filing type to both subject and body.

4. **Q:** What filing type indicator for questionnaire print?
   **A:** Header + meta line — show filing type label next to year.

## 3. Research
### Domain
Transactional email multi-product differentiation, printed document labeling

### Sources Consulted
1. **Mailchimp/Postmark transactional email guides** — Always identify product/service in subject when company offers multiple services to same client. Header banner is second most effective differentiator after From name.
2. **Litmus/Campaign Monitor subject line research** — Bracket prefix or dash-separated tag is industry standard. For Hebrew RTL: Hebrew word must be first character to prevent RTL rendering issues.
3. **ISO document standards / accounting print conventions** — Three mandatory header elements: document type, period/year, client identifier. Document type should be prominent in header area.

### Key Principles Extracted
- Subject line + header bar do 80% of differentiation work — footer is least effective
- Don't over-label routine emails where context is obvious
- For printed documents, document type in header is non-negotiable
- Keep product identifier short (2-3 words max)

### Research Verdict
Apply `FILING_LABELS` pattern (already proven in DL-220/222) to remaining hardcoded locations. For print, add filing type to meta line. For WhatsApp, use generic text to avoid complexity.

## 4. Codebase Analysis

### Complete Email Audit Matrix

| # | Email Type | Location | Subject | Header | Body | WhatsApp | Verdict |
|---|-----------|----------|---------|--------|------|----------|---------|
| 1 | Questionnaire Send | Workers `email-html.ts` | ✅ DUAL | ✅ DUAL | ✅ DUAL | N/A | OK |
| 2 | Office Notification | n8n Doc Service `generate-html` | ✅ DUAL (DL-222) | N/A | N/A | N/A | OK |
| 3a| Client Doc Request (no docs) | Workers `email-html.ts` | ✅ DUAL (DL-222) | ✅ | ✅ | N/A | OK |
| 3b| Client Doc Request (has docs) | Workers `email-html.ts` | ❌ GENERIC | ❌ GENERIC | ❌ GENERIC | N/A | **FIX** |
| 4 | Batch Status | n8n `code-build-email` (QREwCScDZvhF9njF) | GENERIC | GENERIC | GENERIC | N/A | OK (leave) |
| 5 | Type A Reminder | n8n WF[06] `build_type_a_email` | ✅ DUAL | ❌ "שאלון שנתי" | ❌ "הדוח השנתי" ×3 | ❌ "הדוח השנתי" | **FIX** |
| 6a| Type B Reminder (EN bilingual) | n8n WF[06] `build_type_b_email` | ✅ DUAL | ✅ (uses subject) | ❌ HE: "הדוח השנתי" | N/A | **FIX** |
| 6b| Type B Reminder (HE only) | n8n WF[06] `build_type_b_email` | ✅ DUAL | ✅ (uses subject) | ❌ "הדוח השנתי" ×2 | N/A | **FIX** |
| 7 | Edit Notification | n8n WF[04] `Build Edit Email` | GENERIC | N/A | N/A | N/A | OK (leave) |
| 8 | Daily Digest | n8n WF[07] `Build Digest Email` | GENERIC | N/A | N/A | N/A | OK (leave) |
| 9 | Feedback | Workers `feedback.ts` | N/A | N/A | N/A | N/A | OK |
| 10| **Questionnaire Print** | `admin/js/script.js:6787` | N/A | ❌ NO TYPE | ❌ NO TYPE | N/A | **FIX** |
| 11| **WhatsApp URL** | `email-styles.ts:37` + n8n nodes | N/A | N/A | N/A | ❌ "הדוח השנתי" | **FIX** |

### DL-222 Corrections
DL-222 line 49 stated: "Type A Reminder: Uses `FILING_LABELS` map. Subject and body are dynamic." This was **incorrect** — only subjects are dynamic. The body/header still hardcode:
- Type A header: `תזכורת — שאלון שנתי ${year}` (line 62)
- Type A body: `הכנת הדוח השנתי` appears 3 times (lines 71, 75, 82)
- Type B HE body: `הדוח השנתי` appears 2 times (lines 160, 160)

### Existing Patterns (Reuse)
- `FILING_LABELS` map already in `email-html.ts:47-50` with `he`, `he_definite`, `en` keys
- Same pattern in both n8n reminder code nodes (but only `he`/`en`, missing `he_definite`)
- `filingType` already flows through `approve-and-send.ts:132` → `emailParams`
- Questionnaire data includes `filing_type` from Airtable report record

### Dependencies
- `api/src/lib/email-html.ts` — main email builder (Workers)
- `api/src/lib/email-styles.ts` — shared constants including WA_URL
- n8n WF[06] (FjisCdmWc4ef0qSV) — nodes `build_type_a_email`, `build_type_b_email`
- `github/annual-reports-client-portal/admin/js/script.js` — questionnaire print function

## 5. Technical Constraints & Risks
* **Security:** No auth/PII changes
* **Risks:** n8n code node updates must preserve ALL existing params. Test both AR and CS paths for regression.
* **Breaking Changes:** None — AR path (default) remains identical for all changes
* **Two codebases:** Workers email-html.ts + n8n WF[06] both need updates (per CLAUDE.md rules)

## 6. Proposed Solution (The Blueprint)

### Success Criteria
All client-facing emails and the questionnaire print correctly reference the filing type. No CS client sees "דוח שנתי" anywhere in their communications.

### Fix 1: Client Doc Request — "has docs" subject + body (`email-html.ts`)
1. HE subject: `דרישת מסמכים לשנת ${year}` → `דרישת מסמכים — ${labels.he} ${year}`
2. EN subject: `Required Documents - ${clientName} - ${year}` → `Required Documents — ${labels.en} ${year} - ${clientName}`
3. HE body: `להכנת הדו״ח לשנת המס` → `להכנת ${labels.he_definite} לשנת המס`
4. EN body: `for tax year ${year}` → `for your ${labels.en}, tax year ${year}`
5. EN header: `Required Documents` → include labels.en + year

### Fix 2: Type A Reminder — header + body (n8n WF[06])
1. Add `he_definite` to FILING_LABELS: `{annual_report: 'הדוח השנתי', capital_statement: 'הצהרת ההון'}`
2. Header: `שאלון שנתי ${year}` → `שאלון ${ftLabel.he} ${year}`
3. Body para 1: `הדוח השנתי` → `${ftLabel.he_definite}`
4. Body para 2: `הדוח` → `${ftLabel.he_definite}`
5. Body para 3: `הכנת הדוח השנתי` → `הכנת ${ftLabel.he_definite}`

### Fix 3: Type B Reminder — body (n8n WF[06])
1. Same FILING_LABELS expansion as Fix 2
2. HE body: `הדוח השנתי` → `${ftLabel.he_definite}` (2 occurrences)
3. EN bilingual HE card: same pattern
4. EN body: keep "your report" generic (or change to `your ${ftLabel.en}`)

### Fix 4: WhatsApp pre-filled text — generic
1. `email-styles.ts:37` — change to: `שלום, אני צריך/ה עזרה`
2. n8n Type A (line 32) — same change
3. n8n Type B — check if it has local WA_URL, apply same

### Fix 5: Questionnaire Print — header + meta (`script.js:6787`)
1. Look up `filing_type` from `clientsData` using `item.report_record_id`
2. Title: `שאלוני לקוחות — הדפסה` → `שאלוני ${ftLabel} — הדפסה`
3. Meta line: `שנת מס ${year}` → `שנת מס ${year} | ${ftLabel}`

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/email-html.ts` | Modify | Fix 1: dynamic subject/body for "has docs" case |
| `api/src/lib/email-styles.ts` | Modify | Fix 4: generic WhatsApp pre-filled text |
| n8n WF[06] `build_type_a_email` | Modify (MCP) | Fix 2: dynamic header + body |
| n8n WF[06] `build_type_b_email` | Modify (MCP) | Fix 3: dynamic body |
| `github/.../admin/js/script.js` | Modify | Fix 5: print title + meta line |

### Final Step
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] CS approve-and-send (has docs) → subject "דרישת מסמכים — הצהרת הון YYYY", body "הצהרת ההון"
* [ ] AR approve-and-send (has docs) → subject "דרישת מסמכים — דוח שנתי YYYY" (regression)
* [ ] CS approve-and-send (no docs) → unchanged from DL-222 fix
* [ ] EN CS client → subject "Required Documents — capital statement" + body mentions CS
* [ ] CS Type A reminder → header "שאלון הצהרת הון", body "הצהרת ההון" (not "הדוח השנתי")
* [ ] AR Type A reminder → unchanged (regression)
* [ ] CS Type B reminder (HE) → body "הצהרת ההון"
* [ ] CS Type B reminder (EN bilingual) → HE card body "הצהרת ההון"
* [ ] AR Type B reminders → unchanged (regression)
* [ ] WhatsApp link in all emails → generic "שלום, אני צריך/ה עזרה"
* [ ] Print CS questionnaire → title "שאלוני הצהרת הון" + meta "שנת מס YYYY | הצהרת הון"
* [ ] Print AR questionnaire → title "שאלוני דוח שנתי" + meta "שנת מס YYYY | דוח שנתי"

## 8. Implementation Notes (Post-Code)
* **Fix 1 (Workers email-html.ts):** Added `ftLabels` constant early in `buildClientEmailHtml()` for both EN and HE branches. Updated EN header, EN body, HE body (bilingual card), HE-only body, and both subject functions. Removed redundant `filingLabel` variable.
* **Fix 2 (n8n Type A):** Added `he_definite` to FILING_LABELS. Updated header bar, body paras 1/2/3. Generic WhatsApp URL.
* **Fix 3 (n8n Type B):** Added `he_definite` to FILING_LABELS. Moved `ftLabel` computation before the EN/HE branch. Updated EN body "preparing your report" → "preparing your [type]", HE bilingual card body, HE-only body (2 occurrences). Generic WhatsApp URL.
* **Fix 4 (WhatsApp):** Changed `email-styles.ts` global WA_URL + both n8n nodes to generic "שלום, אני צריך/ה עזרה" (dropped "בנושא הדוח השנתי").
* **Fix 5 (Print):** Added filing type lookup from `clientsData` in `generateQuestionnairePrintHTML()`. Added `${ftLabel}` to meta line next to year. Title kept generic "שאלונים" since it covers mixed batches.
* **DL-222 correction:** Updated DL-222 finding — Type A/B reminders were NOT fully dual, only subjects were.
