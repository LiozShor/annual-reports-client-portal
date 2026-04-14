# Design Log 151: Questionnaire Mapping Ecosystem Cleanup
**Status:** [COMPLETED]
**Date:** 2026-03-12
**Related Logs:** DL-007 (original mapping SSOT design)

## 1. Context & Problem
User asked whether `questionnaire-mapping.json` is still necessary given that Tally writes directly to Airtable `documents_templates`. Audit revealed the entire questionnaire-mapping file ecosystem is redundant.

## 2. Audit Findings

### Architecture Reality
The **[SUB] Document Service** workflow (`hf7DRQ9fLmQqHv3u`) fetches all config from Airtable at runtime:
- `Get Templates` → Airtable `documents_templates`
- `Get Mappings` → Airtable `question_mappings` (table `tblWr2sK1YvyLWG3X`)
- `Get Categories` → Airtable categories table

No workflow fetches from GitHub files. The Airtable tables are the true SSOT.

### Files Audited

| File | Size | Consumers | Verdict |
|------|------|-----------|---------|
| `questionnaire-mapping.js` | 44KB, 1100 lines | Only `generate-mapping-json.js` | **REDUNDANT** — stale copy of Airtable `question_mappings` |
| `questionnaire-mapping.json` | 20KB | **None** | **REDUNDANT** — generated but never consumed |
| `n8n/generate-mapping-json.js` | 1.3KB | Manual script | **REDUNDANT** — output unused |
| `admin/questionnaire-mapping-editor.html` | ~30KB | Not linked from admin nav | **ORPHANED** — hardcoded auth, isolated |
| `admin/document-types-viewer.html` | ~15KB | Not linked from admin nav | **ORPHANED** — isolated from main app |

### Key Evidence
- `workflow-processor-n8n.js` receives `mappingData` as parameter from n8n Merge node (which merges Airtable data), NOT from GitHub files
- DL-007 (Jan 2025) proposed GitHub SSOT but Phase 2 (n8n integration) was never completed — Airtable became the SSOT instead
- Both admin HTML pages use hardcoded password auth, not connected to main auth system

## 3. Action Taken
Deleted all 5 redundant files:
1. `questionnaire-mapping.js`
2. `questionnaire-mapping.json`
3. `n8n/generate-mapping-json.js`
4. `admin/questionnaire-mapping-editor.html`
5. `admin/document-types-viewer.html`

## 4. What Remains (Active)
- `n8n/workflow-processor-n8n.js` — active, receives mapping data from Airtable at runtime
- `n8n/ssot-document-generator.js` — embedded in n8n Code nodes (not a GitHub file)
- Airtable tables: `documents_templates`, `question_mappings`, categories
