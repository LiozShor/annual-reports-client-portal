# Design Log 204: Daily Digest — Claude AI Inbox Summarization
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** DL-185 (Daily Natan Digest), DL-202 (Incoming Emails Section)

## 1. Context & Problem
The daily digest email (WF07, `0o6pXPeewCRxEEhd`) has an inbox section that dumps raw `bodyPreview` from MS Graph. This includes email signatures, forwarding headers (`מאת:`, `נשלח:`), "Sent from iPhone", separator lines, phone numbers, and repeated thread content. The result is a wall of noise that makes the section unusable.

**Example:** Client Name sent 3 emails in a thread. The digest shows:
- Entry 1: `"-- ___________________________המלאי ספרים Client Name 0505833969"`
- Entry 2: Same content with forwarding headers
- Entry 3: `"נשלח מה-iPhone שלי"`

**Additional requirement:** No emails on Fridays and Saturdays (weekend skip).

## 2. User Requirements
1. **Q:** Skip entirely on Fri/Sat or send partial email?
   **A:** Skip entirely — no email sent at all on Fridays and Saturdays.

2. **Q:** Failure mode if Claude API fails?
   **A:** Skip the inbox section entirely on failure. Still send sections 2+3.

3. **Q:** Show system emails (from reports@moshe-atsits.co.il)?
   **A:** Filter out entirely — only show emails from external senders.

4. **Q:** Timezone for Fri/Sat detection?
   **A:** Israel time (Asia/Jerusalem). Friday 15:00 Israel = skip. Saturday 20:00 Israel = skip.

## 3. Research
### Domain
LLM Email Summarization, Email Digest UX, MS Graph Thread Grouping

### Sources Consulted
1. **DL-185, DL-202** — Prior research on email digest UX, MS Graph inbox queries, rolling 24h windows. Reusing existing patterns.
2. **Claude Structured Outputs** — Claude Haiku 4.5 supports schema-constrained JSON output, eliminating parse failures. Reliable for structured digest workflows.
3. **MS Graph conversationId** — Groups messages by thread. Not 100% reliable for full thread reconstruction, but sufficient for grouping/dedup in a digest context.
4. **bodyPreview limitations** — 255 chars max. For threads with noise (signatures, headers), actual content may be <50 chars after stripping. LLM can identify and skip empty-content messages.

### Key Principles Extracted
- **Strip noise at the LLM layer** — signatures, forwarding headers, "Sent from iPhone" are best identified by LLM, not regex
- **Group by conversationId** — show each thread once with message count, not every individual message
- **Skip empty messages** — if bodyPreview is pure noise (only signature/footer), LLM should skip it entirely
- **Single API call** — bundle all messages in one Claude call (cheaper, faster, better context for dedup)

### Patterns to Use
- **Single-shot structured output** — one Claude Haiku call with all messages, JSON output
- **Graceful degradation** — try/catch around API call, skip inbox section on failure
- **Pre-filtering** — remove system emails (from reports@) before sending to Claude (saves tokens)

### Anti-Patterns to Avoid
- **Per-message API calls** — expensive, slow, loses thread context
- **Regex-based noise stripping** — fragile, can't handle Hebrew signatures/forwarding headers reliably
- **Using full email body** — would require additional MS Graph call per message, bodyPreview is sufficient for summary

### Research Verdict
Single Claude Haiku API call with all inbox messages (pre-filtered to exclude system emails). Returns structured JSON with thread-grouped summaries in Hebrew. On failure, skip inbox section gracefully.

## 4. Codebase Analysis
* **Existing Solutions Found:** Anthropic API key in `.env` (`ANTHROPIC_API_KEY`). Same pattern used in Cloudflare Workers (`api/src/lib/inbound/document-classifier.ts`). n8n Cloud blocks `$env` — must hardcode in Code node (consistent with Airtable API key already hardcoded in this workflow).
* **Reuse Decision:** Reuse the fetch-to-Anthropic pattern from `document-classifier.ts`. Reuse existing MS Graph OAuth credential.
* **Relevant Files:**
  - n8n workflow `0o6pXPeewCRxEEhd` (WF07)
  - `.env` (API key source)
