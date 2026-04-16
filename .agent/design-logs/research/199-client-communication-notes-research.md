# DL-199: Client Communication Notes — CRM Research

**Date:** 2026-03-26
**Status:** Complete
**Domain:** Research

---

## Sources

1. **[HubSpot Timeline Events API](https://developers.hubspot.com/docs/api/crm/timeline)** — HubSpot uses a two-tier event model: a collapsed header line and an expandable detail view. Events are template-based with typed tokens, custom icons, and timestamps that can be backdated to when the interaction actually occurred (not when it was logged).

2. **[Monday.com CRM AI Timeline Summary](https://support.monday.com/hc/en-us/articles/21998050250386-Emails-Activities-AI-summary)** — Monday CRM generates on-demand AI summaries across all communication channels (emails, calls, meetings, notes). Users click "Summarize" to generate, then choose whether to add the summary to the timeline. Quality depends entirely on completeness of recorded data. Users can give thumbs up/down feedback.

3. **[Detecting Automatically Generated Emails (arp242.net)](https://www.arp242.net/autoreply.html)** — Comprehensive guide to filtering auto-generated emails using a layered heuristic: RFC 3834 `Auto-Submitted` header first, then `X-Auto-Response-Suppress`, `List-Id`, `Precedence`, `noreply@` patterns, and finally rate-limiting as a safety net. Body text inspection is explicitly discouraged as unreliable.

4. **[Detecting Autoresponders (multi_mail wiki)](https://github.com/jpmckinney/multi_mail/wiki/Detecting-autoresponders)** — Catalogs auto-reply headers across 15+ mail systems (Gmail, Exchange, qmail, CPanel, FirstClass). Provides a concrete subject-line regex: `/Auto Response|Out of Office(?:$| Alert| AutoReply:| Reply$)|is out of the office/i`. Notes that some Exchange configs set NO identifying headers at all.

5. **[Airtable Community: Client Notes via Linked Records](https://air.tableforums.com/t/best-way-to-add-client-notes-via-new-linked-records-on-an-interface/641)** — Community consensus: linked records (separate Notes table) are superior for querying, filtering, and reporting, but add friction. Recommended hybrid: text input field + automation button that creates the linked record and clears the input, preserving speed while building a structured archive.

6. **[4Thought Marketing: AI Email Summaries Pitfalls](https://4thoughtmarketing.com/articles/ai-email-summaries-keep-email-clear/)** — Key pitfall: basic summarizers condense text but fail to distinguish between FYI, opinions, and actionable commitments. Domain-specific accuracy (finance, legal) requires specialized tuning. Canonical naming (project names, dates) in source emails dramatically improves summary quality.

---

## Key Principles for Our Case

1. **Header-first filtering, not content parsing.** Auto-reply/OOO detection should check `Auto-Submitted`, `X-Auto-Response-Suppress`, `Precedence`, and `List-Id` headers before any subject/body heuristics. Body inspection is unreliable and should be avoided.

2. **Two-tier timeline display.** Every CRM that does this well (HubSpot, Salesforce, Pipedrive) uses a collapsed one-liner (date + type + summary) with expandable detail. Don't show full email bodies inline — it destroys scannability.

3. **AI summaries should be additive, not replacements.** Monday.com's pattern is instructive: generate a summary on demand, let the user approve it before it enters the timeline. Never auto-replace the source material. Keep the original email linkable/viewable.

4. **Data quality drives summary quality.** AI summaries are only as good as the input. Filtering out noise (auto-replies, forwards, duplicates) BEFORE summarization is critical — garbage in, garbage out.

5. **Linked records beat JSON blobs for queryability.** For Airtable, a separate "Notes" or "Communications" table linked to the client record enables filtering, sorting, rollups, and reporting. JSON arrays in a long-text field are opaque to Airtable's query engine.

---

## Recommended Patterns

### Pattern 1: Linked Communications Table in Airtable

Create a `Communications` table with fields:
- `Client` (linked record to Reports table)
- `Type` (single select: email_in, email_out, note, call, system)
- `Summary` (short text — 1-2 sentence AI-generated or manual)
- `Source` (long text — full email body or note content)
- `Date` (date/time — actual interaction timestamp, not log time)
- `Created By` (text — "AI", "Natan", "System")
- `Email Message ID` (text — for dedup, only for email types)

**Why:** Queryable, filterable, supports rollups (e.g., "last contact date"), works with Airtable views and interfaces. Each entry is a first-class record.

### Pattern 2: Layered Email Filter (for auto-ingestion)

When auto-logging emails from Graph API / Gmail:
1. **Header check:** Skip if `Auto-Submitted` != "no", or `X-Auto-Response-Suppress` contains "All"/"AutoReply", or `Precedence` is "bulk"/"auto_reply"/"list", or `List-Id` present
2. **Address check:** Skip if from address matches `^no.?reply@` or contains "mailer-daemon"
3. **Subject check:** Skip if matches `/^(Re: )*(Fw:|Fwd:|Auto Response|Out of Office|Automatic Reply|Delivery Status|Undeliverable)/i`
4. **Dedup check:** Skip if `Message-ID` already exists in Communications table
5. **Rate limit:** Max 1 entry per sender per 5 minutes (prevents loops)

---

## Anti-Patterns to Avoid

1. **JSON array in a long-text field.** Tempting for simplicity, but: Airtable can't query inside it, no rollups, no filtering by date/type, field size limits (~100KB), concurrent writes risk data loss, and migrating out later is painful. Only acceptable for ephemeral/disposable data.

2. **Auto-summarizing everything without filtering.** Feeding auto-replies, forwards-of-forwards, delivery receipts, and newsletter bounces into an AI summarizer produces noise entries that clutter the timeline and erode trust. Filter BEFORE summarize.

---

## Research Verdict

**Recommended approach:** Use a **linked Airtable table** (`Communications`) for structured timeline entries, with a **layered email filter** (headers > address > subject > dedup) to gate auto-ingested emails. AI summarization should be **on-demand or approval-gated** rather than fully automatic — let the office worker review summaries before they enter the client timeline. Display in admin UI as a **collapsed timeline** (date + type icon + one-line summary) with expandable detail. This gives queryability, auditability, and clean UX without the fragility of JSON-in-a-field or the noise of unfiltered auto-logging.
