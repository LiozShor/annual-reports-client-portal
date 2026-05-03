# Security Deep Audit — 2026-05-03

**Run:** 2026-05-03T05:43:21Z
**Total findings:** 43 (0 CRITICAL, 10 HIGH, 7 MEDIUM, 6 LOW, 20 INFO, 0 suppressed)
**Time-bombs (≤7 days):** 1
**Manual UI checks needed:** 7

---

## 1. Findings (prioritized)

| # | Sev | Cat | Title | Location | Action | Effort |
|---|---|---|---|---|---|---|
| 1 | HIGH | 1-public-repo | Rotated secrets found in pre-migration backup JSON file | `docs/wf05-backup-pre-migration-2026-03-26.json` | Verify this is a backup-only file and consider moving to .gitignore or removing entirely; rotated secrets pose no risk if current production uses regenerated values | 5min |
| 2 | HIGH | 10-dual-use | OneDrive sharing token hardcoded as literal | `api/src/lib/inbound/attachment-utils.ts:7` | Move ONEDRIVE_SHARING_TOKEN to env.ONEDRIVE_SHARING_TOKEN via wrangler.toml secrets or .env | 30min |
| 3 | HIGH | 5-github | Vite path-traversal vulnerability (GHSA-4w7w-66w2-5vf9, CVE-2026-39365) | `https://github.com/LiozShor/annual-reports-client-portal/security/dependabot/1` | Upgrade Vite to 8.0.5+, 7.3.2+, or 6.4.2+; run npm audit fix or manually bump frontend/admin/react/package.json | 30min |
| 4 | HIGH | 5-github | Main branch not protected; no required reviews or enforce_admins | `https://github.com/LiozShor/annual-reports-client-portal/settings/branches` | Enable branch protection on main: require 1+ PR review, enforce_admins=true, allow_force_pushes=false, allow_deletions=false | 5min |
| 5 | HIGH | 6-local | Local .env incomplete vs Worker secrets | `.env, api/wrangler.toml` | Document all 16 Worker secrets (ADMIN_PASSWORD, AIRTABLE_PAT, ANTHROPIC_API_KEY, APPROVAL_SECRET, CF_ACCOUNT_ID, CF_API_TOKEN, CLIENT_SECRET_KEY, DEV_PASSWORD, MS_CLIENT_SECRET, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_REFRESH_TOKEN, MS_GRAPH_TENANT_ID, PII_HASH_KEY, SECRET_KEY, USE_QUEUE) in local .env stub for developer reference and setup checklist; status-quo acceptable for deployment (Worker secrets via CF dashboard is correct pattern). | 30min |
| 6 | HIGH | 7-saas | Microsoft Graph secret expiry not verified | `https://portal.azure.com` | Open https://portal.azure.com → Entra ID → App registrations → find n8n / Worker app → Certificates & secrets → check expirationDateTime on all secrets → rotate any expiring within 30 days → test n8n / Workers integration post-rotation | 1d |
| 7 | HIGH | 8-auth | Non-timing-safe Bearer token comparison in extract-issuer-names | `api/src/routes/extract-issuer-names.ts:212` | Replace direct === comparison with crypto.subtle.timingSafeEqual or constant-time comparison function | 5min |
| 8 | HIGH | 8-auth | Broken auth check - verifyToken promise not awaited in backfill routes | `api/src/routes/backfill.ts:32` | Add await keyword: if (!(await verifyToken(token, c.env.SECRET_KEY)).valid) | 5min |
| 9 | HIGH | 8-auth | Broken auth check - verifyToken promise not awaited in backfill routes (second instance) | `api/src/routes/backfill.ts:258` | Add await keyword: if (!(await verifyToken(token, c.env.SECRET_KEY)).valid) | 5min |
| 10 | HIGH | 9-timebomb | MS Graph subscription expiration — manual renewal required | `MS Graph subscription id: 7171bd0d-7169-4244-9466-e1c637604c9e` | Verify MS Graph subscription expirationDateTime daily via n8n [05-SUB] Email Subscription Manager (runs every 2 days, PATCH expirationDateTime + 3d). If PATCH fails silently, deletion+recreation required. Monitor Worker Logs for Graph API errors (401 invalid subscription, 404 not found). Plan fallback 48-hour manual renewal before 2026-05-05T16:47:29Z expiration. | 5min |
| 11 | MEDIUM | 4-cf-worker | Undocumented secrets in wrangler secret list | `api/wrangler.toml:20-30 (comment block) vs actual secrets` | Update the comment block in wrangler.toml to document all 17 secrets. Missing from docs: APPROVAL_SECRET, CF_ACCOUNT_ID, CF_API_TOKEN, DEV_PASSWORD, MS_CLIENT_SECRET, PII_HASH_KEY, USE_QUEUE | 30min |
| 12 | MEDIUM | 7-saas | Anthropic API key age unknown | `https://console.anthropic.com/settings/keys` | Open https://console.anthropic.com/settings/keys → list all API keys → verify creation date and rotation frequency; revoke any key >180 days old | 30min |
| 13 | MEDIUM | 7-saas | Airtable PAT rotation status unknown | `https://airtable.com/create/tokens` | Open https://airtable.com/create/tokens → list every PAT → cross-check against codebase references (n8n, Workers) → revoke any unrecognized or unused → confirm rotation date within last 180 days | 30min |
| 14 | MEDIUM | 7-saas | Tally API key rotation status unknown | `https://tally.so/settings` | Open https://tally.so/settings → API keys → list active keys → verify each key has owner assigned → revoke any unused keys → confirm rotation within last 180 days | 30min |
| 15 | MEDIUM | 7-saas | N8N API key creation date and scope not verified | `https://liozshor.app.n8n.cloud/settings/api` | Log in to https://liozshor.app.n8n.cloud → Settings → API keys → verify creation date and scope → rotate if >180 days old or overly broad | 30min |
| 16 | MEDIUM | 9-timebomb | Deferred secret rotation — CLIENT_SECRET_KEY (Step 6) | `.agent/secret-rotation-2026-05-02.md:180` | Prerequisite: implement key-versioning in api/src/lib/client-token.ts (verify against [CLIENT_SECRET_KEY_NEW, CLIENT_SECRET_KEY_OLD], 45-day fallback window). Once shipped, rotate CLIENT_SECRET_KEY aligned with next reminder run so re-issued tokens propagate naturally. ~400 outstanding 45-day client portal tokens from 2026-05-01 reminder would invalidate on immediate rotation. Leaked-prefix risk (16/64 hex = 192 bits unbroken) is acceptable short-term. | 2h |
| 17 | MEDIUM | 9-timebomb | Stale NEED-TESTING design logs — 17 days overdue verification | `.agent/design-logs/admin-ui/{124,125,126}*.md (and 46 others)` | Review Section 7 test items for DL-124, DL-125, DL-126, DL-150, DL-152, DL-159, DL-166+ (49 total with NEED-TESTING status, last commit 2026-04-16). Deploy Pages if needed, run live e2e test (send inbound email, submit Tally, click admin UI), verify behavior matches design intent, then mark COMPLETED or update blockers in current-status.md. | half-day |
| 18 | LOW | 1-public-repo | Design logs reference rotated secrets (documentation only) | `.agent/design-logs/ai-review/075-ai-review-inline-document-preview.md` | This is intentional design documentation. No action required; all referenced secrets were rotated on 2026-05-02 | 0min |
| 19 | LOW | 1-public-repo | Design logs reference rotated secrets (documentation only) | `.agent/design-logs/documents/051-onedrive-persistent-file-links.md` | This is intentional design documentation. No action required; all referenced secrets were rotated on 2026-05-02 | 0min |
| 20 | LOW | 1-public-repo | Design logs reference rotated secrets (documentation only) | `.agent/design-logs/email/153-view-documents-button-all-client-emails.md` | This is intentional design documentation. No action required; all referenced secrets were rotated on 2026-05-02 | 0min |
| 21 | LOW | 5-github | GitHub CLI token has delete_repo scope (overly permissive) | `https://github.com/settings/tokens` | Rotate token with minimal scopes: repo, workflow, gist, read:org; remove delete_repo; update .env if stored | 30min |
| 22 | LOW | 6-local | 10 stale merged worktrees on 2026-05-02 | `git worktree list + refs/heads/` | Prune merged worktrees from 2026-05-02 via git worktree remove (branches already merged to origin/main, last commit 2026-05-02 18:43 UTC or earlier); use bash .claude/workflows/close-design-log.sh for design-log branches or manual worktree prune for session branches. | 30min |
| 23 | LOW | 7-saas | GitHub PAT has delete_repo scope | `GitHub CLI (keyring)` | Run `gh auth logout` then `gh auth login` with scope='repo,gist,read:org,workflow' (exclude delete_repo). Verify no scripts depend on repo-delete operations before revoking. | 5min |

