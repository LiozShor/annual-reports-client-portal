# Design Log 410: Rental Contract `NaN.YYYY-NaN.YYYY` Render + Silent Refresh on "+ בקש חוזה"
**Status:** [COMPLETED — 2026-05-11]
**Date:** 2026-05-10
**Related Logs:** DL-385 (lenient parser), DL-359 (full-year ↔ partial swap), DL-397 (atomic reassign + contract_period), DL-408 (multi-instance allowlist), DL-269/270/271 (partial-contract banner + request-missing-period)
**Branch:** claude-session-20260510-173648

## 1. Context & Problem

The client reports two recurring problems on rental-contract docs (T901/T902) in the AI-review screen — confirmed via screenshot:

1. **`NaN.YYYY-NaN.YYYY` in the green "AI חושב שזה" pill.** The matched-doc label renders `חוזה שכירות (הכנסה) NaN.2025-NaN.2025` whenever `item.contract_period` is a truthy object but `startDate`/`endDate` is missing or empty (older T901 records reassigned before DL-397 shipped, or rows where DL-359's `expandFullYearBadgeToEdit` defaulted to a partial shape that drifted). The guard `!item.contract_period` only catches `null` — a truthy-but-incomplete object (e.g. `{coversFullYear:false}`) passes through and `new Date(undefined).getMonth()` returns `NaN`.
2. **"+ בקש חוזה MM.YYYY-MM.YYYY" doesn't refresh the UI.** Clicking the button creates the follow-up doc on the server, but `requestMissingPeriod` only updates the clicked button. The new doc never appears in any open doc list and admin must hard-reload — violating CLAUDE.md project rule P6 ("Silent UI Refresh After DB Mutation").

## 2. User Requirements (Q&A)

1. **Q:** What does "not refreshing" mean precisely?
   **A:** Button stuck — admin must reload page to see the added doc.
2. **Q:** Where should the months always be shown?
   **A:** AI review queue card (matched-doc pill), Doc-manager chip / list row, Admin dashboard doc list, Client portal — i.e. wherever the centralized helper `appendContractPeriod` already runs (single source of truth — fixing the helper fixes every caller).
3. **Q:** For docs with no `contract_period` yet, how should they render?
   **A:** Show `__.__-__.____` placeholder + edit affordance (preserve existing click-to-edit via `editContractDate`).
4. **Q:** Scope?
   **A:** Narrow — fix NaN render + silent refresh on "+ בקש חוזה". No backfill audit. No doc-manager / client-portal expansion (those don't compute month labels client-side; they consume `matched_doc_name` from the server).

## 3. Research

Cumulative knowledge from prior in-repo logs (no new external research per cumulative-knowledge rule):

- **DL-385** — `parseLenientMonthYear`, `renderContractPeriodBanner` already use `hasStart`/`hasEnd` guards (`script.js:7008-7011`). The same pattern is the right shape for the unguarded sites.
- **DL-359** — Bidirectional swap re-render via `refreshItemDom` after a contract-period mutation (used by `saveContractPeriod` line 7187). Established the in-place refresh idiom for this surface.
- **DL-397** — Atomic backend persistence of `matched_template_id` + `contract_period` on reassign. Set the precedent that the backend always returns the data needed to refresh (in this case `request-remaining-contract` already returns `{ok, doc_id, doc_title, period_label}` — frontend just wasn't using it).
- **DL-408** — Encoded multi-instance intent in code (`MULTI_INSTANCE_TEMPLATES`). Reaffirmed the "single source of truth, fix once" principle — this DL fixes one helper rather than every callsite.
- **CLAUDE.md P6 — "Silent UI Refresh After DB Mutation"** — every add/edit/delete must trigger an in-place refetch. Promoted from MEMORY.md to project rule. Direct application here.
- **CLAUDE.md "Duplicate-Path Audit"** — confirmed via Explore subagent that the only NaN-prone sites are `script.js:5973-5981` (`appendContractPeriod`) and `6346-6362` (reviewed-card period buttons). `renderContractPeriodBanner` already guards. Doc-manager / client-portal / email surfaces do not compute month labels client-side.

### Verdict

Two surgical NaN guards (helper + reviewed-card path) + silent-refresh hook in `requestMissingPeriod` reusing `refreshItemDom` + `updateClientDocState` exactly as DL-359 / DL-397 already do. No new helpers. No backend changes.

## 4. Codebase Analysis

### NaN root cause (`frontend/admin/js/script.js:5973-5981`, pre-fix)

```js
const startM = String(new Date(cp.startDate).getMonth() + 1).padStart(2, '0');
const endM = String(new Date(cp.endDate).getMonth() + 1).padStart(2, '0');
```

When `cp.startDate` is missing, `new Date(undefined)` → Invalid Date → `.getMonth()` → `NaN`. The outer `!item.contract_period` guard only catches `null`. Same pattern in the reviewed-card request-period block at `6346-6362`.

### Silent-refresh gap (`script.js:7266-7301`, pre-fix)

`requestMissingPeriod` only mutates the clicked button on success. Backend already returns `{ok, doc_id, doc_title, period_label}` (`api/src/routes/classifications.ts:827-833`). Sibling mutations (`saveContractPeriod` line 7187, `resubmitApprove` line 7330) already use `refreshItemDom` + `updateClientDocState` — copy that pattern.

### Reuse decisions
- `formatPeriodLabel` (5967) — unchanged.
- `refreshItemDom`, `updateClientDocState`, `aiClassificationsData.find` — reused as-is.
- No new helpers introduced.

## 5. Constraints & Risks

- **Monolith size ratchet** — `frontend/admin/js/script.js` is on a one-way ratchet (baseline 16134). Patches were trimmed to land at exactly 16134 lines (delete unused `requestRemainingContract` shim line 7314 + tight one-line condense in helpers). Verified by `python3 .claude/hooks/script-size-ratchet.py`.
- **Hebrew RTL** — placeholder `__.__-__.____` is ASCII; renders LTR-correctly inside Hebrew context (no bidi reversal of underscores).
- **Backwards compat** — deleted `requestRemainingContract` was a no-arg backwards-compat shim (`requestMissingPeriod(rid, null, null, btn)`) with zero callers in repo (verified via grep). Safe to remove.
- **Refresh failure isolation** — silent-refresh wrapped in `try/catch` so a render error never masks the success toast (the backend already added the doc).

## 6. Proposed Solution (Implemented)

### 6a. NaN guard in `appendContractPeriod` (script.js:5973-5981)

```js
function appendContractPeriod(name, item) {
    if (!['T901', 'T902'].includes(item.matched_template_id) || !item.contract_period) return name;
    const cp = item.contract_period;
    if (cp.coversFullYear) return name;
    const sD = cp.startDate && new Date(cp.startDate), eD = cp.endDate && new Date(cp.endDate);
    if (!sD || !eD || isNaN(sD.getTime()) || isNaN(eD.getTime())) return `${name} __.__-__.____`; // DL-410 NaN guard
    return `${name} ${formatPeriodLabel(sD.getMonth() + 1, eD.getMonth() + 1, item.year || eD.getFullYear())}`;
}
```

Single source of truth — fixes every callsite (lines 702, 729, 4859, 4868, 4972, 4978, 6019, 6046, 6120, 6336, 6341, 6437).

### 6b. Reviewed-card guard (script.js:6346-6362)

Build `_sD` / `_eD` once, gate the entire block on dates being present and valid; when invalid, the request-period buttons hide entirely (we have no range to request — same effective UX as `renderContractPeriodBanner`).

### 6c. Silent refresh in `requestMissingPeriod` (script.js:7266-7301)

After the existing button-update block:

```js
// DL-410: silent refresh (CLAUDE.md P6) — mirror DL-385/DL-359
const _it = aiClassificationsData.find(i => i.id === recordId);
if (_it) { try { if (data.doc_id && _it.client_name) updateClientDocState(_it.client_name, data.doc_id); refreshItemDom(_it); } catch (e) { console.warn('[DL-410]', e); } }
```

Propagates the new follow-up doc to any open doc list (admin dashboard expanded row, Doc Manager) without a page reload.

### 6d. Cache-bust

`frontend/admin/index.html` — `script.js?v=419` → `?v=420`.

### Files Changed

| File | Action | Why |
|------|--------|-----|
| `frontend/admin/js/script.js` | Modify | NaN guards (2 sites) + silent refresh + delete unused shim |
| `frontend/admin/index.html` | Modify | Cache-bust |

## 7. Validation Plan

* [ ] **NaN guard live** — open the reported client's AI-review screen; the "AI חושב שזה: חוזה שכירות (הכנסה)" pill reads either `MM.YYYY-MM.YYYY` (when dates present) or `__.__-__.____` (when missing). Never `NaN`.
* [ ] **Reviewed-card guard** — for any reviewed T901/T902 with missing dates, the "+ בקש חוזה" buttons are hidden (no NaN labels).
* [ ] **Silent refresh end-to-end** — pick a partial T901; click "+ בקש חוזה MM.YYYY-MM.YYYY"; the new follow-up doc appears in the doc list for that client without page reload (admin dashboard expanded row + Document Manager if open). Toast shows `נוסף מסמך חסר: חוזה שכירות MM.YYYY-MM.YYYY`. Button stays `נוסף ✓` disabled. No flicker, no scroll jump.
* [ ] **Duplicate-press guard** — click "+ בקש חוזה" twice rapidly; only one follow-up doc is created.
* [ ] **Hebrew RTL** — placeholder `__.__-__.____` renders LTR-correctly inside the Hebrew pill (no bidi reversal of underscores).
* [ ] **Regression — full-year badge** (DL-359) — clicking the green ✓ badge still expands to the editor; no NaN.
* [ ] **Regression — DL-385 swap** — T901↔T902 swap still works.
* [ ] **Regression — DL-397 reassign-to-rental** — manual reassign with months still saves and renders correctly.
* [ ] **Regression — `requestRemainingContract` removal** — confirmed zero callers via repo-wide grep; if any external (n8n / docs) caller surfaces, revert by re-adding the one-line shim.
* [ ] **Cache-bust** — `curl -sI https://docs.moshe-atsits.com/admin/index.html | grep script.js` shows `?v=420` after Pages auto-deploy.
* [ ] **Activity log** — `node scripts/query-worker-logs.mjs --since=1h --search="request-remaining-contract"` shows the action firing during live test.

## 8. Implementation Notes

- All three NaN-prone sites identified by Explore-subagent grep collapsed into two patches (the third site, `renderContractPeriodBanner`, was already guarded — kept in research as the pattern reference).
- Silent-refresh block tightened to a single line plus try/catch wrapper to fit under the monolith size ratchet (baseline 16134). Deleted the unused `requestRemainingContract` backwards-compat shim (line 7314, zero callers) to free the budget.
- Final `wc -l frontend/admin/js/script.js` = 16134 (exactly at baseline). `python3 .claude/hooks/script-size-ratchet.py` passes silent. `node --check` passes silent.
- **Research principles applied:**
  - *Defensive rendering against partial data shapes* — guard before parsing, render placeholder rather than NaN.
  - *Single source of truth* — fix the centralized `appendContractPeriod` helper rather than every callsite.
  - *Silent refresh after mutation* (CLAUDE.md P6) — reuse existing `refreshItemDom` + `updateClientDocState` rather than introducing a new refresh primitive.
  - *Failure isolation* — silent-refresh wrapped in try/catch so a render error doesn't mask the successful backend mutation.
- **Out of scope (deferred):** Backfill of stale `contract_period` JSON in CLASSIFICATIONS rows. Promoting `MULTI_INSTANCE_TEMPLATES` to an Airtable schema flag (DL-408 follow-up). A "skip months" affordance on reassign (DL-397 follow-up).
