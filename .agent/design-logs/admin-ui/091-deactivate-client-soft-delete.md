# Design Log 091: Deactivate Client (Soft Delete)
**Status:** [DRAFT]
**Date:** 2026-03-04
**Related Logs:** DL-052 (unmatched email senders — only place `is_active` is used), DL-065 (bulk import), DL-089 (PII removal from URLs)

## 1. Context & Problem
The admin panel has no way to remove or hide clients. When a client relationship ends (stopped working with the firm, duplicate record, test data), there's no option but to leave them in the active client list. This clutters the dashboard and means deactivated clients still receive automated reminder emails.

The `is_active` checkbox field already exists in the Airtable `clients` table but is essentially unused (only referenced in WF[05] for client matching).

## 2. User Requirements
1. **Q:** Soft delete or hard delete?
   **A:** Soft delete — set `is_active=false`, hide from dashboard but keep data. Reversible.
2. **Q:** Where should the delete button appear?
   **A:** Per-row action button in the dashboard table.
3. **Q:** What about OneDrive folders?
   **A:** Leave as-is — only affect Airtable records.
4. **Q:** Archived clients visibility?
   **A:** Archive filter — toggle to view deactivated clients separately, with reactivate option.

## 3. Research
### Domain
Data Lifecycle Management, Destructive Action UX, CRM Archival Patterns

### Sources Consulted
1. **"Designing Data-Intensive Applications" — Kleppmann** — State changes as immutable events; "deletion" = an event, not mutation
2. **"Avoiding the Soft Delete Anti-Pattern" — Cultured Systems (2024)** — `deleted_at` flags bleed into every query; explicit lifecycle states are the correct model
3. **"Soft Deletion Probably Isn't Worth It" — brandur.org** — 10+ yrs at Stripe/Heroku, zero successful undeletions. `deleted_at` breaks FK integrity
4. **NNG — Confirmation Dialogs** — Only work when rare and specific. Overuse → habituation
5. **NNG — Proximity of Consequential Options** — Destructive actions near benign ones cause accidental triggers
6. **UX Guide to Destructive Actions — Medium/Bootcamp** — Type-to-confirm, undo toasts, verb-noun button labels
7. **Stripe API — Delete vs Archive** — Uses `active: false` for resources needing historical tracking; permanent delete only where no referential risk
8. **HubSpot Community** — No native archive = widely-cited UX gap
9. **SugarCRM — Data Archiver** — Enterprise CRMs move archived records to separate table, not just a flag

### Key Principles Extracted
- **Deactivation = lifecycle state, not deletion flag** — Use `is_active` as explicit state, not `deleted_at` timestamp
- **Irreversibility determines friction level** — Deactivation (reversible) gets confirmation dialog with consequences; reactivation (safe) needs no confirmation
- **Every query must honor status** — All workflows touching clients must filter by `is_active`
- **Referential integrity preserved** — Leave all linked records (annual_reports, documents) intact (Stripe pattern)
- **Spatial separation** — Deactivate button physically last in actions column (NNG proximity rule)

### Patterns to Use
- **Confirmation dialog with consequence language:** Specific to client name + what stops (reminders, dashboard visibility). Verb-noun button: "השבת לקוח" not "כן"
- **Optimistic UI with undo toast:** Remove from list immediately, show persistent toast with undo action button
- **Archive toggle filter:** Separate filter button to switch between active/archived views

### Anti-Patterns to Avoid
- **`deleted_at` timestamp flag** — Every query needs NULL check; in n8n Airtable Search, a missed filter exposes deleted records
- **Generic "Are you sure?" modal** — Users click through without reading
- **UI-only filtering without workflow guards** — If reminder scheduler doesn't check `is_active`, deactivated clients still get emails

### Research Verdict
Use the existing `is_active` checkbox as an explicit lifecycle state. Add a `client_is_active` lookup in `annual_reports` to propagate the flag without extra API calls. Confirmation dialog for deactivation (with consequences), no confirmation for reactivation. Optimistic UI with undo toast.

## 4. Codebase Analysis
* **Admin panel table:** `admin/js/script.js:237-328` — `renderClientsTable()` renders 5 columns. Actions column (lines 313-320) shows send/reminder buttons conditionally by stage. No danger button variant exists.
* **API pattern:** All mutations use `fetchWithTimeout(${API_BASE}/endpoint, {method:'POST', headers:{'Authorization':'Bearer ${authToken}'}, body:JSON.stringify(...)}, FETCH_TIMEOUTS.mutate)`. Optimistic UI update, revert on error, `showAIToast` on success.
* **Confirm dialog:** `showConfirmDialog(message, onConfirm, confirmText, danger)` — callback-based, not promise.
* **Toast:** `showAIToast(msg, type, {label, onClick})` — 3rd arg makes persistent with action button.
* **Existing filters:** `index.html:117-140` — search input, stage dropdown, year dropdown. No archive mechanism.
* **CSS:** `admin/css/style.css` — `.action-btn` variants for view/send/complete/reminder. No danger variant. Design system has `--danger-50/100/700` tokens ready.
* **Dashboard endpoint:** `GET /admin-dashboard` with Bearer auth (script.js:172). Workflow ID not in `docs/workflow-ids.md` — needs lookup.
* **`is_active` field:** Exists in clients table, only used in WF[05] `at-fetch-active-clients` node.
* **`recalculateStats()`:** (script.js:583-598) Counts clientsData by stage, updates stat cards.

## 5. Technical Constraints & Risks
* **Airtable `is_active` default:** All existing clients have `is_active` unchecked (false). Must bulk-set all existing clients to `is_active=true` BEFORE deploying, or they'll vanish from dashboard.
* **Dashboard workflow ID unknown** — not in workflow-ids.md. Must discover via `n8n_list_workflows`.
* **Lookup field filterability:** Airtable lookup fields may not work in filter formulas for all n8n node versions. Fallback: Code node post-filter.
* **No breaking changes:** Feature is purely additive. Existing API contracts unchanged.

