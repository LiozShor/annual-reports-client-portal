# Design Log 243: CS Help Text Content (view-documents `?` accordions)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-07
**Related Logs:** DL-117 (help icons infrastructure), DL-157 (insurance company links), DL-225 (CS hardcoded AR remediation)

## 1. Context & Problem
The `view-documents.html` portal shows a `?` icon next to each document that opens an inline accordion with help text — telling the client where/how to obtain that document. Built in DL-117, extended in DL-157 with per-company links.

**The infrastructure is filing-type agnostic and already serves CS:**
- Frontend (`view-documents.js:341`) renders `doc.help_he`/`doc.help_en` for any document — no `filing_type` branching.
- Workers API (`api/src/routes/documents.ts:156-170` → `api/src/lib/doc-builder.ts:298-303`) reads from `documents_templates` (`tblQTsbhC6ZBrhspc`) without filtering by filing type. `resolveHelpText()` supports `{year}`, `{year_plus_1}`, `{company_name}`, `{company_url}` placeholders identically for AR and CS rows.

**But CS clients see zero `?` icons** because none of the 22 CS templates have `help_he`/`help_en` populated:

| Filing type | Templates | with `help_he` | with `help_en` |
|---|---|---|---|
| `annual_report` | 33 | 21 | 21 |
| `capital_statement` | **22** | **0** | **0** |

