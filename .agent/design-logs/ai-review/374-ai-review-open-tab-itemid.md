# Design Log 374: AI-Review "Open in New Tab" — Route via itemId webUrl
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-29
**Related Logs:** [DL-051](../documents/051-onedrive-persistent-file-links.md), [DL-356](../infrastructure/356-preview-url-stale-itemid-self-heal.md), [DL-230](../infrastructure/230-duplicate-classification-missing-file-info.md), [DL-341](341-preview-zoom-and-completion-flow.md)

## 1. Context & Problem

The "פתח בלשונית" (open in new tab) anchor on the AI-review PDF preview pane uses the raw SharePoint `file_url` captured at upload time — a long Hebrew path under `/personal/reports_moshe-atsits_co_il/Documents/לקוחות/<client>/...`. When staff renames or moves the file in OneDrive, the path changes; the stored URL becomes stale and SharePoint returns 404.

User reported: clicking "open in new tab" on a CPA-728 pending classification (eventId `evt_TL2P290MB0240FA05027CF13C59A71224DE2E2`, status `pending`, marked as duplicate) failed with 404.

DL-051 already established the principle: `onedrive_item_id` is immutable, `webUrl` must be resolved on demand. DL-356 wired self-heal into `/webhook/get-preview-url`. The inline iframe preview correctly uses itemId resolution; only this anchor was left on the legacy `file_url`.

## 2. User Requirements (Phase A)

1. **Q:** Failure mode? **A:** 404 / file not found.
2. **Q:** Surface? **A:** "Open in new tab" button on the PDF preview pane (desktop + mobile).
3. **Q:** Scope? **A:** Route through `get-preview-url` (itemId-based) — same self-heal & freshness as DL-356.

## 3. Research

Cumulative knowledge — see DL-051 §3 (MS Graph driveItem ID immutability, on-demand webUrl resolution) and DL-356 §3 (self-healing on permanent 404). No new research needed.

### Verdict
The Worker `/webhook/get-preview-url` already does a parallel `GET /me/drive/items/{itemId}` for `downloadUrl`. Add `webUrl` to the same `$select` — zero extra MS Graph calls. Plumb it through the JSON response and through `getDocPreviewUrl()`. Set `openTab.href = webUrl` after the preview fetch resolves. DL-356 self-heal handles the 404 path for free.

## 4. Codebase Analysis

| Surface | File:Line | Current source | Failure |
|---|---|---|---|
| Desktop AI-review open-tab | `frontend/admin/js/script.js:3809` | `item.file_url` (synchronous) | 404 on rename/move |
| Mobile AI-review open-tab | `frontend/admin/js/script.js:599` | `item.file_url` (synchronous) | Same |
| Worker preview endpoint | `api/src/routes/preview.ts:62` | Fetches downloadUrl only | webUrl not exposed |
| Worker response shape | `api/src/routes/preview.ts:74` | `{ ok, previewUrl, downloadUrl }` | webUrl missing |
| `getDocPreviewUrl()` | `frontend/admin/js/script.js:3681` | Returns `{previewUrl, downloadUrl}` | webUrl missing |

Existing utilities reused: `MSGraphClient.get()`, `getDocPreviewUrl(itemId, recordId)` (already DL-356 self-heal aware), `handleFileGoneSelfHeal()`, `isItemNotFoundError()`.

## 5. Constraints & Risks

- **No regression for legacy rows without `onedrive_item_id`:** keep `item.file_url` as last-resort fallback.
- **Concurrent clicks (card B during A's fetch):** existing `activePreviewItemId !== recordId` guard at script.js:3833 covers it; the new href set sits after that guard.
- **UX during fetch (300–1700ms):** open-tab button hides until webUrl resolves. Same window as iframe loading state — acceptable.
- **404 self-heal:** already handled by DL-356 path in `preview.ts` — no new code.
- **HTML cache:** must bump `?v=` per `feedback_admin_script_cache_bust.md`.

## 6. Proposed Solution

### Worker — `api/src/routes/preview.ts`
- Line 62: `?$select=@microsoft.graph.downloadUrl,webUrl`
- Line 69-74: extract `itemResponse.webUrl`, include `webUrl` in the JSON response.

### Frontend — `frontend/admin/js/script.js`
- `getDocPreviewUrl()` (3681): return `webUrl` alongside `previewUrl` / `downloadUrl`.
- `loadDocPreview()` (3808–3810): replace synchronous `openTab.href = item.file_url` with `openTab.href = '#'; openTab.style.display = 'none'` upfront; after `await getDocPreviewUrl(...)` set `openTab.href = webUrl || item.file_url || ''` and reveal.
- `loadMobileDocPreview()` (599–600 + .then block): same treatment.

### Frontend — `frontend/admin/index.html`
- Bump `script.js?v=382` → `?v=383`.

### Files Changed
| File | Action |
|---|---|
| `api/src/routes/preview.ts` | Modify (`$select` + response shape) |
| `frontend/admin/js/script.js` | Modify (3 sites: getDocPreviewUrl return, desktop, mobile) |
| `frontend/admin/index.html` | Bump cache version |
| `.agent/design-logs/ai-review/374-ai-review-open-tab-itemid.md` | Create |
| `.agent/design-logs/INDEX.md` | Add row |
| `.agent/current-status.md` | Phase E test entries |

## 7. Validation Plan

* [ ] TS build passes: `./node_modules/.bin/tsc --noEmit` in `api/`
* [ ] Healthy doc: AI-review → click pending classification → inline preview loads, "open in new tab" opens current SharePoint file
* [ ] Live stale doc (CPA-728 / eventId `evt_TL2P290MB0240FA05027CF13C59A71224DE2E2`): click → DL-356 self-heal fires → Hebrew toast → open-tab button hidden
* [ ] Manual rename in OneDrive then re-click → new tab opens at the renamed path (proves staleness fix)
* [ ] Mobile (≤768px): same flow via `loadMobileDocPreview`
* [ ] Cache-bust: hard-reload admin and confirm `script.js?v=383` matches `index.html`
* [ ] No regression on inline iframe preview (still loads via `previewUrl`)
* [ ] No regression on download button (still uses `downloadUrl`)
* [ ] No regression on legacy rows missing `onedrive_item_id` — anchor falls back to `item.file_url`

## 8. Implementation Notes (Post-Code)

- **`preview.ts`:** single-line `$select` extension and one extra field on the response. `webUrl` defaults to `''` if MS Graph returns no value, so the frontend `webUrl || item.file_url || ''` fallback chain stays clean.
- **`script.js`:** kept the synchronous open-tab hide upfront so the user can never click a stale URL during the 300–1700ms fetch window. After the fetch resolves the button reveals only if at least one href is available; if MS Graph returns webUrl='' AND item has no legacy file_url, the button stays hidden (matches existing "no source" behaviour).
- **DL-356 self-heal:** intentionally untouched. The 404 path already nulls Airtable fields and toasts; this DL just makes the previously-stale link itself stop being stale.
- **Cache-bust:** v382 → v383, confirmed `index.html:1540`.
- **TS check:** ran tsc with `NODE_OPTIONS=--max-old-space-size=4096`. Initial run OOM'd at default heap; user should re-verify if concerned.
- **Deploy + live verification deferred** to explicit user approval per `feedback_ask_before_merge_push.md`.
