> **STATUS: FEASIBILITY COMPLETE** — Infrastructure implemented. Content tasks (Tally forms, templates) pending firm input.

# Capital Statements Extension — Feasibility & Complexity Analysis

**Date:** 2026-03-18
**Scope:** Assess extending the Annual Reports CRM to support a second filing type — Capital Statements (הצהרות הון)
**Status:** Infrastructure DONE (Phases 1-5). Content tasks remaining.

---

## 1. Executive Summary

**Complexity: MEDIUM-HIGH**

The system is architecturally well-suited for a second filing type. The Document Service is almost entirely data-driven (Airtable templates + mappings), most API workflows are filing-type-agnostic, and the frontend reads everything from API responses rather than hardcoding document lists. However, several critical touchpoints — the Tally questionnaire, the AI classification prompt (34 hardcoded template types), email templates in 3 workflows with inline "דוח שנתי" strings, and the `annual_reports` table name baked into every workflow — require systematic changes. The cleanest approach is adding a `filing_type` field to the existing Reports table rather than creating a parallel table, then parameterizing the ~6 workflows that contain filing-type-specific logic. Estimated effort: **3–5 weeks** for a production-ready second filing type, assuming the capital statements questionnaire content is already defined.

---

## 2. Frontend Changes

### 2.1 URL Parameter Scheme

Current URL parameters: `report_id`, `token`, `client_id`, `year`. These are **already filing-type-agnostic** — `report_id` uniquely identifies a filing (annual report OR capital statement), and all other data is fetched from the API. No restructuring needed.

### 2.2 File-by-File Analysis

| File | Change Required | Effort | Notes |
|------|----------------|--------|-------|
| **index.html** | Title + subtitle text | S | `<title>` says "Annual Tax Report Questionnaire", `<p class="header-subtitle">` says "Annual Tax Report Questionnaire". These are the only hardcoded strings. Could be made dynamic from API response. |
| **landing.js** | Tally form IDs + base64 strings | M | `FORM_HE = '1AkYKb'` and `FORM_EN = '1AkopM'` are hardcoded annual report Tally forms. `HE_B64` contains Hebrew strings referencing "דוח שנתי". For capital statements, need different form IDs and different UI text. **Solution:** API response from `check-existing-submission` should return `{form_id_he, form_id_en, filing_type_label}` so the landing page can route to the correct Tally form. |
| **view-documents.html** | Title text only | S | `<title>` and `<h1>` say "רשימת מסמכים נדרשים להכנת הדו״ח" and "Required Documents for Annual Report". The email `mailto:` subject includes "דוח שנתי". All document rendering is fully dynamic from API. **Fix:** Have API return `filing_type_label` and use it in title/subject. |
| **view-documents.js** | Near-zero changes | S | All document names, categories, grouping, and help text come from the API. The only hardcoded string is the mailto subject `מסמכים לדוח שנתי ${year}` — replace with API-provided label. |
| **document-manager.html** | No filing-type-specific text | S | All labels are generic ("ניהול מסמכים", "שאלון", "מסמכים"). Already filing-type-agnostic. |
| **document-manager.js** | Template dropdown source | S | Templates and categories are loaded from API (`apiTemplates`, `apiCategories`). Already data-driven. The only concern: the questionnaire section label says "השאלון השנתי" (the annual questionnaire) — should be dynamic. |
| **approve-confirm.html** | Title + confirmation text | S | `<title>` and `<h1>` say "אישור שליחת המסמכים הנדרשים לדוח השנתי". `<div class="alert-title">` says "אישור שליחת דוח שנתי". **Fix:** Pass `filing_type_label` as URL param or resolve from `report_id` via API. |
| **admin/index.html** | Tab labels + stats | M | Dashboard is year-based, shows stage distribution. Currently one filing type per view. **Options:** (A) Add a filing-type filter/toggle to the dashboard, or (B) show all filing types together with a badge. The admin panel JS would need to handle a `filing_type` field in report records. |
| **shared/constants.js** | No changes | — | Stage pipeline (`STAGES`), `API_BASE`, and `ADMIN_TOKEN_KEY` are all generic. Same 8-stage pipeline works for capital statements. |
| **shared/endpoints.js** | No changes | — | All endpoint URLs are generic (`/get-client-documents`, `/edit-documents`, etc.). No filing-type-specific paths. |