---

## 2. Time-bombs (action required <7 days)

| Days | Sev | Cat | Title | Action |
|---|---|---|---|---|
| 2 | HIGH | 9-timebomb | MS Graph subscription expiration — manual renewal required | Verify MS Graph subscription expirationDateTime daily via n8n [05-SUB] Email Subscription Manager (runs every 2 days, PATCH expirationDateTime + 3d). If PATCH fails silently, deletion+recreation required. Monitor Worker Logs for Graph API errors (401 invalid subscription, 404 not found). Plan fallback 48-hour manual renewal before 2026-05-05T16:47:29Z expiration. |

---

## 3. Manual UI checks needed

- [ ] **Microsoft Graph secret expiry not verified** — Open https://portal.azure.com → Entra ID → App registrations → find n8n / Worker app → Certificates & secrets → check expirationDateTime on all secrets → rotate any expiring within 30 days → test n8n / Workers integration post-rotation
- [ ] **MS Graph subscription expiration — manual renewal required** — Verify MS Graph subscription expirationDateTime daily via n8n [05-SUB] Email Subscription Manager (runs every 2 days, PATCH expirationDateTime + 3d). If PATCH fails silently, deletion+recreation required. Monitor Worker Logs for Graph API errors (401 invalid subscription, 404 not found). Plan fallback 48-hour manual renewal before 2026-05-05T16:47:29Z expiration.
- [ ] **Anthropic API key age unknown** — Open https://console.anthropic.com/settings/keys → list all API keys → verify creation date and rotation frequency; revoke any key >180 days old
- [ ] **Airtable PAT rotation status unknown** — Open https://airtable.com/create/tokens → list every PAT → cross-check against codebase references (n8n, Workers) → revoke any unrecognized or unused → confirm rotation date within last 180 days
- [ ] **Tally API key rotation status unknown** — Open https://tally.so/settings → API keys → list active keys → verify each key has owner assigned → revoke any unused keys → confirm rotation within last 180 days
- [ ] **N8N API key creation date and scope not verified** — Log in to https://liozshor.app.n8n.cloud → Settings → API keys → verify creation date and scope → rotate if >180 days old or overly broad
- [ ] **Stale NEED-TESTING design logs — 17 days overdue verification** — Review Section 7 test items for DL-124, DL-125, DL-126, DL-150, DL-152, DL-159, DL-166+ (49 total with NEED-TESTING status, last commit 2026-04-16). Deploy Pages if needed, run live e2e test (send inbound email, submit Tally, click admin UI), verify behavior matches design intent, then mark COMPLETED or update blockers in current-status.md.

