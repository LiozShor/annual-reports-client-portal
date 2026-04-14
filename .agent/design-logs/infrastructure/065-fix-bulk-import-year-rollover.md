# Design Log 065: Fix Bulk Import + Year Rollover
**Status:** [IMPLEMENTED]
**Date:** 2026-02-26
**Related Logs:** None (first design log for this flow)

## 1. Context & Problem
The `[Admin] Bulk Import` workflow has 5 bugs discovered during an expert advisory consultation. The workflow creates client + annual_report records when admins add clients via the admin panel. Additionally, no Year Rollover capability exists — when the next tax year begins, there's no way to create new annual_report records for existing clients.

**Bugs found:**
1. **Create Client node** references `clients[0]` (always first client) instead of current split item — batch imports create N identical records
2. **`report_uid`** generated as UUID but never written (`removed: true` in Airtable node)
3. **`questionnaire_token`** generated twice — UUID in code, overwritten by Crypto node hex
4. **`last_progress_check_at`** hardcoded to `"2026-01-19T15:53:18"` instead of dynamic
5. **No annual_report duplicate check** for same client+year

**Missing capability:**
- No Year Rollover flow — can't create new-year reports for existing clients
- Year dropdowns hardcoded to 2025
- Frontend uses native `confirm()` instead of `showConfirmDialog()`

## 2. User Requirements
*Q&A from discovery phase:*
1. **Q:** What scope should this design log cover?
   **A:** Full fix + Year Rollover — fix all bugs AND build the Year Rollover flow.

2. **Q:** What should we do with `report_uid`?
   **A:** Populate it — restore UUID write during import. Useful as public-facing opaque ID.

3. **Q:** How should partial batch failures be handled?
   **A:** Continue + report failures — if client 5 of 50 fails, continue processing 6-50. Return `{created: 49, failed: 1, errors: [...]}`.

4. **Q:** Has the bulk import been used with real data?
   **A:** Yes, small batch, already manually corrected. No automated cleanup needed.

5. **Q:** How should Year Rollover be triggered?
   **A:** Admin panel button — select target year, see preview, confirm to execute.

## 3. Research
### Domain
Batch Data Operations, Multi-Year CRM Patterns, n8n Error Handling

### Sources Consulted
1. **Stripe Blog: "Designing robust and predictable APIs with idempotency"** — Idempotency keys should be deterministic (email+year) for dedup, not random UUIDs. Multi-step operations need atomic phases.
2. **n8n Docs: Error Handling / Continue On Fail** — Per-node `continueOnFail` setting passes failed items through with error data. Use IF nodes to separate successes from failures after batch processing.
3. **n8n Docs: Loop Over Items (Split in Batches)** — Batch processing with result collection. Sequential processing gives control over memory/timing/errors.
4. **"Release It!" by Nygard (principles)** — Bulkheads, timeouts, circuit breakers. Match resilience to stakes — for admin-only batch operations, per-item error isolation with reporting is sufficient.

### Key Principles Extracted
- **Deterministic dedup keys** — Use email+year as the dedup key, not random values. Safe retries.
- **Continue on fail** — n8n's built-in mechanism lets failed items flow through. Filter out failures before downstream nodes.
- **Atomic autoNumber** — Airtable autoNumber is atomic; no race conditions for client_id generation.
- **No formula uniqueness** — Airtable formulas (like `report_key`) compute values but can't enforce uniqueness. Workflow must check.

### Patterns to Use
- **Per-item error isolation:** Enable `continueOnFail` on Airtable create nodes, add a Filter Failures node to separate successes/failures before continuing.
- **Preview + Execute pattern:** Year Rollover uses two-phase approach — preview shows counts without writing, execute creates records after confirmation.

### Anti-Patterns to Avoid
- **Static reference in loop:** `$('Verify & Extract').last().json.clients[0]` inside a split-item loop. Must use `$json` for current item.
- **Phantom field generation:** Generating values in code nodes that are never persisted. Clean up dead code.

### Research Verdict
The current bugs are all straightforward fixes. Year Rollover should be a separate workflow (not a mode on Bulk Import) because it's a fundamentally different operation — reports-only for existing clients vs clients+reports for new clients.

