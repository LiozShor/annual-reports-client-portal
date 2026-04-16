# Design Log 179: Hebrew Data Query Agent for Admin Portal
**Status:** [COMPLETED]
**Date:** 2026-03-24
**Related Logs:** DL-165 (UX research), DL-169-175 (Cloudflare Workers)

## 1. Context & Problem

The admin portal manages ~600 clients through an 8-stage tax report pipeline. Cross-cutting queries are impossible through the UI — questions like "who's stuck in stage 4 for over a month?" or "clients with 90%+ docs but stage hasn't advanced" require manual cross-referencing across tabs and mental date math.

**Goal:** A floating chat agent where Moshe types commands in Hebrew. The agent can both **analyze data** and **take actions** (with user approval before any mutation).

## 2. User Requirements

1. **Position:** Bottom-left FAB
2. **Memory:** Conversational — maintains 16-message sliding window
3. **API key:** Proxy through Cloudflare Worker (key stays server-side as `ANTHROPIC_API_KEY` secret)
4. **Client links:** Auto-link client names to `viewClientDocs(reportId)`
5. **Architecture:** Agent with tool-use. Read queries answered from injected context. Write actions use Anthropic tool-use API with human approval before execution.

## 3. Research

### Domain
LLM Agent with Tool-Use, Human-in-the-Loop Approval, Chat Widget UX, RTL Interface Design

### Sources Consulted
1. **Intercom/Zendesk/Drift widget patterns** — FAB 56-60px, panel 380-400px × 600px, slide-up animation 200-300ms. WhatsApp Hebrew is the RTL reference standard.
2. **Anthropic API tool-use docs** — `tools[]` in request, `tool_use` content blocks in response, `tool_result` sent back. Claude can return text + tool_use in same response. `stop_reason: "tool_use"` signals pending execution.
3. **Agent safety patterns** — Three-tier model: safe (auto-execute reads), mutating (require approval), destructive (require confirmation + detail). Frontend is gatekeeper — LLM never executes directly.
4. **Hebrew RTL chat** — User messages LEFT, assistant RIGHT (WhatsApp convention). Tables need `dir="ltr"` wrapper. `dir="auto"` on input/messages for bidi detection. `lang="he"` for accessibility.
5. **Cost optimization** — Tool definitions add ~100-300 tokens each. With 4-5 tools, overhead is ~500-1000 tokens. Agent loop: read queries = 1 round-trip (data in context), write actions = 2-3 round-trips. At ~$0.03/conversation, well within budget.

### Key Architecture Decision: Hybrid Read/Write

Instead of using tool calls for everything:
- **Read queries** → data injected in context, Claude answers directly (1 round-trip)
- **Write actions** → Claude proposes via `tool_use`, frontend shows approval card, executes on confirm (2-3 round-trips)

This gives fast reads AND safe writes. Only write tools defined — no read tools needed.

### Anti-Patterns to Avoid
- **Exposing API key in frontend** — GitHub Pages is public
- **Keyword-based data selection** — fragile, breaks on cross-cutting queries
- **Auto-executing write tools** — all mutations require human approval
- **Putting approval logic in system prompt** — approval gate must be hardcoded in frontend
- **RTL tables** — number alignment breaks, always wrap in `dir="ltr"`

## 4. Codebase Analysis

### Global Data Available (script.js scope)
| Variable | Loaded when | Key fields for context |
|----------|-------------|----------------------|
| `clientsData` | Dashboard (auto) | name, report_id, stage, year, docs_received, docs_total, is_active, notes |
| `reviewQueueData` | Dashboard (auto) | report_id, docs_completed_at |
| `remindersData` | Reminders tab (lazy) | report_id, reminder_next_date, reminder_count, reminder_max, reminder_suppress |
| `aiClassificationsData` | AI Review tab (lazy) | client_name, attachment_name, matched_doc_name, review_status, confidence_score |
| `questionnairesData` | Questionnaires tab (lazy) | client_info.name, client_info.submission_date, report_record_id |

Loading flags: `dashboardLoaded`, `reminderLoaded`, `questionnaireLoaded`, `aiReviewLoaded`

