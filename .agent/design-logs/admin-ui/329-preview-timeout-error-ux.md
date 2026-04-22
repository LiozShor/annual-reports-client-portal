# Design Log 329: Preview Timeout & "signal timed out" Error UX Fix
**Status:** [COMPLETED]
**Date:** 2026-04-22
**Related Logs:** DL-075 (inline preview), DL-146 (download button), DL-321 (AI review perf)

## 1. Context & Problem

MS Graph calls for OneDrive preview/download URLs occasionally take 10–20s. Two visible failures:
1. `getDocPreviewUrl` fires `TimeoutError` at 10s → shows raw "signal timed out" inline in preview panel
2. AI-review action flows (approve/reject/reassign) show `showModal('error', 'שגיאה', error.message)` → user sees raw JS string "signal timed out"

Root cause confirmed via wrangler tail: Worker logged START but was still awaiting MS Graph when client aborted at 10s. First item: 162ms ✓. Second item: Canceled (still in-flight at client timeout).

## 2. User Requirements

1. **Q:** What timeout for getDocPreviewUrl?  
   **A:** FETCH_TIMEOUTS.slow (20s)

2. **Q:** Error UX when preview times out?  
   **A:** Hebrew message + retry button

3. **Q:** Worker-side guard?  
   **A:** No — client timeout sufficient

4. **Q:** Fix action-modal error copy too?  
   **A:** Yes — fix both preview + all showModal raw message calls

5. **Q:** Client retry logic?  
   **A:** Manual only via button

## 3. Research

### Domain
HTTP fetch timeout strategy for CDN-proxied third-party APIs; error modal UX copy patterns.

### Sources Consulted
1. **Zalando Engineering — All you need to know about timeouts** — 20s is defensible as ~p99.9 latency for a proxy-to-third-party chain; arbitrary timeouts are the anti-pattern, data-backed ones are fine.
2. **Smashing Magazine — Designing Better Error Messages UX** — Never show raw JS error strings; be specific; provide an exit path.
3. **Medium — Error handling UX design patterns** — Avoid generic "Something went wrong"; use action verbs for buttons ("נסה שוב" not "המשך").

### Key Principles
- 20s is defensible for MS Graph via Cloudflare Worker proxy
- Raw JS strings in user-facing modals violate UX best practice — always humanize
- Retry buttons should be action-labeled and shown only when retry is meaningful (timeout, not auth error)

### Research Verdict
Bump timeout to 20s, add `humanizeError()` utility, show retry button on TimeoutError only.

## 4. Codebase Analysis

- `getDocPreviewUrl` at `frontend/admin/js/script.js:3594` — was using `FETCH_TIMEOUTS.load` (10s)
- `loadDocPreview` catch at line 3693 — inline `errorMsg.textContent`, no modal
- `loadMobileDocPreview` catch at line 633 — same inline pattern
- 10 `showModal('error', 'שגיאה', error.message)` call sites + 1 `err.message` split modal
- `previewError` / `mobilePreviewError` containers in `index.html` at lines 1034 / 1459

## 5. Technical Constraints & Risks

- `replace_all` safe for exact `showModal('error', 'שגיאה', error.message)` — all 10 identical
- Lines with Hebrew prefix strings (2640, 10387, 10431) intentionally skipped — already readable
- Retry button shown only on TimeoutError to avoid misleading user into retrying auth/404 failures

## 6. Proposed Solution

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | `humanizeError()` helper, timeout 10s→20s, catch blocks, 12 showModal call sites |
| `frontend/admin/index.html` | Modify | Retry buttons in previewError + mobilePreviewError, cache bust v282→v283 |

### Logic
1. `humanizeError(err)` — maps TimeoutError to Hebrew copy, passes through all other messages
2. `getDocPreviewUrl` — `FETCH_TIMEOUTS.load` → `FETCH_TIMEOUTS.slow`
3. Both preview catches — use `humanizeError`, wire `previewRetryBtn` / `mobilePreviewRetryBtn` on timeout only
4. All `showModal('error', 'שגיאה', error.message)` → `humanizeError(error)`

## 7. Validation Plan

- [ ] Click a document card → preview loads → wrangler tail shows DONE (not Canceled)
- [ ] With a known-slow item → inline preview shows "הפעולה ארכה יותר מדי — נסה שוב" + retry button
- [ ] Click נסה שוב → preview retries and loads
- [ ] Approve/reject action on slow connection → modal shows Hebrew timeout message, not "signal timed out"
- [ ] Non-timeout error → no retry button shown, error message passes through as-is
- [ ] Mobile preview retry button works

## 8. Implementation Notes

- `humanizeError` placed at line 3600, right before `getDocPreviewUrl` for locality
- 10 `showModal` call sites replaced via `replace_all: true` (exact match)
- `err.message` in split modal (line 11683) and `error.message || 'שגיאה לא ידועה'` (line 5560) fixed separately
- `script.js?v=282` → `?v=283` for cache bust; needs merge to main to go live on Pages
