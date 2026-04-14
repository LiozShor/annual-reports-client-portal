# Session Memories Archive

This file contains detailed session histories moved from CLAUDE.md to reduce file size.
For current project state, see `.agent/current-state.md`.
For design decisions, see `.agent/design-logs/`.

---

## Sessions 49–89 (2026-02-26 to 2026-03-04)

**Session 89 (2026-03-05) — DL-096: Stage-Aware Empty State + Template Field Fix:**
- `view-documents.js`: stage `1-*`/`2-*` shows blue info alert + CTA; stage `3+` with 0 docs shows green success.
- n8n `[API] Get Client Documents` Build Response: added `stage: String(stage)` to client-mode report object.
- Bug fixed: MCP update accidentally used old template field mapping (`description_he/en`) → crashed `initDocumentDropdown()`. Fixed via REST API PUT.
- Commit `2791601` pushed to main

**Session 88 (2026-03-04) — Security Project Closure:**
- SEC-REVIEW-001 (renderFromData XSS) confirmed already fixed in Phase 0.
- Security project CLOSED — 5/7 phases done, Phase 6 (admin accounts) DEFERRED.

**Session 87 (2026-03-04) — Phase 7 Testing & Finalization:**
- E2E brute force alert test: 7 AUTH_FAIL → CRITICAL BRUTE_FORCE alert email delivered. DL-094 → [COMPLETED].

**Session 86 (2026-03-04) — Phase 7: Security Monitoring & Logging:**
- Created `security_logs` Airtable table (`tbljTNfeEkb3psIf8`), 11 fields.
- Auth logging in 6 workflows (7 code nodes) with fire-and-forget `logSecurity()`.
- Created `[MONITOR] Security Alerts` (HL7HZwfDJG8t1aes) + `[MONITOR] Log Cleanup` (AIwVdDqxHa0ZNYD0).
- Created `docs/privacy-compliance.md`.

**Session 85 (2026-03-04) — DL-092: Approve & Send Duplicate Send Prevention:**
- Added `docs_first_sent_at` field to `annual_reports` (`fldpkLSpxWL7RRgBr`).
- WF[03]: removed hard block, added soft re-send warning with date. `approve-confirm.html`: `showAlreadySentWarning(sentAt)`.
- Commit `5250738` pushed. TESTED.

**Session 84 (2026-03-04) — Security Phase 5 Task 4 Fix: Approve Confirmation Page:**
- Webhooks added via API to active workflows don't get OPTIONS handling. Fix: reuse existing webhook with `confirm=1` param.
- WF[03]: `IF Confirm` node → approval flow or confirmation page. Frontend: hidden form uses GET + `confirm=1`.
- TESTED (execs 5511-5513). CORS docs added to CLAUDE.md.

**Session 83 (2026-03-04) — Security Phase 5: Harden Endpoints:**
- SEC-026: no-credential guard in `view-documents.js` + n8n Build Response early UNAUTHORIZED check.
- SEC-015/016/023: `groupByCategoryCl()` whitelists client fields (removed `file_url`, `onedrive_item_id`).
- SEC-007/031/018: reset-submission changed GET→POST in `landing.js` + n8n `[API] Reset Submission`.

**Session 82 (2026-03-04) — DL-090: Security Phase 4 — HMAC Token Architecture:**
- Admin token: 24h→8h expiry, localStorage key migration, Bearer header auth on 5 Verify Token nodes.
- Client HMAC tokens: `{expiryUnix}.{hmac}`, 30-day, report-scoped. `TOKEN_EXPIRED` UI in `landing.js`/`view-documents.js`.
- SEC-005/010/013/017/019 addressed. DL-090 → [COMPLETED], 7 tests passed.

