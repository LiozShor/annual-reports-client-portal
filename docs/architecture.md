# Annual Reports CRM — Architecture Reference

Load this file on-demand when working on architecture, system design, or debugging data flow.

---

## Technology Stack

| Component | Technology | Location |
|-----------|------------|----------|
| Automation | n8n Cloud | liozshor.app.n8n.cloud |
| Database | Airtable | Base appqBL5RWQN9cPOyh |
| Forms | Tally | Bilingual (HE/EN) |
| Email | Microsoft Graph API | Office 365 |
| Frontend | GitHub Pages | liozshor.github.io/annual-reports-client-portal |

---

## SSOT Uniformity Architecture

**The problem this solves:** Documents appear in multiple places — office notification email, client-facing email, admin document manager, client web portal. If each place has its own formatting/generation logic, they WILL diverge.

**The rule:** There is ONE document generation pipeline and ONE display library. Every surface that shows documents MUST use them:

```
Questionnaire Answers
        ↓
[Document Service] — SINGLE generator (SSOT rules + templates)
        ↓
Document List (structured data)
        ↓
[Display Library] — SINGLE formatter (HTML rendering)
        ↓
  ┌─────────────┬──────────────┬──────────────┬─────────────┐
  ↓             ↓              ↓              ↓             ↓
Office Email  Client Email  Admin Panel  Client Portal  Reminders
  (ALL identical titles, formatting, wording, grouping)
```

**Consumers and what they use:**

| Surface | Generation | Display | Source |
|---------|-----------|---------|--------|
| Workflow [02] office email | Document Service sub-workflow | display library (n8n) | Same |
| Workflow [03] client email | — (docs from Airtable) | display library (n8n) | Same |
| Workflow [04] edit handler | — (docs from Airtable) | display library (n8n) | Same |
| view-documents.html | — (docs from API) | display library (browser) | Same |
| document-manager.html | — (docs from API) | display library (browser) | Same |
| Future reminders | — (docs from Airtable) | display library (n8n) | Same |

---

## Document Generation Architecture (Airtable-First)

```
Airtable (SINGLE SOURCE OF TRUTH)
  ├── documents_templates  (33 templates — titles, scopes, variables)
  ├── question_mappings    (60 rules — tally_key → template_id, conditions)
  └── categories           (8 categories — emoji, sort order, HE/EN names)
         ↓
  n8n Workflow [02] reads these tables → generates documents → writes to:
         ↓
  ├── documents table      (generated document records per client)
  └── All consumers read from documents table + templates:
       ├── Office email (workflow [02])
       ├── Client email (workflow [03])
       ├── Admin panel (document-manager.html)
       └── Client portal (view-documents.html)
```

---

## Two Separate Codebases (CRITICAL)

The document generation logic exists in **two independent copies** that must be kept in sync:

| Codebase | Location | Used By | How to Update |
|----------|----------|---------|---------------|
| **n8n Code nodes** | `[SUB] Document Service` (hf7DRQ9fLmQqHv3u) — "Generate Documents" and "Generate HTML" nodes | n8n workflows (emails, document upserts) | `n8n_update_partial_workflow` with `updateNode` |
| **GitHub Pages JS** | `frontend/n8n/` — `workflow-processor-n8n.js`, `questionnaire-mapping.json`, `ssot-document-generator.js` | Web frontend (view-documents.html, document-manager.html) | Git commit + push |

**The n8n Document Service does NOT fetch JS from GitHub Pages.** All business logic is embedded directly in n8n Code nodes. Config (templates, mappings, categories) is read from Airtable tables at runtime.

**When fixing document generation bugs:**
- Airtable changes (question_mappings, templates) → take effect immediately in both codebases
- n8n Code node changes → require `n8n_update_partial_workflow` on the Document Service
- GitHub JS changes → only affect the web frontend, NOT the n8n workflow
- **Always update BOTH** if the fix involves generation logic (not just Airtable config)

---

## HTML Generation Map

**Email design rules:** `docs/email-design-rules.md` — MANDATORY reference when modifying any email HTML generation code.

All email HTML is generated in **`[SUB] Document Service`** (hf7DRQ9fLmQqHv3u):

