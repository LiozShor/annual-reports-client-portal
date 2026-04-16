# DL-094: Security Monitoring & Logging (Phase 7)

**Status:** Completed
**Date:** 2026-03-04
**Session:** 86

## Context

Phases 0-5 hardened the system (CSP, SRI, HMAC tokens, CORS, POST mutations, field stripping). Phase 7 adds visibility into whether anyone is probing or attacking.

- Phase 5: CLOSED (SEC-012 report_uid migration deferred — HMAC neutralizes enumeration)
- Phase 6 (admin accounts): DEFERRED — revisit if logs show suspicious activity

## Implementation

### 7A: Airtable Table
- Created `security_logs` (`tbljTNfeEkb3psIf8`) in base `appqBL5RWQN9cPOyh`
- 11 fields: timestamp, event_type, severity, actor, actor_ip, endpoint, report_id, http_status, error_message, details, workflow_execution_id
- Event types: AUTH_SUCCESS, AUTH_FAIL, TOKEN_EXPIRED, TOKEN_INVALID, ADMIN_ACTION, RATE_LIMIT
- Severity levels: INFO, WARNING, CRITICAL

### 7B: Auth Logging (7 code nodes, 6 workflows)
Inline `logSecurity()` helper function embedded in each auth Code node. Pattern: fire-and-forget `this.helpers.httpRequest()` POST to Airtable, wrapped in try-catch.

| Workflow | Node | Events Logged |
|----------|------|---------------|
| [Admin] Auth & Verify | Validate & Generate Token | AUTH_SUCCESS, AUTH_FAIL |
| [Admin] Auth & Verify | Verify Token | TOKEN_INVALID, TOKEN_EXPIRED |
| [Admin] Dashboard | Verify Token | TOKEN_INVALID |
| [API] Get Client Documents | Build Response | TOKEN_INVALID, TOKEN_EXPIRED (3 paths) |
| [API] Check Existing Submission | Build Response | TOKEN_INVALID, TOKEN_EXPIRED |
| [API] Reset Submission | Validate Token | TOKEN_INVALID |
| [03] Approve & Send | Verify Token | TOKEN_INVALID |

**What is NOT logged:** Successful client access, admin dashboard loads, document views (high-volume, low-signal).

### 7C: Alert Workflow
- `[MONITOR] Security Alerts` (`HL7HZwfDJG8t1aes`) — hourly schedule
- Queries security_logs for WARNING/CRITICAL in last hour
- Pattern detection: brute force (5+ same IP), token probing (10+ failures), any CRITICAL
- Hebrew alert email to reports@moshe-atsits.co.il
- Logs alert to security_logs (ADMIN_ACTION/CRITICAL)
- **Status:** Active — uses MS Graph OAuth2 (`MS_Graph_CPA_Automation`) for email

### 7D: Log Cleanup
- `[MONITOR] Log Cleanup` (`AIwVdDqxHa0ZNYD0`) — daily at 03:00
- Deletes non-CRITICAL records >90 days, CRITICAL records >365 days
- Batch delete with rate limiting (10 per batch, 200ms between)
- **Status:** Active — uses inline Airtable API key headers

### 7E: Privacy Compliance
- Created `docs/privacy-compliance.md`
- Israeli PPA Amendment 13 checklist
- Data flow documentation, retention policy, incident response plan

## Files Changed

| Component | Change |
|-----------|--------|
| Airtable `security_logs` | New table |
| n8n [Admin] Auth & Verify (REInXxiZ-O6cxvldci3co) | 2 nodes updated |
| n8n [Admin] Dashboard (AueLKVnkdNUorWVYfGUMG) | 1 node updated |
| n8n [API] Get Client Documents (Ym389Q4fso0UpEZq) | 1 node updated |
| n8n [API] Check Existing Submission (QVCYbvHetc0HybWI) | 1 node updated |
| n8n [API] Reset Submission (ZTigIbycpt0ldemO) | 1 node updated |
| n8n [03] Approve & Send (cNxUgCHLPZrrqLLa) | 1 node updated |
| n8n [MONITOR] Security Alerts (HL7HZwfDJG8t1aes) | New workflow |
| n8n [MONITOR] Log Cleanup (AIwVdDqxHa0ZNYD0) | New workflow |
| docs/airtable-schema.md | Added security_logs schema |
| docs/workflow-ids.md | Added 4 workflow entries |
| docs/privacy-compliance.md | New document |

## Activation Checklist

1. [x] Configure email credentials — MS Graph OAuth2 (`MS_Graph_CPA_Automation`) on Send Email HTTP node
2. [x] Configure Airtable auth — inline Bearer headers on all HTTP query nodes
3. [x] Activate [MONITOR] Security Alerts workflow
4. [x] Activate [MONITOR] Log Cleanup workflow
5. [x] Test: trigger auth failure → verify log appears in Airtable (AUTH_FAIL + TOKEN_INVALID confirmed)
6. [x] Test: create 5+ AUTH_FAIL records with same IP → verify alert triggers (7 AUTH_FAIL → BRUTE_FORCE CRITICAL alert email sent)