**Session 81 (2026-03-04) — DL-086 Full Testing + Dismiss Bug Fix:**
- All 7 test scenarios passed (approve, persist, re-review, reassign, stats, dismiss).
- Dismiss bug: added `IF Dismiss` + `Handle Dismiss` + `Respond Dismiss` to Batch Status. Workflow 13→16 nodes.
- CSP: added `https://*.sharepoint.com` to `frame-src`. DL-086 → [FULLY TESTED].

**Session 80 (2026-03-04) — DL-089: Remove PII from URLs (SEC-004):**
- Removed `full_name`, `email`, `client_name`, `spouse_name` from all URL params.
- 4 frontend files + 5 n8n workflows updated. Active WF[01] identified as `9rGj2qWyvGWVf9jXhv7cy`.
- Commit `37feb8b`. DL-089 → [IMPLEMENTED & TESTED].

**Session 79 (2026-03-04) — DL-088: Show Reassigned Doc Name on Reviewed Card:**
- 4 lines in `submitAIReassign()` — merge `data.doc_title`/`templateId`/`AI_DOC_NAMES[templateId]` before `transitionCardToReviewed()`. DL-088 → [IMPLEMENTED & TESTED].

**Session 78 (2026-03-04) — Security Phase 2: SEC-001 + SEC-006:**
- SEC-001: token auth on `check-existing-submission`. SEC-006: CORS restricted to `https://liozshor.github.io` across 27 Respond nodes in 12 workflows.

**Session 77 (2026-03-04) — DL-086: Persistent Batch Review — Implementation + Testing:**
- ~15 JS functions: `transitionCardToReviewed`, `renderReviewedCard`, `startReReview`, batch action bar, `reconstructBatchTracker`.
- Post-send: DELETE records from `pending_classifications` (not PATCH). DL-086 → [IMPLEMENTED — TESTING].

**Session 76 (2026-03-04) — Viewport-Aware Floating Elements:**
- `positionFloating()` utility — flip/shift/size-constrain. Applied to 4 floating elements.
- CSS: direction-aware animations via `[data-side]`. Commit `6df899f`.

**Session 75 (2026-03-04) — Phase 0 Security Quick Wins:**
- 8 security fixes: `no-referrer` meta, SRI hashes, CSP meta tags, sanitized console.error, `sanitizeDocHtml()` allowlist.
- Commits `46e89ce`, `f85b388`, `bf663c8`.

**Session 74 (2026-03-03) — DL-083: Email CTA Highlight Box + Title Tweak:**
- Replaced muted inline CTA with highlight box (blue bg `#eff6ff`, 16px bold instruction, 20px mailto).
- Updated WF[03] Document Service, WF[06] Type B Email, Batch Status. Commit `762104b`. DL-083 → [IMPLEMENTED].

**Session 73 (2026-03-03) — DL-082: Clickable UI Audit (Admin Panel):**
- Doc count popover, clickable emails (mailto + copy), client name links, AI review file→preview.
- Bug: docs nested in `groups[].categories[].docs[]`, not flat array. DL-082 → [IMPLEMENTED].

**Session 72 (2026-03-03) — DL-081 Testing + OneDrive Filename Fix:**
- All 6 scenarios passed. Filename duplication bug: `extractIssuer()` helper added to use `issuer_key` not full `issuer_name`. DL-081 → [TESTED & VERIFIED].

**Session 71 (2026-03-02) — DL-080: Document Manager Spouse Fix + Inline Rename:**
- Spouse name from API. Inline rename with pencil icon → `nameChanges` Map → batched save.
- `[04] Document Edit Handler`: parses `name_updates`. Logo links to admin panel. DL-080 → [IMPLEMENTED].

**Session 70 (2026-03-02) — DL-081: Rejection Stale Fields Fix:**
- n8n Airtable Update drops `null` → stale fields. Fix: inline `httpRequest()` PATCH for reject/reassign, `docUpdate = null` on success.

**Session 69 (2026-03-02) — WF[05] Skip Classification When No Required Docs:**
- `alwaysOutputData: true` on `Get Required Docs`. `IF Has Required Docs` + `Skip to Upload` nodes. Workflow 41→43. Tested ✅.

