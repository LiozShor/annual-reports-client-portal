# Design Log 241: Add Issuer Placeholders to CS Template short_name_he
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-06
**Related Logs:** DL-225 (CS Hardcoded AR Remediation), DL-233 (CS Template Fixes), DL-239 (Cross-Filing-Type Reassign)

## 1. Context & Problem
While testing DL-239 (cross-filing-type reassign), noticed CS docs in the AI Review combobox show generic template names ("אישור מס – פנסיה") while AR docs show per-issuer names ("טופס 867 – מיטב דש"). Initial hypothesis was that CS doc generation lacks per-issuer expansion — but document-manager confirmed CS docs ARE per-issuer expanded ("תלוש שכר לחודש 12.2025 משכיר1", etc.). The actual gap is in `short_name_he` Airtable field config.

## 2. User Requirements
1. **Q:** Should we fix this so CS reassign dropdown shows issuer names?
   **A:** Yes, must specify the issuer.
2. **Q:** Backfill existing clients?
   **A:** No backfill needed — fix is at template config level, takes effect immediately for all docs.

## 3. Research
### Domain
Document Generation, Template Variable Substitution

### Cumulative Knowledge
See DL-182, DL-225, DL-233 for prior CS infrastructure work.

### Sources Consulted
1. **Pre-existing `buildShortName()` function** (`api/src/lib/classification-helpers.ts:66`) — reads template's `short_name_he`, substitutes `{varName}` placeholders with bold segments from `issuer_name`.
2. **AR template patterns** — T201, T501, T601 use placeholders like `{employer_name}`, `{institution_name}` in `short_name_he` field.
3. **CS template inspection** (CSV export) — confirmed CS templates lack placeholders.

### Key Principles Extracted
- Template patterns must include placeholders for ALL variables they want substituted at display time, even if `name_he` already includes them.
- `short_name_he` and `name_he` are independent fields — fixing one doesn't fix the other.

### Research Verdict
Not a code bug. Pure data fix in Airtable.

## 4. Codebase Analysis
* **`buildShortName()`** (`api/src/lib/classification-helpers.ts:66-160`) — substitution logic; needs no changes.
* **API caching**: templates cached in KV with key `cache:templates`, TTL 1h. After Airtable update, cache must be cleared OR wait for TTL.
* **Airtable schema**: documents_templates has `template_id`, `name_he`, `short_name_he`, `variables`, `filing_type`.

## 5. Technical Constraints & Risks
* **Risks:** None — fix only affects display name in AI Review combobox. Other surfaces (document-manager, emails) compute names independently.
* **Cache:** API caches templates for 1h — must clear `cache:templates` KV key after update OR wait.
* **Breaking Changes:** None.

## 6. Proposed Solution

### Success Criteria
CS docs in AI Review reassign combobox display the per-issuer name (e.g., "אישור מס – פנסיה – מיטב דש") instead of just the template name.

### Logic Flow
1. Update `short_name_he` field for 17 CS templates in Airtable
2. Clear `cache:templates` KV key in Cloudflare Workers
3. Verify in admin panel

### Templates to Update
17 CS templates with issuer variables (CS-T001, T002, T003, T006, T007, T008, T009, T010, T011, T012, T013, T014, T015, T016, T017, T018, T022) — see plan file for exact new values.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| Airtable documents_templates | Update | 17 CS template `short_name_he` records |
| `SSOT_CS_required_documents.md` | Update | Document new short_name_he formats |

### Final Step
Update design log status, INDEX, current-status, git commit.

## 7. Validation Plan
* [ ] Script runs successfully — all 17 records updated in Airtable
* [ ] `cache:templates` KV key cleared
* [ ] CPA-XXX AI Review reassign combobox shows CS docs WITH issuer names
* [ ] AR docs unchanged in AI Review combobox
* [ ] Document-manager still shows full per-issuer names (regression check)
* [ ] No errors in Workers logs

## 8. Implementation Notes (Post-Code)
- Updated 17 CS template records via pyairtable batch_update — all succeeded
- Cleared `cache:templates` KV key in Cloudflare Workers via `wrangler kv key delete`
- No code changes needed — pure Airtable data fix
- The bug was discovered while testing DL-239 cross-filing-type reassign
- Initial hypothesis (CS doc generator missing per-issuer expansion) was wrong — verified via document-manager that per-issuer expansion DOES work; the gap was only in template `short_name_he` config
