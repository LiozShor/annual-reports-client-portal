# Design Log 133 — Shared Constants, Utils & Endpoints Extraction

**Status:** Implemented
**Date:** 2026-03-09
**Prerequisite:** Design Log 132 (God Component Refactoring Risk Analysis)

## Summary

Extracted duplicated constants, utility functions, and hardcoded webhook URLs into three shared modules. This is the "safe wins" foundation identified in DL-132 — near-zero production risk, required before any future god component splitting.

## Files Created

| File | Purpose | Contents |
|------|---------|----------|
| `shared/constants.js` | SSOT constants | `API_BASE`, `ADMIN_TOKEN_KEY`, `STAGES`, `STAGE_NUM_TO_KEY`, `STAGE_LABELS`, `STAGE_ORDER` |
| `shared/utils.js` | Shared utility functions | `sanitizeDocHtml()` |
| `shared/endpoints.js` | Centralized webhook URLs | `ENDPOINTS` object with 22 named endpoint URLs |

## Files Modified

### HTML (added `<script>` tags for shared modules)
- `admin/index.html` — added constants.js + endpoints.js
- `document-manager.html` — added constants.js + endpoints.js + utils.js
- `view-documents.html` — added constants.js + endpoints.js + utils.js
- `index.html` — added constants.js + endpoints.js

### JS (removed duplicated definitions, replaced with shared globals)
- `admin/js/script.js` — removed `API_BASE`, `ADMIN_TOKEN_KEY`, `STAGES`, `STAGE_NUM_TO_KEY`; replaced 28 inline endpoint URLs with `ENDPOINTS.*`
- `assets/js/document-manager.js` — removed `STAGE_LABELS`, `API_BASE`, `sanitizeDocHtml()`; replaced 6 inline endpoint URLs; now uses `ADMIN_TOKEN_KEY` from shared
- `assets/js/view-documents.js` — removed `sanitizeDocHtml()`, `ADMIN_TOKEN_KEY`; replaced 1 hardcoded URL
- `assets/js/landing.js` — removed `STAGE_ORDER`; replaced 2 hardcoded endpoint URLs

### NOT modified (per DL-132 risk analysis)
- `n8n/workflow-processor-n8n.js` — highest consequence-per-line, leave as-is
- `admin/document-types-viewer.html` — inline `<script>` block, standalone page
- `admin/questionnaire-mapping-editor.html` — inline `<script>` block, standalone page

## Deduplication Summary

| Before | After |
|--------|-------|
| `API_BASE` defined in 3 files | 1 definition in `shared/constants.js` |
| `STAGES`/`STAGE_LABELS`/`STAGE_ORDER` defined in 3 files | 1 definition + derived maps in `shared/constants.js` |
| `ADMIN_TOKEN_KEY` defined in 2 JS files + 2 inline HTML | 1 definition in `shared/constants.js` (inline HTML pages unchanged) |
| `sanitizeDocHtml()` defined in 2 files | 1 definition in `shared/utils.js` |
| 37+ hardcoded webhook URLs across 4 files | 22 named constants in `shared/endpoints.js` |

## Script Loading Order

All pages follow: error-handler → resilient-fetch → **shared/constants** → **shared/endpoints** → [shared/utils if needed] → page-specific script

## Risk Assessment

- **Zero API changes** — only client-side refactoring
- **No behavior changes** — same globals, same values, just sourced from shared files
- **Rollback:** Revert the commit to restore inline definitions