**Session 68 (2026-03-02) — Consolidate Reminder Settings Save to 1 API Call:**
- n8n: `update_configs` batch action, `Collect Saves` node, 3 post-save nodes. Workflow 22→26.
- Frontend: single POST, no client-side date recalculation. Commit `663177b`.

**Session 67 (2026-03-02) — DL-078: Clickable Stat Cards + Suppress/Max Fixes:**
- Stat cards toggle-filter reminder table. Suppress button → dropdown with month/forever options.
- n8n: `unsuppress` resets `reminder_count = 0`. Commit `45168be`. DL-078 → [IMPLEMENTED].

**Session 66 (2026-03-02) — Fix `docs_total` Waived/Not Required Inflation:**
- `docs_total` is a Count field (includes Waived). Code fix in Batch Status `Build Email` with `EXCLUDED_STATUSES`.
- Airtable: created `is_required` formula field (`fldQCVZ5RVcxoeQtC`). Manual step: convert to Rollup in UI.

**Session 65 (2026-03-02) — DL-076: WF[03] Client Email Card-Based Bilingual Layout:**
- `isEnglish` branch: EN card + HE card layout. Deployed to Document Service. DL-076 → [IMPLEMENTED].

**Session 64 (2026-03-02) — Card-Style Bilingual Separation + Batch Delta:**
- Type B + Batch Status: EN card (white) + HE card (gray `#f9fafb`), `🔤` labels, 16px gap.
- Batch Status: compact progress one-liner, removed full doc list. `docs_total` includes Waived (open issue).

**Session 63 (2026-03-02) — Master-Detail Document Preview for AI Review Tab:**
- Split-view: card list + sticky preview panel. New workflow `[API] Get Preview URL` (`aQcFuRJv8ZJFRONt`).
- iframe sandbox removed (SharePoint needs cookies). Commits `c92b442`–`4db3b17`.

**Session 62 (2026-03-02) — DL-074 Follow-up: Card UX Refinement:**
- `max-width: 600px` on AI review cards. `.btn-link` class. Button hierarchy standardized (approve=success, reject=outline-danger, reassign=btn-link).

**Session 61 (2026-03-01) — DL-070: Guard Reassign Target Doc + Design Log Cleanup:**
- n8n `[API] Review Classification`: `IF Conflict` + `Respond Conflict` (409). Frontend: `showConfirmDialog` on conflict, re-call with `force_overwrite=true`. Workflow 30→32 nodes.

**Session 60 (2026-03-01) — Parallel Code Verification + Manual Testing:**
- 5 parallel agents verified DL066/067, DL068, Add General Doc, WF[05] multi-year, Batch Completion — all deployed correctly.

**Session 59 (2026-03-01) — DL-073: Type A Reminder Email Redesign:**
- Single bilingual CTA `📋 מלא/י שאלון / Fill Questionnaire`. Removed `isEnglishFirst` branch. Code reduced 40%.

**Session 58 (2026-03-01) — document_key Case Mismatch Fix:**
- "Find Target Doc" node lowercases `report_record_id`. Root cause of "no docs": all docs had `review_status='confirmed'`.

**Session 57 (2026-03-01) — DL072: Bilingual Email Bug Fixes:**
- 4 bugs across 3 workflows: footer typo, section headers lang-aware, `heToEn` lookup map for EN doc names. 4/4 tests passed.

**Session 56 (2026-03-01) — DL071: Bilingual Document Lists Across All Email Types:**
- `doc_list_html_en` added to Document Service. WF[06] Type B + Batch Status updated.

**Session 55 (2026-03-01) — Bilingual Email Audit (WF[06] + Batch Status):**
- Propagated bilingual support: `_lang` passthrough in Type B, bilingual wrappers in Build Email, Type A always bilingual.