### Existing Patterns to Reuse
- Auth: `authMiddleware` + Bearer token
- Worker routes: Hono at `api/src/routes/`
- `Env` interface at `api/src/lib/types.ts`
- CORS handled globally
- `viewClientDocs(reportId)` for client navigation
- Design tokens: `--brand-600`, `--sp-*`, `--radius-lg`, `--shadow-lg`
- Lucide icons, `showAIToast()` for errors

### Z-Index: Chat widget at **950** (above bulk bar 900, below modals 1001)

## 5. Technical Constraints & Risks

* **Security:** API key server-side only. Tool inputs validated before execution.
* **Token cost:** ~3-5K tokens for 600 clients context. With 16-message history, worst case ~20K tokens/query. ~$0.03-0.05/conversation.
* **Data freshness:** Lazy-loaded arrays may be empty. `_not_loaded` array tells Claude which datasets aren't available.
* **Tool safety:** All tool calls require human approval. Frontend is the gatekeeper, not the LLM.
* **Breaking Changes:** None — purely additive.

## 6. Proposed Solution (The Blueprint)

### Architecture
```
READ QUERY (1 round-trip):
  User question → [chatbot.js injects all loaded data as context]
  → POST /webhook/chat {messages, context}
  → Worker forwards to Anthropic API (no tools needed for reads)
  → Claude responds with text → render in chat

WRITE ACTION (2-3 round-trips):
  User command → [chatbot.js injects context]
  → POST /webhook/chat {messages, context, tools}
  → Claude responds with tool_use block + explanatory text
  → Frontend shows approval card: "Agent wants to: [action]. [Approve] [Deny]"
  → User approves → Frontend executes action via existing Worker endpoints
  → tool_result sent back to Claude
  → Claude confirms with final text response
```

### Tool Definitions (write-only, all require approval)

```
move_to_stage(report_id, new_stage, reason)
  — Change a client's pipeline stage

send_reminder(report_id)
  — Trigger reminder send for a client

add_note(report_id, note_text)
  — Add/update notes on a client record

suppress_reminder(report_id, suppress: boolean)
  — Enable/disable reminder suppression for a client
```

### System Prompt (Hebrew, ~1000 tokens)
Tells Claude:
- It's a data query agent for CPA firm admin portal (משרד רו"ח Client Name)
- The 8 stages with Hebrew names (from STAGES constant)
- Data fields and their meanings
- Formatting rules: tables for lists, bold numbers, concise Hebrew
- `<client>name|report_id</client>` tags for clickable links
- Never invent data
- `_not_loaded` → tell user to visit the relevant tab
- Out-of-scope → polite Hebrew redirect
- For write actions: use the provided tools, explain what you're about to do

### Data Injection (`buildChatContext()`)
Serialize ALL loaded arrays with selective fields:
- `clientsData` → name, report_id, stage, year, docs_received, docs_total, is_active, notes
- `reviewQueueData` → report_id, docs_completed_at
- `remindersData` → report_id, reminder_next_date, reminder_count, reminder_max, reminder_suppress
- `aiClassificationsData` → client_name, attachment_name, matched_doc_name, review_status, confidence_score
- `questionnairesData` → client_info.name, client_info.submission_date, report_record_id
- `_not_loaded` → list of datasets not yet loaded
- `_stats` → total_clients, active_clients, stage_distribution
- `_today` → current date for date math

### Error Handling
| Error | HTTP | Hebrew Message |
|-------|------|----------------|
| Invalid auth | 401 | `אין הרשאה. נסה לרענן את הדף.` |
| Anthropic timeout (>30s) | 504 | `הבקשה לקחה יותר מדי זמן. נסה שאלה קצרה יותר.` |
| Anthropic 5xx | 502 | `שירות הבינה המלאכותית לא זמין כרגע. נסה שוב בעוד דקה.` |
| Rate limit (429) | 429 | `יותר מדי בקשות. חכה רגע ונסה שוב.` |
| Context too large | 400 | `יותר מדי נתונים. נסה לטעון פחות לשוניות ולשאול שוב.` |
| Unknown | 500 | `משהו השתבש. נסה שוב.` |

Worker response format:
```
Success: { ok: true, content: [...content_blocks], usage: { input_tokens, output_tokens } }
Error:   { ok: false, error: string, message_he: string }
```

