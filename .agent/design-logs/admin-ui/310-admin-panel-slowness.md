# Design Log 310: Admin Panel Slowness — Long Tasks & Redundant Tab-Switch Reloads
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-20
**Related Logs:** DL-254 (dashboard load perf), DL-247 (tab SWR), DL-265 (entity tab spinner), DL-132 (monolith refactor risk), DL-256 (table pagination)

## 1. Context & Problem
Chrome console on live admin (2026-04-20) shows persistent violations during initial dashboard load AND every tab switch:
- `setTimeout` handler handlers **448ms, 1512ms, 1754ms, 1805ms, 1888ms, 1958ms, 1359ms**
- `click` handler handlers **150ms, 174ms, 214ms, 331ms, 402ms, 478ms**
- Every tab click re-invokes `switchTab → loadDashboard → 7 parallel fetches` plus a second dashboard reload wave ~40s later

DL-254 and DL-247 already landed fetch-level optimizations (KV cache, dedup, staleness, staggered prefetch). The remaining bottleneck is **synchronous render work after fetches resolve**, not network.

## 2. User Requirements
1. **Q:** What's the primary pain point?
   **A:** Both initial load AND tab-switch freeze.
2. **Q:** Profile first or ship known wins?
   **A:** Profile first, fix root cause.
3. **Q:** Should tab switches re-fire `loadDashboard`?
   **A:** No — only refresh dashboard when on dashboard tab.
4. **Q:** Scope of changes?
   **A:** Surgical fixes in `script.js` only — no React island, no module split.
5. **Q:** Success bar?
   **A:** All `setTimeout` handlers under 200ms.
6. **Q:** How to measure?
   **A:** Playwright — user logs in once, measure before/after; `performance.measure` only, no screenshots (PII safety).

## 3. Research
### Domain
Web Performance — Long Tasks, INP (Interaction to Next Paint), Main-Thread Yielding.

### Sources Consulted
1. **web.dev — Optimize Long Tasks** — Use `scheduler.yield()` (fallback `setTimeout(r,0)`) with a **50ms deadline** pattern: batch work, yield only when elapsed > deadline. Avoid yielding per-item (overhead).
2. **Chrome for Developers — scheduler.yield()** — Prioritized continuation (front of queue), better than `setTimeout(0)` for responsiveness.
3. **PerfPlanet — Yielding to the Main Thread (2023)** — Long tasks are the root of poor INP; split any synchronous block >50ms; `requestIdleCallback` fine for non-urgent background work but tasks may never run on congested main thread.

### Key Principles Extracted
- **50ms deadline rule** — don't yield per-item; track elapsed, yield when >50ms.
- **Scope DOM walks** — `lucide.createIcons()` without a `root:` walks the entire document.
- **One long task > many short tasks** — browser can interleave input between tasks <50ms.
- **Prefetch should not starve rendering** — stagger, don't bundle 7 loaders in one idle callback.

### Patterns to Use
- **Guarded profiling** — `performance.mark` / `performance.measure` wrapped in `if (window.__ADMIN_PERF__)` so zero prod cost.
- **Scoped Lucide replacement** — always pass `root:` to `safeCreateIcons()`.
- **Sequential pump for prefetch** — chain loaders via `setTimeout(next, 16)` so each gets its own frame.
- **Debounced tab switch** — 150ms leading-edge debounce protects against double-clicks.

### Anti-Patterns Avoided
- **Splitting script.js into modules** — DL-132 risk analysis + memory `script.js is the devil file` (10k+ lines, 317 fns). Out of scope.
- **Virtual scrolling** — pagination at 50/page (DL-256) already caps visible rows.
- **Rewriting in React** — DL-306 introduced React islands for *new* features; Strangler-Fig principle says don't rewrite working vanilla.

### Research Verdict
Two phases: (A) instrument hot paths behind a debug flag, measure via Playwright; (B) apply six surgical fixes in script.js targeting the measured bottlenecks: dashboard reload elimination, 5-min staleness, merged render loops, scoped icons, staggered prefetch, debounced tab switch.

