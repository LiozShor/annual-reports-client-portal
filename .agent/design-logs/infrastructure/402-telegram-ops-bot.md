# Design Log 402: Telegram Ops Bot
**Status:** [COMPLETED — 2026-05-12] (M1 only; M2 + M3 still [COMPLETED — 2026-05-12])
**Date:** 2026-05-05
**Related Logs:** None directly. Adjacent: DL-365 (activity logger — used for all bot turns), DL-180 (worker error logging), Phase-9 AI chat (Anthropic key already in env).

## 1. Context & Problem

Office workflow today requires Natan / Lioz / Moshe to open the admin panel browser tab to do everything: check a client's stage, fire a reminder, mark a doc as received, reassign an inbound document, add a note. The admin panel is great for batch work, terrible for one-off questions on the go ("did Cohen send his form 106 yet?").

A Telegram chat bot fixes that for the 3 internal users with zero infra cost (no BSP, no template approval, no Meta verification — vs WhatsApp which would take 1–3 weeks of paperwork and ~€0.05 per proactive message after the July-2025 pricing change). Telegram is internal-only; client-facing comms stay on email/WhatsApp.

**Outcome:** any of the 3 ops users can text the bot in Hebrew or English and get full read-access to client state plus gated write-access (with inline-keyboard confirmation) to reminders, doc statuses, notes, and the inbound-doc routing pipeline.

## 2. User Requirements

1. **Q:** Telegram or WhatsApp for v1?
   **A:** Telegram. Same agent core can later sit behind a WhatsApp webhook if a client-facing v2 is ever needed.
2. **Q:** Action scope for v1?
   **A:** Full ops parity — state queries, reminders + batch-status, doc status writes (received/waived/requires_fix), inbound-doc routing with "whose client?" prompt, add-notes, AI-review approve/advance.
3. **Q:** Authorized users?
   **A:** Lioz + Natan + Moshe (3 chat_ids in env, comma-separated).
4. **Q:** Hosting?
   **A:** New `/webhook/telegram` route in existing `api/` Worker. Reuses Airtable client, secrets, activity-logger, KV.
