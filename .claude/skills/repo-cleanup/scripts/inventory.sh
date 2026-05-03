#!/usr/bin/env bash
# repo-cleanup Phase 2 inventory — read-only.
# Prints annotated tables of local branches, remote branches, and worktrees.
# Run from canonical clone: C:/Users/liozm/Desktop/moshe/annual-reports

set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "ERR: not a git repo"; exit 1; }

CANONICAL="C:/Users/liozm/Desktop/moshe/annual-reports"
[[ "$(pwd -W 2>/dev/null || pwd)" == "$CANONICAL" ]] || \
  echo "WARN: not in canonical clone ($CANONICAL) — output may be misleading"

echo "=== Untracked files in canonical clone ==="
git status --short | grep '^??' || echo "  (none)"
echo

echo "=== Worktrees ==="
git worktree list | while read -r line; do
  path=$(echo "$line" | awk '{print $1}')
  if [[ "$path" == "$CANONICAL" ]] || [[ "$path" == *"/.codex/"* ]]; then
    echo "  $line  [skip]"
    continue
  fi
  if [[ ! -d "$path" ]]; then
    echo "  $line  [PRUNABLE: dir gone]"
    continue
  fi
  dirty=$(git -C "$path" status --porcelain 2>/dev/null)
  if [[ -z "$dirty" ]]; then
    echo "  $line  [clean]"
  else
    cnt=$(echo "$dirty" | wc -l)
    pii_only=$(echo "$dirty" | grep -vE '^\?\? (docs/Samples|docs/templates|docs/Meeting With Natan|docs/.+\.(xlsx?|docx?))' | wc -l)
    if [[ "$pii_only" -eq 0 ]]; then
      echo "  $line  [orphan-PII-only ($cnt files)]"
    else
      echo "  $line  [DIRTY: $cnt files, $pii_only non-PII]"
    fi
  fi
done
echo

echo "=== Local branches ==="
current=$(git branch --show-current)
git for-each-ref --format='%(refname:short)|%(upstream:short)|%(upstream:track)' refs/heads/ | while IFS='|' read -r br upstream track; do
  [[ "$br" == "$current" ]] && marker='*' || marker=' '
  merged=$(git merge-base --is-ancestor "$br" main 2>/dev/null && echo "merged-in-main" || echo "ahead-of-main")
  echo "  $marker $br  ($merged) upstream=${upstream:-none} ${track}"
done
echo

echo "=== Remote branches not on main (patch-id check) ==="
git for-each-ref --format='%(refname:short)' refs/remotes/origin/ | grep -v 'origin/HEAD\|origin/main$' | while read -r ref; do
  name="${ref#origin/}"
  if git merge-base --is-ancestor "$ref" main 2>/dev/null; then
    echo "  $ref  [merged-fast-forward]"
    continue
  fi
  cherry=$(git cherry main "$ref" 2>/dev/null)
  plus=$(echo "$cherry" | grep -c '^+' || true)
  minus=$(echo "$cherry" | grep -c '^-' || true)
  age=$(git log -1 --format='%cr' "$ref" 2>/dev/null)
  if [[ "$plus" -eq 0 ]]; then
    echo "  $ref  [in-main-by-patch-id] last=$age"
  else
    echo "  $ref  [+$plus / -$minus, last=$age]"
    git cherry main "$ref" -v 2>/dev/null | grep '^+' | sed 's/^/      /'
  fi
done
echo

echo "=== Done. Phase 3 (delete) requires explicit user approval. ==="
