# Design Log 060: Reminder Type B Email — SSOT Document Display

**Status:** [COMPLETED]
**Date:** 2026-02-25
**Related Logs:** 059-automated-follow-up-reminder-system.md

## 1. Context & Problem

The [06] Reminder Scheduler's Type B email (missing documents) has completely inline document fetching and HTML generation that bypasses the SSOT star pattern. A client receiving the initial document request email (WF[03]) and then a reminder sees noticeably different formatting — no category grouping, no client/spouse separation, different styling. This violates the #1 Core Principle (Uniformity).

Additionally, the "Fetch Missing Docs" Code node contains a hardcoded Airtable PAT token — a security risk that bypasses n8n credential management.

## 2. User Requirements

1. **Q:** Should the reminder show full SSOT formatting (categories, emojis, client/spouse sections)?
   **A:** Yes — full SSOT formatting, identical to WF[03] client email.

2. **Q:** Should it call the Document Service or fetch directly from Airtable?
   **A:** Fetch from Airtable docs table (docs already generated). No need to re-generate.

3. **Q:** Should Type A emails (questionnaire reminder) change too?
   **A:** Keep Type A as-is. Focus on Type B only.

4. **Q:** How to handle credentials?
   **A:** Use the same Airtable node pattern as other workflows (managed credential).

## 3. Research

### Domain
Email template uniformity, SSOT rendering patterns, n8n workflow code reuse.