**Session 54 (2026-03-01) — DL069: Review Classification Race Condition Guard:**
- `file_hash` compare-and-set guard in Process Action. "Fetch Source Doc" node added. Workflow 29→30. 4 scenarios tested.

**Session 53 (2026-02-26) — DL065 Testing: Year Rollover + Dynamic Year Dropdowns:**
- Fixed 4 bugs in Year Rollover workflow. Dashboard: `available_years` in response. Frontend defaults to newest year.

**Session 52 (2026-02-26) — DL065: Fix Bulk Import + Year Rollover:**
- Fixed 5 bugs in `[Admin] Bulk Import`. Created `[Admin] Year Rollover` (`ODsIuVv0d8Lxl12R`).
- Frontend: dynamic year dropdowns, rollover UI card, `showConfirmDialog` replaces native `confirm()`.

**Session 51 (2026-02-26) — Consolidate Reminder Settings into Modal:**
- `reminder_send_day` config key in `system_config`. `[API] Reminder Admin` + WF[06] updated. Dedup fix.
- Force-send for exhausted clients. Commits `a8ac3b9`–`b89cdc4`.

**Session 50 (2026-02-26) — DL062: Remove `reminder_type` field entirely:**
- Stage is SSOT for type. Removed `reminder_type` from WF[06], WF[02], Reminder Admin. Airtable field deleted.

**Session 49 (2026-02-26) — DL061: Configurable Reminder Limits:**
- `system_config` table (`tblqHOkDnvb95YL3O`) with `reminder_default_max`. Per-client override. Commit `e357a6e`.

---

## Session 2026-02-16 (Session 10) - Review Tab + Phase 2 Planning

### What Was Accomplished:
1. **"Ready for Review" FIFO Tab** — full implementation across all layers:
   - Airtable: `docs_completed_at` field
   - WF[04]: Auto-detection of 100% completion → advance to stage 4
   - Dashboard API: `review_queue` array (FIFO-sorted)
   - New workflow: `[Admin] Mark Complete` (`loOiiYcMqIgSRVfr`)
   - Frontend: Review tab with FIFO table, waiting time badges, mark complete, Excel export
   - All verified by user — working

### Next Session (2026-02-17) — Start Phase 2: Inbound Document Processing
- **Goal:** Build AI-powered document classification pipeline
- **Approach:** LLM (Claude/GPT vision) + client's required doc list as context — no model training needed
- **Pre-requisite:** Ask office crew for ~10-15 sample documents (1 per common type: Form 106, Form 867, bank statement, ID appendix, etc.) — needed for prompt engineering and E2E testing
- **Architecture:** Incoming email → extract text/vision → LLM matches to client's specific required doc list → update Airtable status → file to OneDrive
- **n8n tools:** LangChain AI agent nodes, Microsoft Graph for email reading

---

## Session 2026-01-27 (Evening) - Folder Cleanup

### What Was Accomplished:
1. **Folder Organization:**
   - Created `.agent/archive/` for completed work notes
   - Moved loose files: `fix-code-docmapping.txt`, `workflow-04-*.md`
   - Deleted Windows artifact: `nul` file in root

2. **Design Log Cleanup:**
   - Fixed duplicate numbering: two `025-*` files existed
   - Moved superseded `025-workflow-02-data-flow-fix-needed.md` to archive
   - Kept `025-workflow-02-bug-fixes-lessons-learned.md` as canonical

3. **Documentation:**
   - Created `current-state.md` - comprehensive project context
   - Updated this file with cleaner structure

### Folder Structure After Cleanup:
```
.agent/
├── archive/           # Completed/superseded work
├── design-logs/       # Active design decisions (000-026)
├── current-state.md   # Project context (NEW)
└── session-memories.md
```

---

## Session 2026-01-27 (Day) - Workflow [02] Bug Fixes

(Detailed in design log 025-workflow-02-bug-fixes-lessons-learned.md)

