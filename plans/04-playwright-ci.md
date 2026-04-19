# Playwright E2E in GitHub Actions CI
**Status:** Not started | **Depends on:** 03 pilot merged (stable React selectors)
**Estimated effort:** 2–3 days

## Goal
`@playwright/test` E2E suite running on every PR via GitHub Actions, covering three golden paths: (1) admin login, (2) dashboard load with correct stat counts, (3) a single PA card approval round-trip. "Done" = 3 consecutive green PR runs, no PII leaked in uploaded artifacts.

## Preconditions
- Stable staging URL for admin panel (confirm with user).
- Test credentials for staging stored as GH Actions secrets (`STAGING_ADMIN_USER`, `STAGING_ADMIN_PASS`).
- At least one recordable test fixture in staging Airtable (a synthetic CPA with known stats).
- React pilot (plan 03/01) merged — gives stable `data-testid` selectors for at least one panel.

## Steps
1. Install `@playwright/test` at repo root. Add `playwright.config.ts` with `baseURL` reading from env.
2. Create `tests/e2e/` with three specs:
   - `login.spec.ts` — auth flow, checks localStorage token after login.
   - `dashboard.spec.ts` — loads `/admin/`, asserts tile counts against a fixed Airtable fixture.
   - `pa-approval.spec.ts` — opens PA queue, approves one card, verifies stage transition via `/webhook/client/:id`.
3. Add `.github/workflows/e2e.yml`:
   - Trigger on `pull_request` to `main`.
   - Node 20 + `npx playwright install chromium`.
   - Run against staging URL.
   - Upload failure artifacts (screenshots, traces) **to private GH Actions storage only** — never commit.
4. Configure retention: 7 days for artifacts.
5. Run locally first, iterate on flakiness, then enable in CI.
6. Gate merges on the workflow after 1 week of stable runs.

## Risks
- **Airtable flake** — rate limits or transient 5xx can fail tests. Mitigate with `test.retry(2)` and pre-flight health check.
- **Hebrew RTL selectors** — prefer `data-testid` over text selectors for Hebrew content.
- **PII in artifacts** (per CLAUDE.md `feedback_no_screenshot_commits.md`) — screenshots of admin panel = real PII. Mitigate:
  - Use a dedicated synthetic-data CPA for tests.
  - Mask any remaining PII in screenshots via Playwright's `mask` option.
  - Never commit artifacts; rely on GH Actions private storage with retention.
- **Secrets in logs** — `console.log` in page context could leak tokens; forbid via lint rule or grep in CI.
- **Concurrent test interference** — PA approval mutates Airtable; serialize with `test.describe.configure({ mode: 'serial' })` or use per-run fixtures.

## Rollback
- Disable workflow: rename `.github/workflows/e2e.yml` → `.yml.disabled` or set `if: false` at the job level.
- Specs remain in repo for local use.
- No runtime code is touched — rollback is config-only.

## Acceptance criteria
- [ ] All three specs pass locally against staging.
- [ ] Workflow runs on a test PR and passes.
- [ ] 3 consecutive PR runs green (measure flakiness).
- [ ] Artifact review: zero real CPA-IDs or Hebrew names visible in any uploaded screenshot.
- [ ] `tests/e2e/README.md` documents fixture CPA and how to regenerate credentials.

## Out of scope
- Visual regression testing (pixel diffs).
- Performance / load testing.
- Client portal (`frontend/document-manager.html`) — admin only for now.
- Replacing existing smoke-test scripts (none today).
