# Design Log 171: Cloudflare Workers — Write Endpoints (Phase 3)
**Status:** [COMPLETED]
**Date:** 2026-03-23
**Related Logs:** DL-169 (Phase 1, COMPLETED), DL-170 (Phase 2, COMPLETED)

## 1. Context & Problem
Phases 1-2 migrated 6 endpoints (auth + reads). Phase 3 migrates 7 write endpoints — every admin mutation action (stage change, archive, edit, import, rollover) currently takes 2-4s and will drop to ~300-500ms.

## 2. User Requirements
1. **Q:** Batch create + delete? **A:** Both — optimize import with 10-record batches.
2. **Q:** Token format? **A:** Keep 64-char hex (backwards compatible).
3. **Q:** Rollout? **A:** All 7 at once.

## 3. Research
Same domain as DL-169/170. No new research needed.

## 4. Codebase Analysis
Reuse: `lib/token.ts`, `lib/client-token.ts`, `lib/airtable.ts`, `lib/security-log.ts`, `middleware/auth.ts`
New shared: `audit-log.ts`, `reminders.ts`, `crypto.ts`

## 5. Technical Constraints & Risks
- Airtable rate limit: 5 req/sec — batch operations must chunk (10 records/call)
- Reset Submission is destructive (deletes records) — client token validation is critical
- Change Stage reminder logic (DL-155) is complex — must match n8n exactly

## 6. Proposed Solution
See plan file. 5 new route files + 3 shared utility files.

### Files to Create
| File | Description |
|------|-------------|
| `src/lib/audit-log.ts` | Fire-and-forget audit log via waitUntil |
| `src/lib/reminders.ts` | Reminder date calculator (DL-155) |
| `src/lib/crypto.ts` | Token generation for Workers |
| `src/routes/stage.ts` | admin-change-stage + admin-mark-complete |
| `src/routes/client.ts` | admin-toggle-active + admin-update-client |
| `src/routes/import.ts` | admin-bulk-import |
| `src/routes/rollover.ts` | admin-year-rollover |
| `src/routes/reset.ts` | reset-submission (client auth) |

## 7. Validation Plan
- [ ] TypeScript compiles
- [ ] Change Stage: forward/backward transitions, reminder fields, audit log
- [ ] Toggle Active: archive/reactivate, linked client updated
- [ ] Update Client: get/update/update-notes all 3 actions work
- [ ] Mark Complete: stage set to Completed
- [ ] Bulk Import: dedup works, batch create, correct counts
- [ ] Year Rollover: preview returns list, execute creates reports
- [ ] Reset Submission: client token validates, docs+questionnaires deleted, stage reset
- [ ] All endpoints: CORS, auth, response shape matches n8n
- [ ] Admin portal: all write actions work end-to-end

## 8. Implementation Notes (Post-Code)
* Measured: change-stage 688ms, toggle-active 619ms, dashboard 344ms warm
* Cold first request ~4.5s (DNS+TLS) — unavoidable per session
* Write latency bottleneck: sequential Airtable calls (get→update→audit = 3x ~200ms)
* Year rollover preview tested via curl — works correctly (12 eligible clients)
* All endpoints verified in production by user