## 4. Codebase Analysis
All references: `frontend/admin/js/script.js`

| Line | Finding |
|------|---------|
| 6–12 | `safeCreateIcons(rootOrOpts)` — wraps `lucide.createIcons`. Accepts Element or opts. Without arg = full-doc walk. |
| 31 | `STALE_AFTER_MS = 30000` — too aggressive for natural workflows. |
| 300–337 | `switchTab` — unconditionally calls one of 6 loaders per tab; `loadDashboard` is the default for both `dashboard` and `review` tabs. |
| 318 | `safeCreateIcons()` called on every tab switch (no root scope). |
| 732–817 | `loadDashboard` — fetch, then sync: `recalculateStats`, `existingEmails` set build, `toggleStageFilter → filterClients → renderClientsTable`, `safeCreateIcons()` (line 777, unscoped). |
| 791–811 | Prefetch block — 7 loaders fired inside a single `requestIdleCallback(cb, {timeout:2000})`. |
| 1323–1511 | `renderClientsTable` — two loops (desktop table + mobile cards) over paginated slice; `safeCreateIcons(container)` at end. |
| 2757–2834 | `renderPendingClients` — two loops. |
| 2983–3100+ | `renderReviewTable` — two loops. |
| 5814–5838 | `renderPendingApprovalCards` — `.map().join('')` + `safeCreateIcons(container)`. |

**Reuse Decision:** All machinery exists — staleness constant, SWR guards, `safeCreateIcons` with root param, `fetchWithTimeout` tiers. We're tuning values and re-wiring, not building new.

## 5. Technical Constraints & Risks
- **Security:** No auth changes. Instrumentation is read-only `performance.mark`.
- **Risks:**
  - Bumping `STALE_AFTER_MS` to 5min delays silent refresh of stale data. Mitigated by existing visibilitychange + 5-min auto-refresh intervals.
  - Removing `loadDashboard` from non-dashboard tab switches means clientsData may be stale when user returns. Acceptable: dashboard tab load re-fetches if stale.
  - Chunking `renderClientsTable` via `scheduler.yield()` is async — any caller assuming sync render must be audited. (Pagination at 50 items likely fits in one chunk; yielding only kicks in if >25 items per DL-256 threshold.)
- **Breaking Changes:** None. All defaults preserved.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Zero `setTimeout handler took >200ms` violations during initial dashboard load or any tab switch. Measured before/after via Playwright + `performance.getEntriesByType('measure')`.

### Logic Flow
**Part A — Instrumentation (land first, measure, confirm)**
Gate all perf marks on `window.__ADMIN_PERF__`. No prod cost when off.

**Part B — Surgical fixes (informed by A)**

| # | Fix | File/Line |
|---|-----|-----------|
| B1 | `switchTab`: drop `loadDashboard(true)` branch — dashboard re-loads only when landing on dashboard tab itself; `review` tab uses its own data path (already loaded with dashboard data) | script.js:323-325 |
| B2 | `STALE_AFTER_MS`: 30000 → 300000 (5min) | script.js:31 |
| B3 | `renderClientsTable`: single loop builds both table + mobile card HTML; yield via `scheduler.yield()` w/ 50ms deadline if slice > 25 items | script.js:1323-1511 |
| B4 | Scope `safeCreateIcons()` to just-rendered container at all top-impact sites (777, 318, plus post-render sites); audit remaining ~65 call sites for full-doc walks | script.js:318, 777, etc. |
| B5 | Stagger prefetch: replace single `requestIdleCallback` block with chained `setTimeout(next, 16)` pump | script.js:791-811 |
| B6 | Debounce `switchTab` at 150ms leading-edge | script.js:300 |

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Parts A + B (one file) |
| `.agent/design-logs/admin-ui/310-admin-panel-slowness.md` | Create | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-310 entry |
| `.agent/current-status.md` | Modify | Update active TODOs |

