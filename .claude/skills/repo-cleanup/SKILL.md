---
name: repo-cleanup
description: "Periodic cleanup of accumulated cruft in the annual-reports repo: stray untracked files, merged Claude-session worktrees, merged local/remote branches. Trigger phrases: 'let's do cleanup', 'do cleanup', 'clean up branches', 'clean up worktrees', 'prune branches', 'prune worktrees', 'cleanup repo', 'tidy the repo'. Also trigger after a burst of merged DLs (≥5 fresh commits on main) or when `git branch -r` exceeds ~15 stale refs. Three user-gated phases: untracked-file triage, branch/worktree inventory, verified delete (patch-id + DL-renumber detection). Do NOT trigger for: single-file `rm` requests, single-branch deletes (the user can do those directly), reverting a specific commit, fixing an active branch (use git-ship), or for non-git cleanup like clearing tmp/ caches. Sibling: git-ship handles single-commit/merge/push flows — do not invoke for routine commits."
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Skill
---

# Repo Cleanup

Periodic, user-gated cleanup of the annual-reports CRM repo. Designed for the parallel-Claude-session workflow that accumulates dozens of `claude-session-*` worktrees and `DL-NNN-*` branches across days, many of which are merged via squash/rebase under different SHAs.

The skill exists because plain `--merged` checks miss squash-merges, plain `worktree remove --force` ignores dirty trees (real wipe-active-session incident, 2026-05-02), and plain bulk delete doesn't recognize when a DL number was renumbered before merge (e.g. DL-387→DL-343 in this repo).

## When this triggers

Use this skill when:

- The user says "let's do cleanup", "clean up branches", "prune worktrees", "cleanup the repo", "tidy the repo".
- A burst of DL merges has landed (≥5 commits on main since the last cleanup) and stale branches are piling up.
- `git branch -r` lists ≥15 refs and most look like merged DL/chore work.
- After a `/security-deep-audit` or `/silent-failure-hunt` produced stray audit files in the working tree.

## When this does not trigger

Do not use this skill when:

- The user wants to delete one specific file or one specific branch — they can do that directly with `rm` or `git branch -D`.
- The user wants to revert a commit or undo a push — that's a git-history operation, not cleanup.
- The user is mid-task on an active branch and just wants to commit/push — use `git-ship`.
- The user wants to clear `tmp/`, `.wrangler/`, or `node_modules/` — that's build cache cleanup, not repo cleanup.
- The user wants to delete a worktree they're actively working in — refuse and ask them to switch first.

## Inputs required

Confirm before starting:

- We are in the canonical clone (`C:/Users/liozm/Desktop/moshe/annual-reports`), NOT a session worktree. Run `pwd` and verify.
- Current branch is `main` (or willing to switch). Run `git branch --show-current`.
- No uncommitted work in the canonical clone. Run `git status --porcelain` — if non-empty, stop and ask the user to commit or stash.

## Workflow

The skill runs in three **user-gated** phases. After each phase, present findings and **wait for explicit approval** before proceeding to the next.

### Phase 1 — Untracked-file triage

1. Run `git status --short` and list every `??` entry.
2. For each entry, classify into one of:
   - **junk** — path-mangled output (e.g. `C:Users…` literal in a filename), stray empty dirs, mystery `New Text Document.txt`-style artifacts.
   - **commit-worthy** — referenced from tracked docs (grep the project for the path/filename), or the obvious output of a documented workflow (audits → `.agent/audits/`, skills → `.claude/skills/`).
   - **PII / leave-untracked** — real client docs (`docs/Samples/*.pdf|docx|xlsx`, anything with Hebrew filename), screenshots from production, anything matching `agent-pii-guard.py` patterns.
3. For PII items, propose adding the pattern to `.gitignore` (do NOT auto-commit the files).
4. Run `python3 .claude/hooks/agent-pii-guard.py <commit-worthy paths>` before staging anything from `.agent/`.
5. Present the categorized list to the user. **Wait for explicit "yes" before deleting junk or staging commits.**

### Phase 2 — Branch & worktree inventory

1. Run `bash .claude/skills/repo-cleanup/scripts/inventory.sh`. It outputs:
   - Local branches with `[merged-in-main]`, `[ahead-N-behind-M]`, or `[no-remote]` annotation.
   - Remote branches not in main with patch-id check result.
   - Worktrees with `[clean]` or `[DIRTY: <count> files]` annotation.
2. For each worktree marked dirty, run `git -C <path> status --porcelain | head -5` and inspect — distinguish real WIP from orphan untracked PII (same `docs/Samples/`, `docs/templates/` pattern that exists in every tree).
3. For each remote branch flagged "ahead-N", run `git cherry main origin/<branch>` and capture the `+` (not-in-main) commit subjects.
4. For each `+` commit, search main's log for a likely squash-rename: `git log main --oneline --grep="<DL-NNN>"` and `git log main --oneline --grep="<key phrase from subject>"`. DL numbers in this repo get renumbered (DL-387→DL-343, DL-388→DL-389 are real cases).
5. Present a 4-column table: branch | merged-locally | content-in-main-by-patch-id-or-rename | verdict (delete / keep / investigate).
6. **Wait for explicit "yes" before any deletion.**

### Phase 3 — Verified delete

