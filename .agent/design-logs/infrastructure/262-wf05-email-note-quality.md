# Design Log 262: WF05 Inbound Email Note Quality Improvements
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-13
**Related Logs:** DL-199 (client communication notes), DL-203 (WF05 Worker migration), DL-234 (skip own outbound emails), DL-259 (notes at all stages), DL-261 (dashboard messages panel)

## 1. Context & Problem
DL-261 added a dashboard side panel showing the 10 most recent client messages. Testing revealed data quality issues in the `client_notes` stored by the WF05 inbound email processor:

1. **Quoted reply chains not stripped** — Haiku summarizes our own outbound template text (doc-request emails) embedded in reply chains, producing misleading summaries like "הלקוח צריך לשלוח טופס 867" when the client didn't actually write that
2. **Email signatures included in raw_snippet** — Professional signatures (contact details, logos, disclaimers) pollute the displayed text
3. **HTML entities stored literally** — `&quot;` appears as literal text because `extractMetadata` doesn't decode it (only decodes `&amp;`, `&lt;`, `&gt;`)
4. **Wrong sender_email on some records** — When a client replies via Outlook forwarding, the pipeline may pick up our own email address
5. **Summary describes quoted chain** — Haiku sees the full email body including quoted history and summarizes the wrong part

## 2. User Requirements
1. **Q:** Where should quoted reply chains and signatures be stripped?
   **A:** Haiku prompt only — update the prompt to instruct Haiku to ignore quoted chains/signatures. Zero dependency, handles Hebrew natively.

2. **Q:** Should we backfill existing client_notes records with cleaned data?
   **A:** Yes, backfill but test first — verify the new prompt produces correct results, then re-process existing records.

3. **Q:** What should raw_snippet contain going forward?
   **A:** Clean snippet only — Haiku extracts only the client's own words, stored as `raw_snippet`. No separate field.

4. **Q:** Should the dashboard panel also show manual notes?
   **A:** Emails only — filter to `source=email` in the dashboard panel.

## 3. Research
### Domain
LLM Email Summarization, Prompt Engineering for Structured Extraction, Email Thread Parsing

### Sources Consulted
1. **n8n Community: Clean Email for LLM node** — Pre-stripping quoted replies/signatures with regex before sending to LLM reduces tokens by 70%+. Key patterns: `On DATE, NAME wrote:`, Hebrew `ב-DATE, NAME כתב:`, signature triggers `בברכה`, `תודה`, `--`.
2. **Anthropic Cookbook: Structured JSON via tool_use** — Define a tool schema, Claude populates all fields in one call. No extra cost vs plain prompt, guaranteed schema compliance.
3. **Claude API Docs: Structured outputs** — `tool_use` forces structured output with exact field names. Access via `response.content[0].input` — already a dict, no JSON parsing needed. Supported on Haiku 4.5.

### Key Principles Extracted
- **Filter before LLM** — strip obvious noise (HTML entities, common quote markers) before sending to Haiku. Saves tokens, reduces confusion.
- **Use tool_use for multi-field extraction** — get `summary` + `clean_text` in one structured call instead of parsing raw JSON from text output.
- **Hebrew closings are reliable signature boundaries** — `בברכה`, `תודה`, `בהוקרה` on their own line followed by a name = signature start.

### Patterns to Use
- **tool_use structured extraction** — single tool with `summary`, `clean_text`, `skip` fields
- **Pre-LLM regex strip** — decode entities + strip obvious quote markers before Haiku call

### Anti-Patterns to Avoid
- **Relying on LLM alone for stripping** — Haiku may still "see" the quoted text and be influenced by it. Pre-strip reduces this risk.
- **Complex regex for all edge cases** — diminishing returns. Handle the 80% case with regex, let Haiku handle the rest.

### Research Verdict
Two-layer approach: (1) lightweight regex pre-strip of HTML entities + common quote markers + signature delimiters, then (2) updated Haiku prompt using `tool_use` to extract structured `{summary, clean_text, skip}`. The `clean_text` replaces `raw_snippet`. Pre-strip is defensive — even if it misses edge cases, the prompt instructs Haiku to ignore remaining quoted content.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `extractMetadata()` at `processor.ts:87-122` — already does HTML→text conversion but misses `&quot;` and `&#39;` entity decoding
  - `summarizeAndSaveNote()` at `processor.ts:212-321` — current Haiku call with plain JSON response format
  - `SYSTEM_SENDER` constant at `processor.ts` — already filters `reports@moshe-atsits.co.il`