### 2.3 Frontend Summary

The frontend is **surprisingly well-decoupled** from filing type. Nearly all document data comes from API responses. The main work is:
1. **Landing page routing**: Different Tally form per filing type (return form IDs from API)
2. **Display labels**: ~8 hardcoded "דוח שנתי" strings across 4 files → replace with API-driven label
3. **Admin dashboard**: Add filing-type filter/badge

**Total frontend effort: Small-Medium (1–2 weeks)**

---

## 3. Workflow Analysis

### 3.1 Workflow-by-Workflow Assessment

| Workflow | Purpose | Reusability | Key Changes Needed |
|----------|---------|-------------|-------------------|
| **[01] Send Questionnaires** | Send questionnaire email to clients | **Parameterizable** | Email subject/body hardcodes "שאלון — דוח שנתי". Landing page URL is generic. Need filing-type-aware email template. |
| **[02] Questionnaire Response Processing** | Process Tally submissions → generate docs | **Parameterizable** | Email subject "שאלון שנתי התקבל". Tally form fields are mapped via Airtable (data-driven). Need: (1) new Tally form for CS, (2) new question_mappings rows, (3) filing_type passed to Document Service. |
| **[03] Approve & Send** | Approve docs + send to client | **Parameterizable** | Success text "הדוח אושר בהצלחה!". Table reference `tbls7m3hmHC4hhQVy` hardcoded in 3 nodes. Document Service call is generic. |
| **[04] Document Edit Handler** | Admin add/remove documents | **As-is** | Fully generic — works on `report_id` → documents. No filing-type assumptions. |
| **[05] Inbound Doc Processing** | Email → classify → upload → match | **Parameterizable** | Classification prompt has 34 hardcoded template types for annual reports. For CS, need different template list in prompt. `Get Active Report` assumes one report per client-year — needs filing-type disambiguation. |
| **[06] Reminder Scheduler** | Daily reminders (Type A + Type B) | **Parameterizable** | Email templates hardcode "דוח שנתי". Stage filter (`Waiting_For_Answers`, `Collecting_Docs`) is generic but email content is filing-type-specific. |
| **[06-SUB] Monthly Reset** | Clear reminder_suppress monthly | **As-is** | Fully generic. |
| **[SUB] Document Service** | Generate doc list + HTML from templates | **Parameterizable** | Core engine is **data-driven** (templates + mappings from Airtable). EN→HE translation map has annual-report-specific enum values. For CS: add new templates + mappings to Airtable, potentially add CS-specific enum translations. |
| **[SUB] Format Questionnaire** | Format Q&A for display | **As-is** | Generic formatter. |
| **[API] Get Client Documents** | Fetch docs for client/admin view | **As-is** | Fully generic — reads from documents table by report_id. |
| **[API] Check Existing Submission** | Check if client already submitted | **As-is** | Generic — checks stage + doc count by report_id. |
| **[API] Reset Submission** | Delete docs + reset stage | **As-is** | Generic — works on report_id. |
| **[API] Send Batch Status** | Send progress email to client | **Parameterizable** | Calls Document Service (generic). Email template may need filing-type label. |
| **[API] Review Classification** | Admin approve/reject AI classification | **As-is** | Generic — works on classification records. |
| **[API] Get Pending Classifications** | List pending AI reviews | **As-is** | Generic. |
| **[API] Get Preview URL** | Generate OneDrive preview link | **As-is** | Generic — no Airtable dependency. |
| **[API] Admin Change Stage** | Move report between stages | **As-is** | Generic — same 8-stage pipeline. |
| **[API] Admin Update Client** | Update client info/notes | **As-is** | Generic. |
| **[API] Admin Toggle Active** | Activate/deactivate client | **As-is** | Generic. |
| **[API] Reminder Admin** | Manage reminders per report | **As-is** | Generic. |
| **[Admin] Dashboard** | Dashboard stats | **Parameterizable** | Currently returns all reports for a year. Needs filing_type filter or grouping. |
| **[Admin] Bulk Import** | Create clients + reports | **Parameterizable** | Creates `annual_reports` records. Needs filing_type field in creation payload. |
| **[Admin] Year Rollover** | Clone reports to new year | **Parameterizable** | Clones from source year. Needs filing_type awareness to only clone matching type. |
| **[Admin] Mark Complete** | Quick-complete a report | **As-is** | Generic. |
| **[Admin] Pending Clients** | List pre-questionnaire clients | **As-is** | Generic filter on stage. |
| **[Admin] Auth & Verify** | Admin authentication | **As-is** | Fully generic. |
| **[API] Admin Questionnaires** | Retrieve questionnaire responses | **As-is** | Generic. |
| **[05-SUB] Email Subscription** | MS Graph mail subscription | **As-is** | Generic infrastructure. |
| **[MONITOR] Security Alerts** | Security monitoring | **As-is** | Generic. |
| **[MONITOR] Log Cleanup** | Log retention cleanup | **As-is** | Generic. |

