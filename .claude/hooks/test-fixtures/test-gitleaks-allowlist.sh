#!/usr/bin/env bash
# Regression test for gitleaks issue-1790 — allowlist must NOT poison subsequent
# matches in the same file scope. Reads split fragments from the fixture,
# concatenates into a temp file, scans it. Test passes if gitleaks reports the
# synthetic leak (allowlist did not swallow it).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
FIXTURE=".claude/hooks/test-fixtures/gitleaks-allowlist-bypass.md"
[ -f "$FIXTURE" ] || { echo "missing $FIXTURE"; exit 2; }

# Source the fragments
ALLOW=$(grep '^ALLOWLISTED_LINE=' "$FIXTURE" | cut -d= -f2-)
PREFIX=$(grep '^LEAK_PREFIX=' "$FIXTURE" | cut -d= -f2-)
SUFFIX=$(grep '^LEAK_SUFFIX=' "$FIXTURE" | cut -d= -f2-)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
{
  echo "Allowlisted reference: $ALLOW"
  echo "Real fake leak: ${PREFIX}${SUFFIX}"
} > "$TMP/test.md"

# Locate the gitleaks binary — try PATH first, then pre-commit cache
GITLEAKS_BIN=""
if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS_BIN="gitleaks"
elif [ -x "$HOME/.cache/pre-commit/repovq6xyptc/golangenv-default/bin/gitleaks.exe" ]; then
  GITLEAKS_BIN="$HOME/.cache/pre-commit/repovq6xyptc/golangenv-default/bin/gitleaks.exe"
else
  CACHED=$(find "$HOME/.cache/pre-commit" -name "gitleaks*" -type f -executable 2>/dev/null | head -1)
  [ -n "$CACHED" ] && GITLEAKS_BIN="$CACHED"
fi
[ -n "$GITLEAKS_BIN" ] || { echo "gitleaks binary not found (PATH or pre-commit cache)"; exit 2; }

# Run gitleaks against the assembled file
RC=0
"$GITLEAKS_BIN" detect --no-git --config .gitleaks.toml \
  --source "$TMP" --redact --report-path /dev/null >/dev/null 2>&1 || RC=$?

if [ "$RC" -ne 0 ]; then
  echo "✓ PASS — gitleaks detected the synthetic leak (allowlist did not poison)"
  exit 0
else
  echo "✗ FAIL — gitleaks missed the synthetic leak; allowlist swallowed it (issue-1790)"
  echo "Tighten the [allowlist] regex (anchor with ^\\s* or use regexTarget=match)"
  exit 1
fi
