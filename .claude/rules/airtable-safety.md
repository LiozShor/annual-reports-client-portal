# Airtable & SSOT Safety Rules

## Core Principle
**Airtable = State Machine.** All stages, statuses, and transitions live in Airtable. No in-memory-only state.

## SSOT Rules (CRITICAL)

**Authoritative source:** `SSOT_required_documents_from_Tally_input.md`
**Implementation:** `frontend/n8n/ssot-document-generator.js`

1. ALL document titles MUST use SSOT module — NEVER hallucinate/improvise names
2. NEVER use `document-types.js` templates for generation (legacy)
3. ALL dynamic values in titles must be **bold**
4. Spouse name IN THE MIDDLE of spouse titles (not appended)
5. Form 867: deduplicate by normalized institution name
6. Only ONE "ספח ת״ז" appendix per submission
7. Foreign income FRA01: evidence always required, tax return only if filed abroad
8. Deposits: exact SSOT wording. NII: special wording for נכות and דמי לידה

**After ANY doc-generation edit:** Run SSOT verification — see `.claude/skills/ssot-verify/SKILL.md`

## Two Codebases (CRITICAL)

| Codebase | Location | Update Method |
|----------|----------|---------------|
| **n8n Code nodes** | `[SUB] Document Service` (hf7DRQ9fLmQqHv3u) | `n8n_update_partial_workflow` |
| **GitHub Pages JS** | `frontend/n8n/` | Git commit + push |

n8n Document Service does NOT fetch JS from GitHub — all logic embedded in Code nodes. Config from Airtable at runtime.

**When fixing doc-generation bugs:** Always update BOTH codebases if the fix involves generation logic.
