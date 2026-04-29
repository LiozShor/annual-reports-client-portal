# Design Log 373: Password-Protected PDF Unlock from AI Review Preview

**Status:** [COMPLETED]
**Date:** 2026-04-28 (initial) · 2026-04-29 (post-deploy fixes)
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
- [x] Encrypted PDF (RC4/AES-128) — end-to-end on a real client T106 PDF (2026-04-29): detect → panel → POST → 200 → decrypted file at original location, encrypted copy in archive
- [ ] AES-256 encrypted PDF — not yet exercised; expect 422 UNSUPPORTED_ENCRYPTION
- [ ] Wrong password — not yet exercised; expect 401 + attempt counter
- [ ] Already-unlocked PDF — not yet exercised; expect 409 ALREADY_UNLOCKED
- [x] Non-encrypted PDF — confirmed: detection logs `pdf opened ok — not encrypted`, no panel
- [x] `password` field stripped from `logEvent` — verified `pdf_unlocked` archive entry contains only `{recordId, success}`
- [x] Encrypted original archived at `/ארכיון/encrypted-originals/<filename>` (post-fix)
- [ ] Rate limit test — not yet exercised
- [x] Bundle size delta — Worker built clean at 2212.99 KiB / gzip 618.91 KiB

## 8. Implementation Notes
- Detection happens client-side via PDF.js using the already-loaded CDN build
- Password panel shown inline in the preview area (replaces the error div)
- Archive uses an inline folder-resolution helper inside `unlock-pdf.ts` (no longer reuses `moveFileToArchive` — see post-deploy fixes)

## 9. Post-Deploy Fixes (2026-04-29)

Three issues surfaced during live testing and were fixed in the same session:

### 9.1 Detection never ran — `pdfjsLib not loaded`
PDF.js is lazy-loaded via `ensurePdfJs()`, only triggered by the Split modal. `tryDetectEncryption` assumed the global was already set and bailed early. **Fix:** await `ensurePdfJs()` before parsing. Also expanded the head-slice fetch (8 KB) to a full-file fetch — the `/Encrypt` reference lives in the trailer at EOF, so an 8 KB slice throws `InvalidPDFException` instead of `PasswordException` and the password panel never appears. (commit `55198c3`)

### 9.2 MS Graph's password page was masking ours
For encrypted PDFs the iframe `onload` fires successfully (MS Graph returns 200 with a "file requires password" UI), so `onerror` never triggered detection. **Fix:** also call `tryDetectEncryption` from `iframe.onload`. Without this, the user only ever saw MS Graph's prompt — typing the password there only unlocked the *preview session* and never reached our worker. (initial DL-373 implementation; verified working post-fix `a618ed1e`)

### 9.3 (CRITICAL) Move-then-replace left the original location empty
Original code:
```ts
await moveFileToArchive(msGraph, itemId, { subfolder: 'encrypted-originals' });
await msGraph.putBinaryReplace(itemId, decryptedBytes);
```
OneDrive item IDs are stable across moves. `moveFileToArchive` PATCHed `parentReference` (item.id preserved), then `putBinaryReplace(itemId, ...)` wrote decrypted bytes to that same itemId — **which now lived inside the archive folder**. Net effect: original year-folder location was empty, archive folder held the decrypted version (the opposite of what we want).

**Fix (`6b451b7a`, deployed worker `43b5f07f`):** swapped the strategy. Now the route:
1. Reads the file's `name` + folder lineage,
2. Ensures `/ארכיון/encrypted-originals/` exists,
3. Uploads the **encrypted bytes** as a **new file** at `/ארכיון/encrypted-originals/<filename>` (separate itemId),
4. `putBinaryReplace(itemId, decryptedBytes)` replaces the original in-place — itemId, parent, Airtable references all unchanged.

`moveFileToArchive` is no longer used by this route; the inline helper resolves folders the same way but does NOT move the source file.

### 9.4 Recovery for files already unlocked under the buggy version
Single occurrence (one client T106 PDF). The file's *content* was correctly decrypted; only its *location* was wrong. Recovered manually by dragging the file from `/ארכיון/encrypted-originals/` back into the year-folder `דוח שנתי` subfolder in OneDrive — itemId stays the same, Airtable stays in sync.