* **Current Workflow Flow:**
  ```
  Schedule Trigger → Query Pending Approval → Query Pending Reviews → Compute Cutoff → Query Inbox Messages → Build Digest Email → Send Email
  ```
* **Node IDs:** sched_trigger, query_pending_approval, query_pending_reviews, b418eaa7 (Compute Cutoff), 8e019b1c (Query Inbox Messages), build_email, send_email

## 5. Technical Constraints & Risks
* **n8n Cloud:** No `$env`, no `require()`, only built-in `fetch`. API key must be hardcoded.
* **API key exposure:** Key hardcoded in n8n Code node. Same risk level as existing Airtable API key in this workflow. Acceptable for internal workflow.
* **Claude API rate limits:** Haiku has generous limits. 1-2 calls/day is trivial.
* **Token usage:** ~50 messages × 255 chars = ~12,750 chars input ≈ 4K tokens. Output ~500 tokens. Cost: ~$0.003/day.
* **Weekend skip:** Must check Israel timezone day-of-week. Friday = day 5, Saturday = day 6 in JS `getDay()`.

## 6. Proposed Solution (The Blueprint)

### Architecture Change
```
Current:  Schedule → QPA → QPR → Cutoff → QueryInbox → BuildEmail → Send
New:      Schedule → CheckWeekday → [IF not weekend] → QPA → QPR → Cutoff → QueryInbox → SummarizeInbox → BuildEmail → Send
```

### New/Modified Nodes

#### 1. NEW: "Check Weekday" (Code node)
- Position after Schedule Trigger
- Returns `{ isWeekend: true/false }` based on Israel time day-of-week
- Friday (5) and Saturday (6) = weekend

#### 2. NEW: "Skip Weekend" (IF node)
- Condition: `{{ $json.isWeekend }}` equals `false`
- TRUE branch → continues to Query Pending Approval
- FALSE branch → workflow ends (no email)

#### 3. MODIFY: "Query Inbox Messages" (HTTP Request)
- Add `conversationId` to `$select`: `from,subject,bodyPreview,receivedDateTime,conversationId`

#### 4. NEW: "Summarize Inbox (Claude)" (Code node)
- Takes inbox messages from Query Inbox Messages
- Pre-filters: removes emails from `reports@moshe-atsits.co.il`
- If no client emails remain: returns `{ client_emails: [], skipped_count: N }`
- Calls Anthropic API with bundled messages
- On success: returns structured JSON
- On failure: returns `{ error: true }`

#### 5. MODIFY: "Build Digest Email" (Code node)
- Read Claude output from `$('Summarize Inbox (Claude)').first().json`
- If `error === true`: skip inbox section entirely
- If `client_emails` empty: show "לא התקבלו מיילים ב-24 השעות האחרונות"
- Otherwise: render each client_email with sender, time, subject, summary
- Sections 2+3 remain untouched

### System Prompt for Claude
```
You are an email digest assistant for a CPA firm (משרד רו"ח Client Name). You receive raw inbox messages and produce a clean, actionable summary.

RULES:
1. STRIP all noise: signatures, forwarding/reply headers (מאת, נשלח, אל, נושא, From, Sent, To, Subject, ---------- הודעה מועברת), "Sent from iPhone/Android", separator lines (-- ___), phone numbers in signatures, HTML entities, repeated quoted content from threads.
2. GROUP messages by conversationId into threads. Show each thread once with a message count.
3. EXTRACT INTENT: What is the person saying or asking? Write a 1-2 sentence Hebrew summary of the actual content.
4. If an email has NO meaningful content after stripping (e.g., only a signature or "Sent from iPhone"), SKIP it entirely.
5. Sort by time descending.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "client_emails": [
    {
      "sender": "display name",
      "time": "HH:MM",
      "subject": "cleaned subject line",
      "summary": "1-2 sentence Hebrew summary of what they said/asked",
      "message_count": 1
    }
  ],
  "skipped_count": 0
}
```

