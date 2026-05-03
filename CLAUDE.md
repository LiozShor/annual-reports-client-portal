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
7. **Silent Refresh After Mutation:** Any add/edit/delete/modify that writes to Airtable (or any persisted state) MUST trigger an in-place silent refetch of every affected UI surface (admin list + detail, client portal, mobile + desktop). No full page reload, no flicker, no scroll jump, no "refresh to see changes" instructions. The user must always see up-to-date data.

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
12. **Monthly insights:** GitHub issue auto-opens on the 1st (workflow `monthly-audit.yml`, label `agentic-audit`) → run `/monthly-insights` skill → commit to `.agent/insights-audits/`.
13. **Restate-and-wait (P2 / AUDIT-2026-05-02):** Before writing a plan or touching files for any non-trivial task, restate (1) exact problem, (2) files/systems to modify, (3) success criteria, (4) context needed from user (IDs, URLs, creds). Then **wait for explicit "go"** before editing. Skip only for single-line fixes, config tweaks, or when the user already supplied all four.

---

## Monolith Size Ratchet (HARD RULE)

`frontend/admin/js/script.js` and `frontend/admin/js/chatbot.js` are on a one-way
size ratchet enforced by `.claude/hooks/script-size-ratchet.py` (pre-commit) and
the `size-ratchet` job in `.github/workflows/check.yml` (CI).

**The baseline in `.claude/script-size-baseline.json` is APPEND-ONLY-DOWN.** It
can only shrink. There is **no override**. The ratchet hook actively rejects
any commit that bumps a baseline number upward.

### When the ratchet blocks you

- Do **NOT** edit `.claude/script-size-baseline.json` to make the error go away.
- Do **NOT** ask the user "can I raise the limit?" — that option does not exist.
- The fix is one of:
  1. Extract the new code into `frontend/admin/js/modules/<feature>.js` and
     `import` it from the monolith. See `frontend/admin/js/modules/README.md`.
  2. Build the feature as a React island under `frontend/admin/react/`.
  3. Delete unused code from the monolith first to free up the budget.
- If none of these are possible, **STOP** and report the situation to the user
  factually — do not propose a baseline bump as the solution.

Bump `?v=NNN` in `frontend/admin/index.html` after touching any admin JS file
so browsers don't serve a stale cached module.

## Duplicate-Path Audit (P1 / AUDIT-2026-05-02)

When fixing a UI / render / formatting / state bug, **before patching**:

1. Grep the symptom or affected symbol across ALL parallel surfaces:
   - `frontend/admin/` (admin panel)
   - `frontend/client-portal/` (client-facing)
   - `frontend/n8n/` and email HTML templates
   - Any React island under `frontend/admin/react/`
2. List every site that renders the same data/symptom.
3. Patch all of them in **one commit** — do not ship a partial fix.

Background: Buggy Code +13%/msg in 2026-05-02 audit driven by first-pass fixes that miss duplicate render paths (timestamp bug fixed in admin but not AI-review page; queue stale-state needed two follow-ups). Reinforces global CLAUDE.md "Check Duplicate Rendering / Logic Code".

## Secret-Audit Safety (P0 / AUDIT-2026-05-02)