### Summary:
All critical bugs in Workflow [02] were fixed:
- UUID → Label translation
- Inline SSOT templates (no HTTP dependency)
- Airtable type mapping (exact enum values)
- Multi-line value splitting
- Action buttons in email

### Status:
Awaiting user testing

---

## Session 2026-01-28 - Tally Webhook → Airtable Trigger Migration

### What Was Accomplished:
1. **Architecture Change:**
   - Removed: Tally Webhook + Respond OK nodes
   - Added: Airtable Trigger (polls every minute)
   - Renamed: "Extract Tally Data" → "Extract Airtable Data"
   - Updated all node references to use new node name

2. **Configuration:**
   - Table: תשובות שאלון שנתי (tblxEox8MsbliwTZI)
   - Trigger field: תאריך הגשה
   - Credentials: Airtable Personal Access Token account

3. **Design Log:** 028-tally-webhook-to-airtable-trigger.md

### Issue Discovered (NEEDS INVESTIGATION):
**Execution #2045 failed** - Airtable Trigger returned empty object `{}`

The Extract node received no data, causing:
- `report_record_id: ""`
- `answers_by_key: {}`
- Update Report Stage failed (no record ID)

**Possible causes:**
1. Test record had no data
2. Airtable Trigger format differs from expected
3. Record was deleted after trigger fired

**Added validation:** Extract node now throws error if record is empty or missing report_record_id

### Next Session TODO:
1. Check `תשובות שאלון שנתי` table for the record that triggered execution #2045
2. Verify Airtable Trigger returns data in expected format
3. If needed, adjust Extract Airtable Data code to match actual trigger output format
4. Test with real Tally form submission

### Workflow Status:
- ID: QqEIWQlRs1oZzEtNxFUcQ
- Active: true
- Validated: yes (0 errors, 21 warnings)

---

## Session 2026-01-26 - Display Library Migration

(Detailed in archived `workflow-04-display-library-migration.md`)

### Summary:
- Migrated Workflow [04] to use centralized display library
- Eliminated duplicate `formatDocumentName()` function
- All workflows now use consistent formatting

---

## Session 2026-01-23

### What Was Accomplished:
1. **Folder Cleanup:**
   - Deleted: n8n-mcp/, n8n-management-mcp/, claude_desktop_config.json, n8n-workflow-updates-guide.md, nul, .env
   - Moved: secret_keys.txt → ../secure_keys.txt
   - Saved ~4MB, cleaner project structure

2. **Single Source of Truth Implementation:**
   - **Problem:** Document types defined in 2 places (document-types.js + n8n Code node)
   - **Solution:** Made document-types.js the ONLY source
   - Created document-types.json (auto-generated from .js file)
   - Updated n8n workflow [API] Get Document Types (ID: AhWYAxX83IQVQ1mK)
   - **Result:** To rename "טופס 106", edit 1 file, push to GitHub, done!

3. **Documentation:**
   - Updated CLAUDE.md with architecture diagram
   - Added update procedure with exact commands

### Key Files Modified:
- `github/annual-reports-client-portal/document-types.js`
- `github/annual-reports-client-portal/document-types.json` (NEW)
- n8n workflow AhWYAxX83IQVQ1mK structure changed

---

## Session 2026-01-26

### WORKFLOW [02] REFACTORING - COMPLETE

**Status:** Successfully refactored and tested
**Workflow ID:** EMFcb8RlVI0mge6W

#### What Was Accomplished:

1. **Refactored MEGA NODE into 3 focused nodes** (log 023)
   - **Node 1: "Extract & Prepare"** (364 lines) - Extract system fields, detect language, build answers map
   - **Node 2: "Generate Documents"** (343 lines) - Process mappings, apply perItem logic, format names
   - **Node 3: "Finalize & Format"** (143 lines) - Consolidate appendices, deduplicate, format for Airtable

