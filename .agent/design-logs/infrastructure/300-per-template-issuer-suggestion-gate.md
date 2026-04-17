# Design Log 300: Per-Template Issuer-Suggestion Gate

**Status:** [IMPLEMENTED — NEED TESTING] (✨ accept chip disabled on frontend — see 2026-04-17 follow-up)
**Date:** 2026-04-17
**Branch:** `DL-300-per-template-issuer-suggestion-gate`
**Related:** DL-296 (WF02 ✨ issuer extraction), DL-299 (PA card manual edit + ✨ chip)

> **2026-04-17 follow-up:** live-test on CPA-XXX surfaced a render bug in the ✨ accept flow: clicking "החלף ל-<issuer>" replaced `issuer_name` with the bare suggestion ("לאומי"), and `doc-builder.ts` resolves the row label as `issuer_name ?? template.name_he` — so the full "טופס 867 (אישור ניכוי מס) לשנת 2025 – …" context collapsed to just "לאומי". The ✨ chip is now **hidden on both surfaces** (PA card + doc-manager) via frontend stubs (`suggestion = ''`) in commit `ca3e7d5`. Backend DL-300 gate + `issuer_name_suggested` writes remain intact for opted-in templates — cheap, harmless, and ready for re-enable once the render/accept path re-composes labels via `buildShortName(templateId, issuer)`.

## 1. Context & Problem

DL-296 ships Haiku-based issuer-name extraction for *every* doc produced by WF02 that has a non-empty `raw_context`. The extractor is a blunt instrument: it runs on templates where the concept of an "issuer" is meaningless (e.g. T003 "מסמכי שינוי מצב משפחתי", T1201 "קבלות תרומה", T801 "אישור זכייה", T1301 "תעודת שחרור צבאי", T1001 "רשימת מלאי"), wasting Claude tokens and occasionally surfacing garbage suggestions on the PA card that the admin has to dismiss.

Natan asked for a per-template decision about which templates actually need ✨ suggestions. The source of truth should live in Airtable so he can edit it later without code deploys.

## 2. User Requirements

1. **Config source:** New Airtable field on the templates table.
2. **Filter point:** "During the LLM call" — filter inside `/webhook/extract-issuer-names`, immediately before the Haiku call (not in WF02, not post-response).
3. **Decision ownership:** Natan edits each template flag in Airtable. Ship schema + filter only — no code-side template enumeration.
4. **Backfill:** One-shot clear script removes `issuer_name_suggested` on docs whose template is now disabled.

## 3. Research (incremental on DL-296)

- **Config-as-data (feature flags in a DB table).** Standard for ops-owned toggles: read-through, missing flag = safe default. Applied here as *opt-in / fail-closed* — no LLM call unless explicitly enabled.
- **Edge Worker + small reference tables.** Airtable `templates` is ~32 rows; same `listAllRecords` round-trip already runs in `documents.ts`, `admin-pending-approval.ts`, `classifications.ts`. One more call from `extract-issuer-names.ts` is cheap (~200 ms once per report) — no caching layer needed.
- **DDIA "derived data + source of truth".** Templates table is the source of truth; the Worker materialises the filter decision at each WF02 call. No denormalisation into docs.

## 4. Codebase Analysis

Reused existing:
- `api/src/lib/doc-builder.ts` — `TemplateInfo` + `buildTemplateMap()`; extended with `needs_issuer_suggestion?: boolean`.
- `AirtableClient.listAllRecords` — same call pattern as `admin-pending-approval.ts:69`, `classifications.ts:215`, `documents.ts:163`.

## 5. Proposed Solution

### 5.1 Airtable schema

| Field | Type | Default | Notes |
|---|---|---|---|
| `needs_issuer_suggestion` | Checkbox | unchecked (false) | Ops-owned. Natan toggles per template. |

### 5.2 Endpoint logic (`api/src/routes/extract-issuer-names.ts`)

1. Auth (unchanged).
2. Parse body + filter `docs` for non-empty `raw_context` (unchanged).
3. **NEW:** `airtable.listAllRecords(TEMPLATES_TABLE)` → `buildTemplateMap(...)`.
4. **NEW:** Partition docs into:
   - `llmDocs` — `templateMap.get(d.template_id)?.needs_issuer_suggestion === true`
   - `noteOnlyDocs` — everything else
5. If `llmDocs.length > 0` → `callClaude(llmDocs)`; else skip entirely.
6. Build `updates[]`:
   - For `llmDocs`: existing suggestion + no-op + `bookkeepers_notes` logic.
   - For `noteOnlyDocs`: only the `bookkeepers_notes` append (raw-context preservation).
