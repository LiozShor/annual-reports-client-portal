# CS Extension Audit — Hardcoded AR References

**Date:** 2026-03-29
**Audited paths:**
- Frontend: `frontend/` (all `.html`, `.js`, `.css`, `.json`)
- Workers API: `api/src/` (all `.ts`, `.js`)
- n8n Workflows: `liozshor-workflows (8)` export — 11 active workflows
- SSOT files: `SSOT_required_documents_from_Tally_input.md`, `SSOT_CS_required_documents.md`

## Summary
- **Total findings: 31**
- Critical (would cause wrong behavior for CS clients): **10**
- Warning (cosmetic or minor logic issue): **11**
- Review (unclear / no action needed): **10**

---

## Critical Findings

### [C-01] WF01 Send Questionnaire — entire email is AR-hardcoded
- **File:** WF01 `[1] send_questionnaire` > "HTTP Request" node
- **What:** Email subject `"שאלון דוח שנתי"`, body `"לצורך הכנת הדוח השנתי"`, EN body `"annual tax report"`, footer `"איסוף נתונים לדוח השנתי"` — all hardcoded
- **Problem:** CS clients receive questionnaire invitations saying "שאלון דוח שנתי" instead of "שאלון הצהרת הון"
- **Fix:** Read `filing_type` from report record, use `FILING_LABELS` map for all text in subject/header/body/footer

### [C-02] WF01 Send Questionnaire — confirmation page AR-only
- **File:** WF01 `[1] send_questionnaire` > "Respond to Webhook" node
- **What:** `"הלקוחות הבאים קיבלו את השאלון לדוח השנתי"` (confirmation HTML)
- **Problem:** Natan sees "questionnaire for the annual report" even when sending CS questionnaires
- **Fix:** Make response dynamic per filing_type

### [C-03] WF06 Type A Reminder — email body hardcoded (subject is dynamic)
- **File:** WF06 `[06] Reminder Scheduler` > "Build Type A Email" node
- **What:** Body contains `"שאלון שנתי"`, `"הדוח השנתי שלך"`, `"הכנת הדוח השנתי"` — 5+ hardcoded AR references. Subject line correctly uses `ftLabel.he` but body does not.
- **Problem:** CS clients in `Waiting_For_Answers` get reminders saying "fill the annual report questionnaire"
- **Fix:** Replace all hardcoded body strings with `ftLabel.he`/`ftLabel.en`

### [C-04] WF06 Type B Reminder — Hebrew body hardcoded (EN body is dynamic)
- **File:** WF06 `[06] Reminder Scheduler` > "Build Type B Email" node
- **What:** `"ישנם מסמכים שטרם התקבלו עבור הדוח השנתי"`, `"נוכל להמשיך בהכנת הדוח"` — Hebrew body is AR-only
- **Problem:** CS clients in `Collecting_Docs` get Hebrew reminders referencing "הדוח השנתי"
- **Fix:** Replace with `ftLabel.he`

### [C-05] WF06 WhatsApp pre-filled message — AR-hardcoded (both Type A & B)
- **File:** WF06 > Type A & Type B > WhatsApp URL
- **What:** `wa.me/...?text=...הדוח+השנתי` — pre-filled WhatsApp message says "annual report"
- **Problem:** CS client tapping WhatsApp link sends message about "הדוח השנתי"
- **Fix:** Build WA URL dynamically with filing_type label

### [C-06] view-documents.html — hardcoded `<title>` and `<h1>`
- **File:** `frontend/view-documents.html` (lines 8, 31-32)
- **What:** `<title>...הדו״ח - Required Documents for Annual Report</title>` and `<h1>Required Documents for Annual Report</h1>` — never updated by JS
- **Problem:** CS clients see "Annual Report" in browser tab and page header
- **Fix:** Have `view-documents.js` update title/h1 with `filing_type_label` from API response

### [C-07] view-documents.js — pre-questionnaire message says "שאלון שנתי"
- **File:** `frontend/assets/js/view-documents.js` (lines 281-282)
- **What:** `"טרם מולא שאלון שנתי"` and `"The annual questionnaire hasn't been submitted yet"`
- **Problem:** CS clients see "annual questionnaire" in the empty state
- **Fix:** Use `filing_type_label_he`/`_en` from report data

