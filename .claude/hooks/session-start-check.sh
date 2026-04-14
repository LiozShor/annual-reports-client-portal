#!/bin/bash
cd "$CLAUDE_PROJECT_DIR" || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
STATUS=$(git status --porcelain 2>/dev/null | head -20)

WARNINGS=""

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  WARNINGS="${WARNINGS}CRITICAL: You are on branch '$BRANCH'. Do NOT start any work. Ask the user what ticket/task they're working on and create a feature branch first.\n\n"
fi

if [ -n "$STATUS" ]; then
  WARNINGS="${WARNINGS}WARNING: Uncommitted changes detected:\n${STATUS}\n\nAsk the user how to handle these before starting work (commit, stash, or continue).\n\n"
fi

# Detect worktree status
COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
GITDIR=$(git rev-parse --git-dir 2>/dev/null)
WORKTREE_INFO=""
if [ "$COMMON" != "$GITDIR" ]; then
  WORKTREE_INFO="Running in worktree. Main repo: $(dirname "$COMMON")"
else
  WORKTREE_COUNT=$(git worktree list 2>/dev/null | wc -l)
  if [ "$WORKTREE_COUNT" -gt 1 ]; then
    WORKTREE_INFO="Main repo with $((WORKTREE_COUNT - 1)) active worktree(s)."
  fi
fi

if [ -z "$WARNINGS" ]; then
  CONTEXT="Session check: branch=$BRANCH, working tree clean."
  [ -n "$WORKTREE_INFO" ] && CONTEXT="$CONTEXT $WORKTREE_INFO"
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$CONTEXT"
else
  CONTEXT=$(printf 'SESSION START SAFETY CHECK:\n\n%b%s\nYou MUST address these issues before doing any work.' "$WARNINGS" "$WORKTREE_INFO")
  ESCAPED=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(d)))" <<< "$CONTEXT")
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$ESCAPED"
fi
exit 0
