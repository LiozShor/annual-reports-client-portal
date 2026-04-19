# Migration Master Plan
**Status:** Not started | **Depends on:** none
**Estimated effort:** umbrella (see individual plans)

## Goal
Coordinate five modernization initiatives across the Worker API and admin frontend, executed sequentially with parallel slack where dependencies allow. "Done" = all five plans in `COMPLETED` state with live-data verification recorded.

## Preconditions
- Branch hygiene per CLAUDE.md: each plan executes on its own feature branch off `main`.
- `.agent/` design-log workflow followed for each plan's rollout.
- No existing foothold for any target (all greenfield); nothing to reconcile.

## Status table
| ID | Title | Status | Blocker |
|----|-------|--------|---------|
| 00 | Behavior baseline (discovery only) | Not started | — |
| 01 | Zod + shared API contracts | Not started | — |
| 02 | Sentry + structured logs | Not started | Sentry project provisioning (user) |
| 03 | React + Vite + TS (panels) | Not started | 00 complete + 01 partial (at least `/dashboard` shape) |
| 04 | Playwright E2E in CI | Not started | 03 pilot merged (selectors stable) |
| 05 | Postgres (Neon) + Drizzle shadow-write | Not started | Neon project provisioning (user) |

## Dependency graph
```
00-behavior-baseline ──────────┐
                               ▼
01-zod-contracts   ──┐  03-react-migration (panels)
                     ├──────▶    │
02-sentry ───────────┘            ▼
                             04-playwright-ci
05-postgres-shadow-write (independent; can start any time after 01)
```
01 and 02 remain parallelizable and do NOT depend on 00.

## Order validation
Suggested order is preserved. Rationale:
- **01 first** — smallest blast radius, unblocks 03 by fixing contract drift at the seam React will cross.
- **02 second** — gives a baseline for measuring regressions during the frontend rewrite.
- **03 third** — panel-by-panel strangler-fig; pilot = dashboard stats tiles.
- **04 fourth** — Playwright selectors are more stable against React (data-testid) than against the 11K-line script.js.
- **05 last, but parallelizable** — backend-only, independent of the frontend track.

## Current focus
`00-behavior-baseline` — execute next. Produces the inventories that plan 03 references before any legacy code is removed. 01 and 02 can run in parallel to 00.

## Partial-foothold flags
None. Audit confirmed zero prior work on any of the five tracks. `api/tsconfig.json` has `jsx: react-jsx` but that is for Hono SSR, not client React — do not treat as React foothold.

## Steps
1. Execute plans in dependency order; mark status here when each enters `In progress` or `COMPLETED`.
2. After each plan closes, update its entry in the status table and move the `current focus` pointer.
3. Surface blockers (user actions like provisioning) at the top of this file.

## Risks
- Scope creep: any single plan expanding to cover multiple tracks. Keep each plan's "Out of scope" list authoritative.
- Merge conflicts if 01 and 05 run in parallel and both touch `api/src/index.ts` — sequence them.

## Rollback
Each plan owns its own rollback. Master-plan rollback = revert status entry; individual code-level rollback is per-plan.

## Acceptance criteria
- [ ] All 5 plans closed with `COMPLETED` status
- [ ] Live-data verification recorded for each plan per CLAUDE.md
- [ ] No regressions in admin panel or inbound-email queue consumer

## Out of scope
- Implementation details (each plan owns its own)
- Frontend Sentry (deferred to post-React follow-up)
- Postgres read cutover (only shadow-write scoped here)
