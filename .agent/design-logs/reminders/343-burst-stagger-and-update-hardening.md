# Design Log 343: Burst Stagger + Airtable Update Hardening

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-25
**Related Logs:** DL-342 (audit), DL-059 (foundation), DL-154 (idempotency, still DRAFT), DL-271 (08:00 cron), DL-277 (429 retry pattern)

## 1. Context & Problem
Following the DL-342 audit (422 reminders this week, top concern = duplicate sends / silent failures), the user opted for **single-day burst with intra-run stagger** rather than 5-day spread.

Inspecting WF[06] (`FjisCdmWc4ef0qSV`) showed two material things DL-342 did not catch:

1. **Stagger already exists.** `Send Email` (HTTP Request, typeVersion 4.3) has `options.batching = { batch: { batchSize: 1, batchInterval: 2500 } }`. n8n's HTTP node natively paces sends at one-per-2.5s. 422 × 2.5s ≈ **17.5 min** wall-time. `continueOnFail: true` is also already set. **Nothing needed for the stagger itself.**
2. **The post-send Airtable write was the actual silent-failure risk.** `Update Reminder Fields` and `Update Skipped Airtable` had **no** `retryOnFail`, **no** `onError`. A single failure (Airtable 5 req/s, validation error, transient 5xx) would throw the whole node — meaning **none** of the cohort's `last_reminder_sent_at` writes would land. The next 08:00 cron would then resend all 422 → exactly the duplicate-send scenario the user flagged.

## 2. User Requirements
1. **Q:** Send all on one day or spread? → **A:** One day, internal stagger.
2. **Q:** Stagger interval? → **A:** 2 seconds (current is 2500ms; kept — within tolerance, more conservative).
3. **Q:** Implementation path? → **A:** I write the n8n update via n8n-mcp.
4. **Q:** Schedule change? → **A:** Keep daily 08:00 cron unchanged.
5. **Q:** Reversibility? → **A:** Permanent — becomes the new baseline.

## 3. Research
### Domain
At-least-once scheduled-job dedup; node-level error handling in n8n.

### Sources
1. **DL-342** (in-repo) — established headroom math and bottleneck table.
2. **n8n docs — HTTP Request batching** (`options.batching`) — canonical built-in pacing for HTTP node, confirmed available since typeVersion 4.x.
3. **n8n docs — node error handling** — `onError: 'continueRegularOutput'` is the modern equivalent of legacy `continueOnFail: true`; `retryOnFail`/`maxTries`/`waitBetweenTries` work for transient failures (e.g. Airtable 429 / 5xx).

### Key Principles Extracted
- **Read the actual node config before designing changes.** DL-342's audit recommended actions that turned out to be already-implemented; the real gap was a different node entirely.
- **Resilience belongs on the *write* node, not just the *send* node.** Send Email is already hardened; the silent-failure mode shifts to whatever runs *after* the side-effect.
- **Retries with `onError: continueRegularOutput` is the right pattern for batch writes** — failed items fall through, successful items still emit, downstream gets accurate visibility.

### Patterns to Use
- Node-level `retryOnFail: true, maxTries: 3, waitBetweenTries: 1500, onError: 'continueRegularOutput'` on every Airtable update node that runs over a multi-item batch.

### Anti-Patterns Avoided
- Inserting a `Loop Over Items + Wait` node pair — would have duplicated functionality already provided by HTTP `batchInterval`.
- Lowering `batchInterval` from 2500 → 2000 to "match user's 2s ask" — a 3-min wall-time delta over 17 min isn't worth re-touching a working node.
- Touching `Filter Eligible` to fix DL-154's 24h-window bug pre-burst — high blast radius right before a 422-email run; defer.

### Research Verdict
The right change set is **two surgical node-level patches** to the post-send Airtable writes. Don't touch the send path, don't touch the schedule, don't touch the filter logic.

## 4. Codebase Analysis
### Existing Solutions Found (already in WF[06])
- `send_email_graph` (HTTP Request typeVersion 4.3): `batchSize: 1`, `batchInterval: 2500`, `continueOnFail: true`, `neverError: true`, `fullResponse: true`. Fully hardened.
- `Filter Eligible` (Code node): still uses `now - lastSent < DAY_MS` (DL-154 latent bug).
- Cron `0 8 * * *` (08:00 IL).
- `availableInMCP: true` (workflow stays MCP-visible).

