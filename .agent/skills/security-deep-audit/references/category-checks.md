# Category checks

Each category is a self-contained probe spec. Spawn one subagent per category, paste the full section as the agent's task, and require output as JSON-lines (one finding per line) with these keys:

```
{"category": "<N-name>", "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO|CLEAN",
 "title": "<short>", "location": "<file:line | URL | dashboard path>",
 "evidence_hash": "<sha256:first12>", "recommended_action": "<imperative>",
 "effort_estimate": "<5min|30min|2h|half-day|1d>", "manual_ui_check": false,
 "time_bomb_days": null}
```

If a category found nothing, emit ONE line with `severity: "CLEAN"`. Always emit at least one line.

## Runtime budget (per category, Haiku)

| Cat | Name | Est. wall-clock |
|---|---|---|
| 1 | Public-repo leakage | 4 min |
| 2 | Document/PII leakage | 2 min |
| 3 | n8n exposure | 2 min |
| 4 | Cloudflare Worker / Pages | 1 min |
| 5 | GitHub posture | 2 min |
| 6 | Local laptop hygiene | 1 min |
| 7 | Third-party SaaS | 2 min |
| 8 | Auth/access patterns | 3 min |
| 9 | Time-decaying risks | 1 min |
| 10 | Known dual-use HEAD constants | 1 min |

Total parallel: ≈4 min (longest category dominates). Sequential fallback: ≈19 min.

---

## Category 1 — Public-repo leakage