### 3.2 Reusability Summary

| Category | Count | Workflows |
|----------|-------|-----------|
| **As-is** (no changes) | 20 | WF04, WF06-SUB, SUB Format Q, all API endpoints (Get Docs, Check Existing, Reset, Review Classification, Get Pending, Get Preview, Change Stage, Update Client, Toggle Active, Reminder Admin, Mark Complete, Pending Clients, Questionnaires), Auth, Email Sub, Security, Log Cleanup |
| **Parameterizable** (minor config) | 10 | WF01, WF02, WF03, WF05, WF06, SUB Doc Service, Send Batch Status, Dashboard, Bulk Import, Year Rollover |
| **Needs duplication** | 0 | None — no workflow requires a full copy |

### 3.3 Cross-Cutting References

**Airtable tables referenced across all workflows (12 unique):**

| Table | ID | Referenced By | Filing-Type Impact |
|-------|-----|--------------|-------------------|
| annual_reports | tbls7m3hmHC4hhQVy | 20+ workflows | **HIGH** — table name implies annual reports only. Either rename to `reports`/`filings` or add `filing_type` field. |
| documents | tblcwptR63skeODPn | 8 workflows | LOW — generic. Already supports any doc type via template_id. |
| clients | tblFFttFScDRZ7Ah5 | 6 workflows | NONE — clients are filing-type-agnostic. |
| documents_templates | tblQTsbhC6ZBrhspc | Doc Service, WF05 | **HIGH** — currently has 33 annual-report templates. Need CS templates too. |
| question_mappings | tblWr2sK1YvyLWG3X | Doc Service, WF02 | **HIGH** — maps Tally questions → templates. Need CS mappings. |
| categories | tblbn6qzWNfR8uL2b | Doc Service, Get Docs | MEDIUM — may need CS-specific categories. |
| questionnaire_responses | tblxEox8MsbliwTZI | WF02, Reset, Questionnaires API | MEDIUM — field names are annual-report-specific Hebrew. |
| email_events | tblJAPEcSJpzdEBcW | WF05 | NONE — generic. |
| pending_classifications | tbloiSDN3rwRcl1ii | WF05, Review API, Batch Status | NONE — generic. |
| system_config | tblqHOkDnvb95YL3O | WF06 | NONE — generic. |
| system_logs | tblVjLznorm0jrRtd | Admin actions | NONE — generic. |
| security_logs | tbljTNfeEkb3psIf8 | Monitors | NONE — generic. |

**Webhook paths (18 total):** All generic — none contain "annual" or filing-type-specific terms. No changes needed.

**Tally form IDs:** `1AkYKb` (Hebrew), `1AkopM` (English) — hardcoded in `landing.js` only. Capital statements will need its own Tally forms.

**Email templates with "דוח שנתי" (annual report):**
1. **WF01 (Send Questionnaires)** — email subject + body
2. **WF02 (Response Processing)** — office notification subject "שאלון שנתי התקבל"
3. **WF06 (Reminder Scheduler)** — Type A + Type B email templates
4. **view-documents.js** — mailto subject line
5. **approve-confirm.html** — page title and confirmation text