5. **Q:** How does the bot trigger writes?
   **A:** Call existing Worker routes / n8n webhooks as Claude tools. No parallel write paths (CLAUDE.md uniformity rule #1).
6. **Q:** Claude model?
   **A:** Haiku 4.5 (`claude-haiku-4-5-20251001`). ~60× cheaper than Opus, plenty smart for CRUD-style tool-use.
7. **Q:** Conversation language?
   **A:** Hebrew-first, English supported. System prompt in English; bot replies in language of incoming message.
8. **Q:** Confirmation gate for write tools?
   **A:** Telegram inline keyboard buttons (`reply_markup` + `callback_query` handler), KV-backed 5-min token.

## 3. Research

### Domain

Internal-ops chatbot — webhook auth, Telegram Bot API, Claude tool-use loop, message-history persistence on stateless Workers.

### Sources Consulted

1. **Anthropic, "Building Effective Agents" (Dec 2024)** — prefer simple LLM-in-a-loop tool-use over agent frameworks (LangChain/LangGraph) unless you have stateful multi-agent graphs. We don't.
2. **chatarmin.com (2026-03-05) + developers.facebook.com WhatsApp pricing** — WhatsApp went per-message July 1, 2025; service-window replies free, proactive utility templates paid. Meta also banned general-purpose AI on WhatsApp Jan 15, 2026 (task-specific agents still allowed). Both cost and policy push us off WhatsApp for internal use.
3. **core.telegram.org/bots/api + core.telegram.org/api/bots/buttons** — verified `setWebhook.secret_token` echoed as `X-Telegram-Bot-Api-Secret-Token` header, `callback_data` 1-64 bytes, `answerCallbackQuery` MUST be called even with no message/url to avoid client timeouts, `getFile` 20 MB cap, `sendMessage` 4096-char limit, HTML safer than Markdown for client names.
4. **docs.claude.com — Tool use + Extended thinking** — Anthropic API is stateless, must resend full message history (tool_use + tool_result blocks preserved). Haiku 4.5 only keeps last turn's thinking blocks → don't enable extended thinking in the tool-use loop.
5. **hookdeck.com (2026-02-12)** — generic webhook security: HMAC on raw body, constant-time compare. Telegram's secret_token is a static shared secret rather than HMAC, but the same constant-time compare discipline applies.

### Key Principles Extracted

- **Simple LLM loop > agent framework** — fewer moving parts, easier to reason about, no LangChain runtime tax.
- **Constant-time secret compare** — `events.ts` already uses `timingSafeEqual` from `lib/crypto.ts`. `inbound-email.ts` (`api/src/routes/inbound-email.ts:25`) currently uses plain `!==` — non-timing-safe. Model the Telegram check after `events.ts`, not `inbound-email.ts`.
- **All writes through existing endpoints** — uniformity rule. Bot is a thin wrapper, not a parallel write surface.
- **Confirmation gate for destructive tools** — inline keyboards beat "reply YES" UX-wise (user requirement #8).
- **History per chat_id, KV-backed** — Workers are stateless; KV TTL 7d on a 10-turn rolling window keyed `telegram:chat:{chat_id}` is sufficient.

### Patterns to Use

- **Hono route module** (`api/src/index.ts:55`, `api/src/routes/inbound-email.ts:15`) — export a `new Hono<{Bindings: Env}>()` instance, mount via `app.route('/webhook', telegramRoute)`.
- **`timingSafeEqual` constant-time compare** (`api/src/lib/crypto.ts:14`) — for the secret_token header check.
- **`logEvent` on every turn** (`api/src/lib/activity-logger.ts:115`) — `category: 'ADMIN'`, `event_type: 'telegram_inbound' | 'telegram_tool_call' | 'telegram_confirm'`, `actor: telegram_user_id`, `client_id` only when one is in scope. PII-safe by default.
- **Cache-aside KV** (`api/src/lib/cache.ts:10`) — reuse `CACHE_KV` namespace; no new namespace needed.
- **Inbound pipeline reuse** (`api/src/lib/inbound/processor.ts`) — when bot receives a `document` update, hand `file_id` → `getFile` → download URL → feed into the existing `processor.ts` entry point so Telegram-uploaded docs go through the same client-identifier cascade and OneDrive write as email-inbound docs. Add `source: 'telegram'` to the inbound metadata.

### Anti-Patterns to Avoid

- **Polling** — Workers are request-driven; webhook is mandatory. Already covered.
- **LangChain / LangGraph** — overkill for 3 users + ~12 tools.
- **Storing the full conversation in KV without a turn cap** — runaway tokens. Hard cap: 10 turns.
- **Direct Airtable writes from the bot** — duplicates logic in route handlers, breaks audit trail in activity-logger + n8n executions.
- **Extended thinking on the tool-use loop** — Haiku 4.5 strips prior thinking blocks anyway, so it costs latency for no benefit.
- **Plain `!==` for secret_token** — timing leak; use `timingSafeEqual`.

### Research Verdict

Cloudflare Worker route + Hono + Anthropic SDK tool-use loop with Haiku 4.5 + KV-backed 10-turn history + inline-keyboard confirm flow with KV-backed 5-min token. All writes plumb through existing routes; reads hit existing endpoints (or, where missing, query Airtable directly via the existing `airtable-client.ts`).

## 4. Codebase Analysis

### Existing Solutions Found

- **Worker framework**: Hono, mounted via `app.route('/webhook', module)` (`api/src/index.ts:55,93,95`).
- **Webhook auth template**: `api/src/routes/events.ts:72-80` — Bearer token + `X-N8N-Key` header + `timingSafeEqual` against `N8N_INTERNAL_KEY`.
- **Constant-time compare helper**: `api/src/lib/crypto.ts:14`.
- **KV namespaces**: `TOKEN_CACHE` (MS Graph) and `CACHE_KV` (generic) — `api/wrangler.toml:32-38`. Reuse `CACHE_KV` for both confirm tokens and chat history.
- **Activity logger**: `api/src/lib/activity-logger.ts:115` — `logEvent({event_type, category, ...})`. Categories already include `'ADMIN'`, `'AUTH'`, `'AI'`. We will reuse `'ADMIN'`.
- **Anthropic key in env**: `ANTHROPIC_API_KEY` already a secret (`api/src/lib/types.ts:22`). No new secret needed for Claude.
- **Existing endpoints to wrap as tools**:
  - Reads: `GET /webhook/admin-dashboard` (`dashboard.ts:27`), `POST /webhook/admin-update-client` action='get' (`client.ts:185`), `GET /webhook/get-client-documents` (`documents.ts:92`).
  - Reminders: `POST /webhook/admin-reminders` 9 actions (`reminders.ts:180`).
  - Batch questions: `POST /webhook/send-batch-questions` (`send-batch-questions.ts:21`).
  - Doc status: `POST /webhook/edit-documents` (`edit-documents.ts:330`) — supports Received / Required_Missing / Requires_Fix / Waived / Removed.
  - Notes: `POST /webhook/admin-update-client` action='update-notes' (`client.ts:87`).
  - Inbound assist: `POST /webhook/admin-assisted-link` (`admin-assisted-link.ts:22`), `POST /webhook/upload-document` (`upload-document.ts:31`).
  - Stage advance: `POST /webhook/admin-change-stage` (`stage.ts:17`), `POST /webhook/admin-mark-complete` (`stage.ts:82`).
  - Inbound pipeline entry: `api/src/lib/inbound/processor.ts` + client cascade `inbound/client-identifier.ts:443`.

### Reuse Decision

- **Reuse:** Hono, `timingSafeEqual`, `logEvent`, `CACHE_KV`, every route listed above, `processor.ts` for inbound docs, `airtable-client.ts` for any read not already exposed (e.g. client search by Hebrew name).
- **New:** `api/src/routes/webhook-telegram.ts` (route entry + secret_token check + dispatch), `api/src/lib/telegram-bot/{client.ts,history.ts,confirm-flow.ts,tools.ts,loop.ts}` (bot internals).

### Relevant Files

- `api/src/index.ts:55,93,95` — route mounting pattern.
- `api/src/routes/events.ts:72-80` — auth template.
- `api/src/lib/crypto.ts:14` — `timingSafeEqual`.
- `api/src/lib/activity-logger.ts:115` — `logEvent` signature.
- `api/src/lib/cache.ts:10` — KV cache pattern (TTL on PUT).
- `api/wrangler.toml:11-38` — vars + KV bindings.
- `api/src/lib/types.ts:2-50` — `Env` interface.
- All ops endpoints listed above.

### Existing Patterns

- Route handlers return JSON via `c.json({...})`; bot tools call them with `fetch()` against `https://annual-reports-api.liozshor1.workers.dev/webhook/...` (or call the handlers directly via Hono internal routing — TBD in Phase A2 of M1).
- Async side effects use `c.executionCtx.waitUntil(...)` (e.g. inbound processor).

### Alignment with Research

- Anthropic guidance (simple loop, not framework) → matches our plan.
- Cloudflare's recommendation (constant-time compare on shared secrets) → already a project pattern in `events.ts`; we extend it.
- Telegram primitives (inline keyboards, getFile, secret_token) → Tavily-confirmed, no surprises.

### Dependencies

- Anthropic SDK (`@anthropic-ai/sdk`) — already in `api/package.json` for Phase 9.
- Telegram Bot API — no SDK; raw `fetch()` against `https://api.telegram.org/bot<TOKEN>/...`.
- New env vars: `TELEGRAM_BOT_TOKEN` (secret), `TELEGRAM_WEBHOOK_SECRET` (secret), `ADMIN_TELEGRAM_IDS` (var, comma-separated chat_ids).

## 5. Technical Constraints & Risks

- **Security:**
  - Secret_token verification MUST be constant-time and on every POST.
  - Allow-list of `from.id` MUST be checked before any tool dispatch.
  - Confirm tokens MUST be single-use; mark consumed in KV before executing the action.
  - PII: client names + CPA-IDs will pass through bot replies and Telegram servers. Telegram is end-to-end encrypted between user and Telegram client only — Telegram itself sees plaintext. Office accepts this trade-off for internal-only use.
  - Logs: pass `client_id` only into `logEvent`; never the message body or full user message.
  - **PII guard:** never paste real client_ids or Hebrew names into this DL. Already compliant.
- **Operational risks:**
  - Worker CPU 50ms limit — Anthropic call may exceed. Use `executionCtx.waitUntil` for async post-acknowledge, or rely on the longer Cloudflare Workers Paid CPU window. (Verify in M1.)
  - Per-message rate: Claude API spend cap. Even at 1k turns/day across 3 users with ~5k tokens/turn input + 1k output → ~$1/day worst case on Haiku. Soft cap at 1k turns/day total via KV counter (`telegram:rate:YYYY-MM-DD`).
  - KV eventual consistency — confirm tokens may take a few seconds to propagate. Acceptable for ops (5-min TTL window).
  - Multi-turn drift — bot might invoke a write tool without confirmation. Mitigation: write-tool definitions return a "needs confirmation" stub; the dispatcher posts the inline keyboard and stores the pending action in KV instead of executing.
- **Breaking changes:** None. Pure additive — new route, new module, new env vars.
- **Mitigations:**
  - Use `timingSafeEqual` and reject before any dispatch on bad secret.
  - Allow-list check returns 200 + silent-drop (Telegram requires 200 to stop retries) but logs `unauthorized_telegram_inbound` to activity-logger.
  - Confirm tokens are 32-byte random, KV-stored with `{action, args, chat_id, expires_at}`, deleted-after-execute.
  - 1k turns/day soft cap; on hit, bot replies "rate limited until midnight Israel time" in user's language.
  - Cap chat history at 10 turns to bound input tokens.

## 6. Proposed Solution

### Architecture & Design Principles (SOLID + Clean Architecture)

**Layered structure (dependency rule: outer → inner only):**

```
┌────────────────────────────────────────────────────────────┐
│  Frameworks/IO layer  (knows Hono, fetch, Telegram, KV)    │
│    - routes/webhook-telegram.ts                            │
│    - lib/telegram-bot/client.ts        (Telegram API)      │
│    - lib/telegram-bot/history.ts       (KV)                │
│    - lib/telegram-bot/confirm-flow.ts  (KV)                │
│    - lib/telegram-bot/inbound.ts       (Telegram + R2)     │
└──────────────────────┬─────────────────────────────────────┘
                       │ depends on (interfaces only)
┌──────────────────────▼─────────────────────────────────────┐
│  Use-case layer  (pure orchestration, no IO imports)       │
│    - lib/telegram-bot/loop.ts          (Anthropic loop)    │
│    - lib/telegram-bot/tools.ts         (tool registry)     │
└──────────────────────┬─────────────────────────────────────┘
                       │ uses
┌──────────────────────▼─────────────────────────────────────┐
│  Domain types  (pure)                                      │
│    - lib/telegram-bot/types.ts         (Update, Tool, …)   │
│    - lib/telegram-bot/system-prompt.ts (string template)   │
└────────────────────────────────────────────────────────────┘
```

The use-case layer (`loop.ts`, `tools.ts`) imports **only** types + interfaces — never `fetch`, `KVNamespace`, `Anthropic` directly. This makes the loop unit-testable with in-memory fakes.

**SOLID mapping:**

- **S — Single Responsibility:** each file owns exactly one concern. `client.ts` ↔ Telegram API only; `history.ts` ↔ KV history only; `confirm-flow.ts` ↔ pending-action tokens only; `loop.ts` ↔ Anthropic tool-use orchestration only; each tool's `execute` ↔ one Worker endpoint or one Airtable read. The route handler `webhook-telegram.ts` does only auth + dispatch — no business logic.

- **O — Open/Closed:** tools are registered through a `ToolRegistry` (M1 = 4 tools, M2 adds 6, M3 adds 5). Adding a tool = appending to the registry; **no edit to `loop.ts`**. Confirm-required tools opt in via a flag on registration — the loop reads the flag, doesn't branch on tool name.

- **L — Liskov Substitution:** `BotMessenger` (production = real Telegram) and `ChatHistoryStore` (production = KV) interfaces have in-memory test doubles that satisfy the same contract; `loop.ts` works identically against either. No `instanceof` checks.

- **I — Interface Segregation:** four narrow interfaces instead of one fat "BotPort":
  - `BotMessenger` — `sendMessage`, `editMessageText`, `answerCallbackQuery`, `getFileUrl`.
  - `ChatHistoryStore` — `read(chat_id)`, `write(chat_id, history)`.
  - `ConfirmTokenStore` — `register(action)`, `consume(token)`.
  - `LlmClient` — `complete(messages, tools, system)`.
  Each consumer depends on only what it needs. `tools.ts` doesn't see Telegram or KV.

- **D — Dependency Inversion:** `webhook-telegram.ts` is the composition root — it instantiates the concrete adapters (Telegram client, KV stores, Anthropic SDK) and injects them into `loop.ts`. The use-case layer depends on the four interfaces above, not on Cloudflare-specific or vendor-specific types. Testing `loop.ts` requires no Worker runtime.

**Clean-coding rules adopted for this DL:**

- **Pure functions for transforms:** history-trim, prompt assembly, tool-schema generation, tool-result formatting are all pure (input → output, no side effects).
- **No mixed responsibilities in routes:** `webhook-telegram.ts` does (a) verify, (b) parse update type, (c) dispatch — and nothing else. All branches return promises that the route awaits at the outer layer.
- **No magic strings outside `types.ts`:** event_types, tool names, confirm-token prefixes, KV key prefixes are all constants in one place.
- **Errors as values where the caller can recover:** unauthorized chat_id → `{ kind: 'unauthorized' }` returned to dispatcher, dispatcher logs + 200s. Vendor exceptions (Anthropic 5xx, Telegram 5xx) propagate to the route, get logged via `logEvent({ category: 'ERROR' })`, and 500 to Telegram so it retries.
- **No `any`:** strict typing on Telegram update parsing (a discriminated union), tool arg schemas via Anthropic's `Tool` type, KV reads typed via generics.
- **Tests live next to source:** `lib/telegram-bot/loop.test.ts`, etc.; integration smoke under `api/test/integration/telegram.test.ts`.
- **Comments only for *why*:** per global CLAUDE.md — no narration of what the code obviously does. WHY-comments allowed where invariants aren't obvious (e.g. "answerCallbackQuery must be called even on no-op or Telegram clients hang").

**Anti-patterns explicitly rejected:**

- One mega-file `telegram-bot.ts` mixing IO + orchestration.
- A `BotContext` god object with everything stuffed in (defeats ISP).
- Tool execution branching inside `loop.ts` (`if (toolName === 'sendReminders') …`) — defeats OCP. Registry + per-tool `execute` instead.
- Direct `env.CACHE_KV.put(...)` calls from `loop.ts` (defeats DIP). Always through `ChatHistoryStore` / `ConfirmTokenStore`.
- Silent `try { } catch { }` swallows. Every catch logs via `logEvent` and either rethrows or returns a typed error result.

### Success Criteria

Lioz can text the bot in Hebrew "מה הסטטוס של חוזרי כהן?" and get a stage + doc-progress reply within 5 seconds. Lioz can text "שלח תזכורת לכל מי שתקוע בשלב 4" and get an inline-keyboard confirm prompt; tapping ✓ fires the existing reminder pipeline and bot replies with the n8n result. Same bot accepts a forwarded PDF, asks "whose client is this?" if auto-routing fails, and on tap routes the doc through the existing inbound processor.

### Logic Flow

```
Telegram → POST /webhook/telegram (api/ Worker, Hono route)
  1. timingSafeEqual(req.header('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET) → 401 if mismatch
  2. parse update; check update.message.from.id (or callback_query.from.id) ∈ env.ADMIN_TELEGRAM_IDS.split(',') → 200 + silent-drop + logEvent('unauthorized_telegram_inbound')
  3. logEvent('telegram_inbound', category: 'ADMIN', actor: from.id, ...)
  4. branch:
     a. callback_query → confirm-flow.handle(callback_data) → execute pending action from KV → answerCallbackQuery + editMessageText
     b. document/photo → handleInboundDoc(file_id) → getFile → download → processor.processInboundDoc({source:'telegram', sender_id, file, caption})
     c. text → mainLoop(chat_id, text)
  5. mainLoop:
     - history = (await CACHE_KV.get('telegram:chat:'+chat_id, 'json')) ?? []
     - history.push({role:'user', content: text})
     - call Anthropic Haiku 4.5 with {tools, system, messages: history.slice(-10)}
     - while response.stop_reason === 'tool_use':
       - for each tool_use block:
         - if tool is read-only → execute directly, push tool_result
         - if tool is write → register pending action in KV (5-min TTL), post inline-keyboard message, DON'T execute, push tool_result {pending: true, prompt_sent: true} and break loop
       - resend history with tool_result blocks; continue
     - sendMessage(text response) (HTML parse_mode, RTL automatic for Hebrew)
     - persist trimmed history to KV (TTL 7d)
```

### Data Structures / Schema Changes

**No Airtable schema changes.** All needed fields already exist (`notes`, doc statuses, stage values).

**KV layout (in `CACHE_KV`):**
- `telegram:chat:{chat_id}` → JSON array of `{role, content}` blocks. TTL 7d, max 10 turns.
- `telegram:confirm:{token}` → JSON `{tool_name, args, chat_id, message_id, expires_at}`. TTL 300s. Deleted on consume.
- `telegram:rate:{YYYY-MM-DD}` → integer turn count. TTL 36h.

**Env additions:**
- `TELEGRAM_BOT_TOKEN` (secret) — from @BotFather.
- `TELEGRAM_WEBHOOK_SECRET` (secret) — random 32-byte hex, passed at `setWebhook`.
- `ADMIN_TELEGRAM_IDS` (var) — comma-separated, e.g. `"111111,222222,333333"`.

**Tool catalogue (M1 → M3 incremental):**

M1 read-only:
- `getClientByCpaId(cpa_id)`
- `getClientDocs(report_id)`
- `getDashboardStats(filing_type?, year?)`
- `searchClientsByName(query)` — Airtable formula via `airtable-client.ts`, since no endpoint exists.

M2 reminders + doc-status:
- `listReminderCandidates()` — wraps `admin-reminders` action='list'.
- `sendReminders(report_ids[], force_override?)` — wraps action='send_now', requires confirm.
- `suppressReminders(report_ids[], scope: 'this_month'|'forever')` — confirm.
- `setDocStatus(doc_id, new_status: 'Received'|'Waived'|'Requires_Fix'|'Required_Missing')` — wraps `edit-documents` `extensions.status_changes`, confirm.
- `setDocNote(doc_id, note)` — wraps `edit-documents` `extensions.note_updates`, confirm (low-stakes; debatable).
- `sendBatchQuestions(report_id, questions[])` — wraps `send-batch-questions`, confirm.

M3 notes + inbound + stage:
- `addClientNote(report_id, note)` — wraps `admin-update-client` action='update-notes' (overwrites field) OR adds a `client_notes` JSON entry — pick one in M3 design pass.
- `assignInboundDoc(file_id, report_id, classification_doc_id?)` — wraps `upload-document` (multipart). Used after the bot's "whose client?" prompt.
- `advanceStage(report_id, target_stage)` — wraps `admin-change-stage`, confirm.
- `markComplete(report_id)` — wraps `admin-mark-complete`, confirm.

**Deferred to v2 (NOT in v1):**
- AI-review approve/reject/advance — no dedicated endpoints exist; logic is in `script.js`. Adding it to the bot would either duplicate that logic or require new endpoints, both of which are their own DL. Recommend deferring.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/webhook-telegram.ts` | Create | Hono route. Verify secret_token, allow-list check, dispatch to bot module. |
| `api/src/lib/telegram-bot/client.ts` | Create | Thin Telegram Bot API client (sendMessage, editMessageText, answerCallbackQuery, getFile, sendChatAction). |
| `api/src/lib/telegram-bot/history.ts` | Create | KV read/write of 10-turn rolling history per chat_id. |
| `api/src/lib/telegram-bot/confirm-flow.ts` | Create | Register/consume pending confirm tokens; build inline_keyboard JSON. |
| `api/src/lib/telegram-bot/tools.ts` | Create | Tool definitions (Anthropic tool schemas) + execute() dispatcher per milestone. |
| `api/src/lib/telegram-bot/loop.ts` | Create | mainLoop(chat_id, text) — Anthropic call + tool_use loop. |
| `api/src/lib/telegram-bot/inbound.ts` | Create (M3) | `handleInboundDoc(file_id, sender_id)` — download + auto-route or prompt "whose client?". |
| `api/src/lib/telegram-bot/system-prompt.ts` | Create | English system prompt; instructs Hebrew-first bilingual reply behavior. Pure string builder. |
| `api/src/lib/telegram-bot/types.ts` | Create | Domain types + the four interfaces (`BotMessenger`, `ChatHistoryStore`, `ConfirmTokenStore`, `LlmClient`). Zero IO imports. |
| `api/src/lib/telegram-bot/composition.ts` | Create | Composition root — wires concrete adapters (Telegram, KV, Anthropic) into the use-case layer. Imported only by the route. |
| `api/src/lib/telegram-bot/loop.test.ts` | Create | Unit tests against in-memory fakes for the four interfaces. No network. |
| `api/src/lib/telegram-bot/confirm-flow.test.ts` | Create | Unit tests for token register / consume / expire / single-use semantics. |
| `api/src/lib/telegram-bot/tools.test.ts` | Create | Unit tests for tool registry, schema generation, confirm-flag dispatch. |
| `api/src/index.ts` | Modify | Mount: `app.route('/webhook', telegramRoute)`. |
| `api/src/lib/types.ts` | Modify | Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_IDS` to `Env`. |
| `api/wrangler.toml` | Modify | Document new secret/var names in commented section (no value commit). |
| `scripts/setup-telegram-webhook.sh` | Create | One-shot: `curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=…&secret_token=…`. Run once after first deploy. |

**Per CLAUDE.md monolith ratchet:** zero touches to `frontend/admin/js/script.js` or `frontend/admin/js/chatbot.js`. All new code is under `api/`.

### Final Step

- Update design log status to `[IMPLEMENTED — NEED TESTING]` after each milestone (M1, M2, M3 — three distinct checkpoints).
- Update `.agent/design-logs/INDEX.md` after each milestone.
- Copy unchecked Section 7 items to `.agent/current-status.md` under Active TODOs.
- Invoke `git-ship` for commit/push/merge per milestone.

## 7. Validation Plan

**Pre-merge gates (every milestone):**
- [ ] All new files pass `npx tsc --noEmit` (use `./node_modules/.bin/tsc --noEmit` on Windows — `npx tsc` is broken there).
- [ ] Unit tests for `loop.ts`, `confirm-flow.ts`, `tools.ts` green — verify no test imports from `cloudflare:workers` or hits a real network.
- [ ] No `any` in new code (project tsconfig already strict).
- [ ] Composition root is the only file that imports both vendor SDKs and use-case modules — grep enforces.
- [ ] Monolith ratchet untouched (no edits to `frontend/admin/js/script.js` / `chatbot.js`).

**M1 — read-only (after ship):**
- [ ] `curl -X POST` against `/webhook/telegram` with bad secret_token → 401.
- [ ] Same with good secret_token but unauthorized chat_id → 200, `logEvent('unauthorized_telegram_inbound')` visible in Worker logs.
- [ ] Lioz texts "סטטוס של CPA-XXX" → bot replies in Hebrew with stage + doc count within 5s.
- [ ] Lioz texts "show dashboard stats" → bot replies in English with stage histogram.
- [ ] Lioz texts gibberish → bot replies politely, history persists (verify by texting follow-up).
- [ ] Worker logs show `telegram_inbound` events with `actor=lioz_chat_id` and `client_id=` only when one is in scope.

**M2 — reminders + doc-status (after ship):**
- [ ] "תשלח תזכורת ל-CPA-XXX" → bot proposes action with [Confirm][Cancel] buttons; tapping Cancel cancels; tapping Confirm fires existing `/admin-reminders send_now` and replies with result.
- [ ] "סמן את 106 של כהן כהתקבל" → bot resolves doc_id, posts confirm; tap Confirm → `edit-documents` writes `Received`; admin panel shows the change after silent refresh (DL-053).
- [ ] Confirm token consumed exactly once: tapping Confirm twice on the same message → second tap shows "expired or already used".
- [ ] 5-min TTL: wait 6 min, tap Confirm → "expired".
- [ ] Soft rate cap: 1001st turn of the day → "rate limited" reply.

**M3 — notes + inbound + stage (after ship):**
- [ ] Lioz forwards a PDF to the bot from a non-client number → bot asks "whose client?" with top-5 search results; tap → `upload-document` writes the file, OneDrive item appears, classification record updates.
- [ ] "תוסיף הערה ל-CPA-XXX: 'התקשר מחר'" → confirm → `admin-update-client` action='update-notes' fires, admin panel shows note after refresh.
- [ ] "תקדם את CPA-XXX לשלב Review" → confirm → `admin-change-stage` fires; reminder fields cleared; admin dashboard reflects within 60s.
- [ ] PII guard: log entries have no client name or message body, only `client_id`.

**Cross-milestone regression checks:**
- [ ] Existing email-inbound pipeline still works (no shared-state changes).
- [ ] Existing admin reminders / edit-documents / stage-change behavior unchanged when called via admin panel.
- [ ] Worker bundle size stays under existing budget; deploy succeeds via `bash .claude/workflows/deploy-worker.sh`.

## 8. Implementation Notes

### M1 — read-only bot (2026-05-05)

**Shipped (code-complete, awaiting live test):**

- New module `api/src/lib/telegram-bot/`:
  - `types.ts` — domain types + the four interfaces (`BotMessenger`, `ChatHistoryStore`, `ConfirmTokenStore`, `LlmClient`) + KV key/TTL constants + `CLAUDE_MODEL`. Zero IO imports; pure inner layer.
  - `system-prompt.ts` — pure string builder, Hebrew-language-hint aware.
  - `history.ts` — `KvChatHistoryStore` impl + pure `trimToTurnCap()` helper. Preserves tool_use/tool_result pairing across trim boundary.
  - `telegram-client.ts` — `BotMessenger` impl. 4096-char clamp on `sendMessage`. `answerCallbackQuery` always called for callback_query (per Telegram docs).
  - `anthropic-client.ts` — `LlmClient` impl. Raw fetch against `https://api.anthropic.com/v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01`. Mirrors the Phase-9 `chat.ts` pattern (no SDK dependency added).
  - `worker-api-client.ts` — `WorkerApiClient` mints a 5-min admin token via `signToken({type:'admin', exp, iat}, env.SECRET_KEY)` and calls existing Worker routes with `Authorization: Bearer …`.
  - `tools.ts` — `ToolRegistry` (Map-backed, OCP-compliant) + 4 read-only tools: `get_dashboard_stats`, `get_client_by_report_id`, `get_client_documents`, `search_clients_by_name`. The loop never branches on tool name.
  - `loop.ts` — `runChatTurn(deps, input)`. Pure orchestration. Imports only types + interfaces (verified via grep — see Architecture Audit below). Max 5 tool iterations per turn.
  - `composition.ts` — composition root. Only file that imports both vendor adapters (`anthropic-client`, `telegram-client`, `worker-api-client`) and the use-case layer.
- New route `api/src/routes/webhook-telegram.ts`. Order: `timingSafeEqual` on `X-Telegram-Bot-Api-Secret-Token` (401 on mismatch) → JSON parse (400 on bad) → allow-list check on `from.id` (200 + silent drop + audit log on mismatch) → `logEvent('telegram_inbound', category:'ADMIN')` → `ctx.waitUntil(bot.handleUpdate(...))` so Telegram gets a 200 within its retry window.
- Mounted in `api/src/index.ts` after `adminDevActivity`.
- 3 new env vars added to `Env` interface: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_IDS`. Optional `WORKER_BASE_URL` for self-call override (defaults to prod URL).
- `wrangler.toml` updated with comment block listing the new secrets/vars.
- `scripts/setup-telegram-webhook.sh` — one-shot `setWebhook` registration, registers only `message`/`edited_message`/`callback_query` update types.
- `api/test/telegram-bot-history.test.mjs` — 6 contract tests for `trimToTurnCap`, all green. Full suite (19 tests) green; no regressions.

**Architecture audit (pre-merge gates, all green):**

- `tsc --noEmit` against new files: 0 errors. (Two pre-existing errors in `index.ts:130` and `activity-logger.ts:16` are out of scope.)
- Composition-root invariant verified by grep — only `composition.ts` imports the vendor adapters at runtime; `tools.ts` references `WorkerApiClient` only via `import type` (erased).
- `loop.ts` imports nothing from `cloudflare:workers`, no `fetch`/`KVNamespace`, no Anthropic SDK. Unit-testable in isolation.
- Monolith ratchet: zero touches to `frontend/admin/js/script.js` / `chatbot.js`.
- All `KV_KEYS`, `TTL_SECONDS`, `CLAUDE_MODEL`, `HISTORY_TURN_CAP`, `TELEGRAM_MAX_MESSAGE_BYTES` centralized in `types.ts`. No magic strings outside.

**Out-of-band steps required before M1 live test (NOT done by this code drop):**

1. Create the bot via @BotFather → capture `TELEGRAM_BOT_TOKEN`. (Open Question §9.5 — bot name still pending.)
2. Generate a random 32-byte hex secret → `TELEGRAM_WEBHOOK_SECRET`.
3. Collect 3 Telegram user ids (Lioz / Natan / Moshe) → `ADMIN_TELEGRAM_IDS=…,…,…`.
4. `wrangler secret put TELEGRAM_BOT_TOKEN` and `wrangler secret put TELEGRAM_WEBHOOK_SECRET` from `api/`.
5. Add `ADMIN_TELEGRAM_IDS` under `[vars]` in `wrangler.toml`.
6. Deploy: `bash .claude/workflows/deploy-worker.sh`.
7. Run `bash scripts/setup-telegram-webhook.sh` once (after sourcing `.env` or exporting the three required vars).
8. Live test per §7 M1 checklist.

**Deferred to M2 (intentionally):**

- `confirm-flow.ts` (interface declared in `types.ts`, no implementation yet — would be dead code in M1 read-only path).
- `tools.test.mjs` and `loop.test.mjs` — adding the dual-source pattern (`.ts` + `.mjs`) for testable pure logic in tools/loop is M2 work alongside the confirm flow. The M1 history-trim contract test is sufficient coverage for the only pure helper that ships in M1.
- Soft rate-cap counter in `KV_KEYS.rate` — wired into `types.ts` but enforcement landed in M2.

### M1.1 — Reply quality structural fix (2026-05-05)

**One-sentence summary:** Fixed bot reply quality by transforming tool outputs at the structural layer (not via prompt patches).

**Pattern that emerged — structural fix > prompt patch:** Live test of M1 surfaced raw `recXXX` ids and English stage codes (`Waiting_For_Answers`) leaking into Hebrew bot replies. The instinct was to tighten the system prompt. The correct fix was at the data shape: `_internal` field for IDs the model needs only for follow-up tool calls (never for display), `*_he` suffix for any field that's a user-facing translation of an enum. When the rule lives in the data shape, the model can't violate it — even a smarter model wouldn't help, because the issue was inputs, not intelligence. Defense in depth: leakage now requires both the system prompt rule AND the response shape to fail simultaneously.

**Files changed:**
- `api/src/lib/stage-translations.ts` — new. `STAGE_HE` (8 stages) + `DOC_STATUS_HE` (5 statuses) + `translateStage()` + `translateDocStatus()` + `formatDocProgress()`. Unknown values return `[stage: <code>]` as a visible bug marker, never silent fallback. SSOT mirrored from `frontend/shared/constants.js:14-21` and `frontend/admin/js/script.js:9399-9401`.
- `api/src/lib/telegram-bot/tools.ts` — all 4 read tools now run Worker responses through `formatForChat*` helpers. Top-level `id`/`record_id` removed from every response shape; raw record ids isolated to a hidden `_internal` field. New `ChatClientSummary`, `ChatDocsForClient`, `ChatDashboardStats` interfaces front the LLM-visible shape.
- `api/src/lib/telegram-bot/system-prompt.ts` — appended `## Reply style` section forbidding `rec.../rep...` echoes and mandating use of `*_he` fields. Existing sections untouched.
- `api/wrangler.toml` + `api/src/lib/types.ts` — wired the Worker `[[services]] SELF` self-binding (Cloudflare blocks Workers from fetching their own public hostname, error 1042) and bound D1 `agent_memory` (created today, EEUR region, id `154b373c-d86c-4c17-ba38-6131d3181326`) as `AGENT_MEMORY: D1Database` for upcoming agent-memory work. Not yet consumed by any code path.

**Verification:** production query `יש לקוח בשם ליעוז שור?` returned a clean Hebrew sentence with zero `rec…` substrings and zero English enum codes. Worker version `67f07df5` (reply-quality fix), then `ba5f96e6` (D1 binding wired but not consumed).

**Worker deploys this session:** `9a5019e5` (M1 source) → `633f41e7` (token unit fix: ms not seconds) → `1283bb08` (debug log) → `93cd4dfc` (SELF service binding) → `3e8bfcab` (year-default to currentYear-1) → `67f07df5` (reply-quality fix) → `ba5f96e6` (D1 binding).

## 9. Open Questions Resolved Before This Draft

1. **Notes field?** Resolved — `notes` column on Reports table, endpoint `POST /webhook/admin-update-client` action='update-notes' exists. No schema change.
2. **AI-review parity in v1?** Resolved — **deferred to v2.** No dedicated endpoints exist; logic is `script.js`-direct. Bot would have to duplicate or require new endpoints (own DL).
3. **Inbound doc storage?** Resolved — same R2/OneDrive path as email-inbound. Add `source: 'telegram'` to inbound metadata for traceability.
4. **Claude spend cap?** Resolved — soft cap of 1k turns/day total across users (~$1/day worst case). Implemented via KV counter.
5. **Bot name?** **Open** — propose `MosheOpsBot` (firm name). Alternative: Hebrew name like `עוזר_משרד_בוט`. Lioz to confirm before @BotFather creation.

## 10. Milestone Plan

- **M1 (~3 days):** route + auth + KV history + Anthropic loop + 4 read-only tools. Ship → user tests.
- **M2 (~3 days):** confirm-flow + reminders/batch/doc-status tools (~6 tools). Ship → user tests.
- **M3 (~3-4 days):** inbound docs + notes + stage tools (~5 tools). Ship → user tests.

Each milestone gets its own `[IMPLEMENTED — NEED TESTING]` checkpoint. AI-review tools = v2, not part of this DL.
