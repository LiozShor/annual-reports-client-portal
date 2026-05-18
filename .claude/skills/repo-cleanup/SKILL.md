---
name: repo-cleanup
description: "Full cleanup of the annual-reports repo to a 'main-only' end state: removes ALL untracked junk, ALL session worktrees, and ALL non-main branches (local + remote). Trigger phrases: 'let's do cleanup', 'do cleanup', 'clean up branches', 'clean up worktrees', 'prune branches', 'prune worktrees', 'cleanup repo', 'tidy the repo'. Also trigger after a burst of merged DLs (≥5 fresh commits on main) or when `git branch -r` exceeds ~15 stale refs. Four user-gated phases: untracked-file triage, WIP discovery (unmerged commits + dirty worktrees), branch/worktree inventory, verified delete (patch-id + DL-renumber detection). WIP is never silently dropped — each unmerged commit / dirty worktree forces an explicit merge/discard/keep decision. Do NOT trigger for: single-file `rm` requests, single-branch deletes (the user can do those directly), reverting a specific commit, fixing an active branch (use git-ship), or for non-git cleanup like clearing tmp/ caches. Sibling: git-ship handles single-commit/merge/push flows — do not invoke for routine commits."
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Skill
---

# Repo Cleanup

Full, user-gated cleanup of the annual-reports CRM repo. **Target end state: only `main` exists** — no session worktrees, no DL branches (local or remote), no stray untracked files. Designed for the parallel-Claude-session workflow that accumulates dozens of `claude-session-*` worktrees and `DL-NNN-*` branches across days, many of which are merged via squash/rebase under different SHAs.

The skill exists because plain `--merged` checks miss squash-merges, plain `worktree remove --force` ignores dirty trees (real wipe-active-session incident, 2026-05-02), and plain bulk delete doesn't recognize when a DL number was renumbered before merge (e.g. DL-387→DL-343 in this repo).

**WIP is never silently dropped.** Before deletion, the skill identifies every active worktree with uncommitted changes AND every branch with unmerged commits (vs main), then forces an explicit per-item decision: **merge to main**, **discard** (with reflog recoverability noted), or **keep** (overrides the main-only goal for that item).

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

The skill runs in four **user-gated** phases. After each phase, present findings and **wait for explicit approval** before proceeding to the next. The end-state goal is **only `main` exists** (1 local branch, 1 remote branch, 1 worktree). Anything that would prevent that — uncommitted work, unmerged commits, branches the user explicitly wants to keep — is surfaced as a blocker in Phase 2 and resolved before Phase 4 runs.

### Phase 1 — Untracked-file triage

1. Run `git status --short` and list every `??` entry.
2. For each entry, classify into one of:
   - **junk** — path-mangled output (e.g. `C:Users…` literal in a filename), stray empty dirs, mystery `New Text Document.txt`-style artifacts.
   - **commit-worthy** — referenced from tracked docs (grep the project for the path/filename), or the obvious output of a documented workflow (audits → `.agent/audits/`, skills → `.claude/skills/`).
   - **PII / leave-untracked** — real client docs (`docs/Samples/*.pdf|docx|xlsx`, anything with Hebrew filename), screenshots from production, anything matching `agent-pii-guard.py` patterns.
3. For PII items, propose adding the pattern to `.gitignore` (do NOT auto-commit the files).
4. Run `python3 .claude/hooks/agent-pii-guard.py <commit-worthy paths>` before staging anything from `.agent/`.
5. Present the categorized list to the user. **Wait for explicit "yes" before deleting junk or staging commits.**

### Phase 2 — WIP discovery (the safety phase)

This phase exists so the "main-only" goal never silently destroys real work. Build a single combined list of every item that blocks the goal, then resolve each with the user.

