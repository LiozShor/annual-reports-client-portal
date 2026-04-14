# DL-146: Download Button in AI Review Preview Panel

**Status:** ✅ Completed
**Date:** 2026-03-11

## Problem
AI Review preview panel only had "Open in tab" button. User wanted a download button for direct file download.

## Solution

### n8n: `[API] Get Preview URL` (`aQcFuRJv8ZJFRONt`)
- Added **Get Download URL** node (`http-get-download-url`): `GET /me/drive/items/{itemId}?$select=@microsoft.graph.downloadUrl`
- Uses same `MS_Graph_CPA_Automation` credential, `onError: continueRegularOutput` (non-blocking)
- Rewired: Get Preview URL → Get Download URL → Build Response
- Build Response now merges both: `{ ok, previewUrl, downloadUrl }`
- References `$('Get Preview URL')` for preview data, `$input` for download data

### Frontend: `admin/index.html` + `admin/js/script.js`
- Added `<a id="previewDownload" download>` button with download icon next to "פתח בלשונית"
- `getDocPreviewUrl()` returns `{ previewUrl, downloadUrl }` (was just `previewUrl` string)
- `loadDocPreview()` shows download button when `downloadUrl` is available
- `resetPreviewPanel()` hides and resets download button

## Files Changed
- n8n workflow `aQcFuRJv8ZJFRONt` — added node + rewired + updated code
- `admin/index.html` — download button HTML
- `admin/js/script.js` — getDocPreviewUrl, loadDocPreview, resetPreviewPanel