---

## 4. Airtable Schema Impact

### 4.1 Recommended Approach: Single Reports Table with `filing_type` Field

**Decision:** Use the existing `annual_reports` table (possibly renamed to `reports`) with a new `filing_type` single-select field, rather than creating a separate `capital_statements` table.

**Rationale:**
- 20+ workflows reference `tbls7m3hmHC4hhQVy` by table ID — the ID doesn't change even if renamed
- Shared client entity is already a linked field (`client` → `clients`)
- Stage pipeline is identical for both filing types
- Rollup fields (`docs_total`, `docs_missing_count`, etc.) work identically
- Dashboard/admin queries can add `AND({filing_type}='annual_report')` or `AND({filing_type}='capital_statement')` filters

### 4.2 Schema Changes Required

| Table | Change | Details |
|-------|--------|---------|
| **annual_reports** | Add field: `filing_type` (singleSelect) | Values: `annual_report`, `capital_statement`. Default: `annual_report` (backward-compatible). All existing records get `annual_report`. |
| **annual_reports** | Rename (optional, cosmetic) | Rename to `reports` or `filings` in Airtable UI. Table ID (`tbls7m3hmHC4hhQVy`) stays the same — no workflow changes needed. |
| **documents_templates** | Add CS templates | New rows with CS-specific template IDs (e.g., `CS001`, `CS002`, ...). Add field: `filing_type` (singleSelect) to filter templates by filing type. |
| **question_mappings** | Add CS mappings | New rows mapping CS Tally form fields → CS template IDs. Add field: `filing_type` (singleSelect) to filter mappings by filing type. |
| **categories** | Possibly add CS categories | If capital statements have different document categories. Otherwise reuse existing categories. |
| **questionnaire_responses** | Add CS response table OR add `filing_type` field | CS has different questions → different fields. **Recommend:** Create a separate table `תשובות שאלון הון` for CS responses, parallel to existing `תשובות שאלון שנתי`. This avoids polluting the existing table with unrelated columns. |
| **company_links** | No changes | Insurance company links are reusable across filing types. |
| **system_config** | Add CS-specific config | E.g., `cs_reminder_default_max`, or use compound keys like `reminder_default_max:capital_statement`. |

### 4.3 Data Model After Changes

```
clients (1) ──→ (N) reports [filing_type: annual_report | capital_statement]
                      │
                      ├──→ (N) documents
                      │         ↓
                      │    documents_templates [filing_type filter]
                      │         ↓
                      │    question_mappings [filing_type filter]
                      │
                      ├──→ תשובות שאלון שנתי (annual report responses)
                      └──→ תשובות שאלון הון (capital statement responses)
```

---

## 5. New Components Needed

These are components that don't exist yet and must be built from scratch for capital statements:

| Component | Effort | Description |
|-----------|--------|-------------|
| **Capital Statements Tally Form (HE)** | M | New Tally form with CS-specific questions (asset declarations, property valuations, bank balances, investments, liabilities, etc.). Completely different question set from annual report. |
| **Capital Statements Tally Form (EN)** | M | English version of the CS form. |
| **CS Document Templates (Airtable)** | M | New template records in `documents_templates` with CS-specific document types (bank statements, property deeds, investment reports, loan agreements, etc.). Need to define the full CS document taxonomy. |
| **CS Question Mappings (Airtable)** | M | New mapping records linking CS Tally fields → CS templates. Conditions, per_item rules, scope, etc. |
| **CS Classification Prompt** | L | The AI classification prompt in WF05 has 34 annual-report template types with detailed matching rules. Need an equivalent prompt for CS document types. This is the **single most complex new component** — requires domain expertise to define visual/textual clues for each CS document type. |
| **CS Questionnaire Response Table** | S | New Airtable table with CS-specific question fields. |
| **CS Email Templates** | S | Filing-type-aware email subject lines and intro paragraphs for: send questionnaire, questionnaire received notification, doc list email, reminder emails. |

**Total new components effort: Medium-Large (2–3 weeks of content/config work)**

---

## 6. Recommended Architecture

### 6.1 Airtable Strategy

