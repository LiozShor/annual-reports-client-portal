# Telegram Ops Bot — Roadmap

This is the longer view for `@MosheAtsitsOpsBot`. One paragraph per phase. Don't expand a phase into a spec until it's the next one to ship — premature detail rots faster than it informs.

Last updated: 2026-05-05.

## Phase 1 — Foundation (current)

- M1 read-only bot: ✅ live (DL-402, Worker `ba5f96e6`, 4 read tools, internal users only).
- Reply quality structural fix: ✅ shipped same session — `_internal` + `*_he` conventions in tool outputs, system-prompt `## Reply style` rules, Hebrew translation table sourced from `frontend/shared/constants.js`.
- D1 database `agent_memory` for upcoming agent memory: ✅ created (region EEUR, id `154b373c-d86c-4c17-ba38-6131d3181326`), bound as `AGENT_MEMORY` in the Worker, **not yet used by any code path**.
- DL-403 polish (active-only search default + Hebrew pluralization): queued, ~30 min.

## Phase 2 — Tool namespacing

Before adding any new tools, rename the existing four to a `crm.*` namespace: `crm.search_clients`, `crm.get_client_by_id`, `crm.get_client_documents`, `crm.get_dashboard_stats`. A 30-minute change that sets the convention before the tool count grows. Future tools slot in cleanly: `memory.*`, `calendar.*`, `documents.*`. Doing this at four tools is cheap; doing it at fifteen across multiple call sites is a project on its own.

## Phase 3 — Memory layer (the big one)

The single highest-leverage thing remaining. Without memory, every feature is a one-off; with memory, every feature compounds.

- Schema in D1: `memory(id, type, key, value, user_id, created_at, expires_at, superseded_by)` with two indexes (one on `(user_id, type)`, one on `(superseded_by)` filtered to nulls).
- Four memory types: `preference` (durable user choices), `context` (per-conversation working set), `correction` (user-issued course-corrections), `observation` (bot-noted patterns).
- Two new tools under the `memory.*` namespace: `memory.recall(type?, key?)` and `memory.note(type, key, value, expires_at?)`.
- System-prompt addition: read relevant memory at the start of each conversation, write durable observations as they happen.
- The `superseded_by` pattern: corrections that refine earlier corrections preserve history, but only the active row is queried.

Deserves its own focused session. Estimated half a day.

## Phase 4 — M2 (writes)

Only after memory is in place. The audit log goes into `bot_actions` (Airtable, since this is operational data Moshe owns) and is written *before* the tool executes, so failed writes still leave a trail. The Confirm/Cancel inline-keyboard button is a UX gate; the audit log is the structural one. Tools that land in M2: send-reminder, mark-doc-status, set-doc-note, send-batch-questions.

## Phase 5 — Trigger framework

Lightweight `agent_triggers` table in D1. A scheduled Worker (Cloudflare Cron Trigger) reads the table and fires what's due. First registered trigger: daily digest at 9am Israel time. Future triggers slot in as one-row inserts: "ping me when client X enters stage 5," "summarize emails from priority clients within 5 minutes," etc. Keep the table small and the dispatcher dumb.

## Phase 6 — Lightweight correction loop

Friday-afternoon cron, weekly. The bot reviews `correction` memory entries from the past week and asks itself: "Are any of these corrections structural — meaning a system prompt or tool change would prevent them recurring?" Surfaces patterns to me in Telegram. I decide whether to make them permanent. The bot does **not** auto-modify itself.

## What this is NOT going to become

Document this so future-me doesn't drift:

- **Not multi-tenant.** 3 users max, all hardcoded by Telegram ID.
- **Not a Miss Chief clone.** The architectural patterns (memory-as-files, correction-loop) are useful; the components mostly aren't.
- **Not multi-model.** Stay on Haiku 4.5 unless a real ceiling problem surfaces (see `memory/project_telegram_bot_stays_on_haiku.md`).
- **Not knowledge-graph-shaped.** The CRM (Airtable) is the source of truth for world data; D1 memory is for *agent* data only.
- **Not self-modifying.** The correction loop surfaces patterns; the human approves changes.
- **Not a chatbot.** It's a personal operations agent. Optimization target: capability and judgment, not conversation length.

## Out of phase / wishlist

Items that don't fit a phase yet but shouldn't be lost:

- Privacy notice + processing-register update for Israeli Privacy Law Amendment 13 compliance, before letting Natan + Moshe use the bot routinely (see DL-402 §5).
- M3 inbound-doc routing through Telegram — explicit legal sign-off needed before shipping; tax PDFs flowing over Telegram is a bigger data-flow than read-only queries.
- AI-review approve/advance tools — deferred to "v2"; requires either duplicating `script.js` Airtable-direct logic or building dedicated Worker endpoints (own DL).
