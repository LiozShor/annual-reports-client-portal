#!/usr/bin/env bash
# scripts/setup-worktree.sh
#
# Bootstraps a fresh git worktree by:
#   1. Hardlinking api/node_modules/ from the main worktree (instant, ~0 disk cost on NTFS)
#   2. Copying gitignored secret files (.env, .mcp.json, api/.dev.vars)
#   3. Auto-cleaning stale worktrees (age-only policy — see Phase 2 comment)
#
# Runs automatically via:
#   - claude-worktree.bat (manual worktree creation on Windows)
#
# Safe to re-run: skips work if already done. Falls back to `npm install` if lockfiles drift.
#
# Phase 2 policy (DIVERGES from pre-rollback version):
#   Old policy: remove if BOTH (branch merged into default) AND (age >= 6h).
#   New policy: remove if (age >= 12h) AND (no uncommitted changes).
#   Merge status is NOT checked — worktrees may be on unmerged branches but still
#   abandoned. The dirty check is the safety guard against data loss.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Resolve paths

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[setup-worktree] not inside a git repo, nothing to do"
  exit 0
fi

# Main worktree = first entry in `git worktree list` (the non-linked checkout)
MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
CURRENT=$(git rev-parse --show-toplevel)

# Detect default branch (main or master)
DEFAULT_BRANCH=$(git -C "$MAIN" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || echo "")
if [ -z "$DEFAULT_BRANCH" ]; then
  if git -C "$MAIN" show-ref --verify --quiet refs/heads/main; then
    DEFAULT_BRANCH="main"
  elif git -C "$MAIN" show-ref --verify --quiet refs/heads/master; then
    DEFAULT_BRANCH="master"
  else
    DEFAULT_BRANCH="main"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# Phase 1: Per-worktree setup (only if we're in a worktree, not main)

if [ "$MAIN" = "$CURRENT" ]; then
  echo "[setup-worktree] in main worktree, skipping per-worktree setup"
else
  echo "[setup-worktree] main:    $MAIN"
  echo "[setup-worktree] current: $CURRENT"

  # Hardlink api/node_modules from main (if lockfiles match)
  if [ -d "$MAIN/api/node_modules" ] && [ ! -d "$CURRENT/api/node_modules" ] && [ -f "$CURRENT/api/package.json" ]; then
    lockfiles_match=0
    if [ -f "$MAIN/api/package-lock.json" ] && [ -f "$CURRENT/api/package-lock.json" ]; then
      if cmp -s "$MAIN/api/package-lock.json" "$CURRENT/api/package-lock.json"; then
        lockfiles_match=1
      fi
    fi

    if [ "$lockfiles_match" = "1" ]; then
      echo "[setup-worktree] hardlinking api/node_modules from main (lockfiles match)..."
      # cp -al = archive + hardlink. Works on Windows Git Bash + NTFS.
      if cp -al "$MAIN/api/node_modules" "$CURRENT/api/node_modules" 2>/dev/null; then
        count=$(find "$CURRENT/api/node_modules" -maxdepth 2 -type f 2>/dev/null | wc -l)
        echo "[setup-worktree] ✓ hardlinked api/node_modules (~$count files, ~0 disk cost)"
      else
        echo "[setup-worktree] hardlink failed, falling back to npm install"
        (cd "$CURRENT/api" && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3)
      fi
    else
      echo "[setup-worktree] lockfiles differ or missing, running npm install..."
      (cd "$CURRENT/api" && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3)
    fi
  elif [ -d "$CURRENT/api/node_modules" ]; then
    echo "[setup-worktree] api/node_modules already present, skipping"
  fi

  # Copy gitignored secret files from main
  for f in .env .mcp.json api/.dev.vars; do
    if [ -f "$MAIN/$f" ] && [ ! -f "$CURRENT/$f" ]; then
      mkdir -p "$CURRENT/$(dirname "$f")"
      cp "$MAIN/$f" "$CURRENT/$f" && echo "[setup-worktree] ✓ copied $f"
    fi
  done
fi

