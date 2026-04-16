# Design Log 059 — Automated Follow-up Reminder System

**Date:** 2026-02-25
**Session:** 43
**Status:** Implemented

## Problem
CPA firm (500+ clients) needs automated monthly reminders for tax document collection. Currently, follow-ups are manual and inconsistent.

## Solution
Three-layer system:
1. **[06] Reminder Scheduler** — Daily 08:00 cron, sends Type A (questionnaire) and Type B (missing docs) emails with escalation
2. **[06-SUB] Monthly Reset** — 1st of month, clears this_month suppressions, sets next dates
3. **[API] Reminder Admin** — Webhook for admin panel CRUD operations

Plus admin tab in the dashboard with stats, filters, bulk actions, and per-row controls.

## Architecture Decisions
- **Schedule + Search pattern** (not Airtable Trigger) per n8n bug #16831
- **Idempotency**: Skip if `last_reminder_sent_at` < 24h ago
- **Escalation**: R1=friendly, R2=firm, R3=urgent — controlled by `reminder_count`
- **Type A vs B split** using IF node after search
- **Admin endpoint** uses same GET/POST pattern as other admin APIs (token auth)

## New Airtable Fields
### annual_reports table
- `reminder_count` (number, default 0)
- `reminder_max` (number, null = system default 3)
- `reminder_next_date` (date)
- `reminder_suppress` (singleSelect: this_month / forever)
- `reminder_type` (singleSelect: A / B) — [REMOVED in DL062: redundant, stage is SSOT]
- `last_reminder_sent_at` (dateTime)

### documents table
- `fix_reason_client` (multilineText) — placeholder for future use

## Files Changed
- `admin/index.html` — new reminders tab (HTML)
- `admin/js/script.js` — ~250 lines reminder logic
- `admin/css/style.css` — ~150 lines reminder styles
- n8n workflows: [06], [06-SUB], [API] Reminder Admin

## Verification
- [ ] Admin tab loads with stats, filters, table
- [ ] Bulk actions work (send, suppress, unsuppress)
- [ ] Scheduler sends correct Type A/B emails
- [ ] Idempotency: no duplicate sends
- [ ] Monthly reset clears this_month suppressions
- [ ] Stage 4/5 clears reminder_next_date