### Sources Consulted
1. **Postmark / Uplers / Sidemail — Transactional Email Best Practices** — Reminder emails should show the actionable doc list inline (don't force click-through). Use tone escalation (friendly/firm/urgent) with consistent rendering.
2. **Taxi for Email / Litmus / Mailmodo (Stripe analysis) — Email Design Systems** — One component library, one rendering function. Email types are configurations, not separate templates. Stripe uses a unified design system where all transactional emails inherit shared brand elements.
3. **n8n Docs — Sub-workflows & Code Reuse** — No built-in code library in n8n Cloud. Options: sub-workflow calls (free, but overhead per call), or embed code in Code nodes. Sub-workflows best for single calls; embedding better for batch processing.

### Key Principles Extracted
- **Show only missing docs** (pre-filter input data), not all docs with received struck through. Same rendering function, different data selection. Keeps the email action-oriented.
- **Single rendering path** — All surfaces must use the same `generateDocumentListHTML()` function. Change it once, changes everywhere.
- **Embed over sub-workflow for batch** — Calling Document Service 50+ times per batch (fetches categories each time = 150+ extra API calls) is wasteful. Embedding the 173-line display function is consistent with existing pattern.

### Patterns to Use
- **Pre-filter then render:** Filter docs to Required_Missing/Requires_Fix before passing to display function. Same SSOT rendering, context-appropriate data.
- **Node reference for parallel data:** Use `$('Filter Eligible')` in downstream Code node to recover report items "lost" by the Airtable Search node (which replaces input with its results).

### Anti-Patterns to Avoid
- **Inline HTML generation** (original state) — Different styling drifts from SSOT over time.
- **Embedding display functions in Code nodes** — Creates a second rendering path that diverges from Document Service. Violates Core Principle #2 ("Single Document Service").
- **Hardcoded API tokens in Code nodes** — Security risk, silent failure on rotation.

### Research Verdict
~~Initial verdict: embed display functions. WRONG — violates Core Principle #2.~~

**Corrected approach:** Call [SUB] Document Service (`hf7DRQ9fLmQqHv3u`) with `action: 'html_only'` — same pattern as WF[02] and WF[03]. The Document Service is the SINGLE rendering path. WF[06] fetches missing docs via Airtable Search, prepares input in Document Service format, calls it per-report, and wraps the returned `doc_list_html` in a tone-escalated email template.

## 4. Codebase Analysis

* **Canonical display function:** `github/annual-reports-client-portal/n8n/document-display-n8n.js` (173 lines) — `generateDocumentListHTML()`, `groupDocumentsByCategory()`, `separateClientAndSpouse()`, `renderDocLi()`
* **Document Service Generate HTML:** `[SUB] hf7DRQ9fLmQqHv3u` has table-based email builders (`wrapEmail()`, `documentRow()`, etc.). But the canonical `document-display-n8n.js` uses `<div>/<ul>/<li>` which is acceptable in most email clients. The doc list section gets wrapped in an email-safe `<table>` wrapper anyway.
* **WF[03] pattern:** Calls Document Service with `action: 'html_only'` → uses `client_email_html`. Not suitable for batch (50+ sub-workflow calls with redundant Airtable fetches).
* **Airtable Search field note:** `report_record_id` is a lookup field → returns array. `client_name`, `client_email` are lookups → also arrays. Must handle with `Array.isArray()` check.
* **Merge node bug risk:** Default Append mode waits for both inputs. If only Type A or only Type B exist, workflow hangs. Fix: `alwaysOutputData: true` on both Build nodes.
* **Existing credential:** `ODW07LgvsPQySQxh` (Airtable), `GcLQZwzH2xj41sV7` (MS Graph OAuth2) — same as other nodes in WF[06].

## 5. Technical Constraints & Risks

* **Security:** Remove hardcoded PAT `patvXzYx...` from Code node. Use Airtable Search node with managed credential.
* **Risks:** `$('Filter Eligible')` node reference must match exactly (spaces, case). Verify with workflow structure.
* **Performance:** Airtable Search fetches ALL missing docs (could be 500+ records across all reports). Acceptable for daily batch — paginated automatically by n8n.
* **Breaking Changes:** None — only changes the email HTML content. No API changes, no Airtable schema changes.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. **Search Due Reminders** → add `spouse_name`, `source_language` to field list
2. **Filter Eligible** → unchanged (adds `_tone`, `_type`, `_count`)
3. **Split by Type** → unchanged (A=true, B=false)
4. **[NEW] Search Missing Docs** (Airtable Search) → fetches ALL missing/requires_fix docs
5. **[REWRITE] Build Type B Email** (Code) → groups docs by report, renders with SSOT function, builds email
6. **Build Type A Email** → fix Array handling + alwaysOutputData
7. **Merge All Emails** → both inputs now have alwaysOutputData

### New "Search Missing Docs" Airtable Node
- Table: `tblcwptR63skeODPn`
- Credential: `ODW07LgvsPQySQxh`
- Formula: `AND(OR({status}='Required_Missing',{status}='Requires_Fix'),{review_status}!='pending_review')`
- Fields: issuer_name, issuer_name_en, status, person, category, fix_reason_client, report_record_id, document_key, type, template_id, issuer_key

### New "Prepare Type B Input" Code Node
Groups all missing docs by `report_record_id`, deduplicates, maps to Document Service format:
- `action: 'html_only'`, `source_language`, `client_name`, `spouse_name`
- `documents` array with fields matching Document Service expectations
- Passes through `_report_id`, `_email`, `_name`, `_tone`, `_count`, `_docs_total/received/missing`, `_questionnaire_token`

### New "Call Document Service" Execute Workflow Node
- Calls `hf7DRQ9fLmQqHv3u` with `mode: 'each'`, `source: 'database'`
- Uses `__rl` format for workflowId (typeVersion >= 1.1)
- Returns `doc_list_html` per report

### Simplified "Build Type B Email" Code (~80 lines)
```
1. Get doc_list_html from $input.all() (Document Service output)
2. Get report metadata from $('Prepare Type B Input').all() (index-matched)
3. Wrap in tone-escalated email template (header → greeting → progress → doc list → CTA → footer)
4. Output: {_report_id, _email, _subject, _html, _count}
```

### Email Template Structure (per email-design-rules.md)
```
[OUTER TABLE] 100% width, #f7f8fa bg
  [INNER TABLE] 600px, white bg, rounded corners
    [1] HEADER — tone-colored banner (blue R1, amber R2, red R3)
    [2] GREETING — "שלום {name}," (or English)
    [3] PROGRESS — "התקבלו {received} מתוך {total} מסמכים | חסרים: {missing}"
    [4] DOC LIST — generateDocumentListHTML() output (categories, emojis, client/spouse)
    [5] INSTRUCTIONS — "נא לשלוח מסמכים אל: reports@moshe-atsits.co.il"
    [6] FOOTER — firm name, contact
```

### Tone Colors
| Tone | Header BG | CTA BG | Subject prefix |
|------|-----------|--------|----------------|
| R1 friendly | `#2563eb` blue | `#2563eb` | `תזכורת:` |
| R2 firm | `#d97706` amber | `#d97706` | `תזכורת שנייה:` |
| R3 urgent | `#dc2626` red | `#dc2626` | `תזכורת אחרונה:` |

### n8n Operations (Final — 10 ops)
| # | Type | Node | Change |
|---|------|------|--------|
| 1 | updateNode | Search Due Reminders | Add spouse_name, source_language to fields |
| 2 | removeNode | Fetch Missing Docs | Delete Code node with hardcoded PAT |
| 3 | addNode | Search Missing Docs | New Airtable Search node |
| 4 | addConnection | Split by Type → Search Missing Docs | false branch |
| 5 | addNode | Prepare Type B Input | New Code node — groups docs, maps to service format |
| 6 | addConnection | Search Missing Docs → Prepare Type B Input | main |
| 7 | addNode | Call Document Service | Execute Workflow → hf7DRQ9fLmQqHv3u |
| 8 | addConnection | Prepare Type B Input → Call Document Service | main |
| 9 | addConnection | Call Document Service → Build Type B Email | main |
| 10 | updateNode | Build Type B Email | Simplified to ~80 lines (wraps doc_list_html) |
| 11 | updateNode | Build Type A Email | Fix Array handling + alwaysOutputData |

## 7. Validation Plan

* [ ] Manual send-now test: trigger for a test record with known missing docs
* [ ] Verify email has category grouping with emoji headers
* [ ] Verify client/spouse sections separated (test with married client)
* [ ] Verify bold dynamic values in titles
* [ ] Verify only missing/requires-fix docs shown
* [ ] Verify progress summary matches Airtable counts
* [ ] Verify tone escalation (set reminder_count=0, then 1, then 2)
* [ ] Verify Merge works when only Type B exists (no Type A)
* [ ] Verify no hardcoded PAT in any Code node
* [ ] Verify CTA button links to correct portal URL

## 8. Implementation Notes (Post-Code)

### Critical Course Correction
**Initial approach (WRONG):** Embedded 100+ lines of `document-display-n8n.js` display functions directly in the Build Type B Email Code node. Rationale was "batch efficiency" — avoid 50+ sub-workflow calls.

**User caught the violation:** WF[02] and WF[03] both call the [SUB] Document Service. Embedding display functions creates a second rendering path — exactly what Core Principle #2 prohibits.

**Corrected approach:** Added `Prepare Type B Input` (groups docs by report, maps to service format) → `Call Document Service` (Execute Workflow, mode: each) → simplified `Build Type B Email` (~80 lines, just email wrapper).

### Lesson Learned
**Always check how sibling workflows solve the same problem before designing a new approach.** The "embed for batch efficiency" argument was technically valid but architecturally wrong — uniformity > performance for a daily batch of <100 items.

### Final Node Topology (Type B path)
```
Split by Type (false)
  → Search Missing Docs (Airtable Search — managed credential)
    → Prepare Type B Input (Code — groups docs, maps to Document Service format)
      → Call Document Service (Execute Workflow → hf7DRQ9fLmQqHv3u)
        → Build Type B Email (Code — wraps doc_list_html in tone-escalated template)
          → Merge All Emails (input 1)
```

### Other Fixes Applied
- **Build Type A Email:** Fixed Array handling for `client_name`/`client_email` lookups + added `alwaysOutputData: true`
- **Search Due Reminders:** Added `spouse_name` and `source_language` fields
- **Search Missing Docs:** Added `document_key`, `type`, `template_id`, `issuer_key` fields (needed by Document Service)
- **Security:** Removed hardcoded Airtable PAT from deleted Code node