| HTML Section | Node | What it does |
|-------------|------|-------------|
| Document list (which docs to create) | **"Generate Documents"** Code node | Business logic: mappings → document array with titles, types, categories |
| Office email (full) | **"Generate HTML"** Code node | Assembles: header + summary box + action buttons + questionnaire table + document list |
| Questionnaire answers table | **"Generate HTML"** → `buildQuestionnaireTable()` | Iterates `answers_by_key`, formats values (arrays→`<br>`, booleans→✓/✗), skips hidden fields |
| Action buttons (approve/edit) | **"Generate HTML"** → `generateActionButtons()` | Approve & Send + Edit Documents buttons with URLs |
| Document list HTML (grouped by category) | **"Generate HTML"** → `generateDocListHtml()` | Groups docs by category, separates client/spouse, renders as `<ul>` lists |
| Client email | **"Generate HTML"** → bottom section | Same doc list HTML but without questionnaire table or action buttons |

**Workflow [02]** nodes do NOT generate HTML:
- **"Extract & Map"** — extracts answers from Airtable, maps tally keys → `answers_by_key`
- **"Prepare Email"** — just passes through `office_email_html` and `client_email_html` from Document Service
- **"MS Graph - Send Email"** — sends via Microsoft Graph API

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /webhook/check-existing-submission | GET | Check if report has submission |
| /webhook/reset-submission | GET | Delete docs, reset stage |
| /webhook/get-client-documents | GET | Categorized doc list for client |
| /webhook/get-documents | GET | Flat list for office UI |
| /webhook/tally-questionnaire-response | POST | Process Tally submission |
| /webhook/tally-edit-documents | POST | Process office edits |
| /webhook/approve-and-send | GET | Send final email to client |
| /webhook/get-pending-classifications | GET | Pending AI classifications for review |
| /webhook/review-classification | POST | Approve/reject/reassign a classification |

---

## Web Interfaces

- **index.html** (Landing): URL params → check submission → language selection or view docs
- **view-documents.html** (Client Viewer): bilingual toggle, emoji categories, status badges
- **document-manager.html** (Office Editor): list docs, mark waived, add from dropdown, custom input, notes

---

## Main Workflows

1. **[01] Questionnaire Sending** — Bulk send questionnaires to clients
2. **[02] Response Processing** — Airtable Trigger → generate docs → office email
3. **[03] Office Approval** — Review + edit → client email
4. **[04] Document Edit Handler** — Office edits → update docs
5. **[05] Inbound Document Processing** — Email → AI classify → OneDrive upload

---

## Custom Skills & Tools

| Command / Tool | Description | Location |
|---------|-------------|----------|
| `/design-log` or `/design` | Start the "Stop & Think" protocol for design-first development | `.claude/skills/design-log.md` |
| `/consult` | Expert advisory board — spawns parallel expert agents for independent analysis | `.claude/skills/consult/` |
| `/airtable` | Read/write Airtable data via Python pyairtable | `.claude/skills/airtable/` |
| n8n-MCP | Manage n8n workflows (create, update, validate, test) | MCP server |

### Airtable Access

Agent has direct Airtable access via the `/airtable` skill (pyairtable + API key).
Use this to read/write records, inspect schema, and verify data — instead of guessing or hardcoding.

**When to use Airtable directly:**
- Verify what data actually looks like (don't assume)
- Check if records exist before creating duplicates
- Inspect table structure when building/modifying workflows
- Validate that workflow outputs match expected Airtable format

---

## Execution Reliability Rules

- **Webhooks:** Acknowledge fast to prevent retries
- **Idempotency:** Use upsert keys (report + type + issuer_key)
- **Airtable:** Sequence dependent operations
- **Logging:** report_id, client email, stage transition, doc counts

## n8n-MCP Workflow Process

0. **Load Skills First** — BEFORE any n8n MCP call or code writing, invoke the relevant skill
1. **Template Discovery** - search_templates() first
2. **Node Discovery** - search_nodes(includeExamples=true)
3. **Configuration** - get_node(detail="standard", includeExamples=true)
4. **Validation** - validate_node(), validate_workflow()
5. **Build** - Explicit params, error handling, standard nodes over Code
6. **Full Validation** - validate_workflow()
