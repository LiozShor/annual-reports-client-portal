# Plan: Add `filing_type` Layer for Capital Statements Support

## Status: Phase 9 Remediation COMPLETE — Content Pending

**Infrastructure completed:** 2026-03-18 (session 169, DL-164)
**Admin scoping completed:** 2026-03-29 (DL-216)
**Post-implementation audit:** 2026-03-29 (see `docs/cs-hardcoded-audit.md`)
**Remediation completed:** 2026-03-30 (DL-225)

---

## What Was Done

### Phase 1: Airtable Schema
- Created `filing_type` singleSelect field via API in 3 tables (reports, documents_templates, question_mappings)
- Options: `annual_report`, `capital_statement`
- Backfilled all 106 existing records to `annual_report`
- Renamed table `annual_reports` -> `reports`
- Updated `report_key` formula to include `filing_type` (prevents collision for same client+year)

### Phase 2: Document Service Filter
- `[SUB] Document Service` Generate Documents node filters mappings by `filing_type`
- Default `annual_report` — backward compatible

### Phase 3: Caller Workflow Injection
- 6 workflows forward `filing_type` to Document Service: WF01, WF02, WF03, WF04, WF06, Batch Status

### Phase 4: Email Template Labels
- Workers API `email-html.ts` has `arQuestionnaireContent()` + `csQuestionnaireContent()` with fully distinct content
- WF02 office notification uses `ftLabel.he` dynamically
- WF06 reminder **subjects** use `ftLabel` — but **bodies are still hardcoded** (see Phase 9)

### Phase 5: Frontend + API
- Check Existing Submission API returns `form_id_he`, `form_id_en`, `filing_type`, labels
- Get Client Documents API returns `filing_type` + labels in report object
- landing.js: API-driven form IDs with hardcoded fallbacks
- view-documents.js: dynamic mailto subject
- approve-confirm.html: generic title (no hardcoded "דוח שנתי")

### Phase 6: Admin Dashboard Entity Tabs (DL-166)
- AR/CS entity tabs on admin Dashboard with client-side filtering
- Stat grid, client table, stage filters all scoped to active entity tab

### Phase 7: Admin Filing Type Scoping — All Tabs (DL-216)
- **Backend:** 4 Workers routes (`pending`, `reminders`, `questionnaires`, `classifications`) accept `filing_type` param and filter at Airtable query / post-fetch level
- **Frontend:** All API calls pass `filing_type`, cache invalidation on entity tab switch, review queue filtered
- **Mobile:** Compact navbar entity toggle (שנתיים/הון) visible on all tabs
- Import/add filing type dropdowns auto-sync to active entity tab

### Phase 8: CS Airtable Content (DL-182, partial)
- 22 CS document templates in `documents_templates`
- 22 CS question mappings in `question_mappings` with HE tally keys
- `FILING_CONFIG` updated: `form_id_he: '7Roovz'`, `form_id_en: ''`
- 8 new CS categories auto-created via typecast

### WF01 Send Questionnaire — Fully Migrated to Workers
- n8n WF01 is **archived** — Workers `send-questionnaires.ts` owns the full flow
- Workers already CS-aware: reads `filing_type`, uses `csQuestionnaireContent()` for CS emails
- No n8n fixes needed for questionnaire emails

---

## What Remains

### Phase 9: Remediate Hardcoded AR References (from audit)

Post-implementation audit (2026-03-29) found remaining hardcoded AR references. Organized by owner and priority.

#### 9A. n8n WF06 Reminder Emails — CRITICAL (3 tasks)

WF06 `[06] Reminder Scheduler` still owns reminder email generation. Workers only manages data and triggers n8n for sending.

| # | Finding | Node | What | Fix |
|---|---------|------|------|-----|
| 1 | C-03 | Build Type A Email | Body has 5+ hardcoded AR strings: `"שאלון שנתי"`, `"הדוח השנתי שלך"`, `"הכנת הדוח השנתי"` — subject is dynamic but body is not | Replace all body strings with `ftLabel.he`/`ftLabel.en` |
| 2 | C-04 | Build Type B Email | HE body: `"הדוח השנתי"`, `"הכנת הדוח"` — EN body already uses `ftLabel` | Replace HE body strings with `ftLabel.he` |
| 3 | C-05 | Type A + Type B WhatsApp URLs | Pre-filled WA message: `הדוח+השנתי` | Build WA URL dynamically with `ftLabel.he` |

