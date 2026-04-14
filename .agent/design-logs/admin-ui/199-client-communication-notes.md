# Design Log 199: Client Communication Notes
**Status:** [IMPLEMENTED — VERIFIED + HOTFIX]
**Date:** 2026-03-26
**Related Logs:** DL-126 (Annual Report Notes — existing `notes` textarea), DL-188 (email body in AI review), DL-035 (WF05 classifier)

## 1. Context & Problem
The office reviews client emails in the AI review tab but has no persistent, per-client communication timeline. When preparing a report or sending a reminder, the office has no quick way to see "what has this client been saying to us all year?" — they'd have to search Outlook manually.

We need an accumulated, AI-analyzed log of client communications stored per report, visible in document-manager and reminder-tab, editable by office staff.

## 2. User Requirements
1. **Q:** What should trigger adding a note?
   **A:** All client emails — WF05 analyzes every email, skips forwards/auto-replies.

2. **Q:** How should notes accumulate?
   **A:** JSON array of structured entries `{date, summary, source}` in a single Airtable field.

3. **Q:** Where should AI analysis run?
   **A:** WF05 in n8n — extend existing Claude call to also produce a communication summary.

4. **Q:** How should notes appear in the admin panel?
   **A:** In the AI Review tab's per-client accordion (where "הודעות הלקוח" already appears). Shows last 5 entries with link to document manager.

5. **Q:** Linked Airtable table or JSON in text field?
   **A:** JSON array in a long text field (user preference — simpler, no schema sprawl).

## 3. Research
### Domain
CRM Activity Logging, Email Summarization, Communication Timeline UX

### Sources Consulted
1. **HubSpot Timeline Events API** — Two-tier display (collapsed header + expandable detail), template-based events with backdatable timestamps.
2. **Monday.com CRM AI Summary** — On-demand "Summarize" button; quality depends on data completeness.
3. **arp242.net auto-reply detection** — Layered header-first heuristic: RFC 3834 `Auto-Submitted`, then `X-Auto-Response-Suppress`, `Precedence`, `List-Id`. Body inspection discouraged.
4. **multi_mail autoresponder wiki** — Catalogs headers across 15+ mail systems; subject-line regex fallback.
5. **4Thought Marketing** — AI summarizers fail to distinguish FYI from actionable; domain-specific tuning needed.

### Key Principles Extracted
- **Filter before summarize** — remove noise (auto-replies, forwards, delivery receipts) before AI touches anything. Use subject prefix regex + email headers.
- **Two-tier collapsed timeline** — one-line summary with expandable detail; never show full email bodies inline.
- **Dedup by message_id** — prevent duplicate entries from reprocessed emails.
- **Concurrent write safety** — JSON in a single field has race risk; mitigate with read-modify-write + dedup.

### Patterns to Use
- **Layered email filter**: subject prefix (`Fwd:`, `Re: Fwd:`, `העברה:`, `Automatic reply:`) → skip. Analyze the rest.
- **Append-with-dedup**: Read existing JSON array → check `message_id` → append if new → write back.

### Anti-Patterns to Avoid
- **Unfiltered auto-summarization** — auto-replies and delivery receipts become noise.
- **Full email body in timeline** — overwhelming; use 1-line AI summary + optional raw snippet.

### Research Verdict
Store as JSON array in `client_notes` long text field. WF05 filters noise via subject-line heuristics, generates 1-line summary via existing Claude call, appends entry with dedup. UI shows collapsed timeline with expand-to-detail.

## 4. Codebase Analysis
### Existing Solutions Found
- **`notes` field + textarea** — Already implemented in document-manager (DL-126). Handles free-form office notes via `handleNotesSave()` → `admin-update-client` action `update-notes`. This is **separate** from client_notes.
- **`email_body_text`** — WF05 already threads email body through pipeline (DL-188). Available in `pending_classifications` table.
- **`classifications.ts`** — Returns `email_body_text`, `sender_email`, `sender_name`, `received_at` per classification.

### Reuse Decision
- **Reuse** `admin-update-client` endpoint pattern — add new action `update-client-notes`
- **Reuse** document-manager collapsible section pattern for timeline display
- **Reuse** WF05 Claude prompt — extend to output `communication_summary` alongside classification
- **New**: Timeline rendering component, expandable reminder row, JSON read-modify-write in WF05

### Relevant Files
| File | Purpose |
|------|---------|
| `api/src/routes/client.ts:70-77` | Existing `update-notes` action — pattern for new action |
| `api/src/routes/reminders.ts:25-31` | REMINDER_FIELDS array — add `client_notes` |
| `api/src/routes/documents.ts:223` | Returns `notes` — add `client_notes` |
| `github/.../document-manager.html:245-261` | Notes section HTML — add timeline section |
| `github/.../document-manager.js:220-318` | Notes load/save — add timeline load/edit |
| `github/.../admin/js/script.js:3441-3538` | Reminder row HTML — add expandable detail row |

