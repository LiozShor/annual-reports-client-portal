# Design Log 373: Password-Protected PDF Unlock from AI Review Preview

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-28
**Related Logs:** DL-075 (inline preview), DL-146 (download button), DL-337, DL-049/DL-369 (OneDrive file ops)

## 1. Context & Problem

Clients (especially banks and government bodies) routinely send password-protected PDFs. The admin AI Review preview iframe loads a Microsoft Graph embed URL; MS Graph cannot render encrypted PDFs. Today Moshe must download, open in Acrobat with password, save-as to remove password, and re-upload manually.

## 2. User Requirements

1. Two separate design logs (not bundled).
2. Detect on preview load — when iframe fails, attempt PDF.js parse; on PasswordException show inline password input.
3. After unlock, replace original in OneDrive.
4. Backup encrypted original: move to `/ארכיון/encrypted-originals/` first.

## 3. Research

### Key Findings
- pdf-lib does NOT support encrypted PDF reading (`ignoreEncryption: true` only skips the check, doesn't decrypt).
- `@localonlytools/pdf-decrypt` — full AES-256/AES-128/RC4 PDF decryption, explicitly built for Cloudflare Workers (~30 KB).
- PDF.js (already loaded in codebase via CDN) can detect encrypted PDFs client-side via `PasswordException` — used for detection only.
- `qpdf-wasm` documented as fallback for AES-256 edge cases not covered by primary library.

### Patterns to Use
- **Lazy detection:** iframe `onerror` → PDF.js parse small range → PasswordException → show password panel.
- **Server-side decrypt:** `@localonlytools/pdf-decrypt` in Worker — clean output, no client trust assumption.
- **Archive-then-replace:** Move encrypted original to archive FIRST, only overwrite if archive succeeds.
- **Never persist the password** — strip from all log calls.

### Anti-Patterns to Avoid
- Storing password in Airtable
- Pre-flagging encrypted at inbound
- Client-side decrypt + upload

## 4. Codebase Analysis

- PDF.js loaded via CDN (`script.js:14373`)
- `getDocPreviewUrl` (`script.js:3663`) returns `{ previewUrl, downloadUrl }`
- Iframe error path at `script.js:3847–3866` — insertion point for encryption detection
- `moveFileToArchive` (`api/src/routes/classifications.ts:25`) — extended with optional subfolder
- `MSGraphClient.getBinary` + new `putBinaryReplace` (shared infra)

## 5. Technical Constraints & Risks

- **Security:** Password transits HTTPS once, never logged, never stored. Delete from body before any `logEvent()`.
- **Rate limit:** 5 unlock attempts per itemId per minute (Workers KV with TTL).
- **AES-256 not supported:** Worker returns 422 UNSUPPORTED_ENCRYPTION, UI shows fallback + download button.
- **Bundle size:** ~30 KB added — confirm with `wrangler deploy --dry-run`.

## 6. Proposed Solution

### Files Changed
| File | Action |
|------|--------|
| `api/package.json` | Added `@localonlytools/pdf-decrypt` |
| `api/src/lib/ms-graph.ts` | Added `putBinaryReplace` (shared with DL-372) |
| `api/src/lib/pdf-decrypt-helper.ts` | Created — wraps library with error taxonomy |
| `api/src/routes/unlock-pdf.ts` | Created — POST /webhook/unlock-pdf |
| `api/src/index.ts` | Registered new route |
| `api/src/routes/classifications.ts` | Extended `moveFileToArchive` with subfolder param |
| `frontend/admin/js/script.js` | Added `tryDetectEncryption()` + `showPasswordPanel()` |
| `frontend/admin/index.html` | Bumped cache version to 373 |

### Logic Flow
1. Iframe loads MS Graph preview URL.
2. Iframe `onerror` → `tryDetectEncryption(downloadUrl, recordId)`:
   - Fetch first 8 KB via downloadUrl
   - PDF.js parse with empty password → catch PasswordException → show password panel
3. User types password → clicks Unlock → POST `/webhook/unlock-pdf` with `{ itemId, recordId, password }`.
4. Worker: rate-limit → fetch bytes → decrypt → archive original → replace → logEvent (no password).
5. UI: success toast → reload preview.

## 7. Validation Plan
- [ ] RC4-128 encrypted PDF — flow works end-to-end
- [ ] AES-128 encrypted PDF — flow works
- [ ] AES-256 encrypted PDF — 422 UNSUPPORTED_ENCRYPTION, fallback message with download button
- [ ] Wrong password — 401, attempt counter visible, 5th wrong triggers cooldown
- [ ] Already-unlocked PDF — 409 ALREADY_UNLOCKED, iframe reloads cleanly
- [ ] Non-encrypted PDF — preview loads normally, no password panel (regression)
- [ ] Verify `password` field stripped from any `logEvent` body
- [ ] Verify original file at `/ארכיון/encrypted-originals/<filename>` after unlock
- [ ] Rate limit test — 6 rapid POSTs return 429 on the 6th
- [ ] `wrangler deploy --dry-run` bundle size delta < 50 KB

## 8. Implementation Notes
- Detection happens client-side via PDF.js using the already-loaded CDN build
- Password panel shown inline in the preview area (replaces the error div)
- `moveFileToArchive` signature: `moveFileToArchive(msGraph, itemId, opts?: { subfolder?: string })`
