# Design Log 202: Daily Digest — Incoming Emails Communication Feed
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** DL-185 (Daily Natan Digest), DL-186 (Logo All Emails), DL-034 (Phase 2 Inbound Processing)

## 1. Context & Problem
The daily digest email (WF07, `0o6pXPeewCRxEEhd`) sends Natan at 15:00 and Moshe at 20:00 with two sections: Pending Approval clients and Pending AI Classifications. These are "dry stats" — no visibility into what clients actually wrote.

**The ask:** Add a **communication feed** showing what emails came into `reports@moshe-atsits.co.il` — who wrote, and what they said. Like a mini inbox summary.

**The timing gap problem:** Natan's 15:00 summary misses emails arriving at 16:00+. Moshe's 20:00 summary misses 21:00+. Solution: rolling 24h window per recipient.

## 2. User Requirements
1. **Q:** How to handle the timing gap?
   **A:** Rolling 24h window per recipient. Natan at 15:00 sees yesterday 15:00→today 15:00. Moshe at 20:00 sees yesterday 20:00→today 20:00.

2. **Q:** What data to show?
   **A:** A communication feed — each line shows who emailed and a truncated preview of what they wrote. Not individual attachment lists.

3. **Q:** Data source — Airtable email_events or MS Graph inbox directly?
   **A:** MS Graph HTTP request over the inbox for the last 24h. Simpler, no dedup needed, gets ALL emails (not just ones with attachments).

4. **Q:** Where to position the new section?
   **A:** Communication feed FIRST (most interesting), then existing dry stats below.

5. **Q:** Email body or subject line for the preview?
   **A:** Email body (truncated). MS Graph `bodyPreview` returns up to 255 chars of plain text — perfect.

## 3. Research
### Domain
Email Digest UX, MS Graph API Message Listing, Rolling Time-Window Notifications

### Sources Consulted
1. **Nielsen Norman Group — Notification Digests** — Front-load critical info; cap content to one screen. One consolidated digest beats multiple status emails.
2. **Jira/GitHub Digest Patterns** — Group by entity, lead with overview counts. Aggregate similar actions.
3. **MS Graph API — List Messages** — `GET /me/mailFolders/inbox/messages` with `$filter=receivedDateTime ge {ISO}`, `$select=from,subject,bodyPreview,receivedDateTime`, `$orderby=receivedDateTime DESC`, `$top=N`. `bodyPreview` = 255 chars plain text, always available.
4. **Prior research (DL-202 v1)** — Rolling 24h window pattern, compute cutoff in n8n not in external service.

### Key Principles Extracted
- **Rolling window per recipient** — each person sees exactly 24h ending at their send time, zero gaps
- **Lead with the communication feed** — most dynamic/interesting content first, standing stats below
- **`bodyPreview` is ideal** — MS Graph auto-truncates to 255 chars plain text, no HTML stripping needed
- **One email = one line** — natural dedup since we query messages (not per-attachment records)

### Patterns to Use
- **MS Graph inbox query:** Direct HTTP request, reusing existing OAuth credential (needs `Mail.Read` scope addition)
- **Rolling 24h cutoff:** `new Date(Date.now() - 24*60*60*1000).toISOString()` computed at send time
- **Communication feed layout:** Sender name bold, body preview below in muted text. Chronological (newest first).

### Anti-Patterns to Avoid
- **Querying Airtable email_events:** Creates dedup complexity (one email = N attachment records), misses emails without attachments
- **Showing subject line instead of body:** Subjects are often generic ("מסמכים", "Fwd:"). Body preview has the actual message.
- **Grouping by client:** Not needed here — this is a chronological inbox feed, not a document status report

### Research Verdict
Query MS Graph inbox directly with `$filter=receivedDateTime ge {cutoff}`. Returns one record per email with `bodyPreview` (255 chars). No dedup, no Airtable dependency. Requires adding `Mail.Read` scope to existing OAuth credential.

## 4. Codebase Analysis
* **Existing Solutions Found:** DL-185 workflow already has MS Graph OAuth + HTTP Request node for sending email. Same credential can be used for reading inbox (with added `Mail.Read` scope).
* **Reuse Decision:** Extend existing workflow — add one HTTP Request node for inbox query, extend Code node with communication feed section.
* **Relevant Files:**
  - n8n workflow `0o6pXPeewCRxEEhd` (WF07 Daily Natan Digest)
  - `api/src/lib/email-styles.ts` (color/font constants — reference only)
  - `docs/email-design-rules.md` (mandatory HTML/CSS rules)
* **Existing Patterns:** Workflow already uses MS Graph HTTP Request with OAuth. Same auth pattern for GET request.
* **Dependencies:** MS Graph OAuth credential needs `Mail.Read` scope added (currently only `Mail.Send`).