This is a content gap, not a code gap. Same blocker pattern as `project_help_section_blocked` memory (AR was waiting on Natan's Excel; CS now waits on the same).

## 2. User Requirements
1. **Q:** Are code changes required?
   **A:** No — pipeline already supports CS. Pure Airtable content task.
2. **Q:** Who writes the Hebrew/English help text?
   **A:** Office (Natan). Gmail draft + Excel template prepared 2026-04-07.
3. **Q:** Should banks / credit-card companies get auto-linking via `{company_url}`?
   **A:** TBD when Natan returns the Excel — if he requests links, add new rows to `company_links` (`tblDQJvIaEgBw2L6T`) and use `{company_name}` / `{company_url}` placeholders in the relevant CS templates (CS-T001, CS-T002, CS-T008–T011, CS-T022).

## 3. Research
Already covered by DL-117 (progressive disclosure / accordions / contextual help) and DL-157 (inline external links + alias matching). No new research needed — this log is purely about importing content into the existing infrastructure.

## 4. Codebase Analysis
* **No code changes required.** Verified end-to-end:
  - `api/src/routes/documents.ts:162-163` — single `TABLES.TEMPLATES` fetch, no filing-type filter.
  - `api/src/lib/doc-builder.ts:124-147` `buildTemplateMap` — indexes all templates by `template_id`.
  - `api/src/lib/doc-builder.ts:296-303` — populates `help_he`/`help_en` per doc whenever the matching template has them.
  - `github/annual-reports-client-portal/assets/js/view-documents.js:341-407` — renders `?` icon and accordion when `helpText` is non-empty.
* **Company link infra** (DL-157): `company_links` (`tblDQJvIaEgBw2L6T`) currently holds 14 insurance/pension companies. Banks and credit-card companies are NOT yet there — would need to be added if CS templates use `{company_url}`.
* **22 CS templates** (CS-T001 → CS-T022) already exist in `documents_templates` with proper `name_he`, `category`, `filing_type='capital_statement'`.

## 5. Technical Constraints & Risks
* **Security:** External links must use `target="_blank" rel="noopener noreferrer"` — already enforced by `sanitizeHelpHtml` in `view-documents.js:36`.
* **Risks:** None — additive content only.
* **Breaking changes:** None.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
A CS client opening `view-documents.html?report_id=<CS-report>` sees `?` icons next to all 22 documents (where applicable), each opening a Hebrew/English accordion explaining how to obtain that document, with optional clickable links to bank / company portals.

### Logic Flow
1. **Office fills Excel** (`tmp/CS-help-text-template.xlsx`) — 22 rows, fills `help_he` + `help_en` columns.
2. **Lioz imports to Airtable** via Python script: read Excel → PATCH `documents_templates` records by `template_id`.
3. **(Conditional) Add bank/credit-card rows to `company_links`** if Natan requests `{company_url}` auto-linking.
4. **KV cache invalidation** — Workers cache key `cache:templates` (TTL 3600s) auto-expires within 1 hour, or manually purge via `wrangler kv:key delete --binding=CACHE_KV cache:templates`.
5. **Verify on a real CS report** — open `view-documents.html` and confirm icons + accordion content.

### Files / Data to Change
| Target | Action | Description |
|---|---|---|
| `tmp/CS-help-text-template.xlsx` | Created 2026-04-07 | Excel template with 22 CS rows + instructions sheet |
| Gmail draft `r6963282730062771380` | Created 2026-04-07 | Hebrew request to Natan with attached template (manual attach before send) |
| Airtable `documents_templates` (22 CS rows) | Modify (when returned) | Populate `help_he` + `help_en` from Excel |
| Airtable `company_links` | Possibly extend | Add bank / credit-card companies if requested |
| Workers KV `CACHE_KV` | Purge | Delete `cache:templates` to force re-fetch |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]` once Excel is imported, then run Section 7 tests.

## 7. Validation Plan
* [ ] Excel returned by Natan with 22 rows of `help_he` (and ideally `help_en`).
* [ ] All 22 CS templates updated in Airtable via import script.
* [ ] `cache:templates` KV key purged (or 1h elapsed since last fetch).
* [ ] Open a real CS report in `view-documents.html` — `?` icons appear next to documents that have help text.
* [ ] Click `?` → accordion expands with correct Hebrew text + clickable links (if any).
* [ ] Toggle language to English → English help text shows.
* [ ] Documents with `{company_name}` / `{company_url}` placeholders resolve correctly (or fall back gracefully if no match).
* [ ] Mobile layout: accordion does not break `.doc-row` flex layout.
* [ ] AR view-documents still works unchanged (regression check).

## 8. Implementation Notes (Post-Code)

### 2026-04-07 — Initial blocked state captured
- Audit confirmed help text pipeline is filing-type agnostic. No code changes needed — purely a content gap.
- Created `tmp/CS-help-text-template.xlsx` with 22 CS templates (RTL, frozen header, instructions sheet).
- Created Gmail draft `r6963282730062771380` (Hebrew, addressed to office, references attached Excel). Draft has no recipient yet — requires Natan's email + manual attachment before sending.
- Added entry to `current-status.md` blocked items.

### 2026-04-12 — Natan returned Excel, imported to Airtable
- Natan filled `help_he` for **16 of 22** CS templates. 6 intentionally left empty (self-explanatory docs: CS-T004, CS-T006, CS-T007, CS-T012, CS-T019, CS-T020).
- Fixed hardcoded year "31.12.2025" → "31.12.{year}" in CS-T010 and CS-T018 during import.
- No `help_en` column in returned Excel — generated English translations and imported those too.
- All 16 `help_he` + 16 `help_en` PATCHed into Airtable `documents_templates` via pyairtable.
- KV cache `cache:templates` purged (namespace `39bcc73f6c8c4507bc9c5032bf2914cf`).
- No code changes needed — existing pipeline serves CS help text identically to AR.

### 2026-04-12 — Added company links
- Added 13 new companies to `company_links` table (8 banks, 3 credit cards, 2 brokerages).
- Total `company_links`: 31 entries (18 existing insurance/pension + 13 new).
- Updated 13 CS help texts (HE + EN) to include `<a href="{company_url}">{company_name} ← לאזור האישי</a>` links.
- Templates with links: CS-T001, T002, T008, T009, T010, T011, T013–T018, T022.
- User manually verified and corrected 7 URLs in Airtable (Discount/Mercantile → Telebank, IBI, Isracard, Excellence, Bank Jerusalem, FIBI, Max).
- KV caches purged: `cache:templates` + `cache:company_links`.