# ──────────────────────────────────────────────────────────────────────────────
# Phase 2: Stale worktree cleanup (runs regardless of where we are)
#
# POLICY (diverges from pre-rollback which required merged+age):
#   Remove a worktree when BOTH are true:
#   (a) worktree directory is older than MIN_AGE_HOURS (12h)
#   (b) worktree has no uncommitted changes (working tree is clean)
#
#   Merge status is NOT checked — worktrees may be on unmerged branches but still
#   stale (abandoned sessions). The dirty check is the safety guard.
#
#   Windows caveat: git worktree remove may fail with a file-lock error if another
#   terminal has the directory open. Close the other session first and re-run.
#
# Never touches:
#   - the current worktree
#   - the main worktree
#   - dirty worktrees (uncommitted changes of any kind)
#   - worktrees newer than MIN_AGE_HOURS

MIN_AGE_HOURS=12
now_epoch=$(date +%s)
min_age_seconds=$((MIN_AGE_HOURS * 3600))

echo "[setup-worktree] scanning for stale worktrees (min-age: ${MIN_AGE_HOURS}h)..."

removed_count=0
kept_dirty=()
kept_too_young=()

while IFS= read -r p; do
  [ -z "$p" ] && continue
  [ "$p" = "$CURRENT" ] && continue
  [ "$p" = "$MAIN" ] && continue
  [ ! -d "$p" ] && continue  # dir already gone; let prune handle metadata

  # Get the branch checked out in this worktree
  br=$(git -C "$p" branch --show-current 2>/dev/null || echo "")
  [ -z "$br" ] && continue
  [ "$br" = "$DEFAULT_BRANCH" ] && continue

  # Criterion 1 (REQUIRED): no uncommitted changes?
  # Check unstaged, staged, and untracked files.
  if ! git -C "$p" diff --quiet 2>/dev/null \
     || ! git -C "$p" diff --cached --quiet 2>/dev/null \
     || [ -n "$(git -C "$p" ls-files --others --exclude-standard 2>/dev/null)" ]; then
    kept_dirty+=("$p ($br, has uncommitted changes)")
    continue
  fi

  # Criterion 2 (REQUIRED): worktree dir is older than MIN_AGE_HOURS?
  # Use mtime of the .git file inside the worktree as a proxy for last activity.
  mtime_marker="$p/.git"
  [ ! -e "$mtime_marker" ] && mtime_marker="$p"
  mtime_epoch=$(stat -c %Y "$mtime_marker" 2>/dev/null || stat -f %m "$mtime_marker" 2>/dev/null || echo "$now_epoch")
  age_seconds=$((now_epoch - mtime_epoch))

  if [ "$age_seconds" -lt "$min_age_seconds" ]; then
    age_hours=$((age_seconds / 3600))
    kept_too_young+=("$p ($br, clean but only ${age_hours}h old)")
    continue
  fi

  # Both criteria met — safe to remove
  echo "[setup-worktree] removing stale worktree: $p ($br) [$((age_seconds / 3600))h old, clean]"
  if git -C "$MAIN" worktree remove --force "$p" 2>/dev/null; then
    git -C "$MAIN" branch -D "$br" 2>/dev/null || true
    git -C "$MAIN" push origin --delete "$br" 2>/dev/null || true
    removed_count=$((removed_count + 1))
  else
    echo "[setup-worktree]   ! git worktree remove failed (file-locked by another session?), skipping"
  fi
done < <(git -C "$MAIN" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')

# Prune orphaned worktree metadata (entries pointing to deleted directories)
git -C "$MAIN" worktree prune 2>/dev/null || true

if [ "$removed_count" -gt 0 ]; then
  echo "[setup-worktree] ✓ cleaned $removed_count stale worktree(s)"
fi

if [ "${#kept_dirty[@]}" -gt 0 ]; then
  echo "[setup-worktree] kept worktrees with uncommitted changes:"
  for w in "${kept_dirty[@]}"; do
    echo "[setup-worktree]   - $w"
  done
fi

if [ "${#kept_too_young[@]}" -gt 0 ]; then
  echo "[setup-worktree] kept recently-active worktrees (wait until older than ${MIN_AGE_HOURS}h):"
  for w in "${kept_too_young[@]}"; do
    echo "[setup-worktree]   - $w"
  done
fi

echo "[setup-worktree] done"
