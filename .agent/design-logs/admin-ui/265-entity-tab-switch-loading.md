# DL-265: Entity Tab Switch Loading Indicator

**Status:** IMPLEMENTED — NEED TESTING
**Created:** 2026-04-14
**Category:** Admin UI — Performance & UX

## Problem

Switching between AR (Annual Reports) and CS (Capital Statements) entity tabs feels slow because:
1. Cache invalidation forces full API re-fetch (4 caches cleared)
2. Dashboard/review tab didn't use the opacity fade pattern (just called `loadDashboard()` bare)
3. No visual loading indicator — user sees stale content with no feedback

## Changes

### CSS (`admin/css/style.css`)
- Enhanced `.tab-refreshing` with `pointer-events: none` (prevent interaction during load)
- Added `::after` pseudo-element spinner (24px, brand-colored, positioned at top of content)
- Mobile responsive: smaller spinner (20px) positioned higher (48px from top)

### JS (`admin/js/script.js`)
- Fixed dashboard/review entity switch path to use `addRefresh`/`removeRefresh` pattern
- Previously line 1446 called `loadDashboard()` bare — now wraps with opacity fade + spinner like other tabs

## What Was NOT Changed

- **Tab-to-tab switching** (`switchTab`): Uses SWR with `silent=true`, serves cached data instantly — no spinner needed
- **API performance**: The API call itself is the bottleneck (20s timeout for 579+ clients). This is a perceived-performance fix, not a network optimization.
- **DOM query count**: 6x `querySelectorAll` is negligible vs network latency — not worth caching element refs for this

## Test Plan

1. Open admin panel on dashboard tab
2. Switch from AR to CS — should see opacity fade + small spinner at top
3. Switch back — same behavior
4. Try on Send, Questionnaires, Reminders tabs — all should show spinner
5. Test on mobile (768px breakpoint) — smaller spinner, correct positioning
6. Verify spinner disappears after data loads
7. Verify no interaction possible during refresh (pointer-events: none)