1. **Add `filing_type` field** to `annual_reports` table (singleSelect: `annual_report`, `capital_statement`)
2. **Add `filing_type` field** to `documents_templates` and `question_mappings` tables
3. **Create separate CS questionnaire response table** (different question schema)
4. **Optionally rename** `annual_reports` → `reports` in Airtable UI (cosmetic, no code impact)
5. **Backfill** all existing records with `filing_type = 'annual_report'`

### 6.2 Workflow Strategy: Parameterize, Don't Duplicate

**Do NOT duplicate workflows.** Instead, add `filing_type` awareness to the 10 parameterizable workflows:

| Workflow | Parameterization Approach |
|----------|--------------------------|
| **[SUB] Document Service** | Filter templates/mappings by `filing_type` in Airtable queries. Add `filing_type` to input contract. The core generation engine is already data-driven — this is the **easiest critical change**. |
| **[01] Send Questionnaires** | Read `filing_type` from report record. Use it to select email template (from Airtable config or if/switch node). |
| **[02] Response Processing** | Detect filing type from Tally form ID or from report record. Pass `filing_type` to Document Service. Route to correct questionnaire table for upsert. |
| **[03] Approve & Send** | Read `filing_type` from report. Pass to Document Service. Filing-type label in success message. |
| **[05] Inbound Doc Processing** | Most complex change. Classification prompt must include correct template list based on filing type. Lookup filing_type from report record, then use corresponding prompt. |
| **[06] Reminder Scheduler** | Filter reminders by filing_type if different cadence. Inject filing_type label into email templates. |
| **[API] Send Batch Status** | Pass filing_type to Document Service for correct email template. |
| **[Admin] Dashboard** | Add `filing_type` to Airtable query filter. Return filing_type in response for frontend filtering. |
| **[Admin] Bulk Import** | Accept `filing_type` in import payload. Default to `annual_report` for backward compatibility. |
| **[Admin] Year Rollover** | Include `filing_type` in clone logic. Only clone matching type. |

### 6.3 Frontend Strategy

**Single site, filing-type-aware routing.** No separate repos or subdirectories needed.

1. **`check-existing-submission` API** returns `filing_type`, `form_id_he`, `form_id_en`, `filing_type_label_he`, `filing_type_label_en`
2. **Landing page** uses returned form IDs instead of hardcoded `FORM_HE`/`FORM_EN`
3. **All pages** use `filing_type_label` for display text instead of hardcoded "דוח שנתי"
4. **Admin dashboard** adds a filing-type toggle/filter (defaults to "all")
5. **Admin bulk import** adds a filing-type selector

### 6.4 Phased Implementation Plan

#### Phase 0: Content Definition (Pre-requisite, 1 week)
- [ ] Define the capital statements document taxonomy (all required document types)
- [ ] Design the CS Tally questionnaire (question list, logic, flow)
- [ ] Map CS questions → CS document templates
- [ ] Define CS-specific AI classification rules

#### Phase 1: Airtable Schema ✅ DONE (2026-03-18, DL-164)
- [x] Add `filing_type` field to `reports` (formerly `annual_reports`) with default `annual_report`
- [x] Add `filing_type` field to `documents_templates` and `question_mappings`
- [x] Backfill all existing records (106 records → `annual_report`)
- [x] Rename table `annual_reports` → `reports`
- [x] Update `report_key` formula to include `filing_type` (prevents collision for same client+year)
- [ ] **TODO:** Create CS document templates in Airtable (needs firm input on required docs)
- [ ] **TODO:** Create CS question mappings in Airtable (depends on CS Tally form)
- [ ] **TODO:** Create CS questionnaire response table (depends on CS form design)
- [ ] **TODO:** Add CS categories if needed (depends on CS document taxonomy)

#### Phase 2: Document Service ✅ DONE (2026-03-18, DL-164)
- [x] Add `filing_type` to Document Service input contract
- [x] Filter mappings by filing_type in Generate Documents code node
- [ ] **TODO:** Add any CS-specific enum translations to EN→HE map (when CS templates exist)
- [ ] **TODO:** Test with CS templates + sample questionnaire data (when CS templates exist)