---

## 4. Already-protected (CLEAN / INFO)

| Cat | Assertion |
|---|---|
| 10-dual-use | DRIVE_ID hardcoded (identifier, not credential) |
| 10-dual-use | Airtable base ID appqBL5RWQN9cPOyh found in backup JSON (public identifier) |
| 10-dual-use | No high-entropy hardcoded constants added since 2026-05-02 |
| 10-dual-use | No prior security-deep-audit baseline found; first run |
| 3-n8n | Audit Summary: n8n Credential & Secret Exposure |
| 4-cf-worker | CORS allowed origins configured appropriately |
| 4-cf-worker | Observability head_sampling_rate set to 100% |
| 4-cf-worker | KV namespace bindings inventory |
| 4-cf-worker | R2 bucket bindings inventory |
| 4-cf-worker | No hardcoded secrets detected in Worker source |
| 4-cf-worker | Worker secret retrieval succeeded |
| 5-github | GitHub posture summary: secret-scanning ON, push-protection ON, dependabot ON, branch protection OFF, no external collaborators, overly permissive CLI token |
| 6-local | Untracked high-risk file scan |
| 6-local | Local hygiene summary |
| 7-saas | Automated SaaS token probes completed |
| 8-auth | Route surface audit summary: 52 routes scanned, all with explicit auth middleware |
| 9-timebomb | Cloudflare cron triggers — queues, logpush configured |
| 9-timebomb | Secret rotation runbook Phase 2 (9 protection layers) — deployed 2026-05-02 → 2026-05-03 |
| 9-timebomb | Design log follow-up from DL-386 — assign-to-this-doc chip menu option |
| 9-timebomb | W02 regression — deploy script missing -c wrangler.toml flag |
| 1-public-repo | Public repo leakage audit complete: no live unrotated secrets in HEAD; all 2026-05-02 incident values documented as rotated |
| 2-pii | Document and PII leakage scan complete |
| 3-n8n | Probe 1: n8n Credentials Audit |
| 3-n8n | Probe 2: Inline-Secret Scan (Active Workflows) |
| 3-n8n | gitleaks Working-Tree Paranoid Scan |
| 5-github | Secret scanning enabled with push protection |
| 5-github | No open secret-scanning alerts |
| 5-github | Dependabot security updates enabled |
| 5-github | No outside collaborators |
| 5-github | No deploy keys stored |
| 5-github | No Actions secrets stored |
| 6-local | Pre-commit hook installed and functional |
| 6-local | Phase-2 security hooks present |
| 6-local | .gitleaks.toml and .pre-commit-config.yaml present |
| 6-local | pre-commit run --all-files: all hooks passed |
| 8-auth | HMAC token verification uses crypto.subtle.verify for timing-safe comparison |
| 8-auth | Client token verification uses crypto.subtle.verify for timing-safe comparison |
| 8-auth | Events endpoint implements timing-safe comparison for N8N_INTERNAL_KEY |
| 8-auth | CORS middleware properly scoped to ALLOWED_ORIGIN environment variable |
| 8-auth | Inbound email endpoint uses N8N_INTERNAL_KEY with strict equality check |
| 8-auth | Client token TTL set to 45 days as documented |
| 8-auth | Admin token TTL set to 8 hours |
| 8-auth | Rate limiting present on /webhook/unlock-pdf (5 attempts per minute) |
| 8-auth | Rate limiting present on /webhook/admin-chat (per-token rate limit) |

---

## 5. Suppressed by allowlist

_No allowlist entries applied this run._

---

_Generated by `/security-deep-audit`. Read-only — no actions taken._
_Allowlist: `.agent/audits/false-positive-allowlist.yaml` (see `assets/false-positive-allowlist.example.yaml`)._
