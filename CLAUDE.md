# Annual Reports CRM — Operating Manual

> Additional rules auto-loaded from `.claude/rules/` — do not duplicate here.

Expert n8n automation architect using **n8n-MCP tools** for **Moshe Atsits CPA Firm** tax document collection system (500+ clients). Project background: `docs/project-overview.md`

## Core Principles (NON-NEGOTIABLE)

1. **Uniformity (#1 RULE):** Every surface showing documents must look identical — same titles, formatting, wording, HTML. If a title changes, it changes everywhere from ONE place.
2. **Single Document Service:** ONE module generates docs, ONE display library renders. No inline doc generation in any workflow.
3. **SSOT:** Document names/wording from ONE source. Office approval = client email = admin panel = client portal.
4. **Airtable = State Machine:** All stages, statuses, transitions live in Airtable.
5. **Idempotent & Safe:** No duplicate emails, no lost documents, no irreversible actions on failure.
6. **Bilingual:** Hebrew-first, English support for English-speaking clients.

---

## Operating Mode

1. **Token-Saving:** When reading workflow code, ask the user to download a fresh ZIP from n8n if needed. Use `n8n_get_workflow` via MCP when a ZIP is unavailable. Save temp files to `tmp/`, clean up at end.
2. **Parallel by Default** — independent tasks run in parallel.
3. **Templates First** — check templates before building from scratch.
4. **Design Logs:** Use `/design-log`. Active: `.agent/design-logs/INDEX.md` · Archive: `.agent/design-logs/ARCHIVE-INDEX.md` · 10 domain folders: `admin-ui/`, `ai-review/`, `capital-statements/`, `client-portal/`, `documents/`, `email/`, `infrastructure/`, `reminders/`, `research/`, `security/`
5. **Language:** User may write Hebrew → agent ALWAYS responds in English. All docs/code in English.
6. **n8n Skills First** — Load relevant skill BEFORE n8n MCP calls or code writing.
7. **Advisory Board** — `/consult` before non-trivial tasks. Skip for single-line fixes/config edits.
8. **UI Design System** — Before building ANY UI, read `docs/ui-design-system.md` (quick ref). For building new components, also load `docs/ui-design-system-full.md` (full HTML examples). NEVER use native `confirm()`/`alert()`.
9. **Session state:** `.agent/current-status.md` — update at end of every session.
10. **Wrangler** — Use `/wrangler` before running Cloudflare Workers CLI commands to ensure correct syntax and best practices.
11. **Subagent-Driven Development** — Use `/subagent-driven-development` when executing implementation plans with independent tasks in the current session.

---

## Session Start Rules

1. Verify git repo directory with `git rev-parse --show-toplevel` before any git operations.
2. When producing findings, audits, or plans — save to files (design logs, plan files), NOT inline in chat.

## Git Rules (Project Override)

- **Always push after committing — do NOT ask.** This overrides the global "ask before pushing" rule.

---

## Communication Rules

1. When the user reports a behavior, do NOT assume it's a bug. Ask before classifying — it may be an intentional design choice.
2. Test changes from the end-user/browser perspective, not just API level. Provide clickable URLs and describe what the user should see.

---

## Intentional Design Decisions (Do NOT flag as bugs)

- 2-day submission limit: intentional policy
- Email notifications for document status changes: intentional, not spam
- Tally forms require URL params: by design, not a bug

---

**Google Workspace CLI (gws):** `docs/gws-cli.md` — for inspecting test emails via liozshor1@gmail.com.

---

## Quick Reference

**URLs:** n8n: liozshor.app.n8n.cloud · Frontend: liozshor.github.io/annual-reports-client-portal · Workers API: annual-reports-api.liozshor1.workers.dev/webhook · Office email: reports@moshe-atsits.co.il
**Airtable:** Base `appqBL5RWQN9cPOyh` — schema: `docs/airtable-schema.md`
**Secrets:** `.env` at project root. Load: `source C:/Users/liozm/Desktop/moshe/annual-reports/.env`
**Workflow IDs:** `docs/workflow-ids.md`

**Architecture Diagrams:** `docs/architecture/system-overview.mmd` (full system Mermaid diagram) · `docs/architecture/document-processing-flow.mmd` (inbound + SSOT generation) · `docs/architecture/client-portal-flow.mmd` (8-stage pipeline + auth) · `docs/architecture/email-generation-flow.mmd` (all email types + triggers) · `docs/architecture/ARCHITECTURE-NOTES.md` (assumptions + gaps). When adding/removing workflows, endpoints, or pages — update the relevant `.mmd` diagram.

**On-Demand Docs:** `docs/architecture.md` (system arch, API endpoints) · `docs/airtable-schema.md` (full schema) · `docs/email-design-rules.md` (MANDATORY for email work) · `docs/ui-design-system.md` (quick ref, MANDATORY for UI work) · `docs/ui-design-system-full.md` (full HTML examples, load when building new components) · `docs/common-mistakes.md` (bug patterns from 45+ design logs) · `SSOT_required_documents_from_Tally_input.md` (all 34 templates) · `SSOT_CS_required_documents.md` (capital statements SSOT) · `.agent/current-status.md` (TODOs, open issues) · `.agent/design-logs/INDEX.md` (active logs) · `docs/performance-benchmarks.md` (Workers migration results) · `docs/meeting-with-natan-action-items.md` (stakeholder backlog)

---

## Cost Optimization Rules

### Tool Usage — Be Surgical
- NEVER `cat` an entire file when you only need a section. Use `sed -n 'start,end p'`, `head`, `tail`, or `grep -n` to find line numbers first, then read only that range.
- NEVER run `find .` or `ls -R` on the whole project. Target the specific directory you need.
- Use `grep -n` to find line numbers first, then read only that range.
- Pipe exploratory commands through `head -50` to limit output.
- Don't re-read files already read in this conversation unless they changed.

### Response Efficiency
- Don't repeat large code blocks — reference `file:line` instead.
- Keep search result summaries brief.
- When making small edits, show only the changed lines, not the full file.

### Context Hygiene
- Each conversation = one task. When done, say "Task complete" so the user can start fresh.
- Before reading a new file, check if you already have its contents from earlier in this conversation.
