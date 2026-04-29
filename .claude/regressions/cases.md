# Regression cases
# Format: id | category | command | expect | rule_link
# Blank lines and lines starting with # are ignored.

# --- Wrangler ---
W01 | wrangler | grep -q '^name = ' api/wrangler.toml | wrangler.toml has name field (autoconfig guard) | feedback_wrangler_autoconfig_bug.md
W02 | wrangler | grep -q '\-c wrangler\.toml' api/package.json | -c wrangler.toml flag present in deploy scripts (autoconfig guard) | feedback_wrangler_autoconfig_bug.md
W03 | wrangler | grep -q 'annual-reports-api' api/wrangler.toml | wrangler.toml names correct Worker (not empty hello-world) | feedback_wrangler_autoconfig_bug.md
W04 | wrangler | ! grep -q 'CLOUDFLARE_API_TOKEN' api/wrangler.toml | stale token not hardcoded in wrangler.toml | feedback_wrangler_token_stale.md

# --- Pages deploy ---
PG01 | pages | grep -q 'annual-reports-client-portal-git' scripts/deploy-pages.sh | deploy-pages.sh targets the correct Pages project | reference_pages_production_project.md
PG02 | pages | ! grep -q 'annual-reports-client-portal"' scripts/deploy-pages.sh | deploy-pages.sh does NOT use the old project name (without -git suffix) | reference_pages_production_project.md

# --- PII / Security guard ---
P01 | pii-guard | test -x .claude/hooks/agent-pii-guard.py | PII guard script is executable | feedback_pii_guard_always.md
P02 | pii-guard | python3 .claude/hooks/agent-pii-guard.py --help > /dev/null 2>&1 || python3 .claude/hooks/agent-pii-guard.py /dev/null > /dev/null 2>&1; test $? -le 1 | PII guard script is runnable (exits 0 or 1, not crash) | feedback_pii_guard_always.md

# --- .gitignore ---
G01 | gitignore | grep -q '^\.env$' .gitignore | .env is gitignored | (none)
G02 | gitignore | grep -q '\.playwright-mcp' .gitignore | Playwright MCP output dir is gitignored (screenshot PII guard) | feedback_no_screenshot_commits.md

# --- Env var naming ---
E01 | env-vars | grep -q 'AIRTABLE_PAT' api/src/lib/types.ts | Workers runtime uses AIRTABLE_PAT (not AIRTABLE_API_KEY) | feedback_env_var_names.md

# --- Admin UI cache-busting ---
A01 | admin-ui | grep -q 'script\.js?v=' frontend/admin/index.html | admin index.html has cache-bust version on script.js | feedback_admin_script_cache_bust.md