### Alignment with Research
- Existing code has no email filtering or dedup — must add to WF05.
- No timeline UI exists — must build from scratch.
- Auto-save-on-blur pattern aligns with research (immediate feedback).

## 5. Technical Constraints & Risks
- **Security:** Client email content stored in Airtable — already precedented by `email_body_text` field.
- **Concurrent writes:** WF05 may process an email while office edits notes simultaneously. Mitigate: WF05 reads→appends→writes; office edits individual entries by index.
- **Field size:** Airtable long text max ~100K chars. At ~150 chars/entry, supports ~600+ entries per report. Adequate.
- **WF05 prompt change:** Must not break existing classification output. Add `communication_summary` as an optional additional output field.
- **Breaking Changes:** None — new field `client_notes`, new action `update-client-notes`. Existing `notes` field untouched.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

**A. WF05 Email → Note Entry (n8n)**
1. Email arrives → WF05 processes as usual
2. **New filter step**: Check subject for forward/auto-reply patterns (`/^(fwd:|fw:|העברה:|automatic reply|out of office|הודעה אוטומטית|delivery|undeliverable)/i`). If match → skip note generation.
3. **Extended Claude prompt**: Add instruction: "Also provide a `communication_summary` field — a single Hebrew sentence summarizing what the client is communicating."
4. **New append step** (Code node after classification):
   - Fetch report's current `client_notes` from Airtable
   - Parse JSON array (or `[]` if empty)
   - Check dedup: skip if `message_id` already exists
   - Append `{date, summary, source: "email", message_id, sender_email, raw_snippet}`
   - Write back to Airtable

**B. API — Cloudflare Worker**
1. `documents.ts`: Add `client_notes` to response (office mode)
2. `reminders.ts`: Add `'client_notes'` to REMINDER_FIELDS, add to response
3. `client.ts`: New action `update-client-notes` — accepts full JSON array, validates structure, writes to Airtable

**C. Frontend — Document Manager**
1. New collapsible section "הודעות הלקוח" below existing notes section
2. Timeline display: list of entries, newest first
3. Each entry: date badge + summary text + source icon (email/manual) + edit/delete buttons
4. "Add note" button → inline form with textarea
5. Edit → inline textarea, save on blur
6. Delete → confirm dialog → remove from array → save

**D. Frontend — Reminder Tab**
1. Add expand toggle (chevron icon) in the name cell
2. Click → insert/toggle detail row below with client notes timeline (read-only, last 3 entries)
3. "View all" link → opens document-manager

### Data Structure
```json
// client_notes field (Airtable long text, JSON stringified)
[
  {
    "id": "cn_1711400000000",
    "date": "2026-03-26",
    "summary": "הלקוח שאל על מועד הגשת טופס 106",
    "source": "email",
    "message_id": "<abc123@mail.gmail.com>",
    "sender_email": "client@example.com",
    "raw_snippet": "שלום, רציתי לדעת מתי..."
  },
  {
    "id": "cn_1711450000000",
    "date": "2026-03-26",
    "summary": "הלקוח שלח אישור פיקדון מהבנק",
    "source": "manual",
    "message_id": null,
    "sender_email": null,
    "raw_snippet": null
  }
]
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/client.ts` | Modify | Add `update-client-notes` action |
| `api/src/routes/reminders.ts` | Modify | Add `client_notes` to REMINDER_FIELDS + response |
| `api/src/routes/documents.ts` | Modify | Add `client_notes` to office-mode response |
| `github/.../document-manager.html` | Modify | Add timeline section below notes |
| `github/.../assets/js/document-manager.js` | Modify | Timeline rendering, add/edit/delete handlers |
| `github/.../assets/css/document-manager.css` | Modify | Timeline entry styles |
| `github/.../admin/js/script.js` | Modify | Expandable notes row in reminder table |
| `github/.../admin/css/dashboard.css` | Modify | Expandable row styles |
| n8n WF05 (`cIa23K8v1PrbDJqY`) | Modify | Email filter + prompt extension + append step |
| Airtable REPORTS table | Modify | Create `client_notes` field (long text) |

### Final Step (Always)
- **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Airtable: `client_notes` field exists on REPORTS table
* [ ] WF05: Forward/auto-reply emails are filtered (not summarized)
* [ ] WF05: Normal client email → appends structured entry to `client_notes`
* [ ] WF05: Duplicate email (same message_id) → no duplicate entry
* [ ] API: `get-client-documents` returns `client_notes` in office mode
* [ ] API: `admin-reminders` returns `client_notes` per reminder item
* [ ] API: `update-client-notes` action saves/validates JSON array
* [ ] Document Manager: Timeline section shows entries newest-first
* [ ] Document Manager: Can add manual note entry
* [ ] Document Manager: Can edit/delete existing entries
* [ ] Document Manager: Concurrent edits don't lose data (manual test)
* [ ] Reminder Tab: Expandable row shows last 3 notes
* [ ] Reminder Tab: "View all" navigates to document-manager
* [ ] No regression: existing `notes` field still works independently

