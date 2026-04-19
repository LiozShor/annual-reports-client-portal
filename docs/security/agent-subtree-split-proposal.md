# Proposal: Split `.agent/` into a Private Repo

**Status:** Decision pending — NOT yet executed.  
**Date written:** 2026-04-18

---

## 1. Rationale

`.agent/` is the primary PII surface in this repo:
- **81 `CPA-\d+` matches** across 21 files
- **363+ Hebrew text blocks** across 30+ files
- These are client identifiers and notes extracted from live Airtable records

Even with the `agent-pii-guard` hook operating in diff-only mode (grandfathering existing content), the historical data remains **permanently indexed on GitHub** as long as `.agent/` is in this public repo's history.

A subtree split would move all `.agent/` content — current and historical — to a private repo, eliminating the PII from the public git history entirely.

---

## 2. Command Sequence

### Phase 1 — Extract `.agent/` history to a private repo

```bash
# 1. Split .agent/ into its own branch preserving history
git subtree split --prefix=.agent -b agent-history-branch

# 2. Create a new private GitHub repo: annual-reports-agent-notes
gh repo create LiozShor/annual-reports-agent-notes --private

# 3. Push the split branch as main of the new private repo
git push git@github.com:LiozShor/annual-reports-agent-notes.git \
  agent-history-branch:main

# 4. Clean up the local split branch
git branch -d agent-history-branch
```

### Phase 2 — Remove `.agent/` from the public repo's history

```bash
pip install git-filter-repo

# Strip .agent/ from the entire commit history of the current branch
git filter-repo --path .agent/ --invert-paths

# Force-push rewritten history (DESTRUCTIVE — breaks existing clones)
git push origin main --force
```

### Phase 3 — Wire `.agent/` back into the working tree

Option A (git clone into place):
```bash
# In setup-worktree.sh, after creating the worktree:
git clone git@github.com:LiozShor/annual-reports-agent-notes.git .agent
```

Option B (local symlink from a persistent clone):
```bash
# One-time setup on each machine:
git clone git@github.com:LiozShor/annual-reports-agent-notes.git ~/notes-private
ln -s ~/notes-private /path/to/annual-reports/.agent
```

---

## 3. Access Model Comparison

| | Option A (clone per worktree) | Option B (symlink) |
|---|---|---|
| Isolation | Each session has its own `.agent/` | All sessions share one clone |
| Sync | Pull/push per worktree | One clone, always up to date |
| Setup cost | Extra `git clone` in `setup-worktree.sh` | One-time per machine |
| Windows compat | Safe | Symlinks require admin on Windows |
| Recommendation | Better for parallel sessions | Better for single-machine dev |

---

## 4. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| History rewrite breaks existing clones | Anyone who cloned the public repo before will have diverged history | Low impact — this is a private dev repo with one contributor |
| Open PRs become invalid after force-push | Any in-flight PR branches will need rebasing | Merge all open PRs before executing |
| Design log cross-references dangling | Links like `see .agent/design-logs/NNN-...` in code/docs still work IF `.agent/` is cloned into place | Ensure `.agent/` is always present in working tree |
| Two-repo mental model | Claude Code sessions must clone `.agent/` separately | Update `setup-worktree.sh` and session-start docs |
| `.gitignore` for `.agent/` in main repo | After removal, add `.agent/` to `.gitignore` so accidental adds don't re-pollute history | Add immediately after `filter-repo` run |

---

## 5. Decision Gate

This proposal requires explicit go-ahead before execution. Checklist before proceeding:

- [ ] All open PRs merged to `main`
- [ ] Full backup of current `.agent/` confirmed (the private repo will be the backup after Phase 1)
- [ ] `setup-worktree.sh` updated to include the `git clone` step
- [ ] CLAUDE.md updated to document the new session-start flow
- [ ] Team (Natan) notified that the public repo history will be rewritten

**Do not run Phase 2 (`filter-repo`) until Phase 1 and Phase 3 are tested and confirmed working.**