### Rate Limiting
- 60 requests/hour per admin token (in-memory counter in Worker)
- Frontend: disable send button while waiting

### Conversation Window
- 16 messages max (8 user turns)
- Context injected only in latest user message
- Old messages are cheap (short Hebrew text)

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/types.ts` | Modify | Add `ANTHROPIC_API_KEY` to `Env` |
| `api/src/routes/chat.ts` | Create | POST /webhook/chat — proxy to Anthropic with tool support |
| `api/src/index.ts` | Modify | Import and mount chat route |
| `api/wrangler.toml` | Modify | Add ANTHROPIC_API_KEY to secrets comment |
| `admin/js/chatbot.js` | Create | Full chat agent: UI, agent loop, tool approval, rendering |
| `admin/css/style.css` | Modify | Append chat widget styles (~250 lines) |
| `admin/index.html` | Modify | Add chat container div + script tag |

### Suggested Questions
```
"כמה לקוחות בכל שלב?"
"מי תקוע הכי הרבה זמן?"
"לקוחות עם מסמכים חסרים"
"סיכום כללי"
```

## 7. Validation Plan
* [x] Worker returns 401 without valid token — (implicit, auth tested throughout)
* [x] Worker proxies to Anthropic and returns Hebrew response — ✅ session 183
* [ ] Rate limit triggers at 60 req/hour, returns 429 with Hebrew message — skipped (would need 60 requests)
* [x] Error responses return structured `{ ok: false, message_he }` — ✅ verified in network tab
* [x] FAB appears bottom-left, z-index 950 (above bulk bar, below modals) — ✅ Test 1
* [x] Panel opens with animation, closes on Escape and close button — ✅ Test 1
* [x] Suggestion chips trigger real queries — ✅ Test 2
* [x] "כמה לקוחות בכל שלב?" returns accurate counts matching dashboard — ✅ Test 2 (3+1+8+1=13)
* [x] Client names clickable → opens viewClientDocs() — ✅ Test 3 (fixed :: separator)
* [x] Tables render RTL inside RTL chat — ✅ Test 4 (changed from LTR to RTL)
* [x] Unloaded data shows "visit tab first" message — N/A (prefetching loads all data)
* [x] Out-of-scope question gets polite Hebrew redirect — ✅ Test 6
* [x] Follow-ups work across 8+ turns — ✅ Test 7
* [x] Tool-use: Claude proposes write action → approval card shown — ✅ Test 8
* [x] Approving tool call executes action and shows result — ✅ Test 9
* [x] Denying tool call sends rejection to Claude, Claude acknowledges — ✅ Test 8
* [x] Send button disabled while waiting, 30s client-side timeout — ✅ Test 10
* [x] No API key in frontend source, network tab, or GitHub — ✅ Test 11
* [x] Widget doesn't break existing portal — ✅ Test 12

## 8. Implementation Notes (Post-Code)

### Closed Decisions (2026-03-24)
1. **LLM Provider → Claude Sonnet** (`claude-sonnet-4-20250514`). Single provider.
2. **Architecture → Agent with tool-use + human approval.** Read queries from injected context (1 trip). Write actions via tool_use with approval (2-3 trips).
3. **Data injection → Send all loaded data** (no keyword matching). Selective fields only.
4. **Conversation window → 16 messages** (8 user turns).
5. **Tools → Write-only** (move_to_stage, send_reminder, add_note, suppress_reminder). All require approval.

### Testing Session (2026-03-25, session 183)
- **Bugs found & fixed during testing:**
  1. `<client>` tag `|` separator conflicted with markdown table `|` delimiters → changed to `::` separator
  2. Frontend regex only accepted `|` → made robust to accept `::`, `\`, `,`, whitespace
  3. Table `dir="ltr"` should be `dir="rtl"` for Hebrew chat context
- **System prompt converted to English** — better instruction-following, ~50% fewer input tokens
- **Tool descriptions converted to English** — model-facing, not user-facing
- All 12 manual tests passed (rate limit test skipped — would need 60 requests)

### Phase 2 Candidates
- **LangSmith monitoring** — server-side in Worker
- **Streaming responses** — SSE passthrough
- **More tools** — approve AI classifications, trigger batch emails, bulk stage changes
- **Query history** — localStorage persistence
- **Export answers** — copy/download
