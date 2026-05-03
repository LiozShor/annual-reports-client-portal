# Design Log 397: Capture Contract Months on Manual Assign + Fix Stale `matched_template_id`
**Status:** [COMPLETED — 2026-05-03]
**Date:** 2026-05-03
**Related Logs:** DL-385 (lenient MM.YYYY parser + T901↔T902 swap), DL-359 (edit full-year contract dates), DL-391 (chip menu "assign to this doc"), DL-386 (add-doc popover with inline reassign), DL-269/270/271 (partial-contract banner + request-missing-period)

## 1. Context & Problem

When the AI classifier doesn't recognize a doc and the admin manually assigns it to **[H:rental-contract]** — T901 (`[H:rental-contract] (הכנסה)`) or T902 (`[H:rental-contract] (הוצאה)`) — there's no UI to capture the **contract months**. The admin has to do a second manual step in the post-classification banner (the DL-385/DL-359 editor), which is easy to skip.

Three manual-assign surfaces all converge at `submitAIReassign` (`frontend/admin/js/script.js:7785`) without ever asking for months:

1. **Reassign modal** (`#aiReassignModal`, picker `_buildDocTemplatePicker` line 7860).
2. **Chip menu "assign to this doc"** (DL-391, `selectDocTagAssignToCard` line 9247).
3. **Add-doc popover** (DL-386, callsite line 11581).

A connected **production bug** surfaced today: after a manual reassign to T901/T902, clicking the partial-contract "+ [H:request-contract] MM.YYYY-MM.YYYY" button returns **400 "Only T901/T902 classifications support this action"**. Confirmed root cause by reading the reassign handler:

- `api/src/routes/classifications.ts:2074-2085` — Step 5 PATCH on the CLASSIFICATIONS record updates `review_status`, `reviewed_at`, `notes` only. **It never writes `matched_template_id`**.
- After a manual reassign, the server-side `matched_template_id` stays as the original AI guess (often `general_doc`).
- `request-remaining-contract` reads `clsFields.matched_template_id` at line 747 and gates at line 748 → fails the T901/T902 check → 400.

The local frontend mutation at `script.js:7828` (`reassignedItem.matched_template_id = templateId`) hides the bug from the UI render gates (which check the local cached value), so admin sees the partial-contract banner and the "+ [H:request-contract]" button — but the server disagrees and rejects.

Both problems are linked: the feature (capture months at assign time) and the bug (persist the new template letter on reassign) get fixed together in one atomic backend PATCH.

## 2. User Requirements (Q&A)

1. **Q:** Where exactly does the manual assign to [H:rental-contract] happen?
   **A:** All three flows — reassign modal, chip menu "assign to this doc", and add-doc popover.
2. **Q:** Does admin pick T901 vs T902 themselves at assign time?
   **A:** Yes — already chosen at assign time. No new income/expense picker needed.
3. **Q:** What input format for the months?
   **A:** Reuse DL-385's lenient `MM.YYYY` parser (`parseLenientMonthYear`).
4. **Q:** About the 400 from `/webhook/review-classification` — what action triggered it?
   **A:** It happened during the manual assign flow itself — investigate. (Confirmed: triggered by clicking "+ [H:request-contract]" after manual reassign to T901; root cause is stale `matched_template_id` on the classification record.)

## 3. Research

### Domain
UX for capturing required metadata at the moment of action (in-context form fields during a classification override), combined with lenient/strict date input. Server-side state consistency after admin overrides of AI verdicts.

