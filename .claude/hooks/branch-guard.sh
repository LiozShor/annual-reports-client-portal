#!/bin/bash
cd "$CLAUDE_PROJECT_DIR" || exit 0
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "BLOCKED: Cannot edit files on '$BRANCH' branch. Create a feature branch first (git checkout -b <ticket>-<description>)." >&2
  exit 2
fi
exit 0
