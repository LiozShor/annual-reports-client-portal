#!/usr/bin/env bash
# .claude/workflows/deploy-worker.sh
# Deploy the Cloudflare Worker from api/.
#
# Usage: bash .claude/workflows/deploy-worker.sh [--dry-run]
#
# Key rules enforced:
#   - Always passes -c wrangler.toml (avoids autoconfig hijack in worktrees)
#   - Always clears CLOUDFLARE_API_TOKEN before wrangler (stale token causes code 10000)

set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [ ! -f ./.env ]; then
  echo "ERROR: .env not found at repo root ($REPO_ROOT)" >&2
  exit 1
fi
# shellcheck disable=SC1091
source ./.env

if $DRY_RUN; then
  echo "[dry-run] Would run from: $REPO_ROOT/api"
  echo "[dry-run] CLOUDFLARE_API_TOKEN=\"\" npx wrangler deploy -c wrangler.toml"
  echo "[dry-run] Then verify: curl https://annual-reports-api.liozshor1.workers.dev/health"
  exit 0
fi

echo "→ Deploying Worker from api/"
cd "$REPO_ROOT/api"

CLOUDFLARE_API_TOKEN="" npx wrangler deploy -c wrangler.toml

echo "→ Verifying health endpoint..."
HTTP_STATUS="$(curl -s -o /dev/null -w "%{http_code}" https://annual-reports-api.liozshor1.workers.dev/health)"
if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Worker live (health endpoint: 200)"
else
  echo "⚠️  Health endpoint returned $HTTP_STATUS — check Worker logs" >&2
  exit 2
fi
