#!/usr/bin/env bash
# .claude/workflows/merge-and-push.sh
# FF-merge a feature branch to main, push, optionally deploy Worker and Pages.
#
# Usage: bash .claude/workflows/merge-and-push.sh <branch>
#
# Safety: must run from the canonical clone (not a session worktree).
# Worker and Pages do NOT auto-deploy on push — prompts are required.

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
die()  { echo -e "${RED}ERROR: $*${NC}" >&2; exit 1; }
info() { echo -e "${CYAN}>> $*${NC}"; }
ok()   { echo -e "${GREEN}✔ $*${NC}"; }
warn() { echo -e "${YELLOW}WARN: $*${NC}"; }

[[ $# -lt 1 ]] && die "Usage: $0 <branch-name>"
BRANCH="$1"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Canonical-clone guard — never checkout main from a session worktree
CANONICAL_PATH="$(git worktree list | head -1 | awk '{print $1}')"
normalise() { echo "$1" | tr '\\' '/' | sed 's|/$||' | tr '[:upper:]' '[:lower:]'; }
CANONICAL_NORM="$(normalise "$CANONICAL_PATH")"
CURRENT_NORM="$(normalise "$REPO_ROOT")"
if [[ "$CURRENT_NORM" != "$CANONICAL_NORM" ]]; then
  die "Must run from the canonical clone.\n  Expected: $CANONICAL_PATH\n  Current:  $REPO_ROOT\n\nAlternatively: git push origin $BRANCH:main (FF-only push, skips checkout)"
fi
ok "Canonical clone confirmed"

# Branch existence check
git rev-parse --verify "refs/heads/$BRANCH" > /dev/null 2>&1 \
  || die "Branch '$BRANCH' does not exist locally."

# Fast-forward pre-check
if ! git merge-base --is-ancestor main "$BRANCH" 2>/dev/null; then
  die "Branch '$BRANCH' cannot be fast-forwarded onto main. Rebase first."
fi
ok "Fast-forward check passed"

# Checkout + merge + push
info "Checking out main..."; git checkout main; ok "On main"
info "Merging '$BRANCH'..."; git merge --ff-only "$BRANCH"; ok "Merged"
info "Pushing..."; git push origin main; ok "Pushed origin/main"

# Optional deploys
DEPLOYED_WORKER=false; DEPLOYED_PAGES=false

echo ""
read -r -p "Deploy Worker? (y/N) " ANS_W
if [[ "${ANS_W,,}" == "y" ]]; then
  info "Deploying Worker..."
  bash "$REPO_ROOT/.claude/workflows/deploy-worker.sh"
  DEPLOYED_WORKER=true; ok "Worker deployed"
else
  warn "Worker deploy skipped — Worker does NOT auto-deploy on push."
fi

echo ""
read -r -p "Deploy Pages? (y/N) " ANS_P
if [[ "${ANS_P,,}" == "y" ]]; then
  info "Deploying Pages..."
  bash "$REPO_ROOT/scripts/deploy-pages.sh" "merge $BRANCH"
  DEPLOYED_PAGES=true; ok "Pages deployed"
else
  warn "Pages deploy skipped — git integration broken (DL-368), must deploy manually."
fi

# Summary
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━ Summary ━━━━━━━━━━━━━${NC}"
echo -e "  Branch : ${CYAN}$BRANCH${NC} → main (FF)"
echo -e "  Push   : origin/main ✔"
echo -e "  Worker : $([ "$DEPLOYED_WORKER" = true ] && echo "${GREEN}deployed${NC}" || echo "${YELLOW}skipped${NC}")"
echo -e "  Pages  : $([ "$DEPLOYED_PAGES"  = true ] && echo "${GREEN}deployed${NC}" || echo "${YELLOW}skipped${NC}")"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
