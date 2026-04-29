# Annual Reports CRM - Current Status

**Last Updated:** 2026-04-29 (Self-Improvement Infra Tiers 1+2 SHIPPED — Tier 1: regression scaffold (12 cases), MEMORY.md size guard, retry-detector hook, telemetry gitignore. Tier 2: memory timestamps backfilled (46 files), `.claude/workflows/` (deploy-worker.sh, merge-and-push.sh, close-design-log.sh), Stop-hook session telemetry, design-log skill wired to close-design-log.sh. Plan: `~/.claude/plans/snoopy-conjuring-blossom.md`. Tier 3 SHIPPED — `/consolidate-memory` skill at `.agent/skills/consolidate-memory/SKILL.md`, monthly-insights extended with self-improvement signals section.)
**Last Updated:** 2026-04-29 (DL-379 COMPLETED — encrypted-PDF lock indicator on AI Review cards live.)
**Last Updated:** 2026-04-29 (DL-377 COMPLETED — layered PII/secret defense: harness deny rules, CI pii-guard.yml + secret-scan.yml, pre-commit hook chain. Optional follow-up: enable GitHub branch-protection required status checks for pii-guard.yml.)
**Last Updated:** 2026-04-29 (DL-376 COMPLETED — OneDrive approve-rename uses issuer_name before matched_doc_name. Orphan backfill rename: TODO below.)
**Last Updated:** 2026-04-29 (DL-375 COMPLETED — download button restored on AI-review preview header.)
**Last Updated:** 2026-04-29 (DL-374 COMPLETED — AI-review open-in-new-tab uses fresh MS Graph webUrl. Doc-manager stale-URL follow-up: COMPLETED by user.)
**Last Updated:** 2026-04-29 (DL-373 COMPLETED — password-protected PDF unlock from AI Review preview live.)
**Last Updated:** 2026-04-29 (DL-371 COMPLETED — edit-client modal full redesign live.)
**Last Updated:** 2026-04-29 (DL-370 COMPLETED — move-classification edge cases verified live.)
**Last Updated:** 2026-04-29 (DL-369 COMPLETED — AI Review move-document-to-client live.)
**Last Updated:** 2026-04-29 (DL-366 COMPLETED — dashboard cc_email + copy questionnaire link live.)
**Last Updated:** 2026-04-28 (DL-365 Phase 1 COMPLETE — smoke test passed, CF Logs verified, Logpush active; Phases 2-4 queued.)
**Last Updated:** 2026-04-28 (DL-368 domain cutover COMPLETE — docs.moshe-atsits.com on annual-reports-client-portal-git. Git auto-deploy still broken — CF support ticket pending.)

---

## OPEN: DL-368 — CF Pages git auto-deploy broken (needs CF support ticket)

Pages project `annual-reports-client-portal-git` (`docs.moshe-atsits.com`) does not auto-build from `main` pushes. Root cause: `source.config.repo_id` stale after repo delete+recreate.

**Workaround:** run `bash scripts/deploy-pages.sh "manual deploy"` from canonical clone after every frontend push.

**USER ACTION required:**
- [ ] Open CF support ticket: CF Dash → Pages → Settings → "contact support". Paste: *"Pages project `annual-reports-client-portal-git` (account `ae0f0a190f9375f27d6043111996b1ef`) has stale `source.config.repo_id`. Pushes to `main` produce no `github:push` deploys. Please rebind to repo id `1222817442`."*
- [ ] After fix: verify `deployment_trigger.type=github:push` in `wrangler pages deployment list`.

Design log: `.agent/design-logs/infrastructure/368-cf-pages-git-integration-broken.md`

---

## OPEN: DL-376 — OneDrive orphan backfill rename

Existing files uploaded before the DL-376 fix (approved 867/106/T501 files) still have bare names like `טופס 867.pdf` instead of issuer-substituted names. Needs a one-time backfill rename pass.

---

## OPEN: DL-365 — Activity Logger Phases 2-4

Design log: `.agent/design-logs/infrastructure/365-activity-logger.md`

**Phase 2** — server-side instrumentation: dual-write `logSecurity()` to console.log, wrap `logError()` to also emit `logEvent()`, add `logEvent()` calls to inbound processor / classifications / approve-and-send / upload-document.

**Phase 3** — admin viewer (`/admin/dev/activity` React island) + `frontend/shared/telemetry.js` + `DEV_PASSWORD`-gated lookup endpoints.

**Phase 4** — client portal page hooks + n8n workflow updates (replace 7 Airtable POSTs with `/webhook/events`).

**Phase 5** (2 weeks after Phase 4 lives) — strip dual-write; deactivate `[MONITOR] Security Alerts` + `[MONITOR] Log Cleanup`; mark `security_logs` deprecated.

Still need to set Worker secrets: `DEV_PASSWORD`, `PII_HASH_KEY` (`wrangler secret put` from `api/`).

---

## SHIPPED: Self-Improvement Tier 3 (2026-04-29)

- [x] `/consolidate-memory` skill — reads all memory files, surfaces duplicates/contradictions/stale (>90d unused), outputs proposal to `.agent/insights-audits/memory-consolidation-YYYY-MM-DD.md`.
- [x] `/monthly-insights` self-improvement section — regression pass-rate trend, top 5 rules that fired, top 5 rules never referenced in 30d, retry-trap fire count.

Plan: `~/.claude/plans/snoopy-conjuring-blossom.md`

---

## OPEN: W02 regression — wrangler deploy script missing `-c wrangler.toml`

`api/package.json` deploy script needs `-c wrangler.toml` flag so `check-regressions.sh` W02 case passes honestly.
