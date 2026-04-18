# Security Policy — Annual Reports CRM

## 1. Threat Model

**Repo:** Public GitHub (`LiozShor/annual-reports`).

**Sensitive data in scope:**
- Airtable Personal Access Tokens (PATs) — full read/write access to 500+ client records
- CPA client IDs (`CPA-\d+`) — link commits to real clients
- Hebrew text in `.agent/` files — may contain client names, document notes, or financial values extracted from live Airtable records
- n8n webhook URLs (can trigger automations)
- Cloudflare Worker secrets

**Prior incident:** One Airtable PAT leaked in a commit; rotated immediately. AI-assisted commits statistically leak at ~2× baseline (GitGuardian 2026 data) — hence this layered defense.

---

## 2. What Runs When

| Event | Tool | What it checks |
|-------|------|---------------|
| `git commit` (local) | **gitleaks** | ~2 000 regex rules for API keys, tokens, credentials |
| `git commit` (local) | **ggshield** | GitGuardian cloud matching (AI-assisted commit awareness) |
| `git commit` (local) | **agent-pii-guard** | CPA-IDs, Hebrew text, Airtable PATs — **added lines only** |
| `git push` / PR | **TruffleHog** (CI) | Verified secrets across all commits in the push/PR |

All local hooks are wired via `pre-commit` (`pre-commit install` writes `.git/hooks/pre-commit`).

---

## 3. How Each Hook Works

### gitleaks
Runs against the staged diff. Uses a built-in ruleset (~2 000 patterns) plus any project-level `.gitleaks.toml` overrides. Fast — typically < 1 s.

### ggshield
Calls the GitGuardian API with the staged diff. Uses ML-backed matching with awareness of AI-generated code patterns.

`GITGUARDIAN_API_KEY` is set in `.env` — ggshield picks it up automatically when the env is sourced (`source .env`).

**Install via pipx** (not pip) to avoid dependency conflicts with MCP/FastMCP:
```bash
pipx install ggshield
ggshield auth login   # one-time browser OAuth
```
The hook uses `language: system` so pre-commit calls the pipx-provided binary from PATH.

### agent-pii-guard (diff-only, project-specific)
Scans **only `+` lines in `git diff --cached`** — lines added in this commit, not existing file content. This grandfathers the 81+ CPA-IDs and 363+ Hebrew blocks already present in `.agent/` files without blocking every future commit.

Pattern set:
- `\bCPA-\d+\b` — client identifiers
- `[\u0590-\u05FF]{4,}` — Hebrew text (≥ 4 chars) — proxy for client data
- `\bpat[A-Za-z0-9]{14,}\.[a-f0-9]{64}\b` — Airtable PAT format

**Audit mode** (`python3 .claude/hooks/agent-pii-guard.py --all`) scans full files and exits 0 — use for periodic audits without blocking.

### TruffleHog (CI)
Runs `--only-verified` so it only blocks on secrets that are confirmed live (reduces false positives). Scans the commit range added by the push/PR, not full history.

---

## 4. Allowlist Process

Never add a real secret to an allowlist. Allowlists are for false positives only.

### gitleaks
Add to `.gitleaksignore` in the repo root:
```
# <hash-of-finding> — reason: <why this is a false positive>
abc123def456...
```
Or use `# gitleaks:allow` inline comment on the line.

### ggshield
Add to `.gitguardian.yaml`:
```yaml
ignored-matches:
  - match: "the-false-positive-string"
    name: "reason: <why>"
```

### agent-pii-guard
Add to `ALLOWLIST_PATTERNS` in `.claude/hooks/agent-pii-guard.py`:
```python
re.compile(r'your-pattern-here'),  # reason: <why this is safe>
```
Each allowlist entry **must have a comment** explaining why it is safe.

---

## 5. Policy

- **`--no-verify` is banned.** If a hook blocks a commit, fix the underlying issue — do not bypass hooks.
- If a hook produces a false positive that cannot be resolved by allowlisting, raise it as a GitHub issue before bypassing.
- Feature branches only. Never commit directly to `main`.
- Secrets go in `.env` (gitignored) or Cloudflare Worker secrets / GitHub Actions secrets — never inline in code or config files.

---

## 6. Incident Playbook

If a real secret is found (in a commit, in history, or reported by a scanner):

1. **Rotate immediately** — revoke the token in the issuing system (Airtable, Cloudflare, etc.) before anything else. Do not wait.
2. **Assess exposure** — check GitHub's "used by" and audit logs if available. Was the repo public when the commit was pushed?
3. **Decide on history rewrite** — use `git-filter-repo` to remove the secret from history, then force-push. This breaks existing clones — notify affected parties.
   ```bash
   pip install git-filter-repo
   git filter-repo --replace-text <(echo "OLD_SECRET==>REDACTED")
   git push origin --force --all
   ```
4. **Notify affected systems** — if the leaked key had access to Airtable records, notify Moshe. If it was a Cloudflare key, audit Worker invocation logs.
5. **Post-mortem** — write a note in `.agent/design-logs/security/` describing what happened and what was changed. Do NOT include the rotated secret value.
6. **Allowlist the rotated value** — once rotated, add the old pattern to the appropriate allowlist with a `# rotated YYYY-MM-DD` comment so scanners stop flagging it in history.
