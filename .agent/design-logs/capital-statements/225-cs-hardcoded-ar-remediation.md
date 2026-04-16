# DL-225: CS Hardcoded AR Remediation

**Status:** COMPLETED
**Date:** 2026-03-30
**Audit:** `docs/cs-hardcoded-audit.md`
**Plan:** `docs/capital-statements-implementation-plan.md` (Phase 9)

## Summary

Post-implementation audit found 10 critical + 11 warning hardcoded AR references after the filing_type infrastructure was added. This DL remediated all actionable findings across n8n workflows, client portal frontend, and Workers API.

## Changes Made

### n8n WF06 Reminder Scheduler (`FjisCdmWc4ef0qSV`)
- **Search Due Reminders:** Added `filing_type` to Airtable field list
- **Build Type A Email:** Added `heDef` to FILING_LABELS, replaced 4 hardcoded body strings with `ftLabel.heDef`, dynamic WhatsApp URL
- **Build Type B Email:** Same pattern — HE body uses `ftLabel.heDef`, `ctaBlock()` now accepts `ftLabel` param for dynamic WhatsApp URL

### n8n WF07 Daily Digest (`0o6pXPeewCRxEEhd`)
- **Query Pending Approval:** Added `filing_type` to HTTP URL fields
- **Build Digest Email:** CS clients show `הצ"ה` badge tag, footer changed from `מערכת דוחות שנתיים` to `מערכת דוחות`

### Client Portal (GitHub Pages)
- `view-documents.html`: Generic `<title>` and `<h1>`, JS updates dynamically from API
- `view-documents.js`: Dynamic title/h1 in both code paths, generic empty-state text, generic mailto fallback
- `landing.js`: `FILING_CONFIG` map replaces single AR fallback, generic Base64 header, generic fallback labels
- `admin/js/script.js`: `console.warn` on missing `filing_type` (4 places), generic print footer
- `document-manager.js`: Generic print footer
- `privacy-policy.html`: Broadened 3 references to include `הצהרות הון`

### Workers API (Cloudflare Workers)
- `chat.ts`: Fixed `filing_type` description in AI system prompt
- `rollover.ts`: Added `filing_type` check to target-year `clientsWithTarget` loop
- `dashboard.ts`: Added optional `filing_type` query param to filter formula

## Stale Findings (not fixed — already handled)
- WF01 Send Questionnaire (C-01, C-02): Migrated to Workers, already CS-aware
- WF01 Airtable view (W-10): Migrated to Workers

## Design Pattern: `heDef` in FILING_LABELS
Added definite-article Hebrew forms for body text:
```javascript
const FILING_LABELS = {
  annual_report: { he: 'דוח שנתי', heDef: 'הדוח השנתי', en: 'Annual Report' },
  capital_statement: { he: 'הצהרת הון', heDef: 'הצהרת ההון', en: 'Capital Statement' }
};
```
- `he`: indefinite form for subjects/headers ("שאלון דוח שנתי")
- `heDef`: definite form for body text ("הכנת הדוח השנתי")