## 4. Codebase Analysis
### Relevant Files
| File | Purpose |
|------|---------|
| n8n `DjIXYUiERMe-vMYnAImuO` | [Admin] Bulk Import — the broken workflow |
| `admin/index.html` | Admin panel HTML — hardcoded year dropdowns, import tab |
| `admin/js/script.js` | Admin panel JS — `performServerImport`, `addManualClient`, `showModal`, `showConfirmDialog` |
| `assets/js/resilient-fetch.js` | Fetch timeouts: quick(6s), load(10s), mutate(15s), slow(20s) |

### Existing Patterns
- Dashboard/Pending workflows filter by year: `filterByFormula: AND({year}=X)`
- `showModal(type, title, body, stats?)` — stats: `{created, skipped, sent}`
- `showConfirmDialog(message, onConfirm, confirmText, danger)` — callback-based
- All admin webhooks verify HMAC-SHA256 token with shared secret
- CORS `*` on all webhook responses

### Alignment with Research
- Schema is well-designed for multi-year (1:N clients→reports, year field) — aligns with CRM best practices
- Workflow implementation has bugs that violate basic data flow principles (static reference in loop)
- No idempotency protection on annual_report creation — needs workflow-level guard

## 5. Technical Constraints & Risks
* **Security:** questionnaire_token is sole auth for questionnaire access — Crypto node hex (256-bit) is appropriate
* **Risks:** Year Rollover for 500+ clients means 500+ Airtable creates. Rate limit = 5 req/s. n8n Airtable node has built-in rate limiting but may take 2+ minutes. `FETCH_TIMEOUTS.slow` (20s) may not be enough.
* **Mitigation:** Add new timeout tier `rollover: 120000` (2 min) in resilient-fetch.js for year rollover only.
* **Breaking Changes:** None — all changes are additive or bug fixes.

## 6. Proposed Solution (The Blueprint)

### Part 1: Fix [Admin] Bulk Import Workflow

**Add new node:** `Get Existing Reports` (Airtable Search)
- Table: `annual_reports`, filter: `{year}=TARGET_YEAR`
- Insert between `Get Existing Clients` → `Filter Duplicates`

**Fix `Filter Duplicates` code node:** Rewrite to:
- Reference both `Get Existing Clients` and `Get Existing Reports`
- Build email sets for both clients and reports
- Skip clients where email exists OR report for that year exists
- Remove dead `questionnaire_token` UUID generation
- Keep `report_uid` UUID generation

**Fix `Create Client` node:** Change expressions:
- `name`: `$json.name` (was `$('Verify & Extract').last().json.clients[0].name`)
- `email`: `$json.email` (was `$('Verify & Extract').last().json.clients[0].email`)

**Add new node:** `Filter Failures` (Code node)
- Insert between `Create Client` → `Crypto`
- Separates successful creates from failed ones
- Only passes successes to Crypto → Create Annual Report

**Fix `Create Annual Report` node:**
- Un-remove `report_uid` field, expression: `$('Split Clients').item.json.report_uid`
- Change `last_progress_check_at` to `{{ new Date().toISOString() }}`

**Enable `continueOnFail`** on `Create Client` and `Create Annual Report`

**Rewrite `Count Results` node:** Count successes, failures, skipped. Return `{ok, created, skipped, failed, errors}`.

**Revised flow:**
```
Webhook → Verify & Extract → If Valid → Get Existing Clients → Get Existing Reports → Filter Duplicates → Split Clients → Create Client [continueOnFail] → Filter Failures → Crypto → Create Annual Report [continueOnFail] → Count Results → Respond Success
```

### Part 2: New [Admin] Year Rollover Workflow

**Webhook:** POST `/admin-year-rollover`
**Input:** `{ token, source_year, target_year, mode: "preview"|"execute" }`

**Flow:**
```
Webhook → Verify & Extract → If Valid → Get Active Clients → Get Source Reports → Get Target Reports → Process Rollover → If Should Execute → Create Report [continueOnFail] → Count Results → Respond
```

**Process Rollover logic:**
- Cross-reference active clients + source year reports + target year reports
- Eligible = active clients with source report but no target report
- Preview mode: return counts + client list, don't create
- Execute mode: output eligible clients as items for batch creation

**Create Report fields:** client link, year, stage=1, questionnaire_token (hex), report_uid (UUID), last_progress_check_at (dynamic)

### Part 3: Frontend Changes