2. **Fixed critical deduplication bug**
   - Before: Used `type + issuer_key + person` → all employers from same question had same key
   - After: Uses `document_key` which includes item-specific value

3. **Fixed spouse name bug** - Shows actual name "משה" from questionnaire

4. **Fixed runtime errors** - Node references, eval() issues, data paths

5. **Added business logic** - Foreign income conditional, appendix consolidation

#### Current Architecture:
```
Webhook → Respond to Webhook
   ↓
HTTP nodes (parallel: Doc Types, Questionnaire Mapping, Display Library)
   ↓
Merge → Extract & Prepare → Generate Documents → Finalize & Format
   ↓
Airtable - Batch Upsert
   ↓
Code - Prepare Search Query → Airtable - Search Documents
   ↓
Code - Generate Email HTML → MS Graph - Send Email
   ↓
Code - Prepare Report Update → Airtable - Update Report
```

### SSOT ALIGNMENT - COMPLETE

**Objective:** 100% compliance with `SSOT_required_documents_from_Tally_input.md`

#### Phase 1: Core Module Updates
- Updated `workflow-processor-n8n.js` with SSOT delegation
- Created `ssot-document-generator.js` (534 lines, 34 templates)

#### Phase 2: Workflow [02] Integration
- Added HTTP node for SSOT module
- Updated 3 Code nodes to use SSOT functions

#### Phase 3: Display Library Migration
- Workflow [03] "Approve & Send" - migrated (~85 lines removed)
- Workflow [04] "Document Edit Handler" - migrated (~16 lines removed)

#### Files Modified:
- `n8n/workflow-processor-n8n.js`
- `n8n/ssot-document-generator.js` (NEW)
- Workflows [02], [03], [04] via MCP

---

## Session 2026-01-27

### WORKFLOW [02] BUG FIXES - COMPLETED

| Bug | Fix Location | Implementation |
|-----|--------------|----------------|
| UUID → Label mapping | Extract & Prepare | `translateFieldValue()` using Tally's `options` array |
| Questionnaire table shows UUIDs | Extract & Prepare | Same function for HTML table |
| Missing doc types | Generate Documents | Inline SSOT templates (25+) |
| Airtable type error | Generate Documents | `AIRTABLE_TYPES` mapping with exact schema values |
| Multi-line values not split | Generate Documents | `splitMultiLine()` function |
| No action buttons in email | Generate Email HTML | Approve + Edit buttons |

### Key Lessons Learned:
1. JSON vs JS files: HTTP nodes fetching `.json` return parsed objects
2. Tally arrays: Multi-select fields return arrays even for single values
3. Airtable enums: Must match EXACT PascalCase values from schema
4. SSOT loading fragility: Inline templates more reliable than HTTP + `new Function()`

### Testing Status:
- User to run new test execution
- Verify Airtable upsert succeeds
- Verify document count with multi-line inputs
- Verify questionnaire table shows Hebrew labels
- Verify email has action buttons

---

## Session 2026-01-27 (Late Evening) - [SUB] Document Service Bug Fixes

### What Was Accomplished:

Fixed 3 bugs in the [SUB] Document Service workflow (`hf7DRQ9fLmQqHv3u`):

| Bug | Root Cause | Fix | Result |
|-----|------------|-----|--------|
| T501 duplicate deposits | `generateDocKey()` truncated Hebrew to 20 chars | Increased limit to 50 chars | 8 docs (was 4) |
| T302 spouse NII missing | Mapping used trigger question (`question_Oz4vkY = "כן"`) instead of actual types | Fetch from `question_V0QgDM` directly | 6 docs (was 0) |
| T1601/T1602 wrong logic | Both generated regardless of foreign return status | Added mutual exclusion via `question_487oPA` | T1602 only when return filed |

### Code Changes (Generate Documents node):

1. **generateDocKey truncation:**
```javascript
// BEFORE: substring(0, 20) - caused "הפקדה עצמאית קרן פנסיה 1" and "2" to collide
// AFTER: substring(0, 50)
parts.push(normalizeKey(value).substring(0, 50).replace(/[^A-Z0-9א-ת]/g, '_'));
```