**Prerequisite check (W-01):** Verify "Search Due Reminders" Airtable node includes `filing_type` in its field list. If not, add it — downstream email builders need this field.

#### 9B. Client Portal Frontend — CRITICAL (4 tasks)

| # | Finding | File | What | Fix |
|---|---------|------|------|-----|
| 4 | C-06 | `view-documents.html` | `<title>` and `<h1>` say "Annual Report" — JS never updates them | `view-documents.js`: update title/h1 with `filing_type_label` from API response |
| 5 | C-07 | `view-documents.js:281-282` | Empty state: `"טרם מולא שאלון שנתי"` / `"annual questionnaire"` | Use `filing_type_label_he`/`_en` from report data |
| 6 | C-08 | `landing.js:20-21,109-110` | Tally form ID fallback silently defaults to AR (`1AkYKb`/`1AkopM`) | Use `FILING_CONFIG` map or show error on missing form ID |
| 7 | C-09 | `landing.js:32` | Base64 header decodes to `📋 שאלון דוח שנתי` — flashes before API responds | Change to generic `📋 שאלון` or loading state |

#### 9C. Workers API — CRITICAL (2 tasks)

| # | Finding | File | What | Fix |
|---|---------|------|------|-----|
| 8 | C-10 | `api/src/routes/chat.ts:48` | System prompt describes `filing_type` as business classification, not report type | Fix description: `'annual_report' (דוח שנתי) or 'capital_statement' (הצהרת הון)` |
| 9 | W-11 | `api/src/routes/rollover.ts:40-58` | `clientsWithTarget` set doesn't filter by `filing_type` — CS rollover skipped if AR exists | Add `filing_type` check to target year loop |

#### 9D. Frontend Fallback Labels — WARNING (3 tasks)

| # | Finding | File | What | Fix |
|---|---------|------|------|-----|
| 10 | W-05 | `landing.js:113-114` | `filing_type_label_he \|\| 'דוח שנתי'` — silent AR default | Use generic `'דוח'` / `'Report'` or infer from `filing_type` |
| 11 | W-06 | `view-documents.js:191,257` | mailto subject fallback: `'דוח שנתי'` | Use generic fallback |
| 12 | W-07 | `admin/js/script.js` (4 places) | `filing_type \|\| 'annual_report'` silent defaults | Acceptable for legacy records; add console warning |

#### 9E. n8n WF07 Daily Digest — WARNING (2 tasks)

| # | Finding | Node | What | Fix |
|---|---------|------|------|-----|
| 13 | W-02 | Query Pending Approval | No `filing_type` filter — mixes AR+CS with no distinction | Include `filing_type` label per client in digest display |
| 14 | W-03 | Build Digest Email | Footer: `"מערכת דוחות שנתיים"` | Change to `"מערכת דוחות"` |

#### 9F. Dashboard API — WARNING (1 task)

| # | Finding | File | What | Fix |
|---|---------|------|------|-----|
| 15 | W-09 | `api/src/routes/dashboard.ts:40` | No `filing_type` filter param — returns mixed stats | Accept optional `filing_type` query param; frontend already filters client-side but server-side is better for stat counts |

#### 9G. Cosmetic / Low Priority (3 tasks)

| # | Finding | File | What | Fix |
|---|---------|------|------|-----|
| 16 | W-04 | `script.js:6602`, `document-manager.js:2535` | Print footers: `"מערכת ניהול דוחות שנתיים"` | Change to `"מערכת ניהול דוחות"` |
| 17 | W-08 | `privacy-policy.html:144,152,160` | 3 AR-only references in privacy policy | Broaden to `"דוחות שנתיים והצהרות הון"` |
| 18 | R-07 | `SSOT_CS_required_documents.md:8` | CS generator implementation marked TBD | Verify status — may already be in n8n Code nodes |

