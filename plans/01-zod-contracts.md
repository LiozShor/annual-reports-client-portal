# Zod + Shared API Contracts
**Status:** Not started | **Depends on:** none
**Estimated effort:** 3–5 days (spread across routes; one session per route batch)

## Goal
Introduce a `packages/shared/` workspace that exports Zod schemas + inferred TypeScript types for every `/webhook/*` request and response. The Worker validates at the route boundary; drift between ad-hoc inline types and actual payloads becomes a build or runtime error instead of a silent bug.

## Preconditions
- Root `package.json` converted to npm workspaces (`"workspaces": ["api", "packages/*"]`).
- `api/tsconfig.json` gains a path alias `@shared/*` → `packages/shared/src/*`.
- No in-flight PRs currently modifying `api/src/index.ts` (merge-conflict risk on middleware insertion).

## Steps
1. Create `packages/shared/` with `package.json` (name `@moshe/shared`, private), `tsconfig.json` extending `api/tsconfig.json` compiler options.
2. `npm install zod` at the workspace root (hoisted).
3. Port the smallest route first: `/webhook/dashboard`.
   - Define `DashboardRequestSchema`, `DashboardResponseSchema` in `packages/shared/src/dashboard.ts`.
   - Export `type DashboardResponse = z.infer<typeof DashboardResponseSchema>`.
4. Add a Hono middleware helper `validateSchema(schema)` in `api/src/lib/validate.ts`.
5. Apply to `/webhook/dashboard` in `api/src/index.ts`. Return 400 with structured error on parse failure.
6. Iterate: one commit per route. Priority order — admin-facing read endpoints first (`/dashboard`, `/pending`, `/client`), then mutations (`/stage`, `/documents`), then webhook-triggered async (`/inbound-email`).

## Risks
- **Contract drift:** current admin JS may send fields the server tolerates but schemas will reject. Mitigate by logging parse failures for one week in `permissive` mode before flipping to `strict`.
- **n8n callers** hitting `/webhook/*` with loose shapes — enumerate n8n callers per route before tightening.
- **Hebrew / RTL text fields** — ensure schemas accept Unicode; use `z.string()` without `.regex(/\w+/)`.

## Rollback
- Remove middleware application at route(s); route falls back to untyped parsing.
- `packages/shared` can remain in repo harmlessly if not imported.
- Revert commit for the specific route if needed.

## Acceptance criteria
- [ ] `packages/shared/` builds cleanly (`tsc --noEmit` via `./node_modules/.bin/tsc`, per CLAUDE.md Windows gotcha).
- [ ] `/webhook/dashboard` validates request + response against Zod.
- [ ] Live verification: admin panel loads dashboard on staging Worker without 400s in a 10-minute observation window.
- [ ] Live verification: at least one PA card loads without triggering validation errors.
- [ ] Follow-up: track remaining routes in this file's status header as they land.

## Out of scope
- Frontend consumption of shared types (covered in plan 03).
- Runtime validation of n8n internal webhooks — separate hardening pass.
- Replacing existing error responses' shape (keep current `{ok: false, error}` envelope).
