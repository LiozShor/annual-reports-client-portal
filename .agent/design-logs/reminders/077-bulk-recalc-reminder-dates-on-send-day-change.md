# Design Log 077: Bulk Recalculate Reminder Dates on send_day Change
**Status:** [DONE]
**Date:** 2026-03-02
**Related Logs:** DL-063 (settings dialog), DL-067 (initialize reminder_next_date on stage entry)

## 1. Context & Problem
When the admin changes `send_day` (day of month to send reminders) in the settings modal, only the config value is saved to Airtable's `system_config` table. Existing clients' `reminder_next_date` values are NOT recalculated. The new `send_day` only takes effect after a reminder is actually sent by WF[06], which computes the *next* date using the config.

**Result:** Admin sets send_day=2 expecting all reminders to move to the 2nd. Nothing happens until each client's existing date fires, then *after that* they get moved to the 2nd. This is confusing and defeats the purpose.

## 2. User Requirements
1. **Q:** Scope — all clients or only unsent?
   **A:** All clients in stages 2-3 with a `reminder_next_date`.

2. **Q:** Where should the bulk recalculation happen?
   **A:** n8n backend — one API call from frontend, backend does the work.

3. **Q:** Should overdue dates (in the past) be moved too?
   **A:** No — leave overdue dates alone so the scheduler picks them up immediately on next run.

## 3. Research
### Domain
Batch Scheduling, Config Change Propagation, Airtable Batch Operations

### Sources Consulted
1. **Airtable API Rate Limits** — 5 requests/sec per base, max 10 records per PATCH. For ~500 clients: 50 PATCH calls needed, ~10 seconds at rate limit. Manageable in a single n8n execution.
2. **Stripe/Chargebee Billing Date Changes** — When billing anchor date changes, these systems recalculate all future invoice dates immediately. The pattern: save config + propagate to all affected records in one transaction.
3. **"Release It!" — Michael Nygard** — Idempotent operations: recalculating dates from config is naturally idempotent — running it twice produces the same result. Safe to retry on failure.

### Key Principles Extracted
- **Immediate propagation:** Config changes should be visible immediately, not on a delayed basis. Users expect "save" to mean "applied."
- **Idempotent by design:** Date computation from `send_day` is pure function of (today, send_day) — safe to retry.
- **Preserve overdue intent:** Overdue dates represent clients who SHOULD be contacted ASAP. Moving them forward defeats urgency.

### Patterns to Use
- **Config save + cascade:** Save the config value, then immediately search + batch-update all affected records.
- **Airtable batch loop:** Process records in batches of 10 (Airtable max per PATCH).

### Anti-Patterns to Avoid
- **Frontend batch calls:** Having the frontend send individual update calls per client. Network-heavy, fragile, slow.
- **Moving overdue dates:** Would delay overdue reminders — opposite of what admin wants.

### Research Verdict
Add a cascade step after `update_config` for `reminder_send_day`: search all stage 2-3 records with future `reminder_next_date`, batch-update them to the next occurrence of the new `send_day`. This is the Stripe/Chargebee pattern adapted for Airtable.

## 4. Codebase Analysis
* **[API] Reminder Admin** (`RdBTeSoqND9phSfo`) — 17 nodes. Current `update_config` flow:
  - `Parse Action` → `IF Config Update` (true) → `Update Config` (Airtable upsert on `system_config`) → `Respond POST`
  - `Parse Action` already has a `change_all_dates` action stub (returns `_bulk_update: true`) but it's not wired to anything useful.
* **`Update Config` node** (`update_config`): Airtable upsert on `tblqHOkDnvb95YL3O` (system_config), keyed by `config_key`.
* **`Search Reminder Records` node** (`search_reports`): Already searches `tbls7m3hmHC4hhQVy` for stages 2-3. Same query we need.
* **Frontend** (`admin/js/script.js` lines 3076-3102): `doSaveReminderSettings()` makes two parallel API calls for `reminder_default_max` and `reminder_send_day`. After both succeed, calls `loadReminders(true)` to refresh.
* **WF[06] date computation** (from DL-067 and session 51):
  ```javascript
  if (sendDay) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), sendDay);
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    nextDate = candidate.toISOString().split('T')[0];
  }
  ```

## 5. Technical Constraints & Risks
* **Airtable rate limits:** 5 req/sec, 10 records/batch. 500 clients = 50 batches = ~10 seconds. Acceptable.
* **n8n execution time:** Webhook must respond before timeout. The `update_config` action currently responds immediately. Adding a cascade means the response waits for batch updates. With ~500 records, ~10-15 seconds. Frontend timeout is `FETCH_TIMEOUTS.mutate` — need to verify it's sufficient.
* **No breaking changes:** Existing `update_config` for `reminder_default_max` should NOT trigger bulk date recalc — only `reminder_send_day` changes should.
* **Idempotency:** Pure function of (today, new_send_day). Safe to retry.
* **Concurrency:** If scheduler runs during bulk update, some records may get double-updated. Harmless — both compute the same date from the same `send_day`.

## 6. Proposed Solution (The Blueprint)

### Approach: Add cascade logic to the `update_config` path in [API] Reminder Admin

After saving `reminder_send_day` to system_config, search all stage 2-3 records with future `reminder_next_date` and batch-update them to the next occurrence of the new day.