---

### Phase 10: CS Tally Questionnaire — BLOCKED on user actions

- **Done:** HE form `7Roovz` created with questions
- **Remaining:**
  1. User: Add 22 conditional rules to HE form + delete 2 broken blocks
  2. User: Duplicate HE form to create EN form (old `XxEEYV` deleted)
  3. Agent: Populate `tally_key_en` + `label_en` in question_mappings after EN form exists
  4. Agent: Update CS_KEY_MAP in `workflow-processor-n8n.js` after EN form exists
  5. Agent: Update `form_id_en` in FILING_CONFIG after EN form exists
  6. Both: Publish forms -> end-to-end test

### Phase 11: CS Classification Prompt (WF05)

- **What:** WF05 reads `filing_type` from report -> uses CS-specific classification prompt
- **Who:** Needs CS document taxonomy finalized first
- **Approach:** IF `annual_report` -> existing prompt. IF `capital_statement` -> CS prompt with CS template list
- **This is the only WF05 code change remaining**

---

## Execution Plan

### Sprint 1: Critical Client-Facing Fixes (9A + 9B)
**Goal:** No CS client sees "דוח שנתי" anywhere

Tasks (in dependency order):
1. **WF06 prerequisite:** Verify/add `filing_type` to "Search Due Reminders" field list
2. **WF06 Type A body:** Replace 5+ hardcoded strings with `ftLabel` (n8n MCP update)
3. **WF06 Type B HE body:** Replace hardcoded strings with `ftLabel` (n8n MCP update)
4. **WF06 WhatsApp URLs:** Build dynamically in both Type A + B (n8n MCP update)
5. **view-documents.html:** JS updates `<title>` + `<h1>` from API response
6. **view-documents.js:** Dynamic empty-state message
7. **landing.js:** Fix Tally fallback + Base64 header flash

### Sprint 2: API Fixes + Fallback Labels (9C + 9D)
**Goal:** Fix functional bugs and silent AR defaults

Tasks:
8. **chat.ts:** Fix `filing_type` description in system prompt
9. **rollover.ts:** Add `filing_type` check to target year loop
10. **landing.js + view-documents.js:** Generic fallback labels
11. **admin script.js:** Console warning on missing `filing_type`

### Sprint 3: Internal/Cosmetic (9E + 9F + 9G)
**Goal:** Clean up internal-facing and low-visibility items

Tasks:
12. **WF07 digest:** Add filing_type label per client + fix footer
13. **Dashboard API:** Add optional `filing_type` query param
14. **Print footers:** Generic system name
15. **Privacy policy:** Broaden language
16. **SSOT CS generator:** Verify status

### Sprint 4: Tally + WF05 (Phase 10 + 11)
**Goal:** Complete CS pipeline end-to-end

Tasks (blocked on user actions):
17. User completes Tally form conditionals
18. EN form creation + key population
19. WF05 CS classification prompt
20. End-to-end test

---

## Stale Findings (removed from plan)

These were flagged in the audit but are no longer relevant:

| Audit ID | Finding | Why stale |
|----------|---------|-----------|
| C-01 | WF01 email hardcoded "שאלון דוח שנתי" | WF01 archived; Workers `send-questionnaires.ts` + `email-html.ts` already CS-aware |
| C-02 | WF01 confirmation page hardcoded | WF01 archived; admin panel handles confirmation now |
| W-10 | WF01 Airtable view may exclude CS | WF01 archived; Workers fetches by report ID directly |

---

## How to Activate Capital Statements

Once Sprints 1-3 complete and Tally forms are ready:

1. User adds conditional rules to HE form `7Roovz`
2. User duplicates HE -> EN form, provides new form ID
3. Agent populates EN keys + updates `FILING_CONFIG`
4. Agent adds CS classification prompt to WF05
5. Create a report record with `filing_type = 'capital_statement'` for a test client
6. Test the full pipeline: send questionnaire -> fill -> approve -> receive docs -> reminders
7. Verify all client-facing text shows "הצהרת הון" not "דוח שנתי"