### Sources Consulted
1. **DL-385 (in-repo)** — Lenient MM.YYYY parser, NN/g date input, GOV.UK Design System (separator-tolerant parsing), Material 3 (text-field as source of truth on commit), date-fns 2-digit-year disambiguation, Material 3 Snackbar Undo. All directly reused; no new parser needed.
2. **DL-359 (in-repo)** — "AI verdicts must have a visible edit path" (symmetric override). Manual-assign is the very moment the admin overrides the AI; capturing months inline is the natural extension of that principle.
3. **NN/g — "Wizards: Definition and Design Recommendations"** (https://www.nngroup.com/articles/wizards/) — capture data in-context; reuse user's prior selection as defaults. Applies: render the months input where the assign happens, not in a separate later step.
4. **Carbon Design System — Forms** (https://carbondesignsystem.com/patterns/forms-pattern/) + Raluca Budiu, NN/g "Marking Required Fields in Forms" — required fields must be clearly marked; in-context tooltips for guidance. Applies: the months section appears with explicit Hebrew label and inline placeholder, only when target ∈ {T901, T902}.
5. **UX Knowledge Base — Modeless dialogs / inline forms** — keep user in context; avoid stacked modals. Applies: chip-menu sub-popover swap and add-doc inline render, not a new modal layer.

### Key Principles Extracted
- **Capture-at-action**: required metadata gathered at the moment of action — no deferred second step that admin can skip.
- **Progressive disclosure**: months input only renders when target template is rental; non-rental reassigns unchanged.
- **Lenient input, strict storage**: client parses `MM.YYYY` / `M.YY` / `M-YYYY`; server stores ISO `YYYY-MM-DD`. (DL-385 carry-over.)
- **One source of truth**: ONE `renderContractMonthsInput()` helper used by all three flows — uniformity rule #1.
- **Atomic server state**: reassign PATCH writes both `matched_template_id` and `contract_period` in a single Airtable update — no half-states.
- **Idempotent additive endpoint**: `reassign` action remains backwards compatible; `contract_period` and template-letter persistence are extensions, not contracts changes.

### Patterns to Use
- **Reuse `parseLenientMonthYear` (DL-385, script.js:~6782)** — pure regex parser, no new deps.
- **Sub-popover content swap** (chip menu) — same floating element, swap content; consistent with DL-391's existing menu pattern.
- **Inline section reveal** (reassign modal + add-doc popover) — show/hide a `<div>` based on selected template letter.
- **Pre-flight client validation** — block POST when input invalid; surface server JSON error string in toast on failure.

### Anti-Patterns to Avoid
- **Two-step assign**: reassign now, ask for months later. Easy to skip; produces the very state void this DL closes.
- **New modal stack**: a separate "fill months" modal on top of the reassign modal. Violates context-keeping; trains click-through.
- **Server-side toggle of `matched_template_id`**: writing the field "if missing" is fragile. Always write the explicit target on every reassign — the only correct behavior.
- **Bypassing the gate by relaxing line 748**: removing the T901/T902 check in `request-remaining-contract` would mask the underlying staleness and produce wrong downstream data.

### Research Verdict
Atomic backend extension: persist `matched_template_id` (always) and `contract_period` (when target is T901/T902 and provided) in the Step 5 PATCH on every reassign. One frontend `renderContractMonthsInput` helper mounted at the three flow surfaces. Reuse all DL-385 helpers and the existing `update-contract-period` validation logic (extracted into a shared helper).

## 4. Codebase Analysis

* **Existing solutions found:**
  * `parseLenientMonthYear`, `renderContractPeriodBanner`, `renderFullYearBadge`, `expandFullYearBadgeToEdit`, `editContractDate`, `saveContractPeriod` — all in `frontend/admin/js/script.js` ~6782–6900 (DL-385/359/270).
  * `submitAIReassign` (script.js:7785) — central reassign function called by all three flows.
  * `_buildDocTemplatePicker` (script.js:7860) — reusable template picker inside reassign modal.
  * `selectDocTagAssignToCard` (script.js:9247) — DL-391 chip-menu reassign handler.
  * Add-doc popover inline reassign callsite (script.js:11581) — DL-386.
  * `update-contract-period` action handler (`api/src/routes/classifications.ts:695-719`) — already validates `YYYY-MM-DD`, computes `coversFullYear`, serializes to `contract_period` JSON field. The validation logic is the right shape to extract into a helper for reuse.
  * Render gates `['T901','T902'].includes(item.matched_template_id)` at script.js:776, 5021, 6102, 6271 — all correctly check the letter code locally.
* **Reuse decision:**
  * Reuse `parseLenientMonthYear` and the existing `update-contract-period` validation logic (extracted into `buildContractPeriod` helper).
  * Reuse `submitAIReassign` as the single submission funnel (extend with optional `extras` arg).
  * Add ONE new frontend helper `renderContractMonthsInput` for the inline months mini-form (single source of truth).
  * Add `isRentalTemplate(letter)` predicate to centralize the T901/T902 check.
* **Relevant files:**
  * `frontend/admin/js/script.js` — three flow surfaces + new helpers + `submitAIReassign` extension.
  * `frontend/admin/index.html` — cache-bust.
  * `api/src/routes/classifications.ts` — reassign Step 5 PATCH extension + helper extraction.
* **Existing patterns:** DL-385's lenient parser; DL-391's data-attribute-driven chip menu; DL-386's inline prompt; DL-353's reject-reason inline form (similar progressive-disclosure inside an existing dialog).
* **Alignment with research:** Codebase already implements capture-at-action for date editing on the post-classification banner; this DL extends the same UX upstream into the assign moment.
* **Dependencies:** Airtable CLASSIFICATIONS table fields `matched_template_id` (single line text) and `contract_period` (JSON serialized in long text) — both already exist, no schema change.

## 5. Technical Constraints & Risks

* **Security:** No new PII surface. Same admin-token auth as existing reassign + update-contract-period. Server still validates date format before persistence.
* **Operational risks:**
  * **Atomic PATCH partial failure** — if Airtable rejects the combined fields update, both reassign and contract_period fail together. Acceptable: admin retries the click; no half-state. Mitigation: keep the existing PATCH structure, add fields conditionally.
  * **Cache-bust** — frontend changes need `script.js?v=400 → v=401` in `frontend/admin/index.html`.
  * **TS check** — Windows gotcha: must use `./node_modules/.bin/tsc --noEmit` from `api/`, never `npx tsc`.
  * **Worker deploy** — after main merge run `bash .claude/workflows/deploy-worker.sh` (canonical clone, not session worktree).
* **Breaking changes:** None. `contract_period` is optional on `reassign` body; `matched_template_id` write is purely additive. Existing callers (other workflows, n8n) not affected.
* **Mitigations:**
  * Pre-flight client validation in `submitAIReassign` blocks empty `templateId` (also closes the silent-400 path users hit when chip data-attribute was unset).
  * Surface server `error` string in the toast via existing `formatAIResponseError` (verify it pulls `data.error`).
  * If letter ∈ {T901, T902} and `contract_period` not sent, server does NOT 400 — graceful path so admin can fill via the existing post-classification banner editor.

## 6. Proposed Solution

### Success Criteria
On any of the three manual-assign flows, when admin picks T901 or T902, the dialog/popover reveals two MM.YYYY inputs ([H:from-] / [H:to-]). On submit with valid months, the classification's `matched_template_id` is persisted as `T901`/`T902` AND `contract_period` is saved — both in one server PATCH. The "+ [H:request-contract]" button works immediately afterward (no 400). For non-rental reassigns, behavior is unchanged.

### Logic Flow

**Backend (single PATCH extension):**
1. `reassign` handler runs as today through document operations (line 1840-2072).
2. Step 5 PATCH (line 2075) — extend body to include:
   - Always when `action === 'reassign'`: `matched_template_id: reassign_template_id` (fixes the 400 bug).
   - When letter ∈ {T901, T902} AND `contract_period` valid: `contract_period: <serialized JSON>` via shared `buildContractPeriod()` helper.

**Frontend (per flow):**
1. **Reassign modal**: `_buildDocTemplatePicker` listens for template selection; on T901/T902 reveals `<div id="aiReassignContractMonths">` with `renderContractMonthsInput`. Submit handler validates → calls `submitAIReassign(...args, {contract_period, target_letter})`.
2. **Chip menu**: `selectDocTagAssignToCard` checks chip's letter (already on `data-template-id`); if rental, swaps menu content to sub-popover with months inputs + Save/Cancel. Save validates → calls `submitAIReassign`.
3. **Add-doc popover**: extend the inline prompt at line 11581 — when target letter is rental, render `renderContractMonthsInput` inline before the confirm button.

### Data Structures / Schema Changes
None. Existing `matched_template_id` (text) and `contract_period` (JSON in long text) on CLASSIFICATIONS table.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | (a) Add `contract_period` to body destructuring (line 601). (b) Extract `buildContractPeriod(startDate, endDate)` helper from existing `update-contract-period` block (lines 695-719) for reuse. (c) Step 5 PATCH (line 2075) — conditionally add `matched_template_id` and `contract_period` fields for reassign. |
| `frontend/admin/js/script.js` | Modify | (a) Add `renderContractMonthsInput()` and `isRentalTemplate(letter)` helpers near line 6782. (b) Extend `submitAIReassign` (line 7785) with `extras = {}` arg, pre-flight templateId guard, and contract_period forwarding. (c) `_buildDocTemplatePicker` (line 7860) mounts months section on T901/T902 selection. (d) `selectDocTagAssignToCard` (line 9247) sub-popover swap for rental chips. (e) Add-doc popover (line 11581) inline months render. |
| `frontend/admin/index.html` | Modify | Cache-bust `script.js?v=400 → v=401`. |

### Final Step (Always)
* Update design log status → `[IMPLEMENTED — NEED TESTING]`.
* Update `.agent/design-logs/INDEX.md` with row 397.
* Copy unchecked Section 7 items to `.agent/current-status.md` Active TODOs.
* Invoke `git-ship` skill (no auto-merge — ask before merging to main).
* After merge to main: `bash .claude/workflows/deploy-worker.sh` (canonical clone) for the Worker change. Frontend deploys via Pages git auto-deploy.

## 7. Validation Plan

* [ ] **400 fix**: take a classification where AI guessed `general_doc`, manually reassign to T901 via reassign modal → Airtable CLASSIFICATIONS row shows `matched_template_id = T901`. Click "+ [H:request-contract]" → succeeds, no 400.
* [ ] **Reassign modal flow**: open modal on unrecognized doc, pick T901, fill `1.2025`/`12.2025` → success. Airtable `contract_period = {"startDate":"2025-01-01","endDate":"2025-12-31","coversFullYear":true}`. Banner renders without page reload (silent refresh per project rule).
* [ ] **Chip menu flow**: chip "assign to this doc" on T902 chip → sub-popover with two MM.YYYY inputs and Save/Cancel → submit `5.2026`/`12.2026` → success.
* [ ] **Add-doc popover flow**: add T901 doc with months `3.2025`/`8.2025` → success.
* [ ] **Validation — empty**: submit with one input blank → inline error + Hebrew toast `'[H:fill-contract-months]'`, no POST (Network tab silent).
* [ ] **Validation — bad format**: type `13.2025` → red ring + `'פורמט לא תקין — נסו 05.2026'`, no POST.
* [ ] **Validation — end before start**: `8.2025` start, `5.2025` end → `'תאריך סיום חייב להיות אחרי תאריך התחלה'`, no POST.
* [ ] **Pre-flight templateId guard**: DevTools breakpoint forcing `templateId=''` on chip handler → friendly toast, no POST.
* [ ] **Server error surfacing**: send curl POST with `action:'reassign'` and no `reassign_template_id` → 400 + the error message rendered in a toast (not swallowed).
* [ ] **Non-rental reassign**: reassign to T100 → no months input shown; server doesn't write `contract_period`; behavior unchanged.
* [ ] **Regression — banner editor**: existing post-classification banner (DL-385/DL-359) still saves via `update-contract-period`.
* [ ] **Regression — T901↔T902 swap**: DL-385 swap button still flips classification.
* [ ] **Regression — full-year badge**: DL-359 click-to-edit on full-year badge still works.
* [ ] **Cache-bust**: hard reload, DevTools shows `script.js?v=401` (or whatever the bumped version is at impl time).
* [ ] **Build**: `cd api && ./node_modules/.bin/tsc --noEmit` passes (Windows: never `npx tsc`).
* [ ] **Deploy**: `bash .claude/workflows/deploy-worker.sh` succeeds; `/health` returns 200.
* [ ] **Activity log**: `node scripts/query-worker-logs.mjs --since=1h --search="doc_reassign"` shows new events; classification rows have populated `matched_template_id`.

## 8. Implementation Notes

* **Backend (`api/src/routes/classifications.ts`):**
  * Added `buildContractPeriod(startDate, endDate)` helper at module scope (after `escapeAirtableValue`) — validates `YYYY-MM-DD` shape, ordering, and computes `coversFullYear`. Returns either `{json, contractPeriod}` or `{error}`.
  * Refactored existing `update-contract-period` block to call the helper (no behavior change; smaller diff than I expected).
  * Added `contract_period?: { startDate?, endDate? }` to body destructuring.
  * Replaced Step 5 PATCH inline body with a `step5Fields` object that conditionally sets `matched_template_id` and `contract_period` for the `reassign` action. When the target is T901/T902 and `contract_period` is invalid, returns 400 with the helper's error message rather than corrupting state.
* **Frontend (`frontend/admin/js/script.js`):**
  * Added `isRentalTemplate(letter)` and `renderContractMonthsInput(opts)` helpers immediately above `renderFullYearBadge` (DL-385 cluster). The mini-form is fully self-contained — uses `parseLenientMonthYear`, normalizes display on blur, returns ISO `YYYY-MM-01` start / last-of-month end via `getValues()`, and renders Hebrew validation copy.
  * Extended `submitAIReassign` signature with optional `extras` arg (8th positional). Pre-flight guard short-circuits empty `templateId` with a Hebrew toast — closes the silent-400 path. `extras.contract_period` is forwarded only when target is rental.
  * **Reassign modal**: added `<div id="aiReassignContractMonths">` to `index.html`. New `_dl397SyncReassignMonths` helper toggles the section based on selected template; called from `createDocCombobox.onSelect`, `_buildDocTemplatePicker.onPick`, and on modal open (reset). `confirmAIReassign` now uses a local `collectExtras(letter)` helper that returns `null` on validation failure (keeps modal open) or `{contract_period}` on success.
  * **Chip menu**: `selectDocTagAssignToCard` checks `isRentalTemplate(templateId)` and swaps the chip menu's HTML to a sub-popover with the months input + Save/Cancel buttons. Reuses `renderContractMonthsInput`. Non-rental chips keep the existing one-click flow.
  * **Add-doc popover (DL-386)**: `_showInlineAssignToNewDocPrompt` detects rental templates and embeds the months mini-form in the popover body. Confirm button validates before submitting; non-rental confirm path unchanged.
* **Cache-bust**: `frontend/admin/index.html` `script.js?v=400 → v=401`.
* **Build**: `cd api && ./node_modules/.bin/tsc --noEmit` — only two pre-existing errors in `src/index.ts:128` (Response type) and `src/lib/activity-logger.ts:16` (`node:async_hooks` types) remain. No new errors introduced. Frontend `node --check` passes silently.
* **Research principles applied**:
  * Capture-at-action (NN/g Wizards): months captured at the assign moment in all three surfaces, no deferred second step.
  * Progressive disclosure: section reveals only when target ∈ {T901, T902}; non-rental flows untouched.
  * Lenient input, strict storage (DL-385 carry-over): client `parseLenientMonthYear` handles `MM.YYYY` / `M.YY` / `M-YYYY`; server stores ISO.
  * One source of truth: single `renderContractMonthsInput` reused across all three flows.
  * Atomic server state: single Step 5 PATCH writes both `matched_template_id` and `contract_period` — no orphan-half states.
* **Out of scope (carry-over):**
  * Pending Approval queue partial banner (`script.js:5739` per DL-359 notes) — the manual reassign here doesn't pass through PA; not affected.
  * The legacy callsites at lines 7762/7849/7866 (Path 2 reassign with custom typed name) intentionally don't pass `extras` — when admin uses the "general doc" custom-name path, target is `general_doc` not T901/T902 by definition.
* **Follow-up question (Section 7 spec):** if admin needs a "skip months and fill later" affordance, downgrade the validation to a soft warning. Currently months are required when target is rental. Confirm with user during testing.
