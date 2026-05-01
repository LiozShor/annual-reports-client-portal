# Workflow IDs

## Active n8n Workflows

These workflows handle event-driven processing, scheduled jobs, and async tasks that can't run on Cloudflare Workers.

| Workflow | ID | Purpose |
|----------|-----|---------|
| [02] Response Processing | QqEIWQlRs1oZzEtNxFUcQ | Tally webhook → processes questionnaire responses |
| [04] Document Edit Handler | y7n4qaAUiCS4R96W | Document edits + MS Graph file operations (called async by Workers) |
| [SUB] Document Service | hf7DRQ9fLmQqHv3u | Core doc generation — called by [02] |
| [06] Reminder Scheduler | FjisCdmWc4ef0qSV | Scheduled email reminders (cron) |
| [06-SUB] Monthly Reset | pW7WeQDi7eScEIBk | Monthly reminder counter reset (cron) |
| [API] Send Batch Status | QREwCScDZvhF9njF | Worker calls via X-Internal-Key for async email sending |
| [07] Daily Natan Digest | 0o6pXPeewCRxEEhd | Daily digest email — 15:00 Natan, 20:00 Moshe (cron) |
| [MONITOR] Security Alerts | HL7HZwfDJG8t1aes | Hourly security log scanning |
| [MONITOR] Log Cleanup | AIwVdDqxHa0ZNYD0 | Scheduled log maintenance |

---

## Archived Workflows (migrated to Cloudflare Workers)

All 22 API/admin endpoints replaced by `https://annual-reports-api.liozshor1.workers.dev` (source: `api/`).
Renamed with `[ARCHIVED]` prefix, deactivated. Safe to delete after stable operation confirmed.

| Workflow | ID | Migrated in |
|----------|-----|------------|
| [ARCHIVED] Auth & Verify | REInXxiZ-O6cxvldci3co | DL-169 (Phase 1) |
| [ARCHIVED] Dashboard | AueLKVnkdNUorWVYfGUMG | DL-170 (Phase 2) |
| [ARCHIVED] Pending Clients | s7u7iZkk2OrKYQq4CVedd | DL-170 (Phase 2) |
| [ARCHIVED] Admin Questionnaires | uRG6TGVureMjmJWr | DL-170 (Phase 2) |
| [ARCHIVED] Format Questionnaire | 9zqfOuniztQc2hEl | DL-170 (Phase 2) |
| [ARCHIVED] Check Existing Submission | QVCYbvHetc0HybWI | DL-170 (Phase 2) |
| [ARCHIVED] Admin Change Stage | 3fjQJAwX1ZGj93vL | DL-171 (Phase 3) |
| [ARCHIVED] Admin Toggle Active | jIvRNEOifVc3SIgi | DL-171 (Phase 3) |
| [ARCHIVED] Admin Update Client | grR1Xs2vMEuq8QtZ | DL-171 (Phase 3) |
| [ARCHIVED] Mark Complete | loOiiYcMqIgSRVfr | DL-171 (Phase 3) |
| [ARCHIVED] Bulk Import | DjIXYUiERMe-vMYnAImuO | DL-171 (Phase 3) |
| [ARCHIVED] Year Rollover | ODsIuVv0d8Lxl12R | DL-171 (Phase 3) |
| [ARCHIVED] Reset Submission | ZTigIbycpt0ldemO | DL-171 (Phase 3) |
| [ARCHIVED] Get Client Documents | Ym389Q4fso0UpEZq | DL-172 (Phase 4a) |
| [ARCHIVED] Get Preview URL | aQcFuRJv8ZJFRONt | DL-172 (Phase 4a) |
| [ARCHIVED] Review Classification | c1d7zPAmHfHM71nV | DL-173 (Phase 4b) |
| [ARCHIVED] Get Pending Classifications | kdcWwkCQohEvABX0 | DL-173 (Phase 4b) |
| [ARCHIVED] Reminder Admin | RdBTeSoqND9phSfo | DL-174 (Phase 5) |
| [ARCHIVED] Send Batch Status (dismiss) | *(handled inline by Worker)* | DL-174 (Phase 5) |
| [ARCHIVED] Approve & Send | cNxUgCHLPZrrqLLa | DL-177 (Phase 6) |
| [ARCHIVED] Send Questionnaires | 9rGj2qWyvGWVf9jXhv7cy | DL-177 (Phase 6) |
| [ARCHIVED] Inbound Doc Processing | cIa23K8v1PrbDJqY | DL-203 (WF05 → Workers `process-inbound-email`, March 2026) |
| [ARCHIVED] Email Subscription Mgr | qCNsXnAE06jAZOMe | DL-203 (part of WF05 migration) |

---

**SSOT Test:** `kH9GYY9huFQHQE2R` (compare against WF[02] `EMFcb8RlVI0mge6W`)

**Common Nodes:** `webhook`, `respondToWebhook`, `httpRequest`, `set`, `if`, `merge`, `code`, `@n8n/n8n-nodes-langchain.agent`

**Cloudflare Worker:** `https://annual-reports-api.liozshor1.workers.dev` — source code in `api/` directory