Scan: `LiozShor/annual-reports-client-portal`, full history (all branches, refs/dl-claims/*, stashes, tags).

Probes:
1. `gitleaks detect --source . --config .gitleaks.toml --redact --report-path /tmp/c1-history.json` — exit ≠0 = findings. Parse JSON.
2. `gitleaks detect --no-git --source . --config .gitleaks.toml --redact --report-path /tmp/c1-tree.json` — working-tree-only second pass.
3. Custom history grep for plaintext-in-Markdown-table pattern (the 2026-05-02 incident class):
   `git log --all -p -G "(plaintext|HMAC secret|API key|password|admin password)" --source -- '*.md' | head -200`
   Scrub matches against `.gitleaks.toml` allowlist regex; report only un-allowlisted hits.
4. Truncated key prefix scan (>12 chars): `git log --all -p -G "sk-ant-[A-Za-z0-9_-]{12}|pat[A-Z][A-Za-z0-9]{12}|gh[ps]_[A-Za-z0-9]{12}|AKIA[0-9A-Z]{12}|AIza[0-9A-Za-z_-]{12}" --source` — even truncated, prefixes >12 chars enable targeted guessing.
5. Internal URLs / X-Internal-Key values: `git log --all -p -G "X-Internal-Key|N8N_INTERNAL_KEY|annual-reports-api\.[a-z0-9]+\.workers\.dev/webhook/.*\?(key|token|auth)="`.
6. Cross-check live secrets: `wrangler secret list -c api/wrangler.toml --format json` — for any secret name found leaked-and-rotated in the runbook, confirm Worker has a value present (rotation completion check).
7. **Regression check:** `grep -E "QKiwUBXVH|reports3737|pat2XQGRyzPdycQWr|patvXzYxSlSUEKx9i|sk-ant-api03-8Xzh|db3f995dd145fa5d|0d1a9b04f3c2|wf05-inbound-secret" docs/` — ANY hit is CRITICAL (2026-05-02 incident regression).

Severity guide:
- Live unrotated secret in HEAD = **CRITICAL**
- Live unrotated secret in old commit = **HIGH**
- Rotated secret in old commit (history-only) = **LOW** (informational)
- Truncated prefix >12 chars in HEAD = **MEDIUM**
- Plaintext-marker pattern hit (without secret) = **LOW** (audit-doc hygiene)
- 2026-05-02 specific value resurfaced anywhere = **CRITICAL** (regression)

---

## Category 2 — Document / PII leakage

Probes:
1. Israeli ID pattern: `git ls-files | xargs grep -nE "\b[0-9]{9}\b" -- ':!*lock*' ':!*.svg' ':!*.json'` — filter out hashes / xref padding / placeholder `0000000000`. Real IDs trigger checksum-validation: 9-digit Luhn-like — if checksum valid, escalate.
2. Israeli phone format: `\+972[- ]?[0-9]{8,9}|05[0-9][- ]?[0-9]{7}` — allowlist office numbers `+972779928421`, `036390820`, `0779928421`.
3. Real client emails: regex `[a-z][a-z0-9._-]{2,30}@(gmail|outlook|hotmail|yahoo|icloud)\.com`, allowlist `liozshor1@gmail.com`, `*@moshe-atsits.co.il`.
4. Hebrew text in tracked files **outside** the agent-pii-guard scope (i.e. anywhere not under `.agent/`, `docs/*audit*`, `docs/*compliance*`, `docs/*security*`): `git ls-files | xargs grep -lE "[\x{0590}-\x{05FF}]{8,}"` — anything with 8+ consecutive Hebrew chars in code/config (not labels in quotes).
5. Office documents tracked: `git ls-files | grep -iE "\.(xls|xlsx|doc|docx|ppt|pptx|pdf)$"` — any hit = HIGH (Office files are 99% PII).
6. Workflow exports tracked: `git ls-files | grep -iE "(-backup-|-export-|workflow-backup|n8n-export).*\.json$"` — any hit = HIGH (n8n exports always contain plaintext Code-node secrets — wf05 lesson).
7. Playwright screenshots tracked: `git ls-files | grep -iE "_docs/|playwright-report/|test-results/.*\.png$"` — any hit = MEDIUM.
8. GitHub Pages-rendered .md with secrets: `curl -s https://docs.moshe-atsits.com/ | grep -iE "sk-ant-|pat[A-Z]|password|secret"` — anything matching after redaction = MEDIUM/HIGH depending on value.
9. PR descriptions / issue comments: `gh pr list --state all --json number,body | jq -r '.[] | select(.body | test("sk-ant-|pat[A-Z]|password\\s*[:=]"))'` and same for issues.

Severity guide:
- Real client name/email/ID/phone in tracked file = **HIGH**
- Office document tracked = **HIGH**
- n8n workflow export tracked = **HIGH**
- Playwright screenshot tracked = **MEDIUM**
- Hebrew text outside guard scope = **LOW** (heuristic — likely false positive for UI labels; investigate)
- Secret in PR/issue body = **HIGH**

---

## Category 3 — n8n exposure

Probes:
1. Run `bash scripts/audit-n8n-credentials.sh` (the existing Layer 9 script). Parse output. Surface every `⚠ UNUSED` credential (orphan), every `INACTIVE` workflow still bound to a credential, every probe FAIL.
2. For each credential found: cross-check active vs deactivated workflow status. Active workflows still using credentials whose underlying secret was rotated this month = HIGH (drift suspect — re-test).
3. Inline-secret heuristic across all workflows: `curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_HOST/api/v1/workflows" | jq -r '.data[] | .nodes[]? | select(.parameters.jsCode? // .parameters.functionCode? // "" | test("pat[A-Z]|sk-ant-|xoxb-|[A-Za-z0-9+/]{40,}=*"; "x")) | "\(.name)"'` — any hit means the rotation didn't fully migrate to Credentials store.
4. MS Graph subscription expiry: query MS Graph `/subscriptions` (need `MS_GRAPH_ACCESS_TOKEN` from Worker — call `/admin/diagnostics/graph-subs` if exists, else flag as SKIPPED). Any `expirationDateTime` < 72h = CRITICAL time-bomb.
5. Workflow JSON literal scan: `for wf in $(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_HOST/api/v1/workflows" | jq -r '.data[].id'); do curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_HOST/api/v1/workflows/$wf" | gitleaks detect --no-git --source - --pipe; done` — pipe each workflow through gitleaks.

Severity guide:
- Inline secret literal in active workflow = **HIGH**
- Inline secret in deactivated workflow = **MEDIUM** (still leaks via export)
- Orphan credential >30 days unused = **LOW** (delete candidate)
- MS Graph subscription expiring <72h = **CRITICAL** time-bomb
- Drift between Credential store and rotation runbook = **HIGH**

---

## Category 4 — Cloudflare Worker / Pages

Probes:
1. `CLOUDFLARE_API_TOKEN="" wrangler secret list -c api/wrangler.toml` — confirm every secret name listed in `api/wrangler.toml` comments (`# - ADMIN_PASSWORD`, etc.) actually exists. Missing = MEDIUM (silent break risk).
2. Hardcoded constants in source that should be secrets: `grep -rEn "(SHARING_TOKEN|CLIENT_SECRET|API_KEY|BEARER|HMAC_KEY)\s*=\s*['\"][A-Za-z0-9+/=._-]{16,}['\"]" api/src/` — ignore `c.env.X`, `process.env.X`. Known: `api/src/lib/inbound/attachment-utils.ts:7` ONEDRIVE_SHARING_TOKEN.
3. Other Workers in this CF account: `wrangler list` (if CLI version supports). Any Worker not in repo = MEDIUM (out-of-band deploy).
4. KV namespaces orphaned: list KV namespaces via API, cross-check against bindings in `wrangler.toml`. Unbound = LOW.
5. R2 buckets: list, cross-check against `wrangler.toml` `[[r2_buckets]]`. Unbound = LOW.
6. Observability drift: `head_sampling_rate` in `wrangler.toml` should be `1`. Anything <1 = INFO (sample-rate change wasn't documented).
7. CORS check: `grep -n "ALLOWED_ORIGIN" api/wrangler.toml` — ensure value is the production domain, not `*` or `localhost`.

Severity guide:
- Hardcoded secret-shaped constant in api/src/ = **HIGH**
- Missing Worker secret declared in wrangler.toml = **MEDIUM**
- Out-of-band Worker on the account = **MEDIUM**
- CORS wildcard = **HIGH**

---

## Category 5 — GitHub posture

Probes (all via `gh api`):
1. `gh api repos/LiozShor/annual-reports-client-portal --jq '.security_and_analysis'` — confirm `secret_scanning.status == "enabled"`, `secret_scanning_push_protection.status == "enabled"`, `dependabot_security_updates.status == "enabled"`. Any disabled = HIGH.
2. `gh api repos/LiozShor/annual-reports-client-portal/secret-scanning/alerts?state=open` — any open = HIGH (one finding per alert).
3. `gh api repos/LiozShor/annual-reports-client-portal/code-scanning/alerts?state=open` — any open = severity per alert level.
4. `gh api repos/LiozShor/annual-reports-client-portal/dependabot/alerts?state=open` — any HIGH/CRITICAL = HIGH; LOW/MEDIUM = MEDIUM.
5. `gh api repos/LiozShor/annual-reports-client-portal/branches/main/protection` — verify: `required_pull_request_reviews` set, `enforce_admins.enabled`, `allow_force_pushes.enabled == false`, `allow_deletions.enabled == false`. Any miss = HIGH.
6. `gh api repos/LiozShor/annual-reports-client-portal/collaborators?affiliation=outside` — any outside collaborator = HIGH (least-privilege).
7. `gh secret list -R LiozShor/annual-reports-client-portal` — list Actions secrets, flag any not referenced in `.github/workflows/*.yml` = LOW (orphan).
8. `gh api user/keys` and `gh api repos/LiozShor/annual-reports-client-portal/keys` — list deploy keys; any with `read_only: false` = MEDIUM.
9. `gh auth status` — confirm token scopes, flag if includes `delete_repo` (over-privileged for daily use) = LOW.

---

## Category 6 — Local laptop hygiene

Probes:
1. `.env` parity: `grep -oE "^[A-Z_][A-Z0-9_]*=" .env | sort -u` vs `wrangler secret list` — any var in `.env` not on Worker (or vice-versa for shared secrets) = LOW.
2. Untracked high-risk files: `git status --porcelain | grep -E "^\?\?" | grep -iE "\.codex/|\.agents/|\.cursor/|\.aider/|\.local-backup|\.docx?$|\.xlsx?$|wf05-backup|n8n-export"` — any = LOW (gitignore should already cover most).
3. Stale worktrees: `git worktree list` — any worktree on a branch already merged to main, older than 30 days = LOW.
4. Pre-commit hook installation: `cat .git/hooks/pre-commit 2>/dev/null` — must reference pre-commit framework. Missing = HIGH (defenses bypassed).
5. Each Phase-2 hook present and executable: `for h in agent-pii-guard.py entropy-md-guard.py large-doc-warn.py forbid-workflow-exports.py script-size-ratchet.py; do test -f .claude/hooks/$h || echo "MISSING $h"; done` — missing = HIGH.
6. `.gitleaks.toml` exists and `pre-commit-config.yaml` references gitleaks + ggshield = HIGH if missing.
7. `pre-commit run --all-files` — any failure other than "files would be modified" = HIGH.

---

## Category 7 — Third-party SaaS

Most of this category is **manual UI checks** — set `manual_ui_check: true` in those findings.

Probes that ARE automatable:
1. Anthropic API keys age: `curl -s https://api.anthropic.com/v1/organizations/api_keys -H "x-api-key: $ANTHROPIC_API_KEY"` — list, flag any `created_at` >180 days old as MEDIUM (rotation hygiene). If endpoint requires admin key, mark SKIPPED.
2. Airtable PATs list: no API for listing PATs (Builder Hub is JS-only). Mark `manual_ui_check: true`, instruction: "Open https://airtable.com/create/tokens — list every PAT, cross-check against expected (PAT #1 + PAT #2 from rotation). Revoke any not recognized."
3. Microsoft Azure: `curl -s "https://graph.microsoft.com/v1.0/applications" -H "Authorization: Bearer $MS_GRAPH_ACCESS_TOKEN"` — list app registrations, flag any client secret with `endDateTime` <30 days = HIGH time-bomb.
4. Tally: no API for listing tokens. Mark `manual_ui_check: true`.
5. GitHub PAT for `gh` CLI: `gh auth status --show-token | grep "Token scopes"` — verify scopes are `'repo', 'workflow', 'read:org'` only; flag `delete_repo` or `admin:*` as LOW.

---

## Category 8 — Auth/access patterns in code

Use `Explore` subagent (cheap codebase grep). Probes:
1. Endpoints without auth gating: list every `app.<verb>('/...')` in `api/src/routes/` and `api/src/index.ts`. Cross-check each against the auth-middleware list. Any handler without `requireAdmin` / `requireClient` / `requireInternal` = HIGH (unless intentionally public — `/health`, `/webhook/process-inbound-email` validated by Bearer).
2. HMAC token TTLs: grep `ttlDays` and `expiresIn` in `api/src/lib/`. Cross-check against documented values (`feedback_client_token_45_days`). Drift = MEDIUM.
3. Admin endpoints reachable without admin check: grep `/admin` routes for ones missing `requireAdmin` middleware = HIGH.
4. CORS overly permissive: grep `Access-Control-Allow-Origin` and `cors(` for `*` or `null` outside test files = HIGH.
5. Missing rate-limiting: any `/webhook/*` handler without rate-limit middleware = MEDIUM.
6. Bearer-token comparison must use `crypto.subtle` (timing-safe), never `===`. Grep `req.headers.*Bearer.*===` = HIGH (timing attack).

---

## Category 9 — Time-decaying risks

Probes:
1. MS Graph subscriptions expiring soon: see Category 3 probe 4. Any <72h = CRITICAL time-bomb (also reported here for top-level visibility).
2. Cloudflare cron triggers: parse `wrangler.toml` `[triggers]`, list any cron with `expirationDateTime` (rare) — flag.
3. Deferred rotations from prior runbooks: `grep -lE "DEFERRED|deferred|risk-accept" .agent/secret-rotation-*.md` — list every deferred item with the date and reason. Anything deferred >90 days ago = MEDIUM.
4. Stale NEED-TESTING DLs: `grep -lE "NEED TESTING|NEED-TESTING" .agent/design-logs/**/*.md` — for each, find file mtime; >30 days = MEDIUM.
5. Open `current-status.md` follow-ups: parse the `OPEN:` and `Open-test items` sections; any item with date >30 days = MEDIUM.
6. Anthropic / Cloudflare / Airtable certificates / API token expiry — check if any return `expires_at` field, flag <30 days.

---

## Category 10 — Known dual-use HEAD constants

Cross-reference against the 2026-05-02 audit findings list (the "Already-protected" assertions from the prior audit). For each value previously found in HEAD source code:

1. `api/src/lib/inbound/attachment-utils.ts:7` `ONEDRIVE_SHARING_TOKEN` — confirm still hardcoded (known issue) OR moved to env (fix landed).
2. `api/src/lib/classification-helpers.ts:15-16` `DRIVE_ID` — confirm still hardcoded (acceptable — identifier, not credential).
3. Any `appqBL5RWQN9cPOyh` (Airtable base ID) hardcoded outside `wrangler.toml` and tests = INFO (acceptable).
4. Any new high-entropy hardcoded constant introduced since the 2026-05-02 audit: `git diff cae8a3c1..HEAD -- 'api/src/' | grep -E "^\+.*['\"][A-Za-z0-9+/=._-]{32,}['\"]"` and entropy-filter the matches.
5. Comparison anchor: load `.agent/audits/security-deep-audit-2026-05-02.md` if present — diff "Already-protected" assertions; any regression = HIGH.

---

## Output assembly

Each subagent writes its JSON-lines block to a temp file. The orchestrator concatenates, deduplicates by `evidence_hash`, sorts by severity, applies allowlist, then pipes to `scripts/render-report.sh` which produces the markdown report.
