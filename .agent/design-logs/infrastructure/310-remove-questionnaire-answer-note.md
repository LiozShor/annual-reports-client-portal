# Design Log 310: Remove `[תשובה מהשאלון]` Raw-Answer Note Append
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-20
**Related Logs:** DL-296 (introduced the feature), DL-300 (kept note-append after narrowing LLM), DL-299 (PA card notes UI)

## 1. Context & Problem

DL-296 made `/webhook/extract-issuer-names` append `[תשובה מהשאלון] <raw>` to every upserted doc's `bookkeepers_notes`, so the admin could see the raw client questionnaire answer alongside the AI-suggested issuer on the PA card. DL-300 later narrowed the LLM suggestion to opt-in templates (`needs_issuer_suggestion=true`) but kept the note append running for ALL docs.

The user has decided the note is no longer useful — it clutters `bookkeepers_notes` on the PA card and doc-manager. Remove the producer, back-fill the historical rows.

## 2. User Requirements
1. **Q:** How much of the feature should be removed?
   **A:** Just the note append. Keep endpoint + DL-300 `issuer_name_suggested` LLM path.
2. **Q:** What about existing tagged notes on live doc records?
   **A:** Backfill-strip via one-shot script.
3. **Q:** Update WF02 to stop sending `raw_context` / `existing_notes`?
   **A:** Leave WF02 alone — endpoint ignores silently.
4. **Q:** Branch naming?
   **A:** Rename session branch to `DL-310-remove-questionnaire-answer-note`.

## 3. Research
### Domain
Feature deprecation + idempotent data migration.

### Sources Consulted
Scope is small (~20-line code removal + a one-shot strip script); no fresh web research performed. Standard patterns applied from prior knowledge.

### Key Principles Extracted
- **Strangler-Fig-style removal** (Fowler): stop the producer first (endpoint), then clean historical data. Shipping the code change without the backfill is safe — worst case, stale tagged notes linger until the script runs.
- **Idempotent backfill**: the strip regex matches the exact tagged block; re-running finds 0 matches.
- **Dry-run first**: script defaults to dry-run, requires `--apply` flag.
- **No-op PATCH avoidance**: only update when the cleaned `bookkeepers_notes` actually differs from the original.

### Patterns to Use
- **Airtable server-side filter**: `FIND('[תשובה מהשאלון]', {bookkeepers_notes})` — avoids full-table pagination.
- **Batch update via pyairtable**: matches DL-223 / DL-243 precedent.

### Anti-Patterns to Avoid
- Deleting the endpoint entirely (would also kill the DL-300 ✨ `issuer_name_suggested` path, which is still running for opt-in templates).
- Updating WF02 payload — n8n redeploy risk for zero functional gain; endpoint can just ignore the fields.
- Frontend-only "hide on display" filter — leaves stale data behind; once we decide the note is gone, the data should go too.

### Research Verdict
Remove the producer (note-append) from the Worker route. Keep the endpoint, auth, template gating, and LLM call. Backfill historical records with an idempotent dry-run-first script.

## 4. Codebase Analysis

**Files referencing the feature:**
| File | Role |
|------|------|
| `api/src/routes/extract-issuer-names.ts` | Endpoint — `NOTE_PREFIX`, `buildNotesUpdate`, two call sites |
| `scripts/dl293-patch-wf02.py` | Historical n8n patch — sends `existing_notes`/`raw_context`. Leave untouched. |
| `.agent/design-logs/{296,299,300}*.md` | Historical context |

**Endpoint behaviour before DL-310:**
- `llmDocs` loop: write `issuer_name_suggested` (when confident + not a no-op) AND append `bookkeepers_notes`.
- `noteOnlyDocs` loop: write ONLY `bookkeepers_notes` for non-opted-in templates.

**Endpoint behaviour after DL-310:**
- `llmDocs` loop: write `issuer_name_suggested` only. Skip row entirely when no confident suggestion.
- `noteOnlyDocs` loop: deleted. `filtered_by_template` counter preserved.

## 5. Technical Constraints & Risks
- **Security:** N/A — auth layer untouched.
- **Risks:** Low. Note-append is write-only; removing it cannot break reads. Backfill touches `bookkeepers_notes` only.
- **Breaking Changes:** None. WF02 payload shape unchanged; extra fields ignored.

## 6. Proposed Solution

### Success Criteria
After DL-310: new WF02 runs do not write `[תשובה מהשאלון]` to any doc's `bookkeepers_notes`; existing tagged notes are stripped from production Airtable; DL-300 ✨ `issuer_name_suggested` writes still work for opted-in templates.

### Logic Flow
**Endpoint:**
1. Auth + payload validation (unchanged).
2. Template partition: `llmDocs` (opt-in) vs counted-only (`filtered_by_template` metric).
3. Call Haiku for `llmDocs` only.
4. PATCH `issuer_name_suggested` on confident, non-no-op rows.

**Backfill script:**
1. Query documents table with `FIND('[תשובה מהשאלון]', {bookkeepers_notes})`.
2. Regex-strip tag line + continuation lines, collapse triple newlines, trim.
3. Dry-run: print before/after preview for first 5 records. `--apply`: batch update.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/extract-issuer-names.ts` | Modify | Remove `NOTE_PREFIX`, `buildNotesUpdate`, both call sites; update top JSDoc |
| `scripts/dl310-strip-questionnaire-note.py` | Create | One-shot pyairtable backfill (dry-run by default) |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-310 entry |
| `.agent/current-status.md` | Modify | Add DL-310 test TODOs |

### Final Step (Always)
- Status → `[IMPLEMENTED — NEED TESTING]`
- Copy unchecked Section 7 items to `current-status.md` under Active TODOs
- `wrangler deploy` from `api/`
- Commit + push feature branch; **pause for explicit merge approval**

## 7. Validation Plan
- [ ] `./node_modules/.bin/tsc --noEmit` inside `api/` — route compiles
- [ ] `wrangler deploy` from `api/` succeeds
- [ ] `wrangler tail` — POST a non-opted-in-template payload → response `{ok:true, filtered_by_template≥1}`, no Airtable PATCH
- [ ] POST an opted-in-template payload → response `{suggested:1}`, Airtable writes `issuer_name_suggested` only (no `bookkeepers_notes` change)
- [ ] Submit a real Tally questionnaire end-to-end → new doc rows have clean `bookkeepers_notes` (no `[תשובה מהשאלון]`)
- [ ] Run backfill `--dry-run` → sanity-check ≥3 sample records
- [ ] Run backfill `--apply` → second run finds 0 matches (idempotent)
- [ ] Open PA card for a formerly-tagged client → no `[תשובה מהשאלון]` visible
- [ ] DL-300 ✨ flow regression check: opted-in template still receives `issuer_name_suggested`

## 8. Implementation Notes (Post-Code)
- Endpoint change landed in commit on branch `DL-310-remove-questionnaire-answer-note`.
- Stale comment at the template-gate block updated to reflect the new semantics (docs not in `llmDocs` are no-ops, not "note-only").
- Pre-existing TS errors in `api/src/routes/backfill.ts` and `api/src/routes/classifications.ts` are unrelated to DL-310.
- Research principles applied: Strangler Fig (producer first, then data), idempotent backfill, dry-run default.