2. **T302 special handling:**
```javascript
if (templateId === 'T302') {
  const actualTypesAnswer = getAnswer('question_V0QgDM');  // "נכות;אבטלה;..."
  const spouseAllowanceTypes = splitList(actualTypesAnswer);
  // Generate one document per actual type
}
```

3. **T1601/T1602 mutual exclusion:**
```javascript
const foreignReturnFiled = isTruthy(getAnswer('question_487oPA'));
if (templateId === 'T1601' && foreignReturnFiled) continue;  // Skip T1601
if (templateId === 'T1602' && !foreignReturnFiled) continue; // Skip T1602
```

### Verification:
- Test workflow `uFIrf6gUVbvTHn8Q` executed successfully
- Total documents: 54 (correct)
- All 3 bug fixes verified working

### Status:
✅ Complete - [SUB] Document Service ready for production use

---

## Session 2026-02-14 - Simplified WF02 + Schedule Trigger + n8n Cleanup

(Detailed in design log 029-simplified-wf02-schedule-trigger.md)

### What Was Accomplished:

1. **Phase 0 — Field Discovery:**
   - Cross-referenced 60 `question_mappings` against 83 `תשובות שאלון שנתי` fields
   - Matched 59/60 mappings to Hebrew Airtable field names

2. **Phase 1 — Airtable Schema Update:**
   - Created `airtable_field_name` column on `question_mappings` table
   - Populated all 60 records via batch_update