## 8. Implementation Notes (Post-Code)
* User corrected: client notes should appear in **AI Review tab** accordion, NOT reminder tab. Reverted reminder tab changes, added to AI review instead.
* AI summary approach: using email subject as summary (no extra Claude API call). Can be enhanced with AI summarization later.
* WF05: Added 2 nodes (Build Client Note + Save Client Note) between "Pick Latest Year Report" and "Get Required Docs". Runs once per email (before per-attachment loop).
* Forward detection in Code node (regex), dedup by internet_message_id.
* ~~Note: WF05 only processes emails WITH attachments. Pure text emails are not captured — would require separate workflow enhancement.~~ **RESOLVED** — see Session 2 below.
* Existing `notes` field (free-form office notes, DL-126) remains separate and untouched.

### Session 2: Text-Only Emails + LLM Summary (2026-03-26)

**Goal:** Process ALL client emails (not just those with attachments) and replace subject-based summary with LLM-analyzed key points (עיקרי הדברים).

**Changes to WF05 (6 nodes):**

1. **Fetch Email by ID** — Added `body` to `$select` query param (was: `id,from,subject,bodyPreview,receivedDateTime,internetMessageId,hasAttachments`, now includes `body`).

2. **Extract Email** — Removed `if (!email.hasAttachments) return [];` gate. Added `body_text` field (HTML stripped, capped at 2000 chars) and `has_attachments` boolean flag. Text-only emails now flow through the full pipeline.

3. **Process & Filter Attachments** — When 0 valid attachments, now returns 1 pass-through item (with `attachment_count: 0`, `attachments: []`) instead of `return []`. This lets downstream nodes execute for text-only emails. Also passes `body_text` and `has_attachments` through.

4. **Prepare LLM Summary** (NEW Code node) — Builds Claude API request body. Uses pre-stringify pattern (`JSON.stringify(requestBody)` → `_llm_payload` field) to avoid JSON issues with email content. Short-circuits for empty emails with `communication_summary` field.

5. **LLM Summarize Email** (NEW HTTP Request node) — Calls `https://api.anthropic.com/v1/messages` using Haiku 4.5 (`claude-haiku-4-5-20251001`). Uses existing `Anthropic account` credential (`adqn8bECCih5hKk1`). ~$0.001/email.

6. **Build Client Note** — Now extracts LLM summary from Anthropic API response (`content[0].text` → parse JSON → `summary` field). Falls back to `communication_summary` (short-circuit) or email subject if LLM fails.

**Connection changes:**
- Old: `Pick Latest Year Report` → `Build Client Note`
- New: `Pick Latest Year Report` → `Prepare LLM Summary` → `LLM Summarize Email` → `Build Client Note`

**Text-only email flow:**
- Get Attachments API call returns `{"value": []}` — wasteful but harmless
- Process & Filter outputs pass-through item with `attachment_count: 0`
- Loop Over Items runs 0 iterations → jumps to Done branch → Update Email Event
- Client note is still created and saved before the loop

**Additional fix: Prepare Attachments** — Added early-return guard (`return []`) when `attachment_count === 0` to prevent the Loop from processing a dummy `skip_classification` item through the attachment pipeline, which crashed in `Skip to Upload`.

**Validation:** 4 pre-existing errors, 0 new errors, 0 invalid connections.

**Test results (execution 10549):** Full SUCCESS — text-only email from known client → LLM summary generated → client note saved to Airtable → attachment loop skipped cleanly (0 items).

---

## Regression: Save Client Note broke Get Required Docs (2026-03-26, hotfix session)

**Problem:** Inserting "Save Client Note" (Airtable update node) between "Build Client Note" and "Get Required Docs" changed the data shape. Airtable update nodes return fields nested under `$json.fields.report_key`, but "Get Required Docs" filter used `$json.report_key` (top-level). Result: filter resolved to `{report_key_lookup} = ''`, returned 0 docs → `has_required_docs: false` → all AI classifications bypassed → every attachment went unmatched with `ai_confidence: 0`.

**Impact:** Executions 10554 (11 attachments) and 10555 (1 attachment) for client CPA-XXX (Client Name) — all 12 classifications created as unidentified.

**Fix:** Updated "Get Required Docs" `filterByFormula` from `{{ $json.report_key }}` → `{{ $json.fields.report_key }}`.

**Cleanup:** Deleted 12 broken classification records from Airtable. User deleted uploaded files from OneDrive. Re-sent emails → execution 10558 processed all 11 attachments successfully with correct AI classification.
