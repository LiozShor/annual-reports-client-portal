# Annual Reports CRM — Project Overview

**Client:** Moshe Atsits CPA Firm (500+ clients)
**Purpose:** Tax Document Collection Automation System
**Year:** 2025 tax season

---

## The Problem (Manual Process Today)

The firm's 500+ clients each need to submit tax documents annually. Currently this is entirely manual:
1. Staff manually emails ~600 clients a questionnaire
2. Clients respond; staff manually maps answers → required documents
3. Staff emails clients the list of required documents
4. Clients send documents back over weeks/months (not in one batch — drip-fed via email)
5. Staff manually tags and files each document into client-specific OneDrive folders
6. Staff sends monthly reminders for missing questionnaires or incomplete documents
7. This cycle repeats for months until all documents are collected

---

## The Automated System (What We're Building)

An end-to-end automation that replaces every manual step:

**Phase 1 — Questionnaire & Document Matching (✅ Built)**
- One-click bulk send of dynamic Tally questionnaires to all clients
- Questionnaire adapts follow-up questions based on client answers
- System auto-generates the required documents list from answers (SSOT module)
- Office reviews/edits the document list → confirms → system emails client
- Single Source of Truth (SSOT): what office sees = what client receives (titles, wording, everything)
- All state tracked in Airtable (stages 1-5, document statuses, completion %)

**Phase 2 — Inbound Document Processing (✅ Complete)**
- When clients email documents back: system reads the email + attachments
- AI classifies each document → matches it to the required document list
- Auto-tags document status as "Received" in Airtable
- Auto-files document into the correct client OneDrive folder
- Updates completion percentage automatically
- Migrated from n8n WF[05] to Cloudflare Workers (March 2026).
- **Sample documents:** `docs/Samples/` contains 20 real tax documents (PDFs, DOCX, XLSX) representative of what clients will send. Use these when developing/testing classification, prompt engineering, and E2E testing.

**Phase 3 — Automated Follow-ups (✅ Complete)**
- Monthly automated reminders to clients who haven't filled the questionnaire
- Monthly automated reminders for clients with missing/incomplete documents
- Smart reminder content based on what's actually missing per client

---

## Folder Organization

```
annual-reports/                              # Project root (NOT a git repo)
├── CLAUDE.md                                # Operating manual (concise)
├── SSOT_required_documents_from_Tally_input.md  # Document generation rules & templates
├── .env                                     # Secrets: Airtable API key, Anthropic key (gitignored)
├── .mcp.json                                # n8n MCP server config (API URL + key)
├── .gitignore
│
├── experts/                                 # Advisory board — expert consultants
│   ├── BOARD.md                             # Router: expert list, routing rules, protocol
│   ├── yuki.md, amara.md, renzo.md          # Visual, UX, Frontend
│   ├── kofi.md, priya.md, tomas.md          # Resilience, Data, Debugging
│   └── noa.md, zara.md                      # Content, Security
│
├── .agent/                                  # Agent state & history
│   ├── current-status.md                    # Live session tracking, TODOs, workflow IDs
│   ├── session-memories.md                  # Historical session archive
│   ├── design-logs/                         # 45+ design decision logs (000-045)
│   └── archive/                             # Superseded/completed work notes
│
├── .claude/
│   └── settings.local.json                  # Permissions & MCP server config
│
├── docs/
│   ├── project-overview.md                  # THIS FILE — project background & vision
│   ├── architecture.md                      # System architecture, HTML map, API endpoints
│   ├── airtable-schema.md                   # Full Airtable schema (tables, fields, relationships)
│   ├── email-design-rules.md                # Email HTML design rules (MANDATORY for emails)
│   ├── openai-classification-research.md    # AI classification approach research
│   ├── wf05-gap-analysis-and-improvements.md
│   ├── document-classification-research/    # 6 research files (00-overview → 05-cost-estimates)
│   └── Samples/                             # 20 real sample tax docs (PDFs, DOCX, XLSX)
│
├── archive/                                 # Old questionnaire PDFs, Tally payload, legacy refs
├── tmp/                                     # Session temp files (clean up at end of session)
│
└── frontend/                                # GitHub Pages site (deployed via GitHub Actions)
        ├── index.html                       # Landing page (URL params → submission check)
        ├── view-documents.html              # Client document viewer (bilingual, status badges)
        ├── document-manager.html            # Office document editor (waive, add, notes)
        ├── questionnaire-mapping.js         # Tally field mappings (browser version)
        ├── questionnaire-mapping.json       # Same mappings as JSON
        │
        ├── admin/                           # Admin panel
        │   ├── index.html                   # Dashboard (stats, review queue, bulk actions)
        │   ├── document-types-viewer.html   # Template browser
        │   ├── questionnaire-mapping-editor.html
        │   ├── css/style.css
        │   └── js/script.js
        │
        ├── assets/
        │   ├── css/                         # design-system.css (tokens), common.css, + 3 page CSS
        │   └── js/                          # landing.js, view-documents.js, document-manager.js
        │
        └── n8n/                             # SSOT modules (n8n Code node source files)
            ├── ssot-document-generator.js   # Core SSOT implementation (534 lines, 34 templates)
            ├── document-display-n8n.js      # n8n HTML display library
            ├── workflow-processor-n8n.js     # Core document processor
            ├── orchestrator.js              # Workflow orchestration logic
            ├── email-prep.js                # Email preparation helpers
            └── generate-mapping-json.js     # Mapping JSON generator utility
```
