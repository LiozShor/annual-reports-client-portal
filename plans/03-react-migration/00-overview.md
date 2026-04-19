# React + Vite + TS Migration — Overview
**Status:** Not started | **Depends on:** 01 (at least `/dashboard` shape exported from `packages/shared`)
**Estimated effort:** 6–10 weeks across all panels; pilot 3–5 days

## Goal
Extract `frontend/admin/js/script.js` (11,269 lines, monolithic) into a React + Vite + TypeScript codebase under `frontend/admin-react/`, panel by panel, using a strangler-fig pattern. "Done for the overall migration" = script.js reduced to a thin bootstrap (<500 lines) and all panels render through React. This overview plan only scaffolds the infrastructure; each panel has its own plan file.

## Preconditions
- Plan 01 has ported at least `/webhook/dashboard` to Zod (pilot consumes typed response).
- GitHub Pages continues to deploy from `frontend/**` (per CLAUDE.md — do not relocate).
- Custom modal system from script.js catalogued (`showConfirmDialog`, `showModal`, `showAIToast`) — React code must not call `confirm()`/`alert()`.

## Steps
1. Scaffold `frontend/admin-react/` with Vite + React + TS. Output dir: `frontend/admin-react/dist/` (static assets served by GH Pages).
2. Port design-system tokens from `frontend/admin/css/style.css` into `frontend/admin-react/src/styles/tokens.css`. Preserve exact values.
3. Configure Vite to produce ES module + CSS bundles with hashed filenames.
4. Add a feature-flag switch in `frontend/admin/index.html` that mounts React islands into existing DOM containers when enabled. Default OFF.
5. Import `@moshe/shared` types directly (workspaces already set up from plan 01).
6. Build the Panel Inventory:
   | Order | Panel | Est. lines in script.js | Pilot? |
   |-------|-------|-------------------------|--------|
   | 1 | Dashboard stats tiles | ~300 | ✅ pilot (plan 01) |
   | 2 | Feedback / survey view | ~500 | — |
   | 3 | Settings / admin controls | ~800 | — |
   | 4 | Stage management modal | ~1,500 | — |
   | 5 | Client detail modal | ~2,000 | — |
   | 6 | PA queue | ~3,000 | — |
   | 7 | Dashboard client list | ~2,500 | — |
   (Exact counts measured during pilot via grep on section banners.)
7. After pilot, write one plan file per panel before execution.

## Hosting mode
**Islands (default).** Each React component mounts into an existing `<div id="...">` in `frontend/admin/index.html` when its feature flag is on. This avoids breaking the deployed URL and lets migration proceed panel-by-panel without a big-bang cutover.

## Decision needed
None — islands mode decided. If later we want to cut over to SPA, new plan required.

## Risks
- **Bundle bloat** — Vite + React adds ~150KB gzip; admin panel is internal-only, acceptable.
- **Double rendering** — during rollout both legacy DOM code and React may briefly paint the same container; legacy must be gated by feature flag before React mount.
- **CSS leakage** — design-system tokens shared between legacy + React; avoid CSS Modules for tokens, use plain CSS variables.
- **Shared utilities** (`frontend/shared/`, `frontend/assets/js/`) — React side should re-import, not re-implement, to avoid drift.
- **Locked CSS** — stage grid `repeat(9, 1fr)` (per CLAUDE.md) must not change.

## Rollback
- Feature flag off → legacy script.js renders, React code is loaded but dormant.
- If Vite build breaks deployment: remove `frontend/admin-react/dist/` reference from `frontend/admin/index.html`. GitHub Pages serves unchanged legacy.

## Acceptance criteria
- [ ] `frontend/admin-react/` builds via `npm run build` into `dist/` without errors.
- [ ] Legacy admin panel renders identically with feature flags OFF.
- [ ] `packages/shared` types import cleanly in React code.
- [ ] Panel inventory committed with measured line counts from script.js.

## Out of scope
- Migrating `frontend/assets/js/document-manager.js` (3,925 lines, client portal) — separate future track.
- Replacing the custom modal system (keep using it from React via the existing global functions).
- Server-side rendering / meta tags.
