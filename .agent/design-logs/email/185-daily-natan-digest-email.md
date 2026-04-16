# Design Log 185: Daily Natan Digest Email
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-25
**Related Logs:** DL-059 (reminder system), DL-180 (monitoring/alerting), DL-178 (manual reminder send)

## 1. Context & Problem
Natan (office worker) needs a daily summary of actionable items:
1. **Clients in Pending_Approval stage** — questionnaire filled, documents not yet sent. Natan needs to review and send.
2. **Pending AI classifications** — inbound docs classified by AI, awaiting human review/approval.

Currently Natan has to check the admin panel manually to discover these. A daily digest email at 15:00 Israel time removes that friction.

## 2. User Requirements
1. **Q:** Platform — n8n cron or Cloudflare Worker?
   **A:** n8n cron workflow (fits existing scheduled workflow patterns)

2. **Q:** What time daily?
   **A:** 15:00 Israel time (Asia/Jerusalem)

3. **Q:** Skip email on empty days?
   **A:** Always send — even if empty, so Natan knows system is working ("All clear" message)

4. **Q:** What details per client?
   **A:** Name + doc count (no date — no `stage_changed_at` field exists, user chose to skip dates)

## 3. Research
### Domain
Operational digest emails, n8n scheduled workflows, email UX for internal staff notifications.

### Sources Consulted
1. **n8n Schedule Trigger Docs** — Workflow-level timezone setting (`Asia/Jerusalem`). Cron expression `0 15 * * *` for daily 15:00.
2. **FindDataOps "Build a Better Email Digest"** — Four questions: What happened? What's the effect? Is this urgent? What action is needed?
3. **Stripo/SendPulse Email Digest Best Practices** — Lead with TL;DR summary counts, group by category, one CTA per section.
4. **MagicBell Email Notification Guide** — Severity signals (color/icons) to distinguish urgent vs informational. Don't overload.

### Key Principles Extracted
- **Lead with counts** — top summary: "X clients pending approval · Y docs pending review" so Natan can decide urgency at a glance
- **Always send** — user wants daily confirmation the system is running. Empty = "הכל תקין — אין פריטים ממתינים"
- **One CTA per section** — link to admin panel filtered view, not per-client links
- **Hebrew-first** — Natan is Hebrew-only (per email design rules + user identity memory)

### Patterns to Use
- **n8n Schedule Trigger + Code node + HTTP Request (MS Graph)** — same pattern as [06] Reminder Scheduler and [MONITOR] Security Alerts
- **Summary stat grid at top** — borrowed from admin panel dashboard pattern
- **Table layout** — simple HTML table rows per client, matching email design rules (inline CSS, table layout, 600px max width)

### Anti-Patterns to Avoid
- **Per-client action links** — overkill for an internal digest. One link to admin panel is enough.
- **Complex HTML** — this is an internal email, not client-facing. Keep it simple.

### Research Verdict
Simple n8n cron workflow. Query Airtable for both datasets, build plain HTML table in Code node, send via MS Graph HTTP Request. Hebrew-only, internal, minimal design.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `[06] Reminder Scheduler` (FjisCdmWc4ef0qSV) — cron pattern reference
  - `[MONITOR] Security Alerts` (HL7HZwfDJG8t1aes) — hourly cron + MS Graph email pattern
  - `api/src/lib/email-styles.ts` — color/font constants (reuse for consistency)
  - `api/src/lib/email-html.ts` — email HTML builders (client-facing; too complex for internal digest)
* **Reuse Decision:** Reuse email style constants (colors, fonts) but build a simpler HTML generator in n8n Code node. Don't import the full email-html.ts machinery — it's for client-facing emails.
* **Airtable tables:**
  - `annual_reports` (`tbls7m3hmHC4hhQVy`) — `stage='Pending_Approval'`, fields: `client_name`, `year`, `docs_total`, `docs_received_count`, `client_is_active`
  - `pending_classifications` (`tbloiSDN3rwRcl1ii`) — `review_status='pending'`, fields: `client_name`, `attachment_name`, `ai_confidence`, `received_at`
* **MS Graph in n8n:** HTTP Request node with OAuth2 credentials (same as reminder/monitor workflows)

## 5. Technical Constraints & Risks
* **Security:** Email goes to fixed address (natan@moshe-atsits.co.il) — no PII exposure risk beyond what Natan already sees in admin panel
* **Risks:** If Airtable query returns 0 results, workflow must still send "all clear" email (not error out). Use `alwaysOutputData: true` on Airtable nodes.
* **Breaking Changes:** None — new workflow, no existing code modified

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. **Schedule Trigger** — cron `0 15 * * *`, workflow timezone `Asia/Jerusalem`
2. **Airtable Search: Pending Approval** — `filterByFormula: AND({stage}='Pending_Approval', {client_is_active}=TRUE())`, fields: `client_name, year, docs_total, docs_received_count`
3. **Airtable Search: Pending Classifications** — `filterByFormula: {review_status}='pending'`, fields: `client_name, attachment_name, ai_confidence, received_at`
4. **Code node: Build HTML** — combine both datasets into digest email HTML:
   - Top summary: "X לקוחות ממתינים לאישור · Y מסמכים ממתינים לסיווג"
   - Section 1: Pending Approval table (client name, year, doc count)
   - Section 2: Pending AI Review table (client name, attachment, confidence)
   - If both empty: "הכל תקין — אין פריטים ממתינים"
   - CTA button: link to admin panel
5. **HTTP Request: Send via MS Graph** — POST to MS Graph sendMail, from `reports@moshe-atsits.co.il`, to `natan@moshe-atsits.co.il`

### Email Subject
`סיכום יומי — X ממתינים לאישור · Y ממתינים לסיווג`
(When both zero: `סיכום יומי — הכל תקין ✓`)

### n8n Workflow Structure
```
Schedule Trigger (15:00 Asia/Jerusalem)
  → Airtable Search (Pending Approval) [alwaysOutputData: true]
  → Airtable Search (Pending Classifications) [alwaysOutputData: true]
  → Merge (both inputs)
  → Code (Build HTML)
  → HTTP Request (MS Graph sendMail)
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n workflow (new) | Create | New workflow: `[07] Daily Natan Digest` |
| docs/workflow-ids.md | Modify | Add new workflow ID |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Workflow triggers at 15:00 Israel time (test with manual trigger first)
* [ ] Email arrives at natan@moshe-atsits.co.il with correct subject and content
* [ ] Pending Approval section shows correct clients (cross-check with admin panel)
* [ ] Pending Classifications section shows correct items (cross-check with admin panel)
* [ ] Empty state works: when both sections have 0 items, email says "הכל תקין"
* [ ] Hebrew renders correctly (no garbled chars)
* [ ] Email layout looks good on desktop and mobile (check in Gmail)

## 8. Implementation Notes (Post-Code)
* Workflow ID: `0o6pXPeewCRxEEhd`
* **Claude API call removed** — originally planned AI-generated content, user chose deterministic HTML template instead
* **Dual recipient:** Cron fires at 15:00 + 20:00; Code node checks Israel hour to pick Natan (< 18) or Moshe (>= 18)
* **fields[] workaround:** n8n HTTP Request node doesn't properly handle duplicate query param names. Fixed by encoding `fields%5B%5D=client_name` directly in the URL path.
* **Logo:** Uses existing `assets/images/logo.png` from GitHub Pages — no new asset upload needed
* **Send Email:** Uses `$json.to` expression for dynamic recipient (was hardcoded)
* User explicitly chose: no doc counts, no year, no date-entered-stage — just client names
