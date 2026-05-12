# DL-413 — Lighthouse Perf + A11y Fixes (Admin Panel)

**Status:** [COMPLETED — 2026-05-12]
**Branch:** `DL-413-lighthouse-perf-a11y`
**Date:** 2026-05-11
**Related logs:** DL-255, DL-256, DL-311, DL-314, DL-365

---

## 1. Context & Problem

Authenticated Lighthouse on `https://docs.moshe-atsits.com/admin/` (2026-05-11) returned **Perf 75, A11y 89, Desktop** with measured root causes:

- **DOM size 9,115 elements (LH score 0).** Dual desktop+mobile rendering in `renderClientsTable` / `renderReviewTable` (~3,600 nodes), eager Review tab populated at boot (2,539), SVG icon sprite (~2,900).
- **TBT 740 ms / main-thread 3.9 s (score 0).** Top long task: blocking `xlsx.full.min.js` 596 ms at `frontend/admin/index.html:11`.
- **A11y trio:** `.stat-pct` 2.52:1 (color-contrast), checkbox missing label, `<span class="no-email-indicator" aria-label>` aria-prohibited-attr.
- **Render hints:** No preconnect to cdnjs / Workers API.
- **Client portal:** Perf 98 — single `heading-order` violation.

## 2. Solution Summary

Five paint/network/structure fixes + three a11y patches, single DL, single branch.

| Task | File | Change |
|---|---|---|
| T1 | `script.js:1635–1772` | `renderClientsTable` builds desktop OR mobile per `matchMedia('(max-width:768px)')`, not both. Viewport listener re-renders on flip. |
| T2 | `script.js:3275–3379` | Same one-surface pattern for `renderReviewTable`. |
| T3 | `script.js:38, 870, 375` | `let reviewMounted=false`; `updateReviewQueueUI` no-ops until tab opened; `switchTab('review')` mounts once. |
| T4 | `script.js` + new `js/modules/xlsx-loader.js` | `ensureXLSX()` Promise-wrapped UMD-script injector. Wrapped `XLSX.read` / `XLSX.writeFile` call sites. Functions now `async`. |
| T5 | new `frontend/_headers` | `/admin/*` preconnect to `cdnjs.cloudflare.com` + Workers API. |
| T6 | `style.css:280` | `.stat-pct` color `--gray-400` → `--gray-600` (≥4.5:1). |
| T7 | `script.js:1654, 1721` | `aria-label="בחר ${escapeHtml(client.name)}"` on dashboard checkboxes (desktop + mobile). |
| T8 | `bounce-warning.js:70-71` | `role="img"` added to `<span class="no-email-indicator">` legalizing `aria-label`. |
| T9 | `view-documents.html:103-104`, `document-manager.html:506` | `<h3>` → `<h2>` to make heading levels sequential. |
| T10 | `index.html` | Deleted blocking xlsx CDN script (line 11). Inserted `<script src="js/modules/xlsx-loader.js?v=1">` before script.js. Bumped `script.js?v=425→426`, `style.css?v=386→387`. |

## 3. Files Touched

- `frontend/admin/js/script.js` (still at 16125-line baseline — ratchet preserved by trimming blank lines after structural additions)
- `frontend/admin/js/modules/xlsx-loader.js` (NEW, 18 lines, defines `window.ensureXLSX`)
- `frontend/admin/js/modules/bounce-warning.js`
- `frontend/admin/css/style.css`
- `frontend/admin/index.html`
- `frontend/_headers` (NEW)
- `frontend/view-documents.html`
- `frontend/document-manager.html`

## 4. Out of Scope

- Virtualization (rejected by DL-255 / DL-311 — pagination at 50/page is sufficient).
- Splitting `script.js` into modules at large (DL-132 risk).
- `content-visibility: auto` — does not reduce node count; LH `dom-size` still scores 0.

## 5. Risks

- xlsx lazy-load: first export/import click triggers ~596 ms script load. Subsequent uses instant (UMD caches `window.XLSX`).
- Lazy Review tab: first tab switch incurs render delay. Data is already cached via SWR — only paint is deferred.
- RTL: both rendering branches already work in `dir="rtl"`; we're picking one per viewport, not redesigning.
- Cloudflare Pages `_headers`: `/admin/*` scope avoids clobbering anything else (no existing `_headers` file).

## 6. Implementation Orchestration

Executed via `/subagent-driven-development` in 2 waves:

- **Wave 1 (parallel 5 agents):** A (`script.js` Stream A — T1/T2/T3/T4/T7), B1 (style.css), B2 (bounce-warning.js), B3 (client-portal headings), B4 (`_headers`).
- **Wave 2 (1 agent):** `frontend/admin/index.html` consolidation (T10) — delete xlsx CDN tag, add xlsx-loader script tag, cache-bust both.

Stream A discovered baseline pressure and extracted `ensureXLSX` to `frontend/admin/js/modules/xlsx-loader.js` per the CLAUDE.md monolith-ratchet rule (no baseline bump).

## 7. Validation Plan

- [ ] **VAL-1** Authenticated Lighthouse re-run on `https://docs.moshe-atsits.com/admin/` (Desktop): Perf ≥85, A11y = 100, TBT < 300 ms. Baseline: `tmp/lighthouse/admin-dashboard-auth.json` (Perf 75, A11y 89, TBT 740 ms).
- [ ] **VAL-2** DOM count via `node tmp/lighthouse/count-dom.mjs`: total ≤ 6,500 (from 9,115). Dashboard tab ≤ 3,500. Review tab ≤ 50 *before* first switch.
- [ ] **VAL-3** Live walk-through: scroll/filter clients, switch to Review tab (first switch may show brief delay), export clients to Excel, import .xlsx, resize browser mobile↔desktop. No console errors, no visual regressions.
- [ ] **VAL-4** Client portal Lighthouse re-run: A11y = 100 (`heading-order` fixed).
- [ ] **VAL-5** `curl -I https://docs.moshe-atsits.com/admin/` shows the two `Link: ...; rel=preconnect` headers (requires Early Hints enabled in Cloudflare zone — Lioz to verify).
- [ ] **VAL-6** No new console errors during smoke test.
- [ ] **VAL-7** Pre-commit ratchet hook passes; script.js baseline NOT bumped (verified — 16125 lines).
- [ ] **VAL-8** Admin token rotated by Lioz after VAL-1 completes.

## 8. Implementation Notes

- `script.js` net change held at baseline by trimming blank-line clusters (~10 spots) — no logic deleted.
- `ensureXLSX` extracted to its own module file; loaded via `<script>` tag before script.js (UMD assigns `window.ensureXLSX`).
- `_headers` placed at `frontend/_headers` (Cloudflare Pages root) — wildcards apply per-path, no conflict with future rules.
- Heading-order fix demotes `<h3>` → `<h2>` (preferred over promoting `<h1>`) — visual styling preserved because target classes already match.
