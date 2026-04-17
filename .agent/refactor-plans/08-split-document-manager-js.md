# 08 — Split `frontend/assets/js/document-manager.js`

**Status:** PENDING
**Tier:** 🔴 Hard
**Est. effort:** 4–6 hr
**Branch:** `refactor/split-document-manager`

## Context
`frontend/assets/js/document-manager.js` is 3,925 LOC with ~100 top-level functions. It mixes rendering, wizard logic, upload handling, and detail modal into one file. The quality pass is mandatory before splitting — dead code and duplicate blocks must be removed first so they don't get enshrined in the new module structure. Done means Playwright flows on a live Airtable client complete without errors and the browser console is clean.

## Files touched
- `frontend/assets/js/document-manager.js` — 3,925 LOC (becomes thin bootstrap)
- `frontend/assets/js/dm/state.js` — new: module-level state store (getters/setters)
- `frontend/assets/js/dm/core.js` — new: init, data fetch, data normalization
- `frontend/assets/js/dm/render.js` — new: DOM rendering functions
- `frontend/assets/js/dm/wizard.js` — new: add-doc wizard flow
- `frontend/assets/js/dm/actions.js` — new: status change, waive, delete actions
- `frontend/assets/js/dm/questionnaire.js` — new: questionnaire send/edit
- `frontend/assets/js/dm/notes-edit.js` — new: inline notes editing
- `frontend/assets/js/dm/detail-modal.js` — new: client detail modal
- `frontend/assets/js/dm/upload.js` — new: file upload handler
- `frontend/assets/js/dm/switcher.js` — new: client/year switcher
- `frontend/assets/js/dm/utils.js` — new: shared pure helpers
- `frontend/assets/document-manager.html` — update `<script>` tags; migrate inline handlers where feasible

## Steps

### Phase 1 — Quality pass (mandatory, do not skip)
1. **Dead-code sweep:** `grep -n '^\s*//' frontend/assets/js/document-manager.js | wc -l` — then read and remove commented-out blocks >3 lines. Commit: `chore(dm): remove dead commented-out code`.
2. **Inline-handler inventory:** `grep -n 'onclick=\|onchange=\|oninput=\|onblur=\|onsubmit=' frontend/assets/document-manager.html` — list every inline handler. For each: decide if it can migrate to delegated `addEventListener` + `data-action`. Document remaining `window.X` handlers and why they can't be migrated. Commit inventory as `.agent/refactor-plans/dm-inline-handlers.md`.
3. **Duplicate-block hunt:** `sort frontend/assets/js/document-manager.js | uniq -c | sort -rn | head -30` — inspect top candidates. Collapse genuine duplicates into `utils.js` stubs (even before full split). Commit: `chore(dm): collapse duplicate helpers into utils stubs`.
4. **Function-size audit:** find functions >150 LOC (use node script or awk). Pre-split any that exceed limit in-place before restructuring. Commit per function split.
5. **State audit:** list every module-level `let`/`var` (selected docs, wizard state, etc.). Design `state.js` interface (getters/setters). This file gets created first in Phase 2.

### Phase 2 — Split (one module per commit)
6. Create `frontend/assets/js/dm/` directory.
7. Commit A: `state.js` — collect all shared mutable state into getter/setter exports.
8. Commit B: `utils.js` — pure helpers (formatting, validation) with no DOM or state dependencies.
9. Commit C: `core.js` — init + data fetch. Imports `state.js`.
10. Commit D: `render.js` — DOM builders. Imports `state.js`, `utils.js`.
11. Continue one module per commit through all dm/ files.
12. Update `document-manager.html` `<script>` tags to load `dm/*.js` files in dependency order. Migrate inline handlers identified in Phase 1 where feasible.
13. `document-manager.js` becomes a thin bootstrap: imports all modules, exposes remaining `window.X` for unavoidable inline handlers.
14. Final commit: `refactor(dm): document-manager.js → dm/ module folder`.

## Quality exit criteria
- `document-manager.js` bootstrap is ≤50 LOC.
- No function in any `dm/*.js` file exceeds 150 LOC: `awk '/^function|=> \{/{start=NR} /^\}$/{if(NR-start>150) print FILENAME, start, NR}' frontend/assets/js/dm/*.js` returns empty.
- Zero commented-out blocks >3 lines in any new file.
- Every `window.X` assignment is documented in `.agent/refactor-plans/dm-inline-handlers.md` with a justification.
- `state.js` is the only file with module-level mutable `let` variables — `grep -rn '^\s*let ' frontend/assets/js/dm/*.js | grep -v state.js` returns empty (or only `const`-equivalent block-scoped lets inside functions).
- Browser console zero errors/warnings when loading the document-manager page.

## Verification
- Playwright live flows on a real Airtable client record:
  1. Upload a document (upload flow)
  2. Change document status (actions flow)
  3. Run the add-doc wizard (wizard flow)
  4. Send questionnaire (questionnaire flow)
  5. Edit client detail (detail-modal flow)
  6. Change stage (switcher/actions flow)
- Browser console must be clean during all flows.
- Network tab: no 404s on new `dm/*.js` script loads.
- `grep 'window\.' frontend/assets/js/dm/*.js | wc -l` — count drops vs original; all remaining are documented.

## Rollback
```bash
git revert HEAD~N..HEAD  # N = commits in this plan
git rm -r frontend/assets/js/dm/
git checkout main -- frontend/assets/js/document-manager.js frontend/assets/document-manager.html
git commit -m "revert: document-manager split"
```

## Token savings
- Per-session: ~15k tokens (document-manager.js not loaded for non-DM tasks)
- Per-edit (when LLM edits one DM module): ~20k tokens saved vs loading the full 3,925-LOC file