* **Reuse Decision:**
  - Extend `extractMetadata()` to decode all HTML entities
  - Replace the Haiku plain-text prompt with `tool_use` structured extraction
  - Add a `stripQuotedContent()` helper for pre-LLM cleaning

* **Relevant Files:**
  | File | Purpose |
  |------|---------|
  | `api/src/lib/inbound/processor.ts:87-100` | `extractMetadata` — HTML entity decoding |
  | `api/src/lib/inbound/processor.ts:212-321` | `summarizeAndSaveNote` — Haiku prompt + note creation |
  | `api/src/routes/dashboard.ts:127-198` | `admin-recent-messages` — may need `source=email` filter |

* **Dependencies:** Anthropic API (Claude Haiku 4.5), Airtable reports table

## 5. Technical Constraints & Risks
* **Security:** No new security concerns — same Anthropic API key, same Airtable access
* **Risks:** Changing the Haiku prompt could cause regressions — summaries might become less accurate or skip valid emails. Backfill could corrupt existing good notes if not tested carefully.
* **Breaking Changes:** The `raw_snippet` field semantics change from "raw body text" to "clean client text only". Existing consumers (document-manager.js `renderClientNotes()`) display it as-is, so cleaner text is strictly better.
* **Cost:** `tool_use` with Haiku 4.5 has the same token cost as plain messages. No cost increase.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
New inbound emails produce clean summaries that describe only the client's own message, with `raw_snippet` containing only the client's words (no quoted chains, no signatures, no HTML entities).

### Logic Flow

**Step 1: Fix HTML entity decoding in `extractMetadata()`**
Add `&quot;` → `"` and `&#39;` → `'` to the entity replacements.

**Step 2: Add `stripQuotedContent()` helper**
Lightweight pre-strip function that removes:
- Lines starting with `>` (standard email quoting)
- Everything after `On DATE, NAME wrote:` (Gmail English)
- Everything after `ב-DATE, NAME כתב:` (Gmail Hebrew)
- Everything after `----- Original Message -----` / `הודעה מקורית`
- Everything after common Hebrew signature delimiters: line matching `^(בברכה|תודה|בהוקרה|שלך),?\s*$` followed by a name
- Everything after `-- ` (standard sig delimiter)
- Everything after `From:` / `מאת:` forwarding headers

**Step 3: Update `summarizeAndSaveNote()` — switch to tool_use**
Replace the current plain-text prompt with a `tool_use` call:
- Tool: `parse_client_email` with fields: `summary` (string), `clean_text` (string), `skip` (boolean)
- System prompt instructs Haiku to extract only the new content, ignore any remaining quoted/signature text
- `clean_text` is stored as `raw_snippet`
- `summary` is stored as `summary`
- If `skip: true`, return without saving

**Step 4: Filter dashboard to email-only notes**
Add `source === 'email'` filter in the API endpoint when building the messages array.

**Step 5: Backfill existing records (test first)**
- Create a temporary Worker endpoint or script that:
  1. Fetches all reports with non-empty `client_notes` for year 2025
  2. For each note entry with `source === 'email'` and non-empty `raw_snippet`:
     - Run `stripQuotedContent()` on the stored `raw_snippet`
     - Re-summarize with the new Haiku prompt
     - Update the note entry in-place
  3. Write back the updated `client_notes` JSON
- Test on 5 records first, verify results, then run full backfill

### Data Structures / Schema Changes
No schema changes. The `client_notes` JSON structure stays the same:
```json
{
  "id": "cn_xxx",
  "date": "2026-04-13",
  "summary": "...",        // ← now from tool_use structured output
  "source": "email",
  "message_id": "...",
  "sender_email": "...",
  "raw_snippet": "..."     // ← now clean_text from tool_use (client words only)
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/processor.ts` | Modify | Fix entity decoding, add `stripQuotedContent()`, update Haiku prompt to tool_use |
| `api/src/routes/dashboard.ts` | Modify | Filter to `source === 'email'` in recent-messages endpoint |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] New inbound email with quoted reply → summary describes only client's new content
* [ ] New inbound email with signature → raw_snippet does not contain signature
* [ ] Email with `&quot;` in body → stored without literal entity text
* [ ] Email with only quoted text and no new content → Haiku returns `skip: true`, no note saved
* [ ] Dashboard panel shows only email notes (not manual notes)
* [ ] Backfill: test on 5 records, verify summaries are correct
* [ ] Backfill: run on all records, verify no data corruption
* [ ] No regression: normal client emails still produce correct summaries
* [ ] No regression: auto-replies and system emails still filtered out

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
