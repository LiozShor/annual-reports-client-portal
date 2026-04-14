# DL-SESSION-START-ENFORCEMENT — Session Start Safety Hooks

**Status:** [IMPLEMENTED]
**Date:** 2026-04-14

## Summary

Added two hooks to enforce multi-tab safety rules at session start:

1. **SessionStart hook** (`.claude/hooks/session-start-check.sh`) — Runs on startup/resume. Checks current branch (warns if on main/master) and uncommitted changes. Also detects worktree status. Outputs JSON with `additionalContext` for the agent.

2. **Branch guard PreToolUse hook** (`.claude/hooks/branch-guard.sh`) — Blocks Edit/Write operations when on main/master branch. Exits with code 2 to prevent edits.

Both hooks are wired in `.claude/settings.json`. Branch guard runs before existing Edit|Write hooks (hebrew-encoding, ssot-violation, banned-frontend-patterns).