## 6. Proposed Solution (The Blueprint)

### Pre-requisite: Airtable Bulk Update
Before any code deploys, bulk-set `is_active = true` on ALL existing client records.

### Step 1: Airtable Schema
Add `client_is_active` lookup field on `annual_reports` table → pulls `is_active` from linked `clients` record.

### Step 2: n8n — Update Admin Dashboard Workflow
- Discover workflow ID (search for `admin-dashboard` webhook path)
- Find the Code node that builds the clients array
- Add `is_active: record.fields.client_is_active ?? true` to each client object
- Stats remain unaffected (count from active data)

### Step 3: n8n — New `[API] Admin Toggle Active` Workflow
Webhook: `POST /admin-toggle-active`
Body: `{ report_id, active: boolean }` + Bearer auth header

Nodes:
1. Webhook → 2. Validate token (Code) → 3. Airtable Search annual_reports by record_id → 4. Extract client record ID → 5. Airtable Update clients `is_active` → 6. Respond `{ ok, is_active }`

### Step 4: Frontend — `admin/js/script.js`

**New state variable** (after line 18):
```js
let showArchivedMode = false;
```

**Modify `loadDashboard()`** (line 172): No server-side archive filtering needed initially — filter client-side for simplicity. The dashboard returns `is_active` per client; JS filters locally.

**Modify `renderClientsTable()`** (line 319): Add deactivate/reactivate button as last action in row:
- Active view: `user-x` icon, `.action-btn.deactivate`, calls `deactivateClient()`
- Archived view: `user-check` icon, `.action-btn.reactivate`, calls `reactivateClient()`

**New function `deactivateClient(reportId, name)`:** Shows `showConfirmDialog` with consequence text + danger=true. On confirm → `executeToggleActive(reportId, false)`.

**New function `reactivateClient(reportId, name)`:** Direct call to `executeToggleActive(reportId, true)` — no confirmation (safe/reversible).

**New function `executeToggleActive(reportId, active)`:**
1. Optimistic: splice client from `clientsData`, re-render, recalculate stats
2. POST `/admin-toggle-active` with `{ report_id, active }`
3. On success: `showAIToast` with undo action button (`{ label: 'בטל', onClick: () => executeToggleActive(reportId, !active) }`)
4. On error: revert splice, re-render, show error toast

**New function `toggleArchiveMode()`:** Toggle `showArchivedMode`, update button label, re-filter `clientsData` (local filter by `is_active`), hide stats grid in archived mode.

**Modify `filterClients()`:** Add `is_active` filter based on `showArchivedMode`.

### Step 5: Frontend — `admin/index.html`
Add archive toggle button in `.filters` div (after line 139):
```html
<div class="filter-group">
    <button id="archiveToggleBtn" class="btn btn-sm btn-ghost archive-toggle-btn" onclick="toggleArchiveMode()">
        <i data-lucide="archive" class="icon-sm"></i> לקוחות מושבתים
    </button>
</div>
```

### Step 6: Frontend — `admin/css/style.css`
Add after existing `.action-btn` variants (~line 1148):
```css
.action-btn.deactivate { background: var(--danger-50); color: var(--danger-700); }
.action-btn.deactivate:hover { background: var(--danger-100); }
.action-btn.reactivate { background: var(--success-50); color: var(--success-700); }
.action-btn.reactivate:hover { background: var(--success-100); }
.archive-toggle-btn { white-space: nowrap; color: var(--gray-500); border: 1px solid var(--gray-200); }
.archive-toggle-btn.active { background: var(--warning-50); color: var(--warning-700); border-color: var(--warning-200); }
```

### Step 7: Workflow Guards (Scope)
| Workflow | Change | Priority |
|----------|--------|----------|
| [06] Reminder Scheduler | Add `{client_is_active}=TRUE()` to Airtable filter | This PR — prevents emailing deactivated clients |
| Dashboard | Return `is_active` field | This PR |
| WF[05] | Already filters by `is_active` | No change |
| [01] Send Questionnaires | Manual selection, admin controls | Defer |

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add state var, 4 new functions, modify renderClientsTable + filterClients |
| `admin/index.html` | Modify | Add archive toggle button in filters |
| `admin/css/style.css` | Modify | Add .action-btn.deactivate/.reactivate + .archive-toggle-btn |
| n8n: Admin Dashboard WF | Modify | Add `is_active` to client response |
| n8n: New Toggle Active WF | Create | POST /admin-toggle-active endpoint |
| n8n: [06] Reminder Scheduler | Modify | Add is_active guard to Airtable filter |
| `docs/workflow-ids.md` | Modify | Add new workflow ID |
| `docs/airtable-schema.md` | Modify | Document client_is_active lookup field |

## 7. Validation Plan
* [ ] Bulk-set all existing clients to `is_active=true` in Airtable
* [ ] Verify `client_is_active` lookup field populates correctly
* [ ] Dashboard loads normally (all clients visible, no regressions)
* [ ] Deactivate button appears on each row
* [ ] Click deactivate → confirmation dialog with client name + consequences
* [ ] Confirm → client removed from list, undo toast appears
* [ ] Click undo → client reappears in list
* [ ] Toggle to archived view → only deactivated clients shown
* [ ] Reactivate button in archived view → client moves back to active
* [ ] Stats hide in archived mode, show in active mode
* [ ] Deactivated client does NOT receive reminder emails (test via [06] scheduler)
* [ ] Error handling: network failure → optimistic update reverts

## 8. Implementation Notes (Post-Code)
* *Log deviations here during implementation.*