### Gaps
- `update_reminder_fields` (Airtable typeVersion 2.1): no retry / onError flags.
- `update_skipped_airtable` (Airtable typeVersion 2.1): same gap, parallel skip-write path.

### Reuse Decision
Pure additive node-level config; no logic change, no rewiring, no new nodes.

### Dependencies
n8n cloud (`liozshor.app.n8n.cloud`), workflow `FjisCdmWc4ef0qSV`, Airtable base `appqBL5RWQN9cPOyh`.

## 5. Technical Constraints & Risks
- **Production workflow.** Active cron, fires daily at 08:00 IL. Implementation gate: ExitPlanMode + explicit "go" approval received.
- **MCP `availableInMCP` flag.** Project memory flags REST PUT as a flag-clobber risk; using `n8n_update_partial_workflow` (MCP) preserves it (verified post-update).
- **Risk of the change itself:** near-zero — adding retries + soft-error mode strictly improves safety; in the worst case the nodes behave exactly as before.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
After Day-1's 08:00 burst run, every successfully-sent reminder has `last_reminder_sent_at` written. Day-2 cron sees zero clients from the Day-1 cohort as "still due".

### Logic Flow (unchanged)
Schedule Trigger → Fetch Config → Search Due Reminders → Filter Eligible → Split by Type → (A | B build email) → Merge → Prepare Payload → Send Email (paced 2.5s) → Filter Sent → Set Update Fields → **Update Reminder Fields (now hardened)**.

Parallel skip path: → Filter Type B By Pending → Set Skip Fields → **Update Skipped Airtable (now hardened)**.

### Operations Applied (via `n8n_update_partial_workflow`)

| # | Op | Node | Updates |
|---|---|---|---|
| 1 | updateNode | `Update Reminder Fields` | `retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 1500`, `onError: 'continueRegularOutput'` |
| 2 | updateNode | `Update Skipped Airtable` | same |

### Files to Change
None in this repo. Pure n8n cloud op + design log artifacts.

### Final Step (Always)
- Status → `[IMPLEMENTED — NEED TESTING]`
- INDEX + current-status updated
- Commit on feature branch, push, no merge to main without approval

## 7. Validation Plan
### Pre-burst
- [x] MCP update applied (2/2 ops successful)
- [x] `n8n_get_workflow` JSON parsed: both nodes show `retryOnFail=True, maxTries=3, waitBetweenTries=1500, onError='continueRegularOutput'`
- [x] Send Email batching unchanged (`batchSize:1, batchInterval:2500`)
- [x] Cron unchanged (`0 8 * * *`)
- [x] Workflow active (`active: true`)
- [x] `availableInMCP` preserved (`settings.availableInMCP: true`)
- [ ] Open WF[06] in n8n UI — visually confirm both Airtable nodes show retry config in the Settings panel

### Day-1 of burst (08:00–08:30 IL)
- [ ] n8n executions tab: WF[06] run is green, processed expected count (~85–422 depending on date distribution)
- [ ] Total wall-time 5–18 min (consistent with batchInterval=2500ms × cohort size)
- [ ] Gmail "Sent" folder for `reports@moshe-atsits.co.il` matches cohort count
- [ ] Airtable `reminder_count` rollup increments for the cohort
- [ ] Airtable `last_reminder_sent_at` populated for every successfully-sent record

### Day-2 of burst
- [ ] Clients reminded yesterday do NOT re-appear in today's cohort (proves Update Reminder Fields wrote successfully + idempotency holding)
- [ ] If a yesterday-reminded client *does* re-appear → DL-154 24h-window bug surfaced → promote that DL from `[DRAFT]` to hot-fix

### End of week
- [ ] Total sent ≈ 422 (within ±5%). Larger discrepancy → follow-up DL.

## 8. Implementation Notes (Post-Code)
- Patch applied via `n8n_update_partial_workflow` MCP, two `updateNode` ops in a single call. Workflow remained active throughout (no deactivate/reactivate cycle needed for node-level prop changes via MCP).
- Verified post-update via `n8n_get_workflow({mode:'full'})` + JSON parse — all four flags present on both target nodes; `availableInMCP` preserved (MCP path, not REST PUT).
- DL-154 (calendar-date idempotency) still `[DRAFT]`; deliberately not bundled here. Will be hot-fixed only if Day-2 surfaces the 23.5h-drop bug.
- Research principle applied: "read the actual node config before designing changes" — caught the already-existing 2.5s stagger that DL-342 missed; redirected scope to the real gap (post-send Airtable writes).
