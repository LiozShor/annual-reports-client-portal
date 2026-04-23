# Design Log 331: Fix 422 from Airtable batchUpdate in `/webhook/edit-documents`
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-22
**Related Logs:** DL-174 (endpoint introduction), DL-205 (file-field clearing), DL-180 (logError infra)

## 1. Context & Problem

Worker alert fired 2026-04-22T16:49:08.379Z:
> `Airtable batchUpdate error: 422 {"error":{"type":"INVALID_RECORDS","message":"You must provide an array of up to 10 record objects, each with an 'id' ID field and a 'fields' object for cell values."}}`

`POST /webhook/edit-documents` builds a batch of doc updates from a Tally-like payload and PATCHes Airtable in chunks of 10. A single malformed record in a chunk makes Airtable reject the entire 10. The endpoint 500s, and any earlier chunks that already succeeded leave the doc list in a partially-updated state. Historical occurrences can't be confirmed via `security_logs` due to a separate arg-order bug in `error-logger.ts` (see Section 5).

## 2. User Requirements

1. **Q:** What triggered this alert — specific report or general hardening?
   **A:** Check logs (logs came up empty — see Section 5).
2. **Q:** Scope of fix beyond the immediate 422?
   **A:** Root-cause fix only (minimal diff).
3. **Q:** Should a malformed record block the whole request or be skipped?
   **A:** Skip + log (VALIDATION category via `logError`).
4. **Q:** Reproduce with a test first?
   **A:** Yes — add a unit test that reproduces the bug.

## 3. Research

### Domain
API Input Validation / Defensive Programming / Batch-Operation Resilience

### Sources Consulted
1. **Release It! (Michael Nygard) — "Decouple with Middleware" & "Fail Fast"** — Validate at boundary before expensive/external calls; a bad message should not poison a batch of good ones.
2. **Airtable API docs — "Update multiple records" (PATCH /v0/{base}/{table})** — Confirms: every record in the array needs both `id` (existing record ID) and `fields` (object); any element violating this fails the whole request with 422 `INVALID_RECORDS`. Airtable does not partially-accept.
3. **OWASP Input Validation Cheat Sheet** — Allowlist over denylist. Record IDs should match a known pattern (`^rec[A-Za-z0-9]{14}$`), not a "not empty" check.

### Key Principles Extracted
- **Boundary validation:** Sanitize untrusted data (Tally payload) at the moment we cross into the external service (Airtable). Keep the sanitizer at the call site — not buried in the generic `AirtableClient`, because the "what counts as valid" rule is endpoint-specific.
- **Don't poison the batch:** One malformed entry should not nuke 9 good ones. Filter before chunking.
- **Observability over silence:** Dropping silently trades one bug (500s) for another (missing updates with no trail). Emit a VALIDATION log with the dropped list so bad input is visible.
- **Allowlist the ID shape:** Airtable record IDs are `rec` + 14 base62 chars. Matching that is cheaper than calling Airtable to find out.

### Patterns to Use
- **Input sanitizer at the adapter boundary:** Pure function, no side effects, returns `{valid, dropped}`. Trivially testable without mocking the Worker.

### Anti-Patterns to Avoid
- **Zod/full-schema layer for one endpoint:** Out of scope; user asked for minimal diff.
- **Change the generic `AirtableClient.batchUpdate`:** Would affect every caller; the rule here ("drop empty fields, require rec-ID format") is local to this endpoint's data shape.
- **Fail-fast 400 on any malformed entry:** Rejected — user picked Skip+Log for better UX. A single garbage status_change from a legacy Tally build shouldn't block a 50-doc edit.

### Research Verdict
Sanitize at the call site in `edit-documents.ts` with a pure helper extracted to `api/src/lib/batch-sanitize.mjs` (`.mjs` so `node --test` can import it without a TS toolchain). Emit a `logError({category: 'VALIDATION'})` on any drops. Cover with 5 `node --test` cases.

## 4. Codebase Analysis

### Existing Solutions Found
- `logError` (`api/src/lib/error-logger.ts:25`) with `'VALIDATION'` category and 15-minute cooldown — exactly the observability channel we need.
- `AirtableClient.batchUpdate` (`api/src/lib/airtable.ts:149`) is generic and re-chunks in 10s — keep it as-is; sanitize upstream.

### Reuse Decision
- Reuse `logError` for the drop signal.
- Create a tiny new helper (the sanitizer); no existing utility fits.

### Relevant Files
- `api/src/routes/edit-documents.ts:246-290` — `buildUpdateMap` (construction).
- `api/src/routes/edit-documents.ts:390-401` — batch PATCH loop (insertion point).
- `api/src/lib/airtable.ts:149` — `batchUpdate` signature reference.
- `api/src/lib/error-logger.ts:25` — `logError` entry point.

### Existing Patterns
`.mjs` sibling files under `api/src/lib/` are unprecedented in this repo (all lib is `.ts`). Reason for deviating: `node --test` without a TS loader is the minimum-deps way to satisfy the user's "reproducer test" requirement. TypeScript allows `import` of `.mjs` with `"moduleResolution": "bundler"` (confirmed in `api/tsconfig.json`).