### [C-08] landing.js — Tally form ID fallback silently defaults to AR
- **File:** `frontend/assets/js/landing.js` (lines 20-21, 109-110)
- **What:** `const FORM_HE = '1AkYKb'; const FORM_EN = '1AkopM';` used as fallback: `formIdHe = data.form_id_he || FORM_HE`
- **Problem:** If API fails to return `form_id_he`/`form_id_en` for a CS client, they get the AR questionnaire form
- **Fix:** Show error instead of silently falling back, or maintain a `FILING_CONFIG` map

### [C-09] landing.js — Base64 header flashes AR text before API response
- **File:** `frontend/assets/js/landing.js` (line 32)
- **What:** `HE_B64.header_title` decodes to `📋 שאלון דוח שנתי` — shown before API response arrives
- **Problem:** CS clients briefly see "שאלון דוח שנתי" on page load
- **Fix:** Use a generic label like `📋 שאלון` or show a loading state

### [C-10] Chat system prompt describes `filing_type` incorrectly
- **File:** `api/src/routes/chat.ts` (line 48)
- **What:** `filing_type: filing type (employee, self-employed, company, etc.)` — describes it as business classification, not report type
- **Problem:** AI chat assistant has no concept of CS vs AR, can't help CS clients correctly
- **Fix:** Change to `filing_type: report type — 'annual_report' (דוח שנתי) or 'capital_statement' (הצהרת הון)`. Add CS context to system prompt.

---

## Warnings

### [W-01] WF06 "Search Due Reminders" — missing `filing_type` in field list
- **File:** WF06 `[06] Reminder Scheduler` > "Search Due Reminders" Airtable node
- **What:** Query fetches reminders but doesn't include `filing_type` in returned fields
- **Problem:** Downstream email builders can't differentiate AR vs CS — subjects are dynamic but rely on this field
- **Fix:** Add `filing_type` to the search `fields` list

### [W-02] WF07 Daily Digest — no filing_type filter or display
- **File:** WF07 `[07] Daily Natan Digest` > "Query Pending Approval" node
- **What:** `AND({stage}='Pending_Approval', {client_is_active}=TRUE())` — no filing_type filter
- **Problem:** Digest mixes AR and CS pending-approval clients with no distinction; Natan can't tell which are which
- **Fix:** Include filing_type label in digest display per client

### [W-03] WF07 Daily Digest — footer says "דוחות שנתיים"
- **File:** WF07 `[07] Daily Natan Digest` > "Build Digest Email" node
- **What:** Footer: `"דוח אוטומטי — מערכת דוחות שנתיים"`
- **Problem:** System label implies AR-only (internal email, low impact)
- **Fix:** Change to `"מערכת דוחות"` or keep as system name

### [W-04] Print footers hardcoded as "דוחות שנתיים"
- **File:** `admin/js/script.js` (line 6602), `assets/js/document-manager.js` (line 2535)
- **What:** `"הודפס מתוך מערכת ניהול דוחות שנתיים — Client Name רו"ח"`
- **Problem:** CS document printouts say "annual reports management system"
- **Fix:** Use generic `"מערכת ניהול דוחות"` or dynamic label

### [W-05] landing.js — fallback labels default to AR
- **File:** `frontend/assets/js/landing.js` (lines 113-114)
- **What:** `data.filing_type_label_he || 'דוח שנתי'` / `data.filing_type_label_en || 'Annual Report'`
- **Problem:** Missing label silently shows AR text for CS clients
- **Fix:** Use generic fallback `'דוח'` / `'Report'` or infer from `filing_type` field

### [W-06] view-documents.js — email subject fallback defaults to "דוח שנתי"
- **File:** `frontend/assets/js/view-documents.js` (lines 191, 257)
- **What:** `data.report?.filing_type_label_he || 'דוח שנתי'` in mailto subject
- **Problem:** CS clients clicking "contact office" get email with "מסמכים לדוח שנתי" subject
- **Fix:** Use generic fallback

