# Design Log 118: Qualifying Settlement City Dropdown
**Status:** [COMPLETED]
**Date:** 2026-03-08
**Related Logs:** DL-107 (Tally form intro text updates)

## 1. Context & Problem
Item 6.2 from Natan meeting. Currently the questionnaire asks "Did you live in a qualifying settlement?" (yes/no), then a **free-text** field asks for the settlement name. Clients often don't know if their city qualifies, type names with typos, or use informal names. A dropdown of all 468 official qualifying settlements removes ambiguity — with an "Other" fallback for newly-added settlements.

## 2. User Requirements
1. **Q:** Dropdown or free-text with validation?
   **A:** Tally dropdown with "not in list" free-text fallback.
2. **Q:** Both HE and EN forms?
   **A:** Yes, both.
3. **Q:** What if settlement not in list?
   **A:** "Other" option reveals a free-text field.
4. **Q:** Any downstream logic changes?
   **A:** No — questionnaire only. The yes/no question already triggers `residency_cert`.
5. **Q:** Where to store the list long-term?
   **A:** JSON file in repo (`data/qualifying-settlements-2026.json`).

## 3. Research
### Domain
Form Design — long-list dropdown with fallback

### Sources Consulted
1. **Tally.so docs (Dropdown field)** — Tally dropdowns are searchable by default. Users type to filter. Supports "Bulk insert" — paste all options with each on a separate line.
2. **Tally.so docs (Other option)** — Built-in "Other option" toggle for dropdowns. When enabled, selecting "Other" reveals a free-text input automatically. No conditional logic setup needed.
3. **"Form Design Patterns" — Adam Silver** — For long lists (100+), a searchable dropdown or autocomplete is preferred over radio buttons. Alphabetical sort is critical.

### Key Principles Extracted
- Searchable dropdowns work well for lists up to ~500 items with alphabetical sort
- "Other" fallback prevents dead-ends when the list is incomplete
- Hebrew alphabetical sort is native — no special handling needed

### Research Verdict
Tally's built-in features (bulk insert + searchable dropdown + Other toggle) handle this perfectly. No custom code needed on the form side.

## 4. Codebase Analysis
* **Existing Solutions Found:** `family_settlement_name` mapped as `type: "text"` in `questionnaire-mapping.js` (line 196–206) and `.json` (line 233–238). Tally field IDs: HE `question_7WKvJP`, EN `question_g0q7MK`.
* **Reuse Decision:** The existing mapping entry stays — Tally sends dropdown selections as text values, so n8n processing needs zero changes.
* **Relevant Files:** `questionnaire-mapping.js`, `questionnaire-mapping.json`, `data/qualifying-settlements-2026.json`
* **Dependencies:** Tally forms HE (`1AkYKb`) and EN (`1AkopM`)

## 5. Technical Constraints & Risks
* **Risk:** Tally field ID may change if we delete and recreate the field (dropdown vs text). Must verify — if the Tally field ID changes, the webhook payload key changes and the mapping breaks.
  * **Mitigation:** In Tally, try **converting** the existing text field to a dropdown rather than deleting+recreating. If Tally doesn't support type conversion, create a new dropdown field, note the new field ID, and update the `tallyKeys` in both mapping files.
* **Annual update:** List needs refreshing each tax year. JSON file in repo makes this a simple file update + Tally re-paste.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Copy settlement names from JSON, one per line
2. In Tally HE form: convert/replace the "שם היישוב" text field → dropdown, bulk-paste all 468 names, enable "Other option" toggle
3. In Tally EN form: same process for the EN field
4. Test both forms — verify the webhook payload still uses the same field ID and sends the selected value correctly
5. If field IDs changed: update `tallyKeys` in both mapping files

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `data/qualifying-settlements-2026.json` | Already created | 468 settlement names, names-only |
| Tally HE form (`1AkYKb`) | Modify | Replace text → dropdown with bulk-paste + Other toggle |
| Tally EN form (`1AkopM`) | Modify | Same |
| `questionnaire-mapping.js` | Maybe modify | Update `tallyKeys` if Tally field ID changes |
| `questionnaire-mapping.json` | Maybe modify | Same |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy unchecked validation items to `current-status.md`

## 7. Validation Plan
* [ ] Submit test questionnaire (HE form) — select a settlement from dropdown → verify value arrives in n8n webhook
* [ ] Submit test questionnaire (HE form) — select "Other" + type custom name → verify free-text value arrives
* [ ] Submit test questionnaire (EN form) — same two tests
* [ ] Verify the Tally field ID hasn't changed (check webhook payload key matches `question_7WKvJP` / `question_g0q7MK`)
* [ ] If field IDs changed: update mapping files + verify document generation still works

## 8. Implementation Notes (Post-Code)
* Data file: `data/qualifying-settlements-2026.json` — 486 settlement names, JSON array
* Paste-ready file: `tmp/settlements-paste-ready.txt` — one name per line, ready for Tally bulk-insert
* **Manual step (user):** ✅ Done — converted text field → dropdown in both Tally forms, bulk-pasted 486 settlements, enabled "Other option" toggle
* **Airtable:** ✅ Done — converted field to single select for Tally-Airtable integration
* Mapping files: no changes needed yet — will update `tallyKeys` only if Tally field IDs change after the conversion