### Dependencies
- Airtable REST API (doc table `tblcwptR63skeODPn`)
- `logError` → `security_logs` table + alert email via MS Graph

## 5. Technical Constraints & Risks

### Security
- Record IDs come from untrusted Tally input. Regex allowlist prevents us from accidentally PATCHing IDs from other bases or sending garbage that the Airtable API might misinterpret.
- The VALIDATION `details` field includes the dropped IDs and report_record_id — no PII beyond that.

### Risks
- **`.mjs` bundling with Wrangler:** Wrangler/esbuild handles `.mjs` fine; verified by `wrangler deploy --dry-run` in Verification.
- **`error-logger.ts:40` arg-order bug (discovered during this DL):** `new AirtableClient(env.AIRTABLE_PAT, env.AIRTABLE_BASE_ID)` — constructor expects `(baseId, pat)`. Every `logError` write to `security_logs` has been silently failing. Alert emails still fire (they don't use the client). **Out of scope for this DL** per user; filed as a 1-line follow-up. Until fixed, our new VALIDATION logs will also fail to reach Airtable (but the throttled email will fire). Do not confuse this with a failure of the current change.
- **Breaking Changes:** None. Endpoint behavior: malformed records are now silently dropped (with a log) instead of 500ing — this is strictly an improvement for the caller.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
`/webhook/edit-documents` returns `200 ok:true` for any valid-shape request, even when individual records in the batch are malformed. Valid records PATCH successfully; malformed records are recorded in `security_logs` via `logError` with `category: 'VALIDATION'`. No 422 from Airtable after deploy.

### Logic Flow
1. Build `airtableUpdates` from `buildUpdateMap` (unchanged).
2. **NEW:** Pass through `sanitizeBatchUpdates(airtableUpdates)` → `{valid, dropped}`.
3. **NEW:** If `dropped.length > 0`, `console.warn` + `logError({category: 'VALIDATION', details: {report_record_id, dropped}})`.
4. Chunk and `batchUpdate` only `valid` (unchanged shape beyond that).
5. Rest of the endpoint (create, archive, auto-advance, fire-n8n, audit) unchanged.

### Data Structures

`sanitizeBatchUpdates(records)` returns:
```js
{
  valid:   [{id: 'rec...', fields: {...}}, ...],  // passes PATCH safely
  dropped: [{id: '<empty>'|<any>, reason: 'invalid_id'|'empty_fields'}, ...]
}
```

Validation rules:
- `id` must match `/^rec[A-Za-z0-9]{14}$/` — else `reason: 'invalid_id'`
- `fields` after stripping `undefined` values must have ≥1 key — else `reason: 'empty_fields'`

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/batch-sanitize.mjs` | Create | Pure helper: `sanitizeBatchUpdates`, `AIRTABLE_REC_ID`. |
| `api/src/routes/edit-documents.ts` | Modify | Import sanitizer; apply before batch PATCH loop; emit VALIDATION log on drops. |
| `api/test/edit-documents-sanitize.test.mjs` | Create | 5 `node --test` cases. |
| `api/package.json` | Modify | Add `"test": "node --test test/**/*.test.mjs"`. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-331 row. |

### Final Step (Always)
- Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, Section 7 items copied to `.agent/current-status.md`.

## 7. Validation Plan
- [ ] `cd api && ./node_modules/.bin/tsc --noEmit` — no type errors.
- [ ] `cd api && node --test test/**/*.test.mjs` — all 5 cases pass.
- [ ] `cd api && npx wrangler deploy --dry-run` — bundle builds.
- [ ] `cd api && wrangler deploy` — deployed to production.
- [ ] Craft a test POST to `/webhook/edit-documents` with `extensions.status_changes: [{id: 'recXXXXXXXXXXXXXX', new_status: undefined}]` + one valid waive. Expect `200 ok:true`, the waive succeeds in Airtable, and (once error-logger arg-order follow-up ships) a VALIDATION row in `security_logs`.
- [ ] Regression: normal admin doc-manager edit (waive + add) still works — open a live client in admin panel, waive a doc, confirm PATCH 200.
- [ ] `wrangler tail` for 10 min after deploy — no new 422s from `/webhook/edit-documents`.

## 8. Implementation Notes (Post-Code)
- Sanitizer extracted to `api/src/lib/batch-sanitize.mjs` (pure, zero deps, importable from `.ts` via bundler resolution).
- 7 `node --test` cases pass locally: regex shape, empty id, non-rec UUID, all-undefined fields, happy path, mixed batch, null/non-object tolerance.
- `logError` call uses `category: 'VALIDATION'` (15-min cooldown per `error-logger.ts:17`) — one alert per 15 min regardless of how many requests see drops.
- Call site comment references DL-331 for future context.
- `error-logger.ts:40` arg-order bug **not** fixed here per scope; means the new VALIDATION `security_logs` rows won't land until that 1-line follow-up ships, but the throttled alert email fires correctly.
- Test script added to `api/package.json`: `npm test` runs the sanitize cases.
