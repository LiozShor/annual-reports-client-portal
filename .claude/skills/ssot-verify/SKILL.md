# SSOT Verification Skill

Run this checklist after ANY edit to document-generation code.

## Trigger Files (run verification if ANY of these changed)
- `ssot-document-generator.js`
- `document-types.js`
- `document-display-n8n.js`
- `workflow-processor-n8n.js`

## Test Procedure
Test workflow `kH9GYY9huFQHQE2R` against WF[02] `EMFcb8RlVI0mge6W`.

## Checklist (ALL must pass)
- [ ] Spouse name in MIDDLE: "טופס 106 של **(משה)** לשנת 2025 מ**INTEL**"
- [ ] Bold dynamic values: employer names, bank names, withdrawal types
- [ ] Form 867 deduplicated by institution
- [ ] Only ONE appendix "ספח ת״ז"
- [ ] NII disability: "אישורים על קצבת נכות **שהתקבלו** מביטוח לאומי"
- [ ] Deposits: "(נקרא גם דוח שנתי מקוצר) על ההפקדות"
- [ ] Categories grouped with emojis; client/spouse separation headers

## Two Codebases (CRITICAL)
When fixing doc-generation bugs, always update BOTH:

| Codebase | Location | Update Method |
|----------|----------|---------------|
| n8n Code nodes | `[SUB] Document Service` (hf7DRQ9fLmQqHv3u) | `n8n_update_partial_workflow` |
| GitHub Pages JS | `frontend/n8n/` | Git commit + push |

n8n Document Service does NOT fetch JS from GitHub — all logic embedded in Code nodes.
