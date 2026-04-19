# Behavior Baseline — Pre-React Inventory
**Status:** Not started | **Depends on:** none
**Estimated effort:** 2–3 days (mostly grepping + one 30-minute live session)

## Goal
Produce three inventory documents that every panel migration plan must reference, so no function, handler, or network call in `frontend/admin/js/script.js` is silently dropped during the React migration. This plan is **discovery only** — it generates reference artifacts under `docs/baseline/`, it does not migrate any code.

## Preconditions
- `frontend/admin/js/script.js` is at 11,269 lines with ~48 section banners (`// ==== NAME ====`).
- Access to staging admin panel for the 30-minute live exercise in step 4.
- No in-flight refactor on script.js during the inventory run (to avoid a moving target).

## Steps
1. **Function inventory** — produce `docs/baseline/script-js-functions.md`:
   - Enumerate every top-level function declaration (`function X(...)`, `const X = (...) =>`, `X: function(...)` inside objects attached to `window`).
   - Columns: `name | line range | callers (grep count across repo) | external calls (fetch, Airtable endpoints, window globals) | orphan flag | cross-panel flag`.
   - Orphan = declared but zero call sites anywhere (including HTML `onclick=`, `frontend/shared/`, `frontend/assets/js/`, `frontend/admin/js/chatbot.js`, `frontend/admin/index.html`).
   - Cross-panel = function called from ≥2 section banners (these become shared utilities in React, not panel-local).

2. **Interaction inventory** — produce `docs/baseline/script-js-interactions.md`:
   - Every `addEventListener(...)`, `onclick=` assignment, keyboard shortcut (`keydown`/`keyup`), form `submit` handler, URL hash (`hashchange`, `location.hash` reads), `localStorage` read/write.
   - Columns: `trigger (event + target) | handler function | DOM target selector | side-effect summary (one sentence)`.
   - Include `window.addEventListener` globals.

3. **Network inventory** — produce `docs/baseline/script-js-network.md`:
   - Every `fetch(` invocation in script.js (and any indirect wrappers like `resilientFetch`).
   - Columns: `URL (or URL builder pattern) | method | caller function | request body shape (best-effort, document unknowns as "TBD") | response handling location (line/function)`.
   - Flag any fetch that fires from ≥2 call sites.

4. **Live exercise** — 30-minute staging session:
   - Exercise admin panel across all main tabs (dashboard, PA queue, questionnaires, reminders, review/approve, client detail).
   - Exercise keyboard shortcuts, bulk actions, mobile nav, popovers, context menus.
   - Log any observed behavior **not** present in the three inventories.
   - Add missing rows to the relevant inventory file before closing this plan.

5. **Cross-link** — in each per-panel React plan (03/01, future 03/02, ...), reference the exact line ranges from the function inventory that the panel is expected to cover.

## Risks
- **Dynamic dispatch blind spots** — handlers wired via `onclick="foo()"` in dynamically-built HTML strings will not appear in simple grep for event listeners. Mitigate by grepping for `onclick=` inside template-literal strings too.
- **Indirect call sites** — functions called via `window[funcName]()`, event delegation, or string-built handler names. Flag these manually during the live exercise.
- **Inventory rot** — if script.js changes between the inventory run and a panel migration, a row may be stale. Mitigate by recording the script.js git SHA at the top of each inventory file and re-running grep before each panel port.
- **n8n workflow code is external and not greppable** — n8n Cloud workflows live outside this repo. Any script.js function whose only "caller" is a webhook-triggered side effect (e.g., a page refresh after an n8n callback) will look orphaned in grep but is not safe to remove. Before marking any function as orphan, manually cross-check against the active n8n workflow list (workflows that call `/webhook/*` endpoints whose handlers mutate state the admin panel reads).
- **Hebrew string matching in fetch body shapes** — RTL text in grep output can break column alignment in the generated markdown. Emit as code-fenced cells.

## Rollback
- Inventory files are read-only artifacts. Deletion = removing `docs/baseline/`. No runtime effect.

## Acceptance criteria
- [ ] `docs/baseline/script-js-functions.md` lists every top-level function in script.js with all 6 columns populated.
- [ ] `docs/baseline/script-js-interactions.md` covers all event types listed in step 2.
- [ ] `docs/baseline/script-js-network.md` covers every `fetch(` call in script.js.
- [ ] Each inventory file records the script.js git SHA it was generated against.
- [ ] 30-minute live exercise on staging completed; any observed behavior not present in the inventories has been added.
- [ ] Per CLAUDE.md: live verification is the gate — do NOT mark `COMPLETED` on grep output alone.
- [ ] At least one per-panel React plan (03/01 dashboard-tiles) has been updated to cite rows from the inventories in its preconditions.

## Out of scope
- Any code changes to script.js, `frontend/shared/`, `frontend/assets/js/`, or `api/`.
- Inventory of `frontend/assets/js/document-manager.js` (3,925 lines, client portal) — separate baseline task if/when that migration is scheduled.
- Inventory of `api/src/` — Worker code already has TypeScript; separate concern.
- Automated tooling to generate the inventories (one-off grep + manual curation is acceptable for a one-shot baseline).