### [W-07] Admin `|| 'annual_report'` silent defaults in filter logic
- **File:** `admin/js/script.js` (lines 496, 769, 1058, 2069)
- **What:** `(c.filing_type || 'annual_report') === activeEntityTab` — 4 places
- **Problem:** CS records with null `filing_type` silently appear under AR tab
- **Fix:** Log warning when `filing_type` missing; acceptable for legacy records but should be documented

### [W-08] Privacy policy — 3 AR-only references
- **File:** `frontend/privacy-policy.html` (lines 144, 152, 160)
- **What:** `"איסוף המסמכים לדוחות שנתיים"`, `"מסמכים הנדרשים להכנת הדוח השנתי"`, `"הכנת דוחות שנתיים"`
- **Problem:** Privacy policy only describes annual report collection, no mention of capital statements
- **Fix:** Broaden to `"דוחות שנתיים והצהרות הון"` or generic `"דוחות"`

### [W-09] Dashboard API — no filing_type filter parameter
- **File:** `api/src/routes/dashboard.ts` (line 40)
- **What:** `filterByFormula: 'AND({year}=${year})'` — returns all filing types mixed
- **Problem:** Dashboard stats (stage counts, totals) combine AR + CS with no way to separate
- **Fix:** Accept optional `filing_type` query param; field IS in response so frontend can filter, but server-side is better for stats

### [W-10] WF01 Airtable view may exclude CS records
- **File:** WF01 `[1] send_questionnaire` > "Airtable" search node
- **What:** Uses view `"stage 1 - send questionnare"` — view definition unknown
- **Problem:** View may not include CS records
- **Fix:** Verify view includes all filing types, or switch to `filterByFormula`

### [W-11] Rollover target-year check missing filing_type filter
- **File:** `api/src/routes/rollover.ts` (line 40-58)
- **What:** `clientsWithTarget` set doesn't filter by `filing_type` — if client has AR but not CS in target year, rollover skips CS too
- **Problem:** CS rollover could be incorrectly skipped for clients who already have an AR record in the target year
- **Fix:** Add `filing_type` check to target year loop

---

## Review Items

### [R-01] Document Service loads all templates/mappings (no filing_type filter)
- **File:** WF Doc Service > "Get Templates" + "Get Mappings" nodes
- **What:** Fetches all records, but `Generate Documents` code filters by `filing_type` at runtime
- **Status:** Safe — runtime filter works correctly. Optimization opportunity only.

### [R-02] WF02 Format Q&A — code comment says "שאלון שנתי"
- **File:** WF02 > "Format Q&A" node
- **What:** Code comment only, not functional
- **Status:** No action needed

### [R-03] Admin HTML labels — AR text in entity toggle buttons
- **File:** `admin/index.html` (lines 68, 163, 172, 312, 402, 444, 457)
- **What:** Labels like `דוחות שנתיים` in toggle buttons, `דוח שנתי` in dropdowns
- **Status:** Intentional — these label the AR entity type. CS has its own labels. No action needed.

### [R-04] CSS/JS file header comments reference "Annual Reports"
- **Files:** `common.css`, `design-system.css`, `workflow-processor-n8n.js`
- **What:** Developer-facing comments referencing project name
- **Status:** No action needed

### [R-05] Domain name `annual-reports-api` in endpoints
- **What:** Workers domain `annual-reports-api.liozshor1.workers.dev`
- **Status:** Infrastructure name, not user-facing. No action needed.

### [R-06] Health endpoint says `annual-reports-api`
- **File:** `api/src/index.ts` (line 61)
- **What:** `{ ok: true, service: 'annual-reports-api' }`
- **Status:** Cosmetic, internal only

### [R-07] SSOT CS generator implementation marked TBD
- **File:** `SSOT_CS_required_documents.md` (line 8)
- **What:** `Implementation entrypoint: .../ssot-cs-document-generator.js (TBD)`
- **Status:** Verify whether CS generation is implemented in n8n Code nodes or needs the JS file

### [R-08] `doc-builder.ts` has no filing_type awareness
- **File:** `api/src/lib/doc-builder.ts`
- **Status:** Correct architecture — agnostic to filing type, processes whatever documents exist. No action needed.

### [R-09] No hardcoded Airtable record IDs found in frontend
- **Status:** Clean

### [R-10] No `.annual-report-*` CSS class names found
- **Status:** Clean

---

## Filing-Type Filter Audit