1. **Dirty worktrees.** For every worktree in `git worktree list` (including the canonical clone), run `git -C <path> status --porcelain`. Filter out the known orphan-PII pattern (`docs/Samples/`, `docs/templates/`, `Meeting With Natan.docx`, Hebrew xls/xlsx — these mirror parent FS, not real WIP). What remains is genuine uncommitted work.
2. **Unmerged commits.** For every local branch ≠ `main` and every `origin/*` ≠ `origin/main`, run `git cherry main <ref>` to find unique commits. For each `+ <sha>`, capture the commit subject AND grep main for a likely squash-rename: `git log main --oneline --grep="<DL-NNN>"` and `git log main --oneline --grep="<key phrase from subject>"`. DL numbers get renumbered (DL-387→DL-343, DL-388→DL-389 are real cases) — a `+` from `cherry` does NOT prove the commit is missing from main.
3. **Codex / external worktrees.** Worktrees under paths the skill does not own (e.g. `~/.codex/worktrees/`) are listed but flagged `external-tool` — surface them, but default to "keep" unless the user explicitly says otherwise.
4. Present a combined WIP table — one row per blocker — with columns: location (worktree path or branch ref) | type (dirty / unmerged-commit / external-worktree) | summary (file count or commit subject) | already-in-main? (yes/no/unknown).
5. For each row, propose one of three resolutions:
   - **merge** — commit + push from inside the worktree, then `git push origin <branch>:main` (FF-push, see git-ship skill). Use for real WIP the user wants to keep.
   - **discard** — note that the commit will be recoverable from `git reflog` for ~90 days, then proceed. Use for abandoned experiments.
   - **keep** — keep the branch and/or worktree as an explicit exception to the main-only goal. The skill records it in the "Risks or gaps" section of the final report.
6. **Wait for an explicit resolution per row.** Do not move to Phase 3 until every blocker is resolved or explicitly kept.

### Phase 3 — Branch & worktree inventory (verification pass)

1. Run `bash .claude/skills/repo-cleanup/scripts/inventory.sh`. It outputs:
   - Local branches with `[merged-in-main]`, `[ahead-N-behind-M]`, or `[no-remote]` annotation.
   - Remote branches not in main with patch-id check result.
   - Worktrees with `[clean]` or `[DIRTY: <count> files]` annotation.
2. Cross-check against Phase 2: every branch flagged `[ahead-N]` must already have a Phase 2 resolution. If a new blocker appeared between phases (e.g. a parallel session committed), loop back to Phase 2 for that item.
3. Build the final delete batch: every branch ≠ `main`, every remote ref ≠ `origin/main`, every worktree ≠ canonical clone — minus the items the user chose to **keep** in Phase 2.
4. Present a 4-column table: ref/path | merged-locally | content-in-main-by-patch-id-or-rename | verdict (delete / kept-by-user).
5. **Wait for explicit "yes" before any deletion.**

### Phase 4 — Verified delete

1. Worktree removal — for each worktree marked for deletion:
   - `git worktree remove <path>` (NEVER `--force` without explicit user approval — see gotchas).
   - If the user has manually deleted the directory already, run `git worktree prune -v` to clean metadata.
2. Local branch delete — `git branch -D <name>` (force is expected here because Phase 2 already verified each branch is either patch-id-merged or explicitly discarded). The `-D` form is required for squash-merged branches that `git branch -d` would refuse.
3. Remote branch delete — batch: `git push origin --delete <name1> <name2> …`. Single push avoids per-branch prompts.
4. After deletes, run `git fetch --prune origin && git branch -vv && git branch -r && git worktree list` and report the final state.
5. **Stale-directory cleanup (filesystem).** `git worktree remove` only deletes git metadata — on Windows the actual session directory under `C:/Users/liozm/Desktop/moshe/worktrees/<name>/` often survives because of open file handles. After git-level cleanup, run:
   ```bash
   ls C:/Users/liozm/Desktop/moshe/worktrees/ 2>/dev/null
   ```
   Then for every entry that is NOT a currently-registered worktree (cross-check against `git worktree list`), nuke it with `rm -rf "C:/Users/liozm/Desktop/moshe/worktrees/<name>"`. Batch all deletes in one or two commands. If `rm -rf` errors with "Device or resource busy" / "Permission denied", note it — the user has another Claude tab / editor holding a handle. Tell them to close those and offer a retry, but do NOT loop indefinitely.
   Also run `git worktree prune -v` once to clear residual `.git/worktrees/<name>/` metadata. Noisy "Permission denied" output there is harmless — re-check `git worktree list` to confirm.