**Dynamic year dropdowns:** `populateYearDropdowns()` on DOMContentLoaded — generates years from `currentYear` to `currentYear - 2`.

**Year Rollover UI:** New card at bottom of Import tab with:
- Source year + Target year selectors
- "Preview" button → shows eligible count + already-exist count
- "Execute" button → confirmation dialog → creates reports

**showModal update:** Add `failed` stat with red styling (`var(--danger-500)`)

**Replace 3x `confirm()` calls:** `addManualClient` (line 740), `sendToAll` (line 847), `markComplete` (line 974) → all use `showConfirmDialog()` with callback pattern.

**New timeout:** Add `rollover: 120000` to FETCH_TIMEOUTS for the year rollover operation.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n `DjIXYUiERMe-vMYnAImuO` | Modify | Fix 5 bugs + add error isolation (2 new nodes, 5 node updates) |
| n8n NEW workflow | Create | [Admin] Year Rollover (~10 nodes) |
| `admin/index.html` | Modify | Remove hardcoded year options, add rollover card HTML |
| `admin/js/script.js` | Modify | Dynamic years, rollover functions, confirm() replacements, showModal update |
| `assets/js/resilient-fetch.js` | Modify | Add `rollover: 120000` timeout tier |

## 7. Validation Plan
* [ ] Import 3 clients in batch — verify each has DISTINCT name/email in Airtable
* [ ] Import 1 client manually — verify `report_uid` is populated (UUID format)
* [ ] Import 1 client — verify `last_progress_check_at` is current (not Jan 19)
* [ ] Import same email twice — verify dedup (skipped, not duplicate created)
* [ ] Year Rollover preview — verify correct eligible/existing counts
* [ ] Year Rollover execute — verify reports created with correct year, tokens, stage
* [ ] Year Rollover idempotency — run again, verify 0 new reports (all already exist)
* [ ] Partial failure — test that workflow continues if one Airtable create fails
* [ ] All 3 confirm() dialogs replaced — verify custom dialog appears, not native
* [ ] Year dropdowns show dynamic years (not hardcoded 2025)
* [ ] Dashboard loads correctly after import/rollover

## 8. Implementation Notes (Post-Code)

### Bugs Found During Testing (Session 53)

**Year Rollover Workflow (ODsIuVv0d8Lxl12R) — 4 bugs fixed:**
1. `URLSearchParams is not defined` — n8n Code node sandbox doesn't have this global. Abandoned fetch() approach entirely; reverted to proper Airtable nodes.
2. **Item multiplication** — 3 chained Airtable Search nodes each ran once per input item (1→5→20→80). Fixed by branching all 3 from `If Valid` in parallel + Merge node ("Wait For All") as a barrier before Process Rollover.
3. **Wrong branch routing** — `addConnection` with `sourceOutput: "0"` created `type: "0"` connections (invalid) instead of `type: "main"`. Must use `branch: "true"/"false"` for If nodes, and `replaceConnections` to clean stale entries.
4. **`$('Get Source Reports')` not executed** — Merge node `targetInput` parameter also created wrong type. Fixed with `replaceConnections` setting correct `index: 0/1/2` on all connections.

**Dashboard Workflow (AueLKVnkdNUorWVYfGUMG) — dynamic years:**
5. Added "Get Distinct Years" Airtable node + Merge → Format Response now returns `available_years` array.

**Frontend — 3 bugs fixed:**
6. **`304 Not Modified`** — Browser cached dashboard response missing `available_years`. Fixed with `&_t=Date.now()` cache-buster on fetch URL.
7. **Default year not updating** — `updateYearDropdowns()` preserved current selection (2025) instead of defaulting to newest. Fixed with `_yearsInitialized` flag — first call sets newest year; if year changed, reloads dashboard.
8. **Year filter not re-fetching** — `yearFilter` `onchange` called `filterClients()` (in-memory filter only). Changed to `loadDashboard()` so switching years re-fetches from API.

### n8n Lessons Learned
- **NEVER use `sourceOutput: "0"` (number-string)** for addConnection — use `branch: "true"/"false"` for If nodes
- **Merge node multi-input**: must use `replaceConnections` with `index: 0/1/2` to wire multiple inputs correctly
- **Parallel Airtable searches** need a Merge node as wait barrier before any Code node that references all 3 via `$('node').all()`
- **`replaceConnections`** is the safest way to fix corrupted connection state
