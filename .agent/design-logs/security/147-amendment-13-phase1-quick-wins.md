# Design Log 147: Amendment 13 Compliance — Phase 1 Quick Wins
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-11
**Related Logs:** DL-090 (HMAC token architecture), DL-094 (security monitoring)

## 1. Context & Problem
Israel's Amendment 13 to the Protection of Privacy Law requires stricter handling of personal data. A compliance audit (docs/amendment-13-compliance-report.md) identified several issues. This log covers Tier 1 — quick wins with high compliance impact.

## 2. Tasks Completed

### Task 1: Self-Host Google Fonts (Finding 26)
**Problem:** External Google Fonts import leaked visitor IPs to Google.
**Solution:** Downloaded 12 woff2 files (Heebo 5 subsets, Inter 7 subsets), created local `assets/fonts/fonts.css`, updated `design-system.css` import, removed Google Fonts domains from CSP in all 7 HTML files.
**Files changed:**
- `assets/fonts/` — new directory with 12 woff2 files + fonts.css
- `assets/css/design-system.css` — import path changed
- 7 HTML files — CSP meta tags updated (removed googleapis.com and gstatic.com)
**Commit:** `0b09ae1` — pushed to main

### Task 2: approve-confirm.html GET→POST (Finding 27)
**Problem:** Hidden form used GET, exposing report_id and token in URL bar/history/logs.
**Solution:** Changed form `method="GET"` to `method="POST"`. Used POST form (not fetch) to avoid CORS issues per project CORS rules. Updated n8n workflow [3] Approve & Send (cNxUgCHLPZrrqLLa) Verify Token node to merge POST body with GET query params: `const q = {...(webhookData.body || {}), ...(webhookData.query || {})};`
**Files changed:**
- `approve-confirm.html` — form method GET→POST
- n8n workflow `cNxUgCHLPZrrqLLa` — Verify Token code node updated
**Commit:** `06fc2d2` — pushed to main

### Task 3: Reduce Client Token Expiry 30→14 Days (Finding 11)
**Problem:** 30-day token expiry disproportionate for sensitive tax data.
**Solution:** Changed expiry from `30 * 24 * 60 * 60` to `14 * 24 * 60 * 60` in both token generation locations:
1. `[01] Send Questionnaires` (9rGj2qWyvGWVf9jXhv7cy) → `Build Email Data` node
2. `[06] Reminder Scheduler` (FjisCdmWc4ef0qSV) → `Build Type A Email` node
No frontend changes needed — validation checks embedded expiry timestamp, not hardcoded duration.
**Note:** Existing 30-day tokens will naturally expire. Only new tokens affected.

## 3. Codebase Analysis
- **7 HTML files** with CSP tags — all updated consistently
- **2 n8n workflows** generate client tokens — both updated
- Token validation is timestamp-based (no hardcoded duration on validation side)
- approve-confirm.html used GET form to avoid CORS — kept form approach, just changed to POST

## 4. Technical Constraints & Risks
- **CORS:** POST form chosen over fetch() to avoid CORS preflight issues (per CLAUDE.md CORS rules)
- **Backwards compatible:** Existing 30-day tokens continue working until natural expiry
- **n8n webhook:** Already accepted both GET and POST methods; only needed body+query merge in Verify Token

## 5. Validation Plan
- [x] Open any HTML page in browser — fonts load locally, zero requests to googleapis.com/gstatic.com (Playwright network tab verified)
- [x] Approve-confirm GET flow works — form submits to n8n, processes, redirects back with result param (Task 2 reverted to GET, confirmed working)
- [x] WF[01] Send Questionnaires: code has `14 * 24 * 60 * 60` (execution 7781 was pre-update)
- [x] WF[06] Reminder Scheduler: token expiry = exactly 14 days (email 19cddb9a58906cf8, sent 2026-03-11 16:27, expires 2026-03-25 16:27)
- [ ] Check existing client links with 30-day tokens still work (manual — validation is timestamp-based, no breakage expected)

## 6. Implementation Notes
- Heebo font is variable (same woff2 file across weights 400-700 per subset) — 5 unique files
- Inter has 7 subsets including cyrillic/greek/vietnamese (kept all for completeness)
- n8n workflow [3] already had JSON response path with CORS headers for admin panel — our POST form uses the HTML redirect path
