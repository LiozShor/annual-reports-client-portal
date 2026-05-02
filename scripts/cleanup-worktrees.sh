#!/usr/bin/env bash
# Clean up stale claude-session-* worktrees and merged branches.
#
# Modes:
#   (no flag)     interactive — lists what would be done, asks before destructive ops
#   --safe        non-interactive, only deletes branches strictly merged into main
#                 + removes their worktrees (no -D force, no remote-deleted bypass)
#   --aggressive  non-interactive, also deletes branches merged into HEAD whose
#                 upstream was deleted (uses git branch -D when -d refuses)
#   --dry-run     prints what each mode would do, changes nothing
#   --quiet       suppresses informational output (errors still printed)
#
# Usage from anywhere in repo:
#   bash scripts/cleanup-worktrees.sh            # interactive
#   bash scripts/cleanup-worktrees.sh --safe     # for hooks / claude-worktree.bat
#   bash scripts/cleanup-worktrees.sh --aggressive --dry-run

set -euo pipefail

MODE="interactive"
DRY_RUN=0
QUIET=0

for arg in "$@"; do
  case "$arg" in
    --safe)        MODE="safe" ;;
    --aggressive)  MODE="aggressive" ;;
    --dry-run)     DRY_RUN=1 ;;
    --quiet)       QUIET=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log() { [ "$QUIET" -eq 1 ] || echo "$@"; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "  [dry-run] $*"
  else
    eval "$@"
  fi
}

# Move to repo root (this script lives in scripts/, repo root is parent).
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not in a git repo" >&2; exit 1; }

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"

# ---- 1. Refresh remote state -----------------------------------------------
log "[cleanup] git fetch --prune origin..."
[ "$DRY_RUN" -eq 0 ] && git fetch --prune origin >/dev/null 2>&1 || true

# ---- 2. Identify session worktrees -----------------------------------------
mapfile -t SESSION_WORKTREES < <(
  git worktree list --porcelain \
    | awk '/^worktree / {print $2}' \
    | grep -E '/claude-session-[0-9]+-[0-9]+$' || true
)

if [ ${#SESSION_WORKTREES[@]} -eq 0 ]; then
  log "[cleanup] no claude-session-* worktrees"
else
  log "[cleanup] found ${#SESSION_WORKTREES[@]} session worktree(s)"
fi

# ---- 3. Per-worktree triage ------------------------------------------------
KEEP=()
REMOVE=()
for wt in "${SESSION_WORKTREES[@]}"; do
  name="$(basename "$wt")"
  # Get the branch attached to this worktree
  branch="$(git -C "$wt" branch --show-current 2>/dev/null || echo '')"
  [ -z "$branch" ] && { KEEP+=("$wt (no branch — detached?)"); continue; }
  # Skip the current session's own worktree
  if [ "$branch" = "$CURRENT_BRANCH" ]; then
    KEEP+=("$wt (current session)"); continue
  fi
  # Is the branch merged into origin/main?
  if git merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
    REMOVE+=("$wt|$branch|merged")
  elif [ "$MODE" = "aggressive" ] && git merge-base --is-ancestor "$branch" HEAD 2>/dev/null; then
    REMOVE+=("$wt|$branch|merged-to-HEAD")
  else
    KEEP+=("$wt → $branch (UNMERGED)")
  fi
done

# ---- 4. Show plan ----------------------------------------------------------
if [ ${#REMOVE[@]} -gt 0 ]; then
  log "[cleanup] worktrees to remove (${#REMOVE[@]}):"
  for entry in "${REMOVE[@]}"; do log "  - ${entry//|/ — }"; done
fi
if [ ${#KEEP[@]} -gt 0 ]; then
  log "[cleanup] keeping (${#KEEP[@]}):"
  for entry in "${KEEP[@]}"; do log "  - $entry"; done
fi

# ---- 5. Interactive confirm -----------------------------------------------
if [ "$MODE" = "interactive" ] && [ ${#REMOVE[@]} -gt 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  read -r -p "Proceed with removal? [y/N] " ans
  case "$ans" in [yY]*) ;; *) echo "Aborted."; exit 0 ;; esac
fi

# ---- 6. Remove worktrees ---------------------------------------------------
for entry in "${REMOVE[@]}"; do
  IFS='|' read -r wt _branch _reason <<<"$entry"
  log "[cleanup] removing worktree $wt"
  run "git worktree remove --force \"$wt\" 2>&1 || rm -rf \"$wt\""
done

# ---- 7. Prune stale .git/worktrees admin dirs ------------------------------
log "[cleanup] git worktree prune..."
run "git worktree prune 2>&1 | grep -v 'Permission denied' || true"

# ---- 8. Delete merged branches (excluding those still-in-worktree) ---------
mapfile -t MERGED < <(
  git branch --merged origin/main \
    | sed 's/^[ *+]*//' \
    | grep -vE '^(main|master)$' || true
)

DELETED=0
SKIPPED=0
for b in "${MERGED[@]}"; do
  [ -z "$b" ] && continue
  [ "$b" = "$CURRENT_BRANCH" ] && continue
  # Skip if branch is checked out by any worktree
  if git worktree list --porcelain | awk '/^branch /{print $2}' | grep -qx "refs/heads/$b"; then
    continue
  fi
  log "[cleanup] git branch -d $b"
  # </dev/null prevents git from prompting "Should I try again? (y/n)" on
  # Windows when ref dir deletion is blocked by a file lock.
  if run "git branch -d \"$b\" </dev/null 2>&1"; then
    DELETED=$((DELETED+1))
  fi
done

# ---- 9. Aggressive: -D for branches merged-to-HEAD but stale-upstream ------
if [ "$MODE" = "aggressive" ]; then
  mapfile -t HEAD_MERGED < <(
    git branch --merged HEAD \
      | sed 's/^[ *+]*//' \
      | grep -vE '^(main|master)$' || true
  )
  for b in "${HEAD_MERGED[@]}"; do
    [ -z "$b" ] && continue
    [ "$b" = "$CURRENT_BRANCH" ] && continue
    git worktree list --porcelain | awk '/^branch /{print $2}' | grep -qx "refs/heads/$b" && continue
    log "[cleanup] git branch -D $b (force, merged to HEAD only)"
    if run "git branch -D \"$b\" </dev/null 2>&1"; then
      DELETED=$((DELETED+1))
    fi
  done
fi

log "[cleanup] done — removed ${#REMOVE[@]} worktree(s), deleted $DELETED branch(es)"