### Updated Email HTML for Inbox Section
Each client email rendered as:
```
**sender** · HH:MM — subject
summary text (and "(N הודעות)" if message_count > 1)
```

### Files to Change
| Target | Action | Description |
|--------|--------|-------------|
| n8n WF `0o6pXPeewCRxEEhd` | Modify | Add 3 new nodes (Check Weekday, Skip Weekend IF, Summarize Inbox), modify 2 existing (Query Inbox Messages, Build Digest Email), rewire connections |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] Workflow skips entirely on Friday and Saturday (test with manual trigger)
* [ ] Workflow runs normally on Sun-Thu
* [ ] Query Inbox Messages includes `conversationId` in results
* [ ] Claude API call succeeds and returns valid JSON
* [ ] Thread grouping works — multiple messages in same thread shown as one entry with message_count
* [ ] System emails (from reports@moshe-atsits.co.il) are filtered out
* [ ] Empty-content messages (signature-only, "Sent from iPhone") are skipped
* [ ] Inbox section shows clean Hebrew summaries
* [ ] Claude API failure gracefully skips inbox section (sections 2+3 still sent)
* [ ] Subject line still includes email count (from Claude output)
* [ ] Sections 2 (pending approval) and 3 (pending AI review) unchanged
* [ ] Hebrew renders correctly

## 8. Implementation Notes (Post-Code)

**Implemented 2026-03-26** — multiple iterations to work around n8n Cloud restrictions.

**Issues encountered & resolved:**
1. IF node strict type validation rejected boolean expression → switched to `typeValidation: "loose"`
2. `fetch()` not available in n8n Cloud Code nodes → `fetch is not defined`
3. `$helpers.httpRequest()` also not available → `$helpers is not defined`
4. **Solution:** Split into Code (prep) + HTTP Request (API call) + Code (parse) — n8n Cloud Code nodes cannot make HTTP calls, must use HTTP Request node
5. Claude returned JSON wrapped in markdown fences → added regex strip before `JSON.parse()`
6. Set `onError: "continueRegularOutput"` on HTTP node via REST API for graceful degradation

**Final node chain (13 nodes):**
```
Schedule Trigger → Check Weekday → Skip Weekend [TRUE] →
  Query Pending Approval → Query Pending Reviews → Compute Cutoff → Query Inbox Messages →
  Summarize Inbox (Claude) [prep Code] → IF Has Client Emails →
    [TRUE]  → Call Claude API [HTTP Request] → Parse Claude Response [Code] → Build Digest Email → Send Email
    [FALSE] → Build Digest Email → Send Email
```

**Claude API:** Haiku 4.5 (`claude-haiku-4-5-20251001`), max_tokens 2000, single-shot structured JSON output. API key hardcoded (n8n Cloud blocks `$env`). Pre-stringify pattern: Code node builds JSON payload → HTTP node sends as raw body.

**Test results (exec 10567):** 13 inbox messages → 5 system emails filtered → 8 client emails → Claude grouped into 6 entries (Client Name 3→1 thread). Hebrew summaries clean and actionable. Subject line includes email count.

**Prompt improvement (2026-03-26, session 2):**
- Replaced abstract rules with concrete good/bad examples — fixes descriptive-vs-actionable summaries
- Empty body + document subject → "שלח קובץ מצורף — [type]" (was "הודעה ריקה")
- Pre-filter dev/test emails (sender contains `liozshor` or subject contains `test`) — saves tokens
- Enforce time-descending sort in Build Digest Email Code node (don't trust Claude ordering)
- Final test: 5 emails, all actionable summaries, correct sort, dev emails filtered
