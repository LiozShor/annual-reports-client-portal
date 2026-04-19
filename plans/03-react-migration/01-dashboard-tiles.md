# React Pilot — Dashboard Stats Tiles
**Status:** Not started | **Depends on:** 01-zod-contracts (`/dashboard` shape), 03-react-migration/00-overview (Vite scaffold)
**Estimated effort:** 3–5 days

## Goal
Replace the dashboard stat-tiles section of `frontend/admin/js/script.js` with a `<DashboardTiles />` React component mounted into the existing DOM container. "Done" = tiles rendered by React on staging match the legacy output pixel-for-pixel, and counts match Airtable rollups live.

## Preconditions
- `packages/shared` exports `DashboardResponseSchema` + `DashboardResponse` type (plan 01).
- `frontend/admin-react/` Vite scaffold exists (plan 03 overview).
- Feature flag `ADMIN_REACT_DASHBOARD_TILES` wired in `frontend/admin/index.html`, defaulting OFF.
- **Plan 00 inventories exist** and rows covering the dashboard stats-tiles section of script.js (roughly the `// ==================== DASHBOARD ====================` banner at line 704 onward, scoped to stats-tiles render path) have been identified. List those rows in this file before execution:
  - Functions: (to fill in from `docs/baseline/script-js-functions.md` — e.g. the renderer, the stats calculator, any helper that mutates `_paFilteredData` or equivalent tile state)
  - Interactions: (to fill in from `docs/baseline/script-js-interactions.md` — tile click handlers, stage-filter toggles)
  - Network: (to fill in from `docs/baseline/script-js-network.md` — the `fetch('/webhook/dashboard')` call and any refresh triggers)

## Steps
1. Grep `frontend/admin/js/script.js` for the stats-tiles section banner (likely `// ===== DASHBOARD STATS =====` or similar). Record line range.
2. Inventory: note the container element id, class names, and exact HTML structure the legacy code emits. Screenshot legacy output on staging for comparison.
3. Scaffold `frontend/admin-react/src/panels/DashboardTiles/`:
   - `DashboardTiles.tsx` — functional component consuming `fetch('/webhook/dashboard')` → `DashboardResponseSchema.parse(...)`.
   - `DashboardTiles.module.css` — port styles by reference to `frontend/admin/css/style.css`, do not duplicate tokens.
   - `mount.tsx` — `ReactDOM.createRoot(document.getElementById(...)).render(<DashboardTiles />)`.
4. Build script: Vite emits `frontend/admin-react/dist/dashboard-tiles.js` with hashed filename.
5. In `frontend/admin/index.html`, add script tag gated on `ADMIN_REACT_DASHBOARD_TILES`. When enabled, skip legacy rendering path in script.js and load the React bundle instead.
6. In `script.js`, wrap legacy stats-tiles render in `if (!window.FLAGS?.ADMIN_REACT_DASHBOARD_TILES) { /* legacy */ }`.
7. Deploy to staging. Flip flag ON. Visual diff against legacy.
8. Keep flag ON staging for 1 week; if no regressions, flip ON production.

## Risks
- **Flicker** — if legacy render runs before feature-flag check, React mount will paint over it. Mitigate: check flag before any DOM write in legacy path.
- **CSS grid locked** — stage pipeline grid is `repeat(9, 1fr)` per CLAUDE.md. If the stats tiles share this grid, preserve it exactly.
- **Count mismatch** — tiles consume Airtable rollups (`docs_total`, `docs_received_count` per CLAUDE.md memory). Verify React reads same fields from `/dashboard` response.
- **Hebrew RTL** — tile labels may be Hebrew; ensure `dir="auto"` or inherited direction.
- **Parallel admin panel code** — per CLAUDE.md, grep for duplicate rendering in client portal before declaring done (stats tiles likely admin-only, but verify).

## Rollback
- Flip `ADMIN_REACT_DASHBOARD_TILES` flag OFF. Legacy renderer resumes on next page load. No Airtable or server-side state affected.
- If React bundle breaks page load: remove script tag. Flag default is OFF, so the tag is the only failure surface.

## Acceptance criteria
- [ ] Staging: tiles render identically to legacy (screenshot diff, no visible delta).
- [ ] Staging: counts on each tile match Airtable rollups for 3 sample CPAs.
- [ ] Staging: no console errors in 10-minute interaction window.
- [ ] Live verification (per CLAUDE.md): exercise with a real record before marking `COMPLETED` — do not stop at `[IMPLEMENTED — NEED TESTING]` based on tests alone.
- [ ] Legacy code path preserved under flag for 1 week.
- [ ] **Behavior-baseline accounting:** every function, handler, and fetch claimed by this panel (per the rows listed in Preconditions) is accounted for with one of: `ported` (reimplemented in React), `deprecated` (explicitly dropped — document why), or `orphan` (grep-confirmed zero external callers; flagged in this plan). No row is silently dropped.
- [ ] Pre-removal audit from plan 03 overview step 8 executed and recorded before any legacy removal commit.

## Out of scope
- Other dashboard sections (client list, PA queue, search) — separate plan files.
- Changes to `/webhook/dashboard` response shape (plan 01 owns that).
- New design or UX changes — visual parity only.
