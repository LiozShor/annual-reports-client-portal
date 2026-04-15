<p align="center">
  <img src="frontend/assets/images/logo.png" alt="Moshe Atsits CPA" width="320">
</p>

<h1 align="center">Annual Reports CRM</h1>

<p align="center">
  Tax document collection automation for <strong>Moshe Atsits CPA Firm</strong> (500+ clients)
</p>

<p align="center">
  <a href="https://docs.moshe-atsits.com">Client Portal</a> &middot;
  <a href="https://docs.moshe-atsits.com/admin">Admin Panel</a>
</p>

---

## What It Does

Replaces a fully manual tax document collection process with end-to-end automation:

1. **Questionnaires** — Bulk-send dynamic Tally questionnaires to clients. Follow-up questions adapt based on answers.
2. **Document Generation** — Auto-generates each client's required document list from questionnaire answers (SSOT module).
3. **Inbound Processing** — AI classifies emailed documents, matches them to requirements, files to OneDrive, updates status.
4. **Automated Reminders** — Monthly follow-ups for missing questionnaires and incomplete documents.
5. **Admin Dashboard** — Real-time overview of all clients, stages, AI review queue, reminders, and messaging.
6. **Client Portal** — Bilingual (Hebrew/English) portal where clients view their document status and upload files.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **API** | Cloudflare Workers (TypeScript) |
| **Frontend** | Static HTML/CSS/JS on GitHub Pages |
| **Database** | Airtable |
| **Automation** | n8n Cloud (scheduled jobs, document service) |
| **AI Classification** | Claude API (Anthropic) |
| **Email** | Microsoft Graph API (Office 365) |
| **File Storage** | Microsoft OneDrive |
| **Forms** | Tally (bilingual questionnaires) |

## Project Structure

```
.
├── api/                        # Cloudflare Workers API
│   └── src/
│       ├── index.ts            # Router + middleware
│       ├── routes/             # 27 API endpoints
│       └── lib/                # Shared utilities
│           └── inbound/        # Email processing pipeline
│
├── frontend/                   # GitHub Pages (deployed on push to main)
│   ├── index.html              # Client landing page
│   ├── view-documents.html     # Client document viewer
│   ├── document-manager.html   # Office document editor
│   ├── admin/                  # Admin dashboard (SPA)
│   │   ├── js/script.js        # Main admin logic
│   │   └── css/style.css       # Admin styles
│   ├── assets/                 # CSS, JS, fonts, images
│   ├── shared/                 # Constants, endpoints, utils
│   └── n8n/                    # SSOT modules (mirrored in n8n Code nodes)
│
├── docs/                       # Architecture, schemas, research
│   ├── architecture/           # Mermaid diagrams (system, email, docs, portal)
│   ├── airtable-schema.md      # Full database schema
│   ├── architecture.md         # System architecture reference
│   └── ui-design-system.md     # Frontend design system
│
├── SSOT_required_documents_from_Tally_input.md   # Document templates (34 types)
├── SSOT_CS_required_documents.md                 # Capital statements templates
└── CLAUDE.md                                     # AI assistant operating manual
```

## Key Concepts

**SSOT (Single Source of Truth)** — Document names, titles, and wording come from one place. What the office sees = what the client receives = what the admin panel shows. No divergence.

**8-Stage Pipeline** — Each client progresses through: Send Questionnaire > Waiting for Answers > Pending Approval > Collecting Docs > Review > Moshe Review > Before Signing > Completed.

**Bilingual** — All client-facing surfaces support Hebrew and English. Hebrew-first for Hebrew speakers, bilingual for English speakers.

## Development

**Prerequisites:** Node.js 18+, Wrangler CLI (for Workers)

```bash
# API (Cloudflare Workers)
cd api
npm install
npx wrangler dev              # Local dev server on :8787

# Frontend (static files)
# Served via GitHub Pages — just push to main
# For local dev, use any static server:
npx serve frontend
```

**Environment:** Secrets are managed via `wrangler secret put` (Workers) and `.env` (local). See `api/wrangler.toml` for the full list of required secrets.

## License

Private repository. All rights reserved.
