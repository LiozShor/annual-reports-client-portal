# DL-138: Surgical Removal of T301 from Classification

**Date:** 2026-03-10
**Status:** Deployed
**Impact:** Classification accuracy — generic NII docs no longer misclassified

## Problem
T301 (NII Generic Allowance — Client) is a phantom template. The Tally questionnaire never asks clients about generic NII allowances — only:
- **Client**: `client_nii_disability` → triggers T303 (disability only)
- **Spouse**: `spouse_nii_allowances` → triggers T302 (+ T303/T304 overrides)

Result: 0 T301 required docs across all 500+ clients. When AI classified generic NII as T301, `matched_doc_record_id` was empty → unmatched doc.

## Changes (3 files, 9 edits)

### WF05 Prepare Attachments — Classification Prompt
Node: `22ed433d-fdcb-4afc-9ce2-c14cab2861c4` in `cIa23K8v1PrbDJqY`
- Removed T301 from `ALL_TEMPLATE_IDS` enum
- Deleted T301 doc reference entry, rewrote T302 as standalone generic NII
- T303 override: `instead of T301/T302` → `instead of T302`
- NII Phase B: `generic + client → T301` / `generic + spouse → T302` → `generic → T302` always
- Updated critical warning and confused pairs sections
- issuer_name description: `T301-T306` → `T302-T306`

### WF05 Process and Prepare Upload — HE_TITLE
Node: `630031f2-6e40-46ce-be9b-9a617dd290c3`
- Removed `T301:'אישור קצבה ביטוח לאומי'` from HE_TITLE map

### Admin script.js — RELATED_TEMPLATES
- `T301: ['T301', 'T302'], T302: ['T301', 'T302']` → `T302: ['T302']`

## Deployment
- n8n WF05: Both nodes updated via REST API PUT — verified T301 absent
- GitHub: Committed `10712c7` and pushed to main

## Verification Checklist
- [ ] Resend test docs → doc4.pdf (אבטלה) classifies as T302 (not T301)
- [ ] doc4 matches client's T302 required doc slot
- [ ] Other NII docs unaffected (T303-T306 still correct)
- [ ] T601/T201/T401 classifications unchanged
- [ ] T301 physically impossible — not in enum