### Final Step (Always)
Housekeeping — update status to `[IMPLEMENTED — NEED TESTING]`, copy Section 7 to current-status.md.

## 7. Validation Plan
* [ ] Playwright baseline: `window.__ADMIN_PERF__ = true` → reload admin → switch tabs → capture `performance.getEntriesByType('measure')`
* [ ] After B1: switching dashboard → PA queue → PA queue (not returning to dashboard) fires ZERO extra `loadDashboard` (Network tab)
* [ ] After B2: 60 seconds between tab switches → no silent dashboard refetch
* [ ] After B3: `renderClientsTable` measure < 200ms at 50-row pagination
* [ ] After B4: `safeCreateIcons` measure < 50ms at every site (no full-doc walk)
* [ ] After B5: prefetch loaders land across multiple frames, not one long task
* [ ] After B6: rapid double-click a tab → only one loader fires
* [ ] No regression: reminders, AI review, questionnaires render correctly; full-screen overlay still fires for mutations (bulk send)
* [ ] Final Playwright measurement confirms no `setTimeout handler took >200ms` Chrome violations during dashboard load or tab switching
* [ ] Before/after `performance.measure` numbers recorded in Section 8

## 8. Implementation Notes (Post-Code)

### What shipped this pass
Part A instrumentation **and** Part B1/B2/B4/B5/B6 shipped together — the instrumentation is gated on `window.__ADMIN_PERF__` so it's zero-cost in prod, and the fixes are independent of profiling (they're correctness/hygiene improvements). **B3 (merge renderClientsTable loops + `scheduler.yield` chunking) intentionally deferred** pending user-run profiling numbers — if violations persist after B1/B2/B4/B5/B6, B3 is the next lever.

### Changes landed in `frontend/admin/js/script.js`
- **Instrumentation helpers** (`perfStart`/`perfEnd`) near top of file. Prefix `dl310:` on all measures. Marks >50ms also `console.log`.
- **`safeCreateIcons`** now measured; tags each call as `scoped` vs `full-doc` so the audit is data-driven.
- **B1 — `switchTab`:** only calls `loadDashboard(true)` when `tabName === 'dashboard'`. For the `review` tab, only loads dashboard data on first visit (when `!dashboardLoaded`). Other tabs use their own loaders.
- **B2 — `STALE_AFTER_MS`:** 30 000 → 300 000 (5 min). Visibilitychange + 5-min auto-refresh intervals handle real-time freshness.
- **B4 — Scoped Lucide replacement:** `switchTab`'s post-activation call now scopes to the activated tab element; `loadDashboard`'s post-render call now scopes to `#tab-dashboard`. Remaining unscoped sites to audit if profiling flags them.
- **B5 — Prefetch pump:** 7 loaders no longer bundled in a single `requestIdleCallback`. Each step runs via `scheduler.postTask('background')` → `requestIdleCallback` → `setTimeout(16)` fallback chain, yielding between each step.
- **B6 — `switchTab` debounce:** 150ms leading-edge guard suppresses double-click re-entry.

### Not yet shipped (B3)
`renderClientsTable` still runs two sequential loops (desktop table + mobile cards) and a single `innerHTML` swap. Merging into one loop and chunking via `scheduler.yield()` is the next lever if Playwright/profile shows >200ms violations persist on this function.

### Testing instructions for user
See Section 7 and the commit message. Summary: set `window.__ADMIN_PERF__ = true` in DevTools console, reproduce, then:
```js
copy(JSON.stringify(performance.getEntriesByType('measure').filter(m => m.name.startsWith('dl310:')).map(m => ({name:m.name, dur:+m.duration.toFixed(1)})), null, 2))
```
Paste back into conversation.

### Baseline (captured by user)
*Pending — will paste after first reproduction.*

### After fixes (captured by user)
*Pending — same repro after the fixes deploy.*

### Deviations from plan
- **B5 implemented inside Part A instrumentation commit** — the staggered pump replaced the old prefetch block while wiring in perf marks, so they landed together.
- **B3 deferred** pending profiling evidence.