#### Phase 3: Core Workflows ✅ DONE (2026-03-18, DL-164)
- [x] WF02: Detect filing_type from report, pass to Document Service
- [x] WF01: Read filing_type from report, dynamic email template
- [x] WF03: Pass filing_type to Document Service
- [x] WF04: Pass filing_type to Document Service
- [x] WF06: Add filing_type to reminder email templates (Type A + Type B)
- [x] Batch Status: Pass filing_type to Document Service
- [ ] **TODO:** WF02: Route to CS questionnaire table (when CS table exists)
- [ ] **TODO:** WF05: Create CS classification prompt, add filing-type-based prompt selection

#### Phase 4: Admin & API — Partially Done
- [x] Check Existing Submission API: returns `filing_type`, `form_id_he`, `form_id_en`, labels
- [x] Get Client Documents API: returns `filing_type` + labels in report object
- [x] Batch Status: passes filing_type to Document Service
- [ ] **TODO:** Dashboard: Add filing_type filter to query + response
- [ ] **TODO:** Bulk Import: Accept filing_type in payload
- [ ] **TODO:** Year Rollover: Include filing_type in clone logic

#### Phase 5: Frontend ✅ DONE (2026-03-18, DL-164)
- [x] Landing page: Use API-returned form IDs + labels (hardcoded fallbacks preserved)
- [x] View documents: Use API-returned filing_type_label for mailto subject
- [x] Approve confirm: Dynamic title (removed hardcoded "דוח שנתי")
- [ ] **TODO:** Admin dashboard: Filing-type filter toggle
- [ ] **TODO:** Document manager: Dynamic questionnaire section label

#### Phase 6: Tally Forms — TODO (needs firm input)
- [ ] **TODO:** Build CS Hebrew Tally form
- [ ] **TODO:** Build CS English Tally form
- [ ] **TODO:** Configure Tally → Airtable integration for CS response table
- [ ] **TODO:** Test end-to-end questionnaire flow

#### Phase 7: AI Classification — TODO (needs CS document taxonomy)
- [ ] **TODO:** Write CS classification prompt (document types, visual clues, matching rules)
- [ ] **TODO:** Test classification accuracy with sample CS documents
- [ ] **TODO:** Integrate into WF05 with filing-type-based prompt selection

#### Phase 8: Testing & Rollout — TODO
- [ ] **TODO:** End-to-end test: CS client flow (questionnaire → doc list → upload → classify → complete)
- [ ] **TODO:** Admin flow: CS bulk import, dashboard view, document management
- [ ] **TODO:** Verify annual report flow is unaffected (regression — checklist in `.agent/current-status.md`)
- [ ] **TODO:** Staged rollout with a few test clients

---

## 7. Risk Factors

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **CS document taxonomy undefined** | HIGH | Blocks everything — can't build templates, mappings, or classification prompt without knowing what documents CS requires | Complete Phase 0 first. Get sign-off from Moshe on the full CS document list before any implementation. |
| **AI classification accuracy for CS docs** | MEDIUM | CS documents may be harder to classify (bank statements look similar across institutions, property deeds vary wildly) | Start with conservative confidence thresholds. Heavy manual review initially. Iterate on prompt. |
| **Airtable field limits** | LOW | Airtable tables have a 500-field limit. Adding filing_type fields is trivial, but if CS questionnaire has many questions, the response table could grow large. | Already mitigated by using a separate CS response table. |
| **One report per client per year assumption** | MEDIUM | Some workflows (e.g., WF05 "Get Active Report") assume one report per client-year. With two filing types, a client could have both annual report AND capital statement for the same year. | Disambiguate by `filing_type` in queries: `AND({client_id}=X, {year}=Y, {filing_type}='capital_statement')`. WF05 needs special attention — inbound emails need filing-type routing logic. |
| **Email routing for WF05** | MEDIUM-HIGH | Inbound document processing (WF05) receives emails at a single inbox. How to determine if an attachment is for annual report vs. capital statement? | Options: (A) Different email addresses per filing type, (B) AI determines from document content, (C) Match against both report types and pick best. Option B is most practical — extend the classification prompt to also identify filing type. |
| **Backward compatibility** | LOW | Existing 600+ annual report records must continue working exactly as before | Mitigated by using `filing_type` with default `annual_report`. All existing records are automatically backward-compatible. |
| **Stage pipeline differences** | LOW | Capital statements might have a different lifecycle (e.g., no "Before_Signing" stage) | Use the same 8-stage pipeline. Skip unused stages via config. Avoids frontend/workflow changes. |
| **SSOT document updates** | MEDIUM | `SSOT_required_documents_from_Tally_input.md` is authoritative for annual reports. Need an equivalent for CS, and the Document Service must respect both. | Create `SSOT_capital_statements.md`. Update Document Service to load correct SSOT based on filing_type. |
| **n8n webhook registration** | LOW | New webhooks created via API may not register properly (known issue from memory) | No new webhooks needed — reuse existing endpoints with filing_type parameter. |