1. Worktree removal — for each worktree marked safe (clean OR confirmed orphan-PII-only):
   - `git worktree remove <path>` (NEVER `--force` without explicit user approval — see gotchas).
   - If user has manually deleted the directory already, run `git worktree prune -v` to clean metadata.
2. Local branch delete — `git branch -d <name>` for branches with no remote ref or with remote-merged. Use `git branch -D` ONLY after confirming via Phase 2 patch-id/rename check that content is in main.
3. Remote branch delete — batch: `git push origin --delete <name1> <name2> …`. Single push avoids per-branch prompts.
4. After deletes, run `git fetch --prune origin && git branch -vv && git branch -r && git worktree list` and report the final state.

## Decision gates

- **Stop and ask the user** if `git status --porcelain` is non-empty in the canonical clone — never proceed with cleanup on top of dirty state.
- **Stop and ask** if a worktree shows >5 modified/untracked files that don't match the known orphan-PII pattern (`docs/Samples/`, `docs/templates/`, `Meeting With Natan.docx`, Hebrew xls/xlsx). Real WIP looks different from orphan PII.
- **Stop and ask** before any `git branch -D` (force-delete), `git worktree remove --force`, or remote-branch batch delete with >20 entries.
- **Refuse** to delete the branch the user is currently checked out in any worktree.
- **Refuse** to run on platforms other than the canonical clone — if `pwd` is under `worktrees/`, abort.
- **Escalate** if a `+` commit on a remote branch has no semantic match in main's log — that's genuine WIP, do not delete.

## Output format

After the skill completes, return:

```md
# Repo Cleanup — <YYYY-MM-DD>

## Summary
- Phase 1: <N> junk deleted, <N> committed, <N> PII gitignored
- Phase 2: <N> worktrees + <N> local + <N> remote inventoried
- Phase 3: <N> worktrees pruned, <N> local deleted, <N> remote deleted

## Decisions
- <branches/files kept and why>

## Final state
```
git branch:       <count> local (just main + active sessions)
git branch -r:    <count> remote (just main + active session)
git worktree list: <count> trees (canonical + active sessions)
```

## Risks or gaps
- <branches the user manually owns and skill could not auto-classify>
```

## Gotchas

- **Never `git worktree remove --force` without user approval.** It ignores dirty trees. The 2026-05-02 cleanup-script incident wiped an active session this way. The dirty-skip guard in `scripts/inventory.sh` is non-negotiable.
- **`git branch --merged main` misses squash-merges.** A branch merged via GitHub's "Squash and merge" or via local `git merge --squash` will NOT appear in `--merged` output. Always cross-check with `git cherry main <ref>` (patch-id) AND grep main's log by DL number / commit subject.
- **`git cherry` reports false positives when the merged version was bundled with extra changes.** If the in-main commit squashed two branches together, `cherry` sees a different patch-id and emits `+`. Always disambiguate with `git log main --grep` before deleting.
- **DL numbers get renumbered before merge.** This repo has real cases of DL-387→DL-343, DL-386→DL-387, DL-388→DL-389. Searching for the literal DL-NNN from the branch name will miss the merge. Always also grep main by a key phrase from the commit subject.
- **`worktree prune` fails noisily on Windows with "Permission denied"** for residual files in `.git/worktrees/<name>/`, but the worktree-list-level removal still succeeds. Don't treat the noise as failure — re-run `git worktree list` to confirm.
- **Never run from a session worktree.** `git checkout main` errors with `fatal: 'main' is already used by worktree at '...'`. Always `cd` to the canonical clone first.
- **`git push --force-with-lease` is on the deny list.** Don't use it to overwrite a divergent remote branch — instead, FF-push directly: `git push origin <branch>:main`, or just delete the divergent ref after confirming content is in main.
- **PII files appear in every worktree as orphans.** `docs/Samples/`, `docs/templates/`, `Meeting With Natan.docx` show up as untracked in nearly every Claude session worktree because they exist in the parent filesystem. They are NOT WIP — they are the same files mirrored. Treat as safe-to-skip when classifying worktree dirtiness.
- **Don't bulk-delete remote refs without verifying content first.** A remote ref's mere presence is not a signal it's unmerged — many were squash-merged. Always patch-id-check Phase 2 before Phase 3.

## Evaluation checklist

- Does the skill run only in the canonical clone, never a session worktree?
- Does Phase 1 distinguish junk, commit-worthy, and PII correctly on a known-bad input?
- Does Phase 2 correctly flag a squash-merged branch as "in main" via cherry + grep, even when DL was renumbered?
- Does the skill stop and ask before every destructive batch?
- Does Phase 3 use `--force` only after explicit per-batch user approval?
- Does the final report match the actual `git branch -vv` and `git worktree list` state?
- Does it skip worktrees with non-PII dirty content (real WIP)?

## Scripts

- `scripts/inventory.sh` — runs the inventory queries (branches, worktrees, cherry-checks) and prints the annotated tables. Read-only.

## References

- `feedback_cleanup_script_safety_guards` memory — 2026-05-02 wipe-active-session incident; the dirty-skip + age-check rule.
- `feedback_no_delete_worktree_branch` memory — never `git branch -d` a branch checked out in a worktree.
- `feedback_merge_from_main_worktree` memory — only run from canonical clone.
