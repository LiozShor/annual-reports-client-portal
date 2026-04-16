# Design Log 287: Cloudflare Queues Migration for Inbound Email Pipeline
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-16
**Related Logs:** DL-203 (WF05 Worker migration, sync), DL-277 (429 retry + batch delay), DL-283 (SUPERSEDED — waitUntil wrap), DL-286 (SUPERSEDED — revert commit `f439e21`), DL-046 (original serial attachment loop), DL-174 (async hybrid research), DL-264 (KV+cron chosen over Queues for a different shape)

## 1. Context & Problem

The inbound email pipeline has whipsawed between two bad options for a month:

- **Synchronous (DL-203 / DL-286).** n8n's HTTP client times out at 120 s. Anthropic 429 retries with 60–72 s `Retry-After` on multi-attachment emails blow through that budget. Worker gets cancelled mid-processing → partial Airtable state, zero classifications saved.
- **Async `ctx.waitUntil` (DL-283).** Cloudflare hard-caps `waitUntil` at 30 s after response. DL-277's 429 retry wait (31–64 s) exceeds it → Worker cancelled mid-retry, dropped all classifications on any rate-limited email.

Today's incident: Orit Matania's forward (8 attachments) and Roby Haviv's original email (multi-attachment) both hit Anthropic 429s with 72 s `Retry-After`. Under DL-286's sync revert, n8n's 120 s timeout killed both Worker invocations. `pending_classifications` has 0 records for either email. Their `email_events` are stuck at `Detected` status with `pc=0`.

