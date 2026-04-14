# Design Log 027: [SUB] Document Service Sub-Workflow

**Date:** 2026-01-27
**Status:** [COMPLETED]
**Related Workflows:** New sub-workflow, does NOT modify Workflow [02]

---

## 1. Overview

Create a reusable n8n sub-workflow that generates documents and HTML emails by reading configuration from Airtable tables instead of hardcoded JavaScript. This service will be used by **new workflows only** - Workflow [02] remains unchanged.

---

## 2. Architecture Decision

### Why Airtable-Driven Config?
1. **Maintainability**: Non-developers can update document templates
2. **Auditability**: All changes tracked in Airtable history
3. **Flexibility**: Easy to add new document types without code changes
4. **Separation of concerns**: Config vs logic separated

### Data Flow
```
Caller Workflow → [SUB] Document Service → Airtable Config → Generated Output
                                        ↓
                               Returns: { documents[], office_html, client_html }
```

---

## 3. Airtable Tables Schema

### 3.1 Table: `document_templates`
32 rows based on SSOT templates T001-T1701

| Field | Type | Example |
|-------|------|---------|
| template_id | Single line text (PK) | T201 |
| template_he | Long text | `טופס 106 לשנת **{{year}}** – **{{employer_name}}**` |
| template_en | Long text | `Form 106 for **{{year}}** — **{{employer_name}}**` |
| scope | Single select | CLIENT, SPOUSE, PERSON, GLOBAL_SINGLE |
| category | Link to categories | employment |
| airtable_type | Single line text | Form_106 |
| variables | Long text (JSON) | `["year", "employer_name"]` |
| is_static | Checkbox | false |

### 3.2 Table: `question_mappings`
~52 rows from questionnaire-mapping.json

| Field | Type | Example |
|-------|------|---------|
| mapping_id | Single line text (PK) | employment_employers_list |
| tally_key_he | Single line text | question_5zjRMZ |
| tally_key_en | Single line text | question_xpDPY9 |
| trigger_type | Single select | yes_no, list, checkbox, always |
| trigger_value | Single line text | כן (for yes_no type) |
| templates | Long text (JSON) | `["T201"]` |
| per_item | Checkbox | true |
| details_field | Single line text | employer |
| is_spouse | Checkbox | false |
| linked_question | Single line text | (mapping_id reference) |
| fixed_params | Long text (JSON) | `{"deposit_type": "קרן פנסיה"}` |

### 3.3 Table: `categories`
8-11 rows

| Field | Type | Example |
|-------|------|---------|
| category_id | Single line text (PK) | employment |
| emoji | Single line text | 💼 |
| name_he | Single line text | הכנסות מעבודה |
| name_en | Single line text | Employment Income |
| display_order | Number | 1 |

### 3.4 Table: `template_overrides`
4 rows for special cases

| Field | Type | Example |
|-------|------|---------|
| override_id | Single line text (PK) | nii_disability |
| condition_field | Single line text | allowance_type |
| condition_value | Single line text | נכות |
| original_template | Single line text | T301 |
| override_template | Single line text | T303 |
| priority | Number | 1 |

---

## 4. Sub-Workflow Design

### 4.1 Input Contract (POST webhook or Execute Workflow)
```json
{
  "action": "generate_docs" | "generate_html" | "both",
  "report_record_id": "recXXX",
  "answers_by_key": { "question_5zjRMZ": ["INTEL", "Google"], ... },
  "client_name": "לוי יצחק",
  "spouse_name": "משה",
  "year": "2025",
  "language": "he"
}
```

### 4.2 Output Contract
```json
{
  "ok": true,
  "documents": [
    {
      "document_key": "recXXX_T201_client_intel",
      "type": "Form_106",
      "person": "client",
      "issuer_name": "טופס 106 לשנת <b>2025</b> – <b>INTEL</b>",
      "category": "employment"
    }
  ],
  "office_email_html": "<html>...",
  "client_email_html": "<html>...",
  "document_count": 42
}
```

### 4.3 Node Structure
1. **Webhook / Execute Workflow Trigger** (dual trigger support)
2. **Respond to Webhook** (immediate 202)
3. **4x Airtable Get All** (parallel: templates, mappings, categories, overrides)
4. **Merge Config**
5. **Code - Generate Documents** (main logic)
6. **IF - action includes HTML?**
7. **Code - Generate HTML** (office + client)
8. **Code - Format Response**

---

## 5. Implementation Notes

### Critical SSOT Rules (from SSOT_required_documents_from_Tally_input.md)
- T002 (ספח ת״ז) appears ONLY ONCE globally
- Form 867 deduplicated by normalized institution
- Spouse name appears EXACTLY ONCE in spouse document titles
- Bold rules: all dynamic values + always **מקוצר** and **רלוונטיים**
- Foreign income binary logic (1.10): return filed → T1602, else → T1601

### Credential Reference
- Airtable: `ODW07LgvsPQySQxh` (Airtable Personal Access Token account)

---

## 6. Files Created/Modified

| File | Action | Status |
|------|--------|--------|
| Airtable: document_templates | CREATE | Pending (user creates) |
| Airtable: question_mappings | CREATE | Pending (user creates) |
| Airtable: categories | CREATE | Pending (user creates) |
| Airtable: template_overrides | CREATE | Pending (user creates) |
| n8n: [UTIL] Migrate Config to Airtable | CREATE | Pending |
| n8n: [SUB] Document Service | CREATE | Pending |
| CLAUDE.md | UPDATE | Pending |

---

## 7. Testing Strategy

1. Build migration workflow → Populate tables
2. Build sub-workflow incrementally
3. Test with SSOT example payload (Section 3)
4. Verify output matches Section 4 expected output
5. Run SSOT verification checklist

---

## 8. Session Log

### 2026-01-27
- Plan approved
- Design log created
- Airtable credential identified: ODW07LgvsPQySQxh
- Tables already exist and populated (categories, documents_templates, question_mappings)
- Skipped migration workflow - data already in place
- Created [SUB] Document Service workflow: **hf7DRQ9fLmQqHv3u**
- Simplified to 7 nodes (removed IF branching - always generate HTML)
- Workflow structure: Trigger → 3x Airtable (parallel) → Merge → Generate Docs → Generate HTML
- Validation warnings about error handling (non-blocking)
- Updated CLAUDE.md with workflow ID
- Created test workflow: **uFIrf6gUVbvTHn8Q**

**Testing iterations:**
1. First test: 0 documents (trigger data not passing through)
   - Fixed: Added "Pass Trigger Data" node and 4-input Merge
2. Second test: 77 documents with double bold `<b><b>...</b></b>` and "כן" values
3. Third test: 57 documents, still double bold and duplicates
4. Fourth test: **47 documents** ✅ - Major improvements:
   - Fixed double bold by processing `**{var}**` before `**text**`
   - Fixed empty `****` markers
   - Added specific variable lookups per template (T001, T1501, T1601, etc.)
   - Eliminated duplicate documents

**Remaining issues (may be Airtable mapping issues):**
- Only 1 deposit per type instead of 2
- Missing spouse NII allowances (T302)
- Possible T1601 duplicates (1 generic + per-type)

**Status:** Functional - needs minor refinement