| Workflow/Endpoint | Airtable Query | Has filing_type filter? | Risk |
|---|---|---|---|
| WF01 Send Questionnaire | View: "stage 1 - send questionnare" | **UNKNOWN** (view-based) | WARNING |
| WF02 Fetch Record | By record ID | N/A (single record) | Safe |
| WF02 Get Mappings | All records | **NO** (filtered at runtime) | Low |
| WF04 Fetch Updated Docs | By report_record_id | N/A (report-scoped) | Safe |
| WF06 Search Due Reminders | Stage + date filters | **NO** (missing from fields) | WARNING |
| WF06 Search Missing Docs | Status filter | N/A (doc-level) | Safe |
| WF06-SUB Monthly Reset | Stage + suppress | **NO** | Low |
| WF07 Query Pending Approval | Stage filter | **NO** | WARNING |
| Doc Service Get Templates | All records | **NO** (filtered at runtime) | Low |
| Doc Service Get Mappings | All records | **NO** (filtered at runtime) | Low |
| Doc Service Get Categories | All records | N/A | Safe |
| API Dashboard | `{year}=${year}` | **NO** | WARNING |
| API Rollover (target) | `{year}=${target_year}` | **NO** | WARNING |
| API Batch Status | By record ID | N/A | Safe |
| API Client Identifier | `{stage}!='Completed'` | **NO** (correct — needs all) | Safe |

## Email Template Audit

| Workflow | Email Type | Filing-type aware? | Hardcoded text found |
|---|---|---|---|
| WF01 | Questionnaire invitation | **NO** | `שאלון דוח שנתי`, `הדוח השנתי`, `annual tax report` |
| WF01 | Webhook confirmation | **NO** | `השאלון לדוח השנתי` |
| WF02 | Office notification (subject) | **YES** | Uses `ftLabel.he` |
| WF04 | Office edit notification | **YES** (generic) | No AR text |
| WF06 Type A | Reminder subject | **YES** | Uses `ftLabel` |
| WF06 Type A | Reminder body | **NO** | `שאלון שנתי`, `הדוח השנתי` (5+ instances) |
| WF06 Type A | WhatsApp message | **NO** | `הדוח+השנתי` |
| WF06 Type B | Reminder subject | **YES** | Uses `ftLabel` |
| WF06 Type B | Reminder EN body | **YES** | Uses `ftLabel` |
| WF06 Type B | Reminder HE body | **NO** | `הדוח השנתי` |
| WF06 Type B | WhatsApp message | **NO** | `הדוח+השנתי` |
| WF07 | Daily digest | **NO** (footer) | `מערכת דוחות שנתיים` |
| API Batch Status | Status update | **YES** (generic) | No AR text |
| API Email HTML | Questionnaire email | **YES** | Separate AR/CS content functions |
| API Chat | System prompt | **NO** | Wrong `filing_type` description |

---

## Priority Fix Order

### Tier 1 — Client-facing, wrong text shown to CS clients
1. **WF01 Send Questionnaire** (C-01, C-02) — first touchpoint, every CS client affected
2. **WF06 Type A body** (C-03, C-05) — CS reminders in `Waiting_For_Answers`
3. **WF06 Type B HE body** (C-04, C-05) — CS reminders in `Collecting_Docs`
4. **view-documents.html title/h1** (C-06) — every CS client visiting doc page
5. **view-documents.js empty state** (C-07) — CS clients before questionnaire
6. **landing.js Tally fallback** (C-08) — latent risk, wrong form on API failure

### Tier 2 — Functional issues, less visible
7. **WF06 missing `filing_type` in fields** (W-01) — prerequisite for Tier 1 fixes
8. **Chat system prompt** (C-10) — AI gives wrong guidance
9. **Rollover filing_type filter** (W-11) — CS rollover bug
10. **Dashboard filing_type filter** (W-09) — mixed stats

### Tier 3 — Cosmetic / internal
11. **Fallback label defaults** (W-05, W-06, W-07) — silent AR defaults
12. **Print footers** (W-04) — internal printouts
13. **Privacy policy** (W-08) — legal text
14. **Digest display** (W-02, W-03) — internal office email
15. **landing.js Base64 flash** (C-09) — brief flash before API responds