### Logic Flow
1. Frontend calls `update_config` with `config_key: 'reminder_send_day'`, `config_value: '2'`
2. `Parse Action` detects `update_config` → sets `_config_update: true` (existing)
3. `IF Config Update` → true → `Update Config` saves to system_config (existing)
4. **NEW:** After `Update Config`, check if `config_key === 'reminder_send_day'`:
   - If yes → search `annual_reports` for stages 2-3, filter to future `reminder_next_date > TODAY`
   - Compute new date: next occurrence of `send_day` (same logic as WF[06])
   - Batch update all matching records' `reminder_next_date`
   - Respond with `{ ok: true, action: 'update_config', dates_updated: N }`
   - If no → respond immediately (existing behavior for `reminder_default_max`)

### Implementation Options

**Option A: Code node after Update Config**
Add a Code node that:
1. Checks if `config_key === 'reminder_send_day'`
2. If not, passes through to Respond POST
3. If yes, uses n8n's built-in HTTP Request to call Airtable API directly:
   - GET all stage 2-3 records with future dates
   - Batch PATCH in groups of 10

**Option B: New nodes (Search + Loop + Update)**
Add Airtable Search + SplitInBatches + Airtable Update nodes after Update Config.

**Recommendation: Option A** — A single Code node is simpler, fewer nodes, and the Airtable API calls are straightforward. We already have the base ID and API key available.

Actually, **revised recommendation: Option B** — Using native n8n Airtable nodes is more maintainable and follows n8n best practices. The search node already exists as a pattern (`search_reports`). We need:
1. An IF node checking `config_key === 'reminder_send_day'`
2. A Code node to compute the new date
3. An Airtable Search node for future-dated stage 2-3 records
4. A Code node to set the new date on each record
5. An Airtable Update node (batch mode)

**Final recommendation: Hybrid** — Add a Code node after `Update Config` that:
- If key !== `reminder_send_day`, passes through unchanged
- If key === `reminder_send_day`, calls Airtable API to search + batch update, returns count

This keeps node count low (+1 node) while being self-contained.

### The Code Node Logic
```javascript
const configKey = $json.config_key;
const configValue = $json.config_value;

// Only cascade for send_day changes
if (configKey !== 'reminder_send_day') {
  return [{ json: { config_key: configKey, config_value: configValue, dates_updated: 0 } }];
}

const sendDay = parseInt(configValue);
if (isNaN(sendDay) || sendDay < 1 || sendDay > 28) {
  return [{ json: { config_key: configKey, config_value: configValue, dates_updated: 0 } }];
}

// Compute new date: next occurrence of sendDay
const now = new Date();
const today = now.toISOString().split('T')[0];
const candidate = new Date(now.getFullYear(), now.getMonth(), sendDay);
if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
const newDate = candidate.toISOString().split('T')[0];

// Search for all stage 2-3 records with future reminder_next_date
const BASE_ID = 'appqBL5RWQN9cPOyh';
const TABLE_ID = 'tbls7m3hmHC4hhQVy';
const API_KEY = $env.AIRTABLE_API_KEY; // or however the key is accessed

const searchFormula = `AND(OR({stage}='2-Waiting_For_Answers',{stage}='3-Collecting_Docs'),{reminder_next_date}>'${today}')`;
const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=${encodeURIComponent(searchFormula)}&fields[]=reminder_next_date`;

// Fetch all matching records (paginate if needed)
let allRecords = [];
let offset = null;
do {
  const url = offset ? `${searchUrl}&offset=${offset}` : searchUrl;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  const data = await resp.json();
  allRecords = allRecords.concat(data.records || []);
  offset = data.offset;
} while (offset);

// Filter out records already on the correct date
const toUpdate = allRecords.filter(r => r.fields.reminder_next_date !== newDate);

// Batch update in groups of 10
let updated = 0;
for (let i = 0; i < toUpdate.length; i += 10) {
  const batch = toUpdate.slice(i, i + 10);
  const patchBody = {
    records: batch.map(r => ({ id: r.id, fields: { reminder_next_date: newDate } }))
  };
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody)
  });
  updated += batch.length;
  // Small delay to respect rate limits
  if (i + 10 < toUpdate.length) await new Promise(r => setTimeout(r, 220));
}

return [{ json: { config_key: configKey, config_value: configValue, dates_updated: updated } }];
```

### n8n Airtable Credentials
Need to check how the workflow accesses Airtable — via credential ID (not raw API key). The Code node may need to use `$helpers` or the existing credential. Will verify during implementation.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n `RdBTeSoqND9phSfo` | Modify | Add "Cascade Send Day" Code node after `Update Config`, before `Respond POST` |
| `admin/js/script.js` | Modify | Update `doSaveReminderSettings` to show count of updated dates in toast |

### Frontend Change (minor)
After saving, if the API response for `reminder_send_day` includes `dates_updated > 0`, show it in the toast:
```
"הגדרות תזכורות עודכנו (X תאריכים עודכנו)"
```

## 7. Validation Plan
* [ ] Change send_day from blank to 15 → all future-dated clients move to the 15th
* [ ] Change send_day from 15 to 2 → all future-dated clients move to the 2nd (next occurrence)
* [ ] Overdue clients (past dates) are NOT changed
* [ ] Clients already on the correct day are skipped (no unnecessary updates)
* [ ] `reminder_default_max` config change does NOT trigger date recalc
* [ ] Toast shows count of updated dates
* [ ] Reload reminder list → dates reflect the new send_day

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