When auditing for secrets, NEVER paste the actual value into any tracked file
(.md, .ts, .json, .agent/**, docs/**). The audit's job is to point AT the secret,
not contain it.

Allowed in audit docs:
  - file path + line number (`api/src/lib/x.ts:42`)
  - **first 4 chars only** of a known prefix (`pat2…`, never `pat2XQGRyzPdycQWr`)
  - the var NAME (`CLIENT_SECRET_KEY`, `AIRTABLE_PAT`)
  - a stable hash if cross-referencing is needed (`sha256:abc…`)

Forbidden:
  - secrets in backticks, code fences, table cells, or quoted strings
  - "(plaintext)" / "(plaintext in Code node)" markers next to a value
  - >12 consecutive hex/base64 chars from any real key

Background: 2026-05-02 leak in `docs/multi-tenant-audit.md` exposed admin password,
HMAC secret, Airtable PAT prefixes, Anthropic key prefix in plaintext Markdown
table cells. AI-assisted audit doc was committed without review. Existing gitleaks
/ pii-guard / TruffleHog defenses missed it because they target KEY=value shapes,
not Markdown table cells with adjacent "plaintext" markers.

## Silent UI Refresh After DB Mutation (P6 / AUDIT-2026-05-02)

Every add/edit/delete that hits Airtable or Workers state must trigger an **in-place refetch** so the UI shows up-to-date data immediately. Never instruct the user to reload the page. This applies to admin panel, client portal, and React islands. Confirmed top-wins pattern — promoted from MEMORY.md to project rule.

---

## Session Start Rules

1. Verify git repo directory with `git rev-parse --show-toplevel` before any git operations.
2. When producing findings, audits, or plans — save to files (design logs, plan files), NOT inline in chat.

## Git Rules (Project Override)

- **Always push after committing — do NOT ask.** This overrides the global "ask before pushing" rule.
- **MANDATORY: invoke `git-ship` skill before any git write op.** `commit`, `push`, `merge`, `rebase`, `reset`, `branch -d`, `checkout main` — all routed through the skill. Read-only ops (`status`, `diff`, `log`, `show`, `branch --show-current`) don't need it. The skill enforces multi-tab safety, worktree-aware merges (cd to canonical clone, never `checkout main` from a session worktree), and conflict-prone-file handling.

## Debugging — Autonomous Log Access

When investigating a bug or unexpected Worker behavior, Claude can pull logs directly without asking:

- **Live tail:** `wrangler tail -c wrangler.toml` (run from `api/`, background Bash for monitoring) — catches events while streaming.
- **R2 archive (historical, primary):** Use AWS CLI against the S3 API — `source ~/Desktop/moshe/annual-reports/.env` then `AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto aws s3 ls s3://activity-logs-archive/ --endpoint-url=$R2_S3_ENDPOINT --recursive`. Filter NDJSON with `gunzip -c <file> | jq 'select(.event_type=="...")'`. 90d retention; ~5min Logpush latency.
- **Pass `-c wrangler.toml` explicitly** when using wrangler (avoid autoconfig-hijack bug).
- **Historical hot-tier (last 7d) is NOT queryable from CLI** — Workers Logs dashboard only. If repeated need arises, propose adding a `/admin/logs/query` Worker endpoint (Automation Reflex).
- Use `logEvent()` filters (`event_type`, `category`, `client_id`) when grepping NDJSON archives — same shape as `api/src/lib/activity-logger.ts`.

---

## Communication Rules

1. When the user reports a behavior, do NOT assume it's a bug. Ask before classifying — it may be an intentional design choice.
2. Test changes from the end-user/browser perspective, not just API level. Provide clickable URLs and describe what the user should see.

## Failure Postmortem Rule

When you hit an error, bug, or repeat the same failed action 2+ times in a session — **STOP**. Don't keep retrying. Do this:

1. State the root cause in one sentence.
2. Decide a concrete prevention rule (a check, a guardrail, a memory entry, a CLAUDE.md update, a hook, a permission rule, or a verification step that would have caught it).
3. Apply that rule now: write it to `MEMORY.md` (+ memory file), add it to `CLAUDE.md`, or update `.agent/current-status.md` — wherever it'll fire next time.
4. Tell the user what you did so they can confirm or adjust.

Repetitive failures (same tool denied twice, same arg-parsing bug, same env-var typo) are the signal — never silently retry a third time.

## Automation Reflex Rule (חיכוך = friction)

When you notice yourself (or the user) doing the **same multi-step thing 2+ times** — STOP and propose automation. Less friction = better. Triggers:

- Same shell command typed twice with minor variations
- Same multi-tool sequence (e.g. read→edit→bash→verify) repeated for similar tasks
- User pastes / re-runs a `! command` you proposed (means a permission rule or hook is missing)
- Manual verification step that could be a hook, npm script, or skill

What to do:

1. Name the friction in one sentence ("we keep registering MCPs by hand", "we keep fixing cache-bust versions").
2. Propose the automation: a hook (`.claude/settings.json`), a skill, an npm script, a CLAUDE.md rule, an allow/deny permission rule, or a one-shot setup script. Pick the lightest mechanism that kills the repetition.
3. Apply it now (or ask once if it touches shared/destructive surface), then confirm to the user what was wired up.

Anti-pattern: re-typing the same command in three sessions and never installing an alias/hook for it.

---

## Intentional Design Decisions (Do NOT flag as bugs)

- 2-day submission limit: intentional policy
- Email notifications for document status changes: intentional, not spam
- Tally forms require URL params: by design, not a bug

---

**Google Workspace CLI (gws):** `docs/gws-cli.md` — for inspecting test emails via liozshor1@gmail.com.

---

## Quick Reference

**URLs:** n8n: liozshor.app.n8n.cloud · Frontend: docs.moshe-atsits.com (Cloudflare Pages) · Workers API: annual-reports-api.liozshor1.workers.dev/webhook · Office email: reports@moshe-atsits.co.il
**Airtable:** Base `appqBL5RWQN9cPOyh` — schema: `docs/airtable-schema.md`
**Secrets:** `.env` at project root. Load: `source C:/Users/liozm/Desktop/moshe/annual-reports/.env`
**Workflow IDs:** `docs/workflow-ids.md`
**Workflows (repeat sequences):** `.claude/workflows/deploy-worker.sh` · `.claude/workflows/merge-and-push.sh` · `.claude/workflows/close-design-log.sh`
- **Merging to main:** run `bash .claude/workflows/merge-and-push.sh <branch>` from the canonical clone (canonical = `C:/Users/liozm/Desktop/moshe/annual-reports/`, NOT a session worktree).
- **Closing a DL:** run `bash .claude/workflows/close-design-log.sh <NNN>` — patches status in DL file + INDEX.md, runs PII guard, stages files.
- **Deploying Worker:** run `bash .claude/workflows/deploy-worker.sh` — clears stale token, passes `-c wrangler.toml`, verifies health endpoint.

**Architecture Diagrams:** `docs/architecture/system-overview.mmd` (full system Mermaid diagram) · `docs/architecture/document-processing-flow.mmd` (inbound + SSOT generation) · `docs/architecture/client-portal-flow.mmd` (8-stage pipeline + auth) · `docs/architecture/email-generation-flow.mmd` (all email types + triggers) · `docs/architecture/ARCHITECTURE-NOTES.md` (assumptions + gaps). When adding/removing workflows, endpoints, or pages — update the relevant `.mmd` diagram.

**On-Demand Docs:** `docs/architecture.md` (system arch, API endpoints) · `docs/airtable-schema.md` (full schema) · `docs/email-design-rules.md` (MANDATORY for email work) · `docs/ui-design-system.md` (quick ref, MANDATORY for UI work) · `docs/ui-design-system-full.md` (full HTML examples, load when building new components) · `docs/common-mistakes.md` (bug patterns from 45+ design logs) · `SSOT_required_documents_from_Tally_input.md` (all 34 templates) · `SSOT_CS_required_documents.md` (capital statements SSOT) · `.agent/current-status.md` (TODOs, open issues) · `.agent/design-logs/INDEX.md` (active logs) · `docs/performance-benchmarks.md` (Workers migration results) · `docs/meeting-with-natan-action-items.md` (stakeholder backlog)

**React Islands:** Source at `frontend/admin/react/` (Vite + React 18 + TS strict). Built output at `frontend/admin/react-dist/` (committed). See `frontend/admin/react/README.md` for dev/build/test commands and island bridge contract.

**Activity Logger (DL-365):** Cloudflare-native logger replacing Airtable `security_logs`. Use `logEvent({event_type, category, ...})` from `api/src/lib/activity-logger.ts` for ALL activity logs (auth, inbound, AI, admin actions, errors). PII-safe by default — sanitization in `api/src/lib/pii.ts` (drop names/emails/phones; pass `client_id` only). External callers POST to `/webhook/events` (admin token / `X-N8N-Key` / client HMAC). Logs land in CF Workers Logs (7d hot, queryable in dashboard) + Logpush → R2 `activity-logs-archive` (90d archive). Do NOT add new Airtable `security_logs` writes. Phase 1 live; Phases 2-4 pending. Design log: `.agent/design-logs/infrastructure/365-activity-logger.md`.

**React-First for New Features (default):** When proposing or implementing a NEW feature, default to a React island if it involves a form with 2+ fields, data fetching + mutation, complex UI state (tabs, inline editing, multi-step flows), or anything that warrants unit tests. Stay in vanilla `script.js` only for trivial additions (button wired to existing fn, wording tweaks, CSS-only changes, quick fixes to existing vanilla flows). **Never rewrite working vanilla code just to "be in React"** — Strangler Fig principle: new growth in React, touch the old only when you have to.

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