6. **Verify against goal.** Confirm the final state is exactly `1 local (main) + 1 remote (origin/main) + 1 worktree (canonical clone) + any user-kept exceptions` AND `ls C:/Users/liozm/Desktop/moshe/worktrees/` returns empty (or only user-kept entries). If extras remain, list them and ask the user how to proceed.

## Decision gates

- **Stop and ask the user** if `git status --porcelain` is non-empty in the canonical clone — never proceed with cleanup on top of dirty state. (Phase 2 will surface this as a blocker.)
- **Stop and ask** if a worktree shows >5 modified/untracked files that don't match the known orphan-PII pattern (`docs/Samples/`, `docs/templates/`, `Meeting With Natan.docx`, Hebrew xls/xlsx). Real WIP looks different from orphan PII.
- **Stop and ask** before any `git worktree remove --force`, or remote-branch batch delete with >20 entries. (`git branch -D` is expected at this skill's scale and does NOT need a per-batch gate beyond the Phase 3 approval — Phase 2 already verified content safety.)
- **Refuse** to delete the branch the user is currently checked out in any worktree.
- **Refuse** to run on platforms other than the canonical clone — if `pwd` is under `worktrees/`, abort.
- **Escalate** if a `+` commit on a remote branch has no semantic match in main's log — that's genuine WIP. Treat as a Phase 2 blocker, never silently delete.
- **Honor user-kept exceptions.** If the user said "keep" for a branch/worktree in Phase 2, do not delete it in Phase 4 even if it otherwise looks merged.

## Output format

After the skill completes, return:

```md
# Repo Cleanup — <YYYY-MM-DD>

## Summary
- Phase 1: <N> junk deleted, <N> committed, <N> PII gitignored
- Phase 2: <N> WIP blockers — <N> merged, <N> discarded, <N> kept
- Phase 3: <N> worktrees + <N> local + <N> remote inventoried for deletion
- Phase 4: <N> worktrees removed, <N> local deleted, <N> remote deleted

## Decisions
- <per-blocker resolution: "DL-424 branch — merged to main", "DL-NNN — discarded (reflog: <sha>)", "DL-NNN — kept by user request">

## Final state (target: main-only)
```
git branch:        <count> local (main + <kept exceptions>)
git branch -r:     <count> remote (origin/main + <kept exceptions>)
git worktree list: <count> trees (canonical + <kept exceptions> + <external e.g. codex>)
```

## Risks or gaps
- <user-kept exceptions and why>
- <external worktrees (codex etc.) left in place>
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
- Does Phase 2 surface EVERY dirty worktree and EVERY unmerged commit as an explicit blocker before any delete?
- Does Phase 2 correctly flag a squash-merged branch as "already in main" via cherry + grep, even when DL was renumbered?
- For each Phase 2 blocker, does the user get a real merge/discard/keep choice — not a silent default?
- Does Phase 3 honor user-kept exceptions from Phase 2 (no surprise deletes)?
- Does `git worktree remove --force` require explicit per-call approval?
- Does the final state match the main-only target (1 local + 1 remote + 1 worktree) plus only the exceptions the user explicitly kept?
- Does the final report list user-kept exceptions AND external worktrees (codex etc.) under "Risks or gaps"?

## Scripts

- `scripts/inventory.sh` — runs the inventory queries (branches, worktrees, cherry-checks) and prints the annotated tables. Read-only.

## References

- `feedback_cleanup_script_safety_guards` memory — 2026-05-02 wipe-active-session incident; the dirty-skip + age-check rule.
- `feedback_no_delete_worktree_branch` memory — never `git branch -d` a branch checked out in a worktree.
- `feedback_merge_from_main_worktree` memory — only run from canonical clone.