7. Batch PATCH (unchanged).
8. Response: `{ ok, suggested, skipped, filtered_by_template, results }`.

**Templates-table fetch failure policy:** bubble up as 500. If we silently skipped filtering, all future submissions would drop suggestions until someone noticed. `bookkeepers_notes` append is also skipped on fetch failure (acceptable — the admin sees the 500 and WF02 can retry).

**Default value for empty flag:** `false` (opt-in). Matches user intent (reduce LLM calls) and is safer than accidental over-suggesting.

### 5.3 `bookkeepers_notes` separation

Two independent switches:
- ✨ suggestion (gated by `needs_issuer_suggestion`)
- `[תשובה מהשאלון] <raw>` append (always, regardless of the flag)

So disabled templates still get the raw context preserved in the note — admin doesn't lose the free-text answer.

### 5.4 Cleanup script (`api/scripts/clear-disabled-template-suggestions.ts`)

- Fetches templates → set of disabled IDs.
- Lists all docs with `{issuer_name_suggested} != ''`.
- Patches `issuer_name_suggested: ""` on docs whose resolved template is disabled.
- `DRY=1` by default (dry-run); `DRY=0` to apply.
- Groups the clear-count per template in the log.
- Idempotent; safe to re-run.

## 6. Files Changed

```
api/src/lib/doc-builder.ts                              # + needs_issuer_suggestion on TemplateInfo + buildTemplateMap
api/src/routes/extract-issuer-names.ts                  # load templates, partition, conditional Claude call, still append notes
api/scripts/clear-disabled-template-suggestions.ts      # NEW one-shot cleanup (dry-run default)
.agent/design-logs/infrastructure/300-per-template-issuer-suggestion-gate.md  # this log
.agent/design-logs/INDEX.md                             # + DL-300 row
.agent/current-status.md                                # session summary + §7 tests
```

Airtable schema change (manual, done outside repo): add `needs_issuer_suggestion` checkbox on templates table.

## 7. Validation Plan

### Airtable
- [ ] `needs_issuer_suggestion` checkbox visible on templates table; admin can toggle.
- [ ] Natan toggles all ~32 templates (his call — not blocking deploy).

### Endpoint behaviour
- [ ] POST `/webhook/extract-issuer-names` with mixed (enabled + disabled) batch → Claude is only called with enabled docs; `filtered_by_template` in the response reflects the count.
- [ ] POST with only disabled templates → no Claude call, but `bookkeepers_notes` still appended on each; `suggested: 0`, `filtered_by_template > 0`.
- [ ] POST with only enabled templates → behaviour identical to pre-DL-300 (regression sample from DL-296).
- [ ] Templates-table fetch failure → endpoint returns 500 (does not silently skip).

### Cleanup script
- [ ] `DRY=1 node scripts/clear-disabled-template-suggestions.ts` prints doc counts grouped by disabled template; no writes.
- [ ] `DRY=0 …` clears `issuer_name_suggested` only on disabled-template docs; PA cards for those docs lose the ✨ chip.
- [ ] Re-run is a no-op.

### No regression
- [ ] DL-296 ✨ chip + 1-click accept still works for enabled templates (end-to-end with live WF02 submission).
- [ ] DL-299 PA card pencil + note popover unchanged.
- [ ] `bookkeepers_notes` still contains `[תשובה מהשאלון] <raw>` for both enabled and disabled templates after WF02.

## 8. Verification Steps (end-to-end, post-deploy)

1. Deploy Worker (`cd api && npx wrangler deploy`).
2. Airtable: add `needs_issuer_suggestion` checkbox on templates table. Toggle a seed set (e.g. T106, T501, T601 = true; T003, T1201, T801 = false).
3. Submit a new Tally questionnaire (staging client) triggering docs across both enabled and disabled templates.
4. Worker logs: `[extract-issuer-names] report=… docs=N suggested=… skipped=… filtered_by_template=…`.
5. Open PA card for the new report: ✨ chips appear only on enabled-template docs; all docs have raw context in `bookkeepers_notes`.
6. Run cleanup script in `DRY=1` first → confirm counts → then `DRY=0`.

## 9. Open Decisions

- **Field name:** `needs_issuer_suggestion` (explicit) chosen over `extract_issuer` (shorter). Self-describing in the Airtable UI; matches Natan's question phrasing.
- **Default:** `false` (opt-in). Documented in §5.2.
