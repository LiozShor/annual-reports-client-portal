# Design Log 375: Restore download button on AI-review preview pane
**Status:** [COMPLETED]
**Date:** 2026-04-29
**Related Logs:** [DL-374](374-ai-review-open-tab-itemid.md), [DL-373](373-password-protected-pdf-unlock.md)

## 1. Context & Problem

The ""Download" (Hebrew)" (download) button in the AI-review preview header (`#previewDownload`, `frontend/admin/index.html:1029`) disappeared for **all files** — not just the password-protected one originally reported.

Live diagnosis via Playwright on prod admin (2026-04-29):
```json
{ "ok": true, "previewUrl": "https://…", "downloadUrl": "", "webUrl": "https://…" }
```
`downloadUrl` is an empty string. Frontend reveal at `script.js:3873` (`if (downloadUrl) { … display = '' }`) never fires → button stays `display:none`.

## 2. User Requirements (Phase A)

1. **Q:** Scope? **A:** All files — regression, not password-specific.
2. **Q:** Behavior on password-protected files? **A:** Show "Download" (Hebrew) in header (download as-is).
3. **Q:** Placement? **A:** Same as before (header next to "Open in new tab" (Hebrew)).
4. **Q:** URL source? **A:** Fresh MS Graph downloadUrl only (current behavior).

## 3. Research

Cumulative knowledge — see DL-374 §3. New finding via MS Graph behavior:
`@microsoft.graph.downloadUrl` is an **instance annotation**, not a property. Under `$select=…` it is omitted unless explicitly requested, and even then has inconsistent support across endpoints. The pre-DL-374 query (no `$select`) emitted it by default.

### Verdict
Drop `$select` entirely. Cost: ~1–2 KB extra payload. Benefit: both `webUrl` and `downloadUrl` always present.

## 4. Codebase Analysis

| Surface | Location | Issue |
|---|---|---|
| Worker preview endpoint | `api/src/routes/preview.ts:62` | `$select=@microsoft.graph.downloadUrl,webUrl` dropped the annotation |
| Frontend reveal (desktop) | `frontend/admin/js/script.js:3873-3876` | Correct, gated on truthy `downloadUrl` |
| Frontend reveal (mobile) | `frontend/admin/js/script.js:633-635` | Same gate, same fix-by-cascade |

Reused existing reveal logic — no frontend change needed.

## 5. Constraints & Risks

- ~1-2 KB extra payload per `/webhook/get-preview-url` call. Negligible.
- DL-374 `webUrl` path unaffected (still returned in default DriveItem).
- DL-356 self-heal path unaffected.

## 6. Solution

**`api/src/routes/preview.ts:62`** — replace
```ts
msGraph.get(`/me/drive/items/${itemId}?$select=@microsoft.graph.downloadUrl,webUrl`)
```
with
```ts
msGraph.get(`/me/drive/items/${itemId}`)
```
plus comment explaining the annotation gotcha.

### Files Changed
| File | Action |
|---|---|
| `api/src/routes/preview.ts` | Modify |
| `.agent/design-logs/ai-review/375-restore-download-button.md` | Create |
| `.agent/design-logs/INDEX.md` | Add row |
| `.agent/current-status.md` | Phase E test entries |

## 7. Validation Plan

* [ ] TS build (preview.ts) — clean (rest of api has pre-existing unrelated errors)
* [ ] `wrangler deploy` succeeds
* [ ] Live curl: `downloadUrl` non-empty for any healthy item
* [ ] Browser: AI-review → click any file → ""Download" (Hebrew)" appears in header next to "Open in new tab" (Hebrew)
* [ ] Click ""Download" (Hebrew)" → file downloads
* [ ] Password-protected file (T106.pdf_*** from screenshot) → header shows both buttons
* [ ] Mobile (≤768px) → `#mobilePreviewDownload` reveals
* [ ] DL-374 regression: "open in new tab" still uses fresh `webUrl`

## 8. Implementation Notes (Post-Code)

- Single-line Worker change. No frontend edits — existing reveal at `script.js:3873-3876` self-heals once `downloadUrl` returns non-empty.
- Root cause was a silent regression introduced by DL-374 (`a507221`): adding `webUrl` to `$select` accidentally dropped `@microsoft.graph.downloadUrl` because instance annotations behave differently from properties under `$select`.
- Frontend has no error path for missing `downloadUrl` (just hides the button) — considered adding a `console.warn` but kept change minimal. Future enhancement: telemetry when downloadUrl is unexpectedly empty.
