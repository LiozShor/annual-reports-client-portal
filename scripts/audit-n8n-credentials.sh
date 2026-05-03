#!/usr/bin/env bash
# audit-n8n-credentials.sh — Layer 9 of the 2026-05-02 prevention work.
#
# Purpose: detect drift between secrets declared in n8n workflows (Code-node
# literals AND Credential-store entries) and the Worker / Airtable / Anthropic
# providers they're supposed to authenticate against. Run after any rotation
# OR weekly as a smoke test.
#
# Exit codes:
#   0 = all probes succeeded
#   1 = drift detected (one or more probes failed)
#   2 = environment / setup error
#
# Outputs a one-line summary per probe + a final tally.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "must be run inside the repo"; exit 2; }

# Source .env so we have N8N_API_KEY, AIRTABLE_API_KEY, ANTHROPIC_API_KEY, etc.
# shellcheck disable=SC1091
source ./.env 2>/dev/null || { echo "ERR: cannot source ./.env"; exit 2; }

PASS=0
FAIL=0

probe() {
  local name="$1"; shift
  local expected_code="$1"; shift
  local got
  got=$("$@" 2>/dev/null)
  if [ "$got" = "$expected_code" ]; then
    echo "✓ $name (HTTP $got)"
    PASS=$((PASS + 1))
  else
    echo "✗ $name (HTTP $got, expected $expected_code)"
    FAIL=$((FAIL + 1))
  fi
}

curl_status() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

echo "=== n8n credential drift audit ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ==="

# ── n8n API itself ──
probe "n8n API reachable + API key valid" \
  "200" curl_status -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "${N8N_API_URL:-https://liozshor.app.n8n.cloud}/api/v1/workflows?limit=1"

# ── Worker → /webhook/process-inbound-email with current N8N_INTERNAL_KEY ──
probe "Worker accepts current N8N_INTERNAL_KEY (Bearer)" \
  "202" curl_status -X POST \
    "https://annual-reports-api.liozshor1.workers.dev/webhook/process-inbound-email" \
    -H "Authorization: Bearer $N8N_INTERNAL_KEY" \
    -H "Content-Type: application/json" \
    -d '{"message_id":"AUDIT_PROBE_'"$(date +%s)"'","change_type":"created"}'

# ── Airtable PAT #1 (.env AIRTABLE_API_KEY) ──
probe "Airtable PAT #1 valid (read reports table)" \
  "200" curl_status \
    "https://api.airtable.com/v0/${BASE_ID:-appqBL5RWQN9cPOyh}/tbls7m3hmHC4hhQVy?maxRecords=1" \
    -H "Authorization: Bearer $AIRTABLE_API_KEY"

# ── Anthropic key (.env ANTHROPIC_API_KEY) ──
probe "Anthropic API key valid" \
  "200" curl_status -X POST "https://api.anthropic.com/v1/messages" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'

# ── Negative tests: stale values are revoked. Each known-rotated old value
# should be REJECTED. If any return 200/202, the provider didn't actually
# revoke and the leak is still live.
#
# Old values are NOT hardcoded here — even revoked, full-length tokens trip
# GitHub Push Protection / gitleaks / ggshield. Operator passes them via
# OLD_N8N_KEY / OLD_AIRTABLE_PAT_1 / OLD_ANTHROPIC_KEY env vars at run-time
# (typically sourced from a local `.env.audit-old-values` file — gitignored).
# Each negative test is skipped if its env var isn't set.
echo
echo "=== negative tests (old values must be rejected; skipped if not provided) ==="

if [ -n "${OLD_N8N_KEY:-}" ]; then
  probe "OLD N8N_INTERNAL_KEY rejected (Worker)" \
    "401" curl_status -X POST \
      "https://annual-reports-api.liozshor1.workers.dev/webhook/process-inbound-email" \
      -H "Authorization: Bearer ${OLD_N8N_KEY}" \
      -H "Content-Type: application/json" -d '{}'
else
  echo "○ SKIP — OLD_N8N_KEY env var not set"
fi

if [ -n "${OLD_AIRTABLE_PAT_1:-}" ]; then
  probe "OLD Airtable PAT #1 rejected" \
    "401" curl_status \
      "https://api.airtable.com/v0/${BASE_ID:-appqBL5RWQN9cPOyh}/tbls7m3hmHC4hhQVy?maxRecords=1" \
      -H "Authorization: Bearer ${OLD_AIRTABLE_PAT_1}"
else
  echo "○ SKIP — OLD_AIRTABLE_PAT_1 env var not set"
fi

if [ -n "${OLD_ANTHROPIC_KEY:-}" ]; then
  probe "OLD Anthropic key rejected" \
    "401" curl_status -X POST "https://api.anthropic.com/v1/messages" \
      -H "x-api-key: ${OLD_ANTHROPIC_KEY}" \
      -H "anthropic-version: 2023-06-01" \
      -H "Content-Type: application/json" \
      -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
else
  echo "○ SKIP — OLD_ANTHROPIC_KEY env var not set"
fi

# ── n8n workflow drift — every active workflow's credential refs ──
echo
echo "=== n8n workflow credential references (drift signal) ==="
curl -s "${N8N_API_URL:-https://liozshor.app.n8n.cloud}/api/v1/workflows?limit=100" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  | node -e "
    const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const seen=new Map();
    for (const w of d.data) {
      if (w.isArchived) continue;
      // print one line per workflow with credential summary; details fetched below
      seen.set(w.id, w.name);
    }
    process.stdout.write([...seen.entries()].map(([id,n])=>id+':'+n).join('\n'));
  " 2>/dev/null \
  | while IFS=: read -r wid wname; do
      [ -z "$wid" ] && continue
      creds=$(curl -s "${N8N_API_URL:-https://liozshor.app.n8n.cloud}/api/v1/workflows/$wid" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        | node -e "
            const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
            const seen=new Set();
            function walk(o){if(!o||typeof o!=='object')return;
              if(Array.isArray(o)){o.forEach(walk);return;}
              for(const k of Object.keys(o)){
                if(k==='credentials'&&typeof o[k]==='object'){
                  for(const t of Object.keys(o[k])){
                    const c=o[k][t];if(c&&c.id)seen.add(t+':'+c.id);
                  }
                } else walk(o[k]);
              }
            }
            walk(d);
            console.log([...seen].join(','));
          " 2>/dev/null)
      [ -n "$creds" ] && echo "  $wname → $creds"
    done

# ── Final tally ──
echo
echo "=== summary ==="
echo "passed: $PASS   failed: $FAIL"

# ── gitleaks allowlist-bypass regression test ──
echo
echo "=== gitleaks allowlist-bypass regression test ==="
bash .claude/hooks/test-fixtures/test-gitleaks-allowlist.sh

# ── informational paranoid scan (working tree, including gitignored) ──
echo
echo "=== gitleaks working-tree paranoid scan (--no-git) — informational ==="
GITLEAKS_BIN=$(command -v gitleaks || \
  find "$HOME/.cache/pre-commit" -name "gitleaks*" -type f -executable 2>/dev/null | head -1)
if [ -n "$GITLEAKS_BIN" ]; then
  "$GITLEAKS_BIN" detect --no-git --config .gitleaks.toml --redact 2>&1 \
    | grep -E '(scanned|leaks|no leaks)' | tail -3 \
    || echo "(informational — gitignored or untracked secrets detected; review)"
else
  echo "(skip — gitleaks binary not found)"
fi

[ "$FAIL" -eq 0 ] || exit 1
exit 0