Root cause: **HTTP request lifecycle is the wrong unit of work for a multi-step pipeline that can legitimately take minutes.** Decouple the producer (n8n's HTTP call) from the consumer (the processing pipeline).

DL-283's own author flagged this: "Migrate `/webhook/process-inbound-email` to Cloudflare Queues. Eliminates the 30s cap. New DL." — that DL is this one.

## 2. User Requirements

1. **Q:** Scope — Queues migration, classifier serialization, or both? **A:** Queues (primary) + classifier `CLASSIFY_BATCH_SIZE=1` (belt-and-suspenders).
2. **Q:** Queue message granularity — 1 email or 1 attachment per message? **A:** 1 email = 1 message. Keep existing `processInboundEmail` logic; consumer just calls it.
3. **Q:** n8n interaction? **A:** Keep n8n → Worker producer endpoint. Worker auth + dedup + enqueue. No n8n-side changes.
4. **Q:** Failure handling? **A:** DLQ + email alert. 3 retries → DLQ → `logError(category='DEPENDENCY')` → admin email.
5. **Q:** Rollout? **A:** Feature flag `USE_QUEUE=true`. Dual paths deployed. Flip flag to test. Remove sync path after verification.
6. **Q:** Orit + Roby recovery timing? **A:** After Queue deploy. Delete stuck events + orphan PCs + KV dedup keys; recover emails from Outlook deleted items.
7. **Q:** Also reduce classifier batch? **A:** Yes — `CLASSIFY_BATCH_SIZE=1` with existing 1 s inter-batch delay.

## 3. Research

### Domain
Async job processing for serverless compute; producer/consumer with DLQ (Cloudflare Queues).

### Sources Consulted
1. **Cloudflare Queues docs** — guaranteed delivery, 6 h max retention, 5000 msg/s per queue; consumers get a fresh CPU/wall-clock budget per batch (independent of producer).
   - https://developers.cloudflare.com/queues/
2. **Cloudflare Wrangler config reference** — `retry_delay`, `max_concurrency`, `dead_letter_queue` keys for `[[queues.consumers]]`.
   - https://developers.cloudflare.com/workers/wrangler/configuration/#queues
3. **DL-174 (Async Hybrid research)** — Previously concluded `waitUntil` is "at-most-once"; Queues is the right fit for "at-least-once + idempotent".
4. **DL-264 (Off-hours queue)** — Explicitly rejected Queues for 5–20 items/night. Reasoning doesn't apply here: inbound email is unpredictable burst traffic with production correctness requirements.
5. **Enterprise Integration Patterns (Hohpe) — "Enqueue then return"** — HTTP endpoint does identity/auth/dedup only, enqueues, returns 202. Consumer does the work.

### Key Principles
- **Decouple HTTP lifecycle from work lifecycle.** Client timeouts must not dictate processing budget.
- **Idempotency via dedup key.** Queues are at-least-once — consumer must tolerate duplicates. KV dedup already exists by `message_id`; move the lock to consumer-side.
- **DLQ is observability, not garbage.** A DLQ message is a bug to investigate, not data to lose.
- **Feature flag for live migrations.** Deploy both paths, flip secret, observe, cut over, clean up.

### Anti-Patterns Avoided
- **1-attachment-per-message** — would split client identification across messages, fragment the email summary, complicate state. Single-email messages preserve `processInboundEmail` entirely.
- **n8n-direct-to-Queue via REST** — loses our auth + dedup shield, requires n8n-side queue knowledge.
- **Large batch sizes with long per-message CPU** — caught in code review: `max_batch_size = 10` with `cpu_ms = 300000` per invocation would poison the whole batch on a 429 storm. Batch size fixed at 1.

### Research Verdict
Queue the work, keep `processInboundEmail` untouched, flag-gate the rollout. Constrain the consumer config so each invocation is one email.

## 4. Codebase Analysis

### Current State (pre-DL-287)
| Component | File | Role |
|--|--|--|
| Producer route | `api/src/routes/inbound-email.ts` | Auth (`N8N_INTERNAL_KEY`), KV dedup, sync call to `processInboundEmail` |
| Pipeline | `api/src/lib/inbound/processor.ts` (lines 637–957) | 11 stages: fetch, extract, filter, mark-read, email_event, identify, reports, OneDrive root, note, classify, upload |
| Classifier batch | `api/src/lib/inbound/processor.ts:781` | `CLASSIFY_BATCH_SIZE = 3`, parallel within batch, 1 s between |
| Worker entry | `api/src/index.ts` | `export default { fetch: app.fetch }` — no `queue()` handler |
| Env types | `api/src/lib/types.ts` | Secrets + KV bindings, no queue binding |
| Wrangler config | `api/wrangler.toml` | KV only, no queue producer/consumer |
| Error logger | `api/src/lib/error-logger.ts` | `logError({endpoint, error, category?, details?})`, category-throttled admin email via MS Graph |

### Reuse Decisions
- **Entire `processInboundEmail` reused verbatim.** Consumer awaits it.
- **Existing KV dedup logic reused.** Moves from route to consumer (at-least-once tolerance).
- **Existing `logError` reused for DLQ + consumer errors.** No new alert infrastructure.

### Dependencies
- Cloudflare paid plan (already — `cpu_ms = 300000`).
- MS Graph `sendMail` (already).
- Airtable `email_events` table (already).

## 5. Technical Constraints & Risks

- **Queues are paid.** Already on paid plan.
- **6 h message retention max.** Any un-processed message >6 h is lost. Acceptable; DLQ catches real blockers.
- **At-least-once delivery.** Consumer dedups KV + `processInboundEmail` internal Airtable upserts are idempotent.
- **Feature flag risk.** Enabling `USE_QUEUE=true` without consumer deployed would lose messages. Mitigation: consumer deploys FIRST (no-op without producer), flag enabled SECOND.
- **Breaking changes:** None user-facing. n8n workflow unchanged. Airtable schema unchanged. Response shape unchanged (`{ok:true, status:...}`).
- **CPU budget per invocation (caught in review).** `cpu_ms = 300000` is per-Worker-invocation, not per-message. A batch containing multiple 1–2 min messages could blow the budget → whole batch re-tries → false DLQ. Mitigated by `max_batch_size = 1`.

## 6. Implementation

### Architecture Change

**Before (DL-286):**
```
n8n → POST /webhook/process-inbound-email → Auth → Dedup → processInboundEmail (sync) → 200
                                                                    ↑
                                                            n8n 120s timeout kills here
```

**After (DL-287, USE_QUEUE=true):**
```
n8n → POST /webhook/process-inbound-email → Auth → Dedup-CHECK → INBOUND_QUEUE.send() → 202 (<2s)
                                                                        ↓
                                                             Cloudflare Queue (durable)
                                                                        ↓
                          queue() handler → Dedup-LOCK → processInboundEmail (full 5min CPU)
                                                                        ↓
                                          On failure: retry (3x, 30s) → DLQ → logError + alert
```

### Consumer Logic
1. `queue()` dispatches on `batch.queue` name → `handleInboundQueue` or `handleInboundDLQ`.
2. `handleInboundQueue` per message:
   - Layer 0: skip non-'created' → `message.ack()`.
   - Layer 1: KV dedup read → write → re-read verify. Duplicate or race → `message.ack()`.
   - `processInboundEmail(env, ctx, message_id)`.
   - Success → `message.ack()`.
   - Throws → `logError(INTERNAL)` + `message.retry()` (exponential backoff by Cloudflare).
3. `handleInboundDLQ`: synthesizes `Error("DLQ: inbound email dead-lettered after max retries ...")`, `logError(DEPENDENCY)`, unconditional `message.ack()`.

### Feature Flag Behavior
- `USE_QUEUE === 'true'`: producer does auth + dedup-CHECK + `INBOUND_QUEUE.send` + 202. Consumer takes the write-lock.
- Default (`USE_QUEUE !== 'true'`): DL-286 sync path unchanged. Consumer still deployed (harmless — no messages arrive).

### Queue Config (`wrangler.toml`)
```toml
[[queues.producers]]
binding = "INBOUND_QUEUE"
queue = "inbound-email"

[[queues.consumers]]
queue = "inbound-email"
max_batch_size = 1         # one email per invocation (cpu_ms budget is per invocation, not per message)
max_batch_timeout = 2
max_retries = 3
max_concurrency = 2        # bound Airtable/Graph concurrency during bursts
retry_delay = 30
dead_letter_queue = "inbound-email-dlq"

[[queues.consumers]]
queue = "inbound-email-dlq"
max_batch_size = 5
max_batch_timeout = 10
max_retries = 1
```

### Classifier Serialization
`api/src/lib/inbound/processor.ts:781`: `CLASSIFY_BATCH_SIZE = 3 → 1`. Eliminates 429 storms at source. 8-attachment email classification now ~16 s vs ~10 s (worst-case, no 429s). Inside Queue consumer's 5 min budget this is irrelevant.

### Files Changed
| File | Action |
|--|--|
| `api/wrangler.toml` | +Producer + 2× consumer blocks (inbound-email + DLQ) |
| `api/src/lib/types.ts` | +`INBOUND_QUEUE: Queue<InboundQueueMessage>`, +`USE_QUEUE?: string`, +`InboundQueueMessage` interface |
| `api/src/lib/inbound/queue-consumer.ts` | NEW — `handleInboundQueue` |
| `api/src/lib/inbound/dlq-consumer.ts` | NEW — `handleInboundDLQ` |
| `api/src/routes/inbound-email.ts` | +feature-flag branch; sync path preserved as `else` |
| `api/src/index.ts` | +`queue(batch, env, ctx)` export routing by `batch.queue` name |
| `api/src/lib/inbound/processor.ts` | Line 781: `CLASSIFY_BATCH_SIZE = 3 → 1` |
| `.agent/design-logs/infrastructure/287-cloudflare-queues-inbound-email.md` | NEW — this file |
| `.agent/design-logs/INDEX.md` | +DL-287 row, DL-283 marked SUPERSEDED |
| `.agent/current-status.md` | +DL-287 session summary |

## 7. Validation Plan

### Pre-deploy
- [ ] `wrangler deploy` succeeds (types + TOML parse).
- [ ] `wrangler queues create inbound-email` succeeds.
- [ ] `wrangler queues create inbound-email-dlq` succeeds.
- [ ] `wrangler secret put USE_QUEUE` set to `true`.

### Live tests
- [ ] **V1 — Producer fast path.** POST `/webhook/process-inbound-email` with `USE_QUEUE=true` returns 202 in <2 s.
- [ ] **V2 — Consumer invocation.** Cloudflare tail shows `queue() invoked for 1 message` → `[queue] processing message_id=...` → `[queue] done ... status=completed`.
- [ ] **V3 — Idempotency.** Enqueue the same `message_id` twice → only one `pending_classifications` record.
- [ ] **V4 — 1-attachment email.** n8n 202 fast, PC record + OneDrive upload within 30 s.
- [ ] **V5 — 8-attachment email (Orit).** Recover from Outlook. n8n 202 fast; 8 PC records + 8 OneDrive files within 2 min; no n8n timeout.
- [ ] **V6 — 429 storm.** Force Anthropic rate-limit (admin re-classify 20 files). Consumer waits out 429s within 5 min budget; all classifications eventually land.
- [ ] **V7 — DLQ.** Poison message (malformed `message_id` e.g. `bogus-id-xxx`). 3 retries → DLQ handler fires → admin email within 5 min.
- [ ] **V8 — Feature flag off.** `USE_QUEUE=false`; POST falls back to DL-286 sync.
- [ ] **V9 — Regression, small email.** 1-attachment email still lands <30 s.
- [ ] **V10 — Regression, forwarded email (DL-282).** Moshe forwards a client email → note sender = client.
- [ ] **V11 — Regression, Office→PDF.** Client sends `.docx` → converts and classifies.
- [ ] **V12 — Regression, office_reply (DL-266).** Office reply to client → threaded under parent note, hidden from AI review.
- [ ] **V13 — Orit recovery.** After Queue deploy + cleanup + Outlook recover → Orit's 8 files in CPA-XXX/2025.
- [ ] **V14 — Roby recovery.** Same for Roby → CPA-XXX/2025.

## 8. Implementation Notes (Post-Code)

- **Batch size 1, not 10.** Code review flagged that `max_batch_size = 10` × `cpu_ms = 300000` per invocation = a moderate batch of multi-attachment emails with 429 retries would blow the per-invocation CPU cap, falsely retrying the entire batch then DLQ'ing fine messages. Fixed to `max_batch_size = 1` + `max_concurrency = 2`.
- **Retry delay 30 s.** Explicit backoff for transient downstream failures (MS Graph throttle, Airtable 5xx). Default immediate retries would hammer the service during degradation.
- **Typed `InboundQueueMessage`.** Cleaner than `Queue<{message_id, change_type}>` inline. Colocated in `types.ts` — small, env-scoped.
- **`DEPENDENCY` for DLQ, `INTERNAL` for mid-retry.** Let the alert dashboard distinguish "we gave up" from "we're still trying."
- **DLQ visibility in logs.** `[queue] pipeline error ... attempt=N/3 WILL_DLQ|will_retry` so a grep tells the story on Cloudflare dashboard.
- **Double-logging.** Both `processInboundEmail` internal catch AND consumer catch call `logError`. Pre-existing pattern from the sync route — cleaning up touches the processor contract used elsewhere. Left for a follow-up; has a comment in the consumer explaining.
- **Dedup lock on producer vs consumer.** Queue path: producer reads only (short-circuit obvious duplicates), consumer writes the lock (authoritative). Sync path: producer writes the lock (unchanged). Both paths use the same `dedup:<message_id>` KV key with 24 h TTL.
- **Consumer dedup gated on `message.attempts === 1`.** Final-review bug catch: taking (and then checking) the dedup lock on every delivery attempt silently ack'd retries of our own lock, defeating `max_retries` + DLQ entirely. The lock is now only read/written on the first attempt. On retries we skip the dedup check and go straight to the pipeline, relying on `processInboundEmail`'s internal Airtable upserts for idempotency.
