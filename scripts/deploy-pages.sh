#!/usr/bin/env bash
# Deploy frontend to Cloudflare Pages production project.
#
# IMPORTANT: docs.moshe-atsits.com is bound to `annual-reports-client-portal-git`,
# NOT the old `annual-reports-client-portal` project (DL-368 cutover, 2026-04-28).
# Deploying to the old project succeeds silently but does NOT reach the live domain.
#
# Usage: bash scripts/deploy-pages.sh ["commit message"]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Load CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
if [ ! -f ./.env ]; then
  echo "ERROR: .env not found at repo root" >&2
  exit 1
fi
# shellcheck disable=SC1091
source ./.env

PROJECT="annual-reports-client-portal-git"
COMMIT_HASH="$(git rev-parse HEAD)"
COMMIT_MSG="${1:-$(git log -1 --pretty=%s)}"

echo "→ Deploying frontend/ to Pages project: $PROJECT"
npx wrangler pages deploy frontend \
  --project-name="$PROJECT" \
  --branch=main \
  --commit-hash="$COMMIT_HASH" \
  --commit-message="$COMMIT_MSG" \
  --commit-dirty=true

# Verify the live domain picked up the deploy
echo "→ Waiting 8s for domain propagation..."
sleep 8
LIVE_VER="$(curl -s https://docs.moshe-atsits.com/admin/ | grep -oE 'script\.js\?v=[0-9]+' | head -1)"
LOCAL_VER="$(grep -oE 'script\.js\?v=[0-9]+' frontend/admin/index.html | head -1)"
echo "→ Live: $LIVE_VER  |  Local: $LOCAL_VER"
if [ "$LIVE_VER" = "$LOCAL_VER" ]; then
  echo "✅ Domain serving the new build."
else
  echo "⚠️  Mismatch — domain may still be propagating, or deploy went to wrong project."
  exit 2
fi