3. **Phase 2 — Rebuilt Workflow [02] (14 nodes):**
   - Replaced unreliable Airtable Trigger with Schedule Trigger + Search pattern (n8n bug #16831)
   - New Extract & Map reads mappings from Airtable at runtime (no hardcoded fields)
   - Added Mark Processed node (`סטטוס = 'התקבל'`) for idempotent processing
   - Fixed 5 runtime bugs during testing (node modes, parallel execution, Python string interpolation, valid status values)
   - End-to-end test: 48 documents created, email sent, report stage updated

4. **Phase 3 — n8n Cleanup:**
   - Deleted 7 unused workflows (old WF02 versions, legacy document managers, old tests)
   - Deactivated 4 redundant API/Admin workflows (types & mappings now in Airtable)
   - Final state: 18 workflows (13 active, 5 inactive)

5. **Documentation Updates:**
   - `docs/airtable-schema.md` — Added `airtable_field_name` column
   - `CLAUDE.md` — Updated workflow IDs
   - `.agent/current-status.md` — Full rewrite
   - `.mcp.json` — Updated expired n8n API key

### Key Decisions:
- Schedule Trigger polls every minute — cost is ~2 Airtable API calls/min when idle (well within free tier)
- JS code loaded from separate file to avoid Python string interpolation mangling `$('NodeName')`
- `סטטוס` field uses Hebrew singleSelect values: `התקבל` (received), not English

### Remaining Items:
- Verify Mark Processed on next real submission
- Run SSOT verification checklist against 48 documents
- Review deactivated workflows before permanent deletion
- Phase 4 (future): Simplify WF03 & WF04 to read from Airtable

### Status:
✅ Complete — WF02 rebuilt, tested, and running in production

---

## Sessions 12–42 Summary (2026-02-16 to 2026-02-25)

> Consolidated summary — individual session details were not archived at the time. Key milestones extracted from design logs and current-status.md.

### Phase 1 Completion (Sessions 12–29)
- **WF[02] iterative bug fixes** (DL020–025): Category ID mapping, data path fixes, multi-value bugs, mega-node refactoring into 3 focused nodes
- **SSOT alignment** (DL024): Comprehensive audit ensuring all 34 templates match authoritative source
- **Display library migration** (DL026): WF[03] + WF[04] migrated to centralized display
- **Document Service sub-workflow** (DL027): Created `[SUB] Document Service` (hf7DRQ9fLmQqHv3u)
- **Tally → Airtable trigger** (DL028–029): Replaced unreliable Tally webhook with Schedule + Search pattern
- **Bilingual email** (DL030): English respondents get bilingual emails
- **WF[04] rebuild** (DL031): Document Edit Handler rebuilt
- **UI/UX redesign** (DL032): Full frontend redesign
- **Admin review queue** (DL033): FIFO "Ready for Review" tab
- **CLAUDE.md token refactor** (session 29): Reduced from 486 → 175 lines, created docs/architecture.md and docs/project-overview.md

### Phase 2 — Inbound Document Processing (Sessions 30–42)
- **WF[05] built** (DL034–035): AI classification + OneDrive upload pipeline
- **AI review interface** (DL036): Admin tab for reviewing AI classifications
- **Admin portal UX** (DL037): Portal-wide UX improvements
- **Email router** (DL038): Designed but DEPRECATED — user decided not to implement
- **Searchable doc dropdown** (DL039): Categorized dropdown for doc reassignment
- **AI review cards** (DL042–043): Card cleanup and redesign with confidence/issuer comparison
- **Error handling** (DL044): Architecture for consistent error handling
- **Document manager** (DL045): Status overview panel + file view/download
- **WF[05] optimization** (DL046): Loop restructure + classification optimization
- **Status indicators** (DL047): Visual indicators across all surfaces
- **OneDrive file ops** (DL048–049): Rename, move, DOCX extraction, dedup
- **Inline confirmation** (DL050): Inline confirm on AI review cards
- **Persistent file links** (DL051, 056): OneDrive batch resolve at page load
- **Unmatched senders** (DL052): Two-tier identification pipeline (regex + AI fallback)
- **Stage advancement** (DL054): Inline 3→4 advancement in review classification
- **Sortable headers** (DL055): Sortable table + clickable stage badges
- **Security audit** (session 37): Auth gates on all pages/endpoints, token hiding from URLs
- **Logo integration** (session 33): Logo across all portal pages
- **Custom doc creation** (session 42): Create new docs from AI review reassign

---

## Session 43 (2026-02-25) — Phase 3: Automated Follow-up Reminder System (Part 1)
- Admin tab: "תזכורות חודשיות" with stats, filters, bulk actions, sortable table
- n8n workflows deployed: [API] Reminder Admin (`RdBTeSoqND9phSfo`), [06] Reminder Scheduler (`FjisCdmWc4ef0qSV`), [06-SUB] Monthly Reset (`pW7WeQDi7eScEIBk`)
- Airtable: 6 new fields on `annual_reports`, 1 on `documents`
- Design log 059 created

---

## Session 44 (2026-02-25) — Phase 3: Reminder System (Part 2)
- Airtable fields created via API (reminder_count/max/next_date/suppress/last_sent)
- Stage integration: Admin Change Stage clears reminder_next_date on stage >= 4
- WF[02] sets stage to 3-Collecting_Docs on questionnaire responses

---

## Session 45 — Not recorded (gap in numbering)

---

## Session 46 (2026-02-26) — AI Classification Test
- Classified 20 sample PDFs against SSOT templates
- Results: 14/20 correct, 3/20 wrong (pension withdrawal misclassification), 3 edge cases
- Found n8n 502 crash: execution record too large (base64 PDFs in DB)
- n8n upgraded to v2.10.1

---

## Session 47 (2026-02-26) — Reminder System Frontend + Backend Fixes
- n8n [API] Reminder Admin: CORS fix, auth fix, Airtable credential fix, data access fix
- n8n [06] Reminder Scheduler: Replaced SMTP with MS Graph API, added Execute Workflow Trigger, fixed next date logic
- Frontend: Removed type column, added "last sent" column, batch date picker, Type A/B section split with collapsible accordions
