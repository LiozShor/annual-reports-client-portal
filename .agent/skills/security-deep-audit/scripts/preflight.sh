#!/usr/bin/env bash
# preflight.sh — verify environment for /security-deep-audit
#
# Exits:
#   0 = ready
#   2 = environment error (missing tool / wrong cwd / unsourceable .env)
#
# Prints one line per check. STOP on first failure — partial-runs hide gaps.
set -uo pipefail

CANONICAL="C:/Users/liozm/Desktop/moshe/annual-reports"
ERR=0

ok()   { printf "OK   %s\n" "$1"; }
fail() { printf "FAIL %s\n" "$1"; ERR=1; }
warn() { printf "WARN %s\n" "$1"; }

# 1. Canonical clone (Git Bash-friendly path comparison)
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
TOPLEVEL_NORM=$(echo "$TOPLEVEL" | sed 's|\\|/|g')
CANONICAL_NORM=$(echo "$CANONICAL" | sed 's|\\|/|g')
if [ -z "$TOPLEVEL_NORM" ]; then
  fail "not inside a git repo"
elif [ "$(echo "$TOPLEVEL_NORM" | tr '[:upper:]' '[:lower:]')" != "$(echo "$CANONICAL_NORM" | tr '[:upper:]' '[:lower:]')" ]; then
  fail "must run from canonical clone $CANONICAL — current toplevel: $TOPLEVEL_NORM"
else
  ok "canonical clone confirmed"
fi

# 2. .env sourceable (don't print contents)
if [ -f "$CANONICAL/.env" ]; then
  if ( set +u; source "$CANONICAL/.env" ) 2>/dev/null; then
    ok ".env is sourceable"
  else
    fail ".env exists but cannot be sourced"
  fi
else
  fail ".env missing at $CANONICAL/.env"
fi

# 3. Required CLIs (direct, then npx, then pre-commit fallback for gitleaks)
have_cmd() {
  local c="$1"
  command -v "$c" >/dev/null 2>&1
}
have_npx() {
  local c="$1"
  ( cd "$CANONICAL" && npx --no-install "$c" --version ) >/dev/null 2>&1
}
have_precommit_hook() {
  local h="$1"
  [ -f "$CANONICAL/.pre-commit-config.yaml" ] && grep -q "$h" "$CANONICAL/.pre-commit-config.yaml"
}
for cmd in git gh jq curl; do
  if have_cmd "$cmd"; then ok "$cmd installed"; else fail "$cmd missing — install"; fi
done
if have_cmd wrangler; then ok "wrangler installed (system)"
elif have_npx wrangler; then ok "wrangler available via npx"
else fail "wrangler missing — install via npm or run inside api/ where it's vendored"; fi
if have_cmd gitleaks; then ok "gitleaks installed (system)"
elif have_npx gitleaks; then ok "gitleaks available via npx"
elif have_precommit_hook gitleaks; then ok "gitleaks available via pre-commit framework"
else fail "gitleaks missing — install or wire via pre-commit"; fi

# 4. gh auth
if gh auth status >/dev/null 2>&1; then
  ok "gh authenticated"
else
  fail "gh not authenticated — run: gh auth login"
fi

# 5. Wrangler config readable
if [ -f "$CANONICAL/api/wrangler.toml" ]; then
  ok "api/wrangler.toml present"
else
  fail "api/wrangler.toml missing"
fi

# 6. .gitleaks.toml present (Phase-2 prevention layer)
if [ -f "$CANONICAL/.gitleaks.toml" ]; then
  ok ".gitleaks.toml present"
else
  warn ".gitleaks.toml missing — category 1 will use gitleaks defaults only"
fi

# 7. audit-n8n-credentials.sh present (category 3 wraps it)
if [ -f "$CANONICAL/scripts/audit-n8n-credentials.sh" ]; then
  ok "scripts/audit-n8n-credentials.sh present"
else
  fail "scripts/audit-n8n-credentials.sh missing — required for category 3"
fi

# 8. .agent/audits/ writable
mkdir -p "$CANONICAL/.agent/audits" 2>/dev/null
if [ -w "$CANONICAL/.agent/audits" ]; then
  ok ".agent/audits writable"
else
  fail ".agent/audits not writable"
fi

# 9. Working tree not catastrophically dirty (warn, don't fail — audit is read-only)
DIRTY=$(cd "$CANONICAL" && git status --porcelain | wc -l)
if [ "$DIRTY" -gt 50 ]; then
  warn "working tree has $DIRTY pending changes — large deltas may slow scans"
fi

# 10. Optional creds (informational — categories that need them will SKIP if missing)
( set +u; source "$CANONICAL/.env" 2>/dev/null
  for v in N8N_API_KEY ANTHROPIC_API_KEY MS_GRAPH_ACCESS_TOKEN AIRTABLE_API_KEY R2_ACCESS_KEY_ID; do
    val=$(eval echo \"\${$v:-}\")
    if [ -n "$val" ]; then
      ok "$v present in .env"
    else
      warn "$v missing in .env — categories needing it will mark SKIPPED"
    fi
  done
)

if [ "$ERR" -ne 0 ]; then
  echo
  echo "Pre-flight FAILED. Fix the above before running /security-deep-audit."
  exit 2
fi

echo
echo "Pre-flight OK."
exit 0