### 7.1 Key Decision Points

Before implementation, these decisions need stakeholder input:

1. **What documents does a capital statement require?** (Blocks Phase 0)
2. **Same inbox for all filing types or separate email addresses?** (Affects WF05 complexity)
3. **Same stage pipeline or different stages?** (Affects constants.js, admin UI)
4. **Same reminder cadence or different?** (Affects WF06 config)
5. **Should the admin dashboard show both filing types together or separate tabs?** (Affects frontend Phase 5)

---

## Appendix A: Airtable Tables Reference

| Table | ID | Records | Filing-Type Impact |
|-------|-----|---------|-------------------|
| clients | tblFFttFScDRZ7Ah5 | ~600 | None — shared entity |
| reports *(renamed)* | tbls7m3hmHC4hhQVy | ~600/year | `filing_type` field added ✅ |
| documents | tblcwptR63skeODPn | ~3000/year | None — linked to report |
| documents_templates | tblQTsbhC6ZBrhspc | 33 | `filing_type` field added ✅. CS templates TODO. |
| question_mappings | tblWr2sK1YvyLWG3X | 61 | `filing_type` field added ✅. CS mappings TODO. |
| categories | tblbn6qzWNfR8uL2b | 8 | Possibly add CS categories |
| questionnaire_responses | tblxEox8MsbliwTZI | ~600/year | Separate table for CS |
| email_events | tblJAPEcSJpzdEBcW | varies | None |
| pending_classifications | tbloiSDN3rwRcl1ii | varies | None |
| system_config | tblqHOkDnvb95YL3O | 1 | Add CS config keys |
| system_logs | tblVjLznorm0jrRtd | varies | None |
| security_logs | tbljTNfeEkb3psIf8 | varies | None |
| company_links | tblDQJvIaEgBw2L6T | varies | None |

## Appendix B: Webhook Paths (All Generic)

| Path | Workflow | Method |
|------|----------|--------|
| `/admin-auth` | Auth & Verify | POST |
| `/admin-verify` | Auth & Verify | GET |
| `/admin-dashboard` | Dashboard | GET |
| `/admin-pending` | Pending Clients | GET |
| `/admin-send-questionnaires` | Send Questionnaires | POST |
| `/admin-change-stage` | Change Stage | POST |
| `/admin-mark-complete` | Mark Complete | POST |
| `/admin-update-client` | Update Client | POST |
| `/admin-toggle-active` | Toggle Active | POST |
| `/admin-bulk-import` | Bulk Import | POST |
| `/admin-year-rollover` | Year Rollover | POST |
| `/admin-questionnaires` | Questionnaires | GET |
| `/admin-reminders` | Reminder Admin | GET/POST |
| `/check-existing-submission` | Check Existing | GET |
| `/reset-submission` | Reset Submission | POST |
| `/get-client-documents` | Get Client Docs | GET |
| `/edit-documents` | Edit Documents | POST |
| `/approve-and-send` | Approve & Send | GET/POST |
| `/get-preview-url` | Get Preview URL | GET |
| `/get-pending-classifications` | Get Pending | GET |
| `/review-classification` | Review Classification | POST |
| `/send-batch-status` | Send Batch Status | POST |
| `/wf05-email-notification` | Inbound Doc Processing | POST |