## 5. Technical Constraints & Risks
* **OAuth scope:** Existing credential likely only has `Mail.Send`. Must add `Mail.Read` and re-consent in Azure AD. **Risk:** If the credential is shared across workflows, re-consent shouldn't break anything — adding a scope is non-destructive.
* **Rate limits:** 10,000 requests per 10 minutes per mailbox. 1-2 calls/day is trivial.
* **`bodyPreview` length:** Fixed at 255 chars max. Cannot be changed. Good enough for a feed preview.
* **Spam/automated emails:** Inbox may contain auto-replies, bounce notifications, spam. May want to filter out known automated senders or show all (user chose "all emails").
* **Empty inbox window:** If no emails in 24h, show "לא התקבלו מיילים ב-24 השעות האחרונות".
* **`$filter` + `$orderby` constraint:** MS Graph requires the `$orderby` field to also appear in `$filter`. Our filter is on `receivedDateTime` and order is by `receivedDateTime DESC` — this satisfies the constraint.

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. Schedule Trigger fires at 15:00 / 20:00 Israel time (existing)
2. **NEW — Code node: Compute Cutoff** — calculates `cutoff = now - 24h` as ISO string
3. **NEW — HTTP Request: MS Graph Get Inbox Messages**
   ```
   GET https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages
   ?$filter=receivedDateTime ge {cutoff}
   &$select=from,subject,bodyPreview,receivedDateTime
   &$orderby=receivedDateTime DESC
   &$top=50
   ```
   Auth: existing MS Graph OAuth credential (with `Mail.Read` scope added)
4. Existing Airtable queries run in parallel:
   - **Query 1:** Pending Approval reports
   - **Query 2:** Pending Classifications
5. Merge all inputs (inbox messages + 2 Airtable results)
6. Code node builds HTML with **reordered sections:**
   - **Section 1 (NEW): Communication Feed** — chronological list of emails with sender + body preview
   - **Section 2: Pending Approval** (existing)
   - **Section 3: Pending Classifications** (existing)
7. Subject line: `"סיכום יומי — Z מיילים · X ממתינים לאישור · Y ממתינים לסיווג"`
8. MS Graph sends email to dynamic recipient (existing)

### MS Graph Query Details
```
Endpoint: GET /v1.0/me/mailFolders/inbox/messages
Params:
  $filter: receivedDateTime ge 2026-03-25T15:00:00Z
  $select: from,subject,bodyPreview,receivedDateTime
  $orderby: receivedDateTime DESC
  $top: 50
Auth: OAuth2 (existing MS Graph credential + Mail.Read scope)
```

### HTML Communication Feed Structure
```html
<!-- Section header -->
📬 תקשורת נכנסת (24 שעות אחרונות) — Z מיילים

<!-- Per email -->
<div style="border-right: 3px solid #2563eb; padding: 8px 16px; margin-bottom: 12px;">
  <strong>Client Name</strong> · 14:32
  <div style="color: #6b7280; font-size: 13px;">
    שלום, מצרף את המסמכים שביקשתם. טופס 106 מהעבודה ואישור...
  </div>
</div>

<!-- Empty state -->
לא התקבלו מיילים ב-24 השעות האחרונות
```

### Sender Name Extraction
MS Graph `from` field returns: `{ emailAddress: { name: "Client Name", address: "client@example.com" } }`
- Use `from.emailAddress.name` when available
- Fallback to `from.emailAddress.address` if name is empty

### Time Formatting
- `receivedDateTime` comes as ISO UTC string
- Convert to Israel time (UTC+2/+3) and show as `HH:MM`

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n WF07 (`0o6pXPeewCRxEEhd`) | Modify | Add HTTP Request node (inbox query), add Code node (cutoff), update Merge, rewrite Code node HTML with feed section first |
| Azure AD / MS Graph credential | Config | Add `Mail.Read` scope to existing OAuth app registration |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] MS Graph OAuth credential has `Mail.Read` scope and re-consent works
* [ ] Inbox query returns messages from last 24h correctly
* [ ] Communication feed section appears FIRST in the email
* [ ] Each email shows sender name + body preview (truncated)
* [ ] Time shown in Israel timezone (not UTC)
* [ ] Empty state shows "no emails received" when inbox is quiet
* [ ] Subject line includes email count
* [ ] Rolling 24h window works — cutoff is 24h before send time
* [ ] Natan's 15:00 email and Moshe's 20:00 email show different time windows
* [ ] Existing Pending Approval and Pending Classifications sections still work correctly
* [ ] Hebrew renders correctly (no garbled chars)
* [ ] Email layout looks correct on desktop (Gmail + Outlook)

## 8. Implementation Notes (Post-Code)
* Implemented via `n8n_update_partial_workflow` — 10 atomic operations in single call
* Added "Compute Cutoff" Code node (24h rolling window as ISO string)
* Added "Query Inbox Messages" HTTP Request node (MS Graph GET with OAuth2, same credential as Send Email)
* Rewired chain: `...Query Pending Reviews → Compute Cutoff → Query Inbox Messages → Build Digest Email...`
* Updated Build Digest Email with 3 sections: Communication Feed (new, first) → Pending Approval → Pending AI Reviews
* Added `esc()` HTML sanitizer for user-generated content (sender names, body previews)
* Subject line now includes email count: `סיכום יומי — Z מיילים · X ממתינים לאישור · Y ממתינים לסיווג`
* Empty state for communication feed: "לא התקבלו מיילים ב-24 השעות האחרונות"
* Communication feed uses RTL border-right accent (3px solid #2563eb) per email design rules
* **Pre-requisite still needed:** `Mail.Read` scope must be added to MS Graph OAuth credential in Azure AD before testing
