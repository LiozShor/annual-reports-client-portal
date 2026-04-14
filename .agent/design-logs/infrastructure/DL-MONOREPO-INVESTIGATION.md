# DL-MONOREPO: Git Structure Restructuring Investigation

**Status:** IMPLEMENTED — monitoring stability
**Date:** 2026-04-14
**Goal:** Evaluate options to make git worktrees work simply (one command, no scripts, no symlinks)

---

## Step 1: Current Structure Map

### Two Repos, Nested

```
C:\Users\liozm\Desktop\moshe\annual-reports\     ← OUTER REPO (local-only, NO remote)
├── .git/                    (29 MB, 254 commits)
├── .env                     (4 KB — only env var: N8N_INTERNAL_KEY)
├── .claude/                 (128 KB — settings, hooks, skills, rules, agents)
├── .agent/                  (3.2 MB — design logs, session state, archive)
├── .mcp.json                (n8n-mcp config)
├── .claudeignore
├── .gitignore
├── CLAUDE.md
├── api/                     (223 MB total, 218 MB is node_modules)
│   ├── src/                 (Cloudflare Workers — Hono TypeScript)
│   ├── wrangler.toml
│   ├── package.json
│   ├── .gitignore           (covers node_modules/, dist/, .dev.vars, .wrangler/)
│   └── node_modules/        (NOT tracked by outer — api/.gitignore)
├── archive/                 (4 MB — old plans, samples, legacy)
├── data/                    (12 KB — qualifying-settlements JSON)
├── docs/                    (8.7 MB — architecture, schemas, research, samples, DPAs)
├── experts/                 (100 KB — advisory board profiles)
├── github/
│   └── annual-reports-client-portal/   ← NESTED REPO (GitHub remote)
│       ├── .git/            (separate git history)
│       ├── admin/           (admin portal: HTML + JS + CSS)
│       ├── assets/          (fonts, images, CSS, JS)
│       ├── shared/          (constants.js, endpoints.js, utils.js)
│       ├── n8n/             (SSOT generators, display library)
│       ├── *.html           (client-facing pages)
│       └── .gitignore       (ignores .claude/)
├── node_modules/            (37 MB — jszip, pdfkit, xlsx)
│   └── ⚠️ 246 files TRACKED by outer repo git!
├── package.json             (devDependencies only)
├── tmp/                     (1.7 MB — temp working files)
├── SSOT_*.md                (document template specs)
└── skills-lock.json
```

### Key Facts

| Property | Outer Repo | Nested Repo |
|----------|-----------|-------------|
| Remote | **NONE** (local-only) | `origin` → `github.com/LiozShor/annual-reports-client-portal` |
| Branch | `master` | `DL-268-edit-client-modal-save-fix` |
| Tracked files | 740 (incl. 246 node_modules!) | 42 |
| Git history | 254 commits, 29 MB | Separate history, hosted on GitHub |
| Deploys to | Cloudflare Workers (`wrangler deploy` from `api/`) | GitHub Pages (auto-deploy on push) |
| Gitlink | Tracks nested as `160000 commit` (submodule-like, but no `.gitmodules`) | N/A |

### Problems with Current Setup

1. **Outer repo has no remote** — no backup, no collaboration, no CI
2. **Outer repo tracks `node_modules/`** — 246 files committed (jszip, xlsx, etc.)
3. **Nested repo is a "phantom submodule"** — tracked as gitlink but no `.gitmodules`, so `git submodule` commands don't work
4. **Worktrees impossible** — `git worktree add` on outer repo creates a worktree without the nested repo's `.git`, breaking the frontend entirely
5. **Two independent git histories** — no unified view of changes

---

## Step 2: Cross-Reference Map

### Does `api/src/` import from `github/`?
**NO.** Zero cross-imports. The Worker and frontend are completely independent codebases at the filesystem level. They communicate only via HTTP (Worker API ← Frontend JS).

### Does `github/` import from outer dirs?
**NO.** The nested repo grep for `../../api`, `../../docs`, `../../.agent`, `../../.claude` returned zero results.

### What references `github/annual-reports-client-portal/` by path?

| File | Nature of Reference |
|------|-------------------|
| `CLAUDE.md` | Session rules: "git repo managed manually" |
| `SSOT_required_documents_from_Tally_input.md` | Points to `github/.../n8n/ssot-document-generator.js` |
| `SSOT_CS_required_documents.md` | Points to `github/.../n8n/ssot-cs-document-generator.js` |
| `docs/architecture.md` | Architecture table: "GitHub Pages JS at `github/.../n8n/`" |
| `docs/cs-hardcoded-audit.md` | 8 references to files in `github/.../` |
| `docs/project-overview.md` | Folder structure diagram |
| `.claude/rules/airtable-safety.md` | Two Codebases table |
| `.agent/session-memories.md` | Historical file references |
| `.agent/archive/` (multiple) | Historical design logs |
| `.agent/design-logs/` (multiple) | Active design logs |

### What references the GitHub Pages URL (`liozshor.github.io/annual-reports-client-portal`)?

| Location | What |
|----------|------|
| `api/src/routes/approve-and-send.ts` | `FRONTEND_BASE` constant |
| `api/src/routes/send-questionnaires.ts` | `FRONTEND_BASE` constant |
| `api/src/routes/feedback.ts` | Logo URL inline |
| `api/src/lib/email-html.ts` (likely) | Email template URLs |
| `api/wrangler.toml` | `ALLOWED_ORIGIN` for CORS |
| `docs/email-design-rules.md` | Email template examples |
| `docs/custom-domain-migration-audit.md` | URL audit |
| `tmp/` (many files) | Working copies of n8n code |
| n8n workflows (remote) | Hardcoded URLs in workflow Code nodes |

### Hooks & Settings

- All hooks use `$CLAUDE_PROJECT_DIR` (resolved at runtime) — **no hardcoded paths**
- `.mcp.json` has no path dependencies
- `.claude/settings.json` uses only `$CLAUDE_PROJECT_DIR`-relative paths

---

## Step 3: Option Evaluation

### Option A: Sibling Directories (Separate Two Repos)

**What:** Move `github/annual-reports-client-portal/` out to `C:\Users\liozm\Desktop\moshe\annual-reports-client-portal\` as a sibling.

**Effort:** Low (30 min)

**What breaks:**
- Every doc/memory referencing `github/annual-reports-client-portal/` path (20+ files)
- Outer repo's gitlink entry
- Claude Code would need to be opened in one dir at a time, losing unified context
- OR: need multi-root workspace — Claude Code doesn't support this natively

**Risk:** Medium — two disconnected Claude Code sessions, no unified CLAUDE.md

**Verdict:** **REJECT** — makes the developer experience worse. Currently Claude Code sees both codebases in one session with one CLAUDE.md. Splitting forces context-switching between windows.

---

### Option B: Monorepo (Merge Into GitHub Repo) ← RECOMMENDED

**What:** Move ALL outer repo contents into the GitHub repo. Single repo, single remote, single worktree.

**Proposed structure:**
```
annual-reports/                  ← Single repo with GitHub remote
├── .claude/                     (from outer)
├── .agent/                      (from outer)
├── .env                         (gitignored, stays local)
├── .mcp.json                    (from outer)
├── .claudeignore                (from outer)
├── .gitignore                   (merged)
├── CLAUDE.md                    (from outer)
├── api/                         (from outer — Cloudflare Workers)
│   ├── src/
│   ├── wrangler.toml
│   └── package.json
├── frontend/                    ← RENAMED from root of nested repo
│   ├── admin/
│   ├── assets/
│   ├── shared/
│   ├── n8n/
│   └── *.html
├── docs/                        (from outer)
├── experts/                     (from outer)
├── archive/                     (from outer)
├── data/                        (from outer)
├── SSOT_*.md                    (from outer)
├── package.json                 (from outer — can be merged or removed)
└── tmp/                         (gitignored)
```

**What changes:**

| Item | Current Path | New Path | Files to Update |
|------|-------------|----------|-----------------|
| Frontend code | `github/annual-reports-client-portal/` | `frontend/` | ~20 docs + CLAUDE.md + rules |
| SSOT references | `github/.../n8n/ssot-document-generator.js` | `frontend/n8n/ssot-document-generator.js` | 2 SSOT docs |
| Architecture docs | paths in `docs/architecture.md` etc. | Update to `frontend/` | ~5 docs |
| Design logs (archive) | references in `.agent/` | Could leave as-is (historical) | 0 (optional) |
| Outer `node_modules/` | Tracked (246 files!) | **DELETE** — add to .gitignore | 1 (.gitignore) |
| Outer `package.json` | Root level | Keep at root or merge | 0 |
| GitHub Pages deploy | Deploys from repo root | Needs GitHub Pages config → `frontend/` dir | 1 (GitHub settings) |
| `CLAUDE_PROJECT_DIR` | Points to outer repo root | Points to monorepo root | 0 (same concept) |

**Git history:**
- Outer repo history (254 commits): **Will be lost** unless we do a history merge. Since it has no remote backup, this is the biggest risk.
- Options:
  - a) **Simple migration**: Copy files into GitHub repo, commit as "chore: merge outer repo into monorepo". History browsable via `git log --follow` for moved files. Old outer `.git` can be archived as a zip.
  - b) **History-preserving merge**: `git merge --allow-unrelated-histories` to combine both histories. More complex, messier log, but preserves full blame/log.
  - Recommendation: **(a) Simple migration** + archive `.git` as backup. The outer history is mostly Claude Code design logs and config changes — the code history that matters (api/, frontend/) is either in the GitHub repo already or in the outer repo's git which we'll zip.

**Secrets & .env:**
- `.env` only has `N8N_INTERNAL_KEY` — stays gitignored
- Worker secrets are in `wrangler secret` (Cloudflare) — unaffected
- `.mcp.json` has the n8n API key — already gitignored by `.claudeignore` (but check if `.mcp.json` is currently tracked... yes it IS tracked in outer repo, which means the n8n API key is in git history! But outer has no remote, so exposure is local-only)
- **Action needed:** Add `.mcp.json` to `.gitignore` before pushing to GitHub, or remove the key

**GitHub Pages deploy:**
- Currently deploys from repo root (all HTML/JS/CSS at root level)
- After restructuring to `frontend/`, need to update GitHub Pages settings:
  - Option 1: Set deploy source to `frontend/` directory (GitHub supports this via Actions)
  - Option 2: Keep frontend at root (don't rename) — but then `api/` lives alongside frontend files, which is messy
  - **Best:** Use GitHub Actions workflow to deploy only `frontend/` to Pages

**Cloudflare Workers deploy:**
- `wrangler deploy` runs from `api/` — **unchanged** (path is relative)
- `wrangler.toml` has no path references outside `api/`

**n8n references:**
- n8n workflows reference `liozshor.github.io/annual-reports-client-portal/` URLs — these are **runtime HTTP URLs**, not filesystem paths. **Unchanged.**
- n8n Code nodes that fetch from `raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/...` — path within the repo changes if we restructure. **Need to update these if files move from root to `frontend/`**.

**Impact assessment:**

| Concern | Impact |
|---------|--------|
| Claude Code workflow | **Improved** — single repo, single CLAUDE.md, worktrees work |
| git-ship | **Improved** — one commit can touch api/ + frontend/ together |
| Design logs | **Unchanged** — already in `.agent/` |
| Hooks | **Unchanged** — use `$CLAUDE_PROJECT_DIR` |
| n8n | **Minor** — update GitHub raw URLs if frontend files move |
| Cloudflare deploy | **Unchanged** — `api/` is self-contained |
| GitHub Pages | **Needs config** — set deploy directory or add Actions workflow |
| Worktrees | **SOLVED** — `git worktree add` gives a complete copy |

**Effort:** Medium (2-4 hours including testing)

**Risk:** Low-Medium
- Main risk: forgetting to update a GitHub raw URL in an n8n workflow
- Mitigation: grep n8n workflows for `raw.githubusercontent.com` paths before migration

---

### Option C: Proper Git Submodule

**What:** Register the nested repo as a formal submodule with `.gitmodules`.

**Current state:** Already tracked as a gitlink (mode `160000`) but without `.gitmodules`. Adding `.gitmodules` would formalize this.

**Does this help with worktrees?**
- `git worktree add` does NOT automatically initialize submodules
- You must run `git submodule update --init` in each worktree
- With nested repos, this is fragile — submodule state can diverge between worktrees
- Git 2.36+ added `git worktree add --recurse-submodules` but it's experimental

**Maintenance overhead:**
- Must `git submodule update` after every outer repo checkout/pull
- Commits require two steps: commit in submodule, then commit outer to update gitlink
- Already a pain point (per memory: "Always commit inside submodule first")
- Doesn't solve the "no remote" problem for the outer repo

**Verdict:** **REJECT** — formalizes the current pain rather than eliminating it. Submodules add ceremony, don't simplify worktrees, and the outer repo still has no remote.

---

## Step 4: Recommendation — Option B (Monorepo)

### Migration Plan

**Pre-migration (safety):**
1. Archive outer repo's `.git`: `cd .. && zip -r annual-reports-git-backup-2026-04-14.zip annual-reports/.git`
2. Ensure nested repo has no uncommitted changes: `git -C github/annual-reports-client-portal status`
3. Note the current nested repo commit hash for reference

**Step 1: Prepare the GitHub repo**
1. Clone the GitHub repo fresh to a temp location
2. Create a new branch: `git checkout -b chore/monorepo-restructure`

**Step 2: Move frontend files into `frontend/` subdirectory**
In the fresh clone:
```bash
mkdir frontend
git mv admin/ assets/ shared/ n8n/ *.html frontend/
git mv .gitignore frontend/.frontend-gitignore  # merge later
git commit -m "chore: move frontend files to frontend/ subdirectory"
```

**Step 3: Copy outer repo files into the monorepo**
```bash
# From the outer repo, copy (not move) all non-git, non-nested content:
cp -r api/ docs/ archive/ data/ experts/ tmp/ .claude/ .agent/ .env \
      .claudeignore CLAUDE.md SSOT_*.md package.json skills-lock.json \
      experts/ <target-clone>/

# Copy dotfiles
cp .mcp.json .gitignore <target-clone>/
```

**Step 4: Merge `.gitignore` files**
Combine outer `.gitignore` + `api/.gitignore` + nested `.gitignore` into one root `.gitignore`:
```
# Dependencies
node_modules/

# Secrets
.env
.mcp.json

# Build
dist/
.wrangler/
api/.dev.vars

# Temp
tmp/*
!tmp/.gitkeep

# Claude
.playwright-mcp/

# Binary
*.png
*.jpg
*.pdf
docs/Samples/
archive/

# Lock files
package-lock.json
api/package-lock.json
```

**Step 5: Remove tracked `node_modules/` from outer repo**
The outer repo currently tracks 246 `node_modules/` files. In the monorepo, ensure they're gitignored.

**Step 6: Update path references**
Files that need `github/annual-reports-client-portal/` → `frontend/` replacement:

| File | Lines/Sections |
|------|---------------|
| `CLAUDE.md` | Session Start Rules, Two Codebases table reference |
| `.claude/rules/airtable-safety.md` | Two Codebases table |
| `SSOT_required_documents_from_Tally_input.md` | Implementation path |
| `SSOT_CS_required_documents.md` | Implementation path |
| `docs/architecture.md` | GitHub Pages JS row |
| `docs/cs-hardcoded-audit.md` | ~8 file path references |
| `docs/project-overview.md` | Folder structure diagram |

Files that can be left as-is (historical):
- `.agent/archive/*` — frozen historical records
- `.agent/design-logs/*` — references are contextual, not functional
- `.agent/session-memories.md` — historical

**Step 7: Update GitHub Pages deployment**
- Go to GitHub repo Settings → Pages
- Change source to "GitHub Actions"
- Add `.github/workflows/deploy-pages.yml`:
```yaml
name: Deploy Frontend to GitHub Pages
on:
  push:
    branches: [main]
    paths: ['frontend/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: frontend
      - uses: actions/deploy-pages@v4
        id: deployment
```

**Step 8: Update n8n raw GitHub URLs**
Search all n8n workflows for `raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/` and update paths:
- `main/n8n/document-display-n8n.js` → `main/frontend/n8n/document-display-n8n.js`
- `main/n8n/workflow-processor-n8n.js` → `main/frontend/n8n/workflow-processor-n8n.js`
- `main/questionnaire-mapping.json` → `main/frontend/n8n/questionnaire-mapping.json` (verify path)

**Step 9: Update CLAUDE.md references to nested repo**
- Remove: "Do NOT git pull at session start" (now it's one repo)
- Update: Two Codebases table paths
- Update: Quick Reference section if needed
- Remove: submodule commit rules from memory (no longer applicable)

**Step 10: Commit and push**
```bash
git add -A
git commit -m "chore: merge outer repo into monorepo for worktree support"
git push origin chore/monorepo-restructure
# Create PR, review, merge
```

**Step 11: Replace local directory**
After merge:
```bash
cd C:\Users\liozm\Desktop\moshe
mv annual-reports annual-reports-OLD
git clone https://github.com/LiozShor/annual-reports-client-portal.git annual-reports
cd annual-reports
cp ../annual-reports-OLD/.env .
# Verify everything works
```

**Step 12: Post-migration verification**
- [ ] `wrangler deploy` from `api/` works
- [ ] GitHub Pages deploys from `frontend/`
- [ ] n8n raw GitHub URLs resolve
- [ ] Claude Code opens with correct CLAUDE.md
- [ ] Hooks fire correctly
- [ ] `git worktree add ../annual-reports-wt1 -b feature/test` works
- [ ] Frontend loads in browser
- [ ] Admin panel loads

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Outer repo history lost | Certain (if simple migration) | Low (config/docs history, code is in git blame) | Archive `.git` as zip |
| GitHub Pages breaks | Medium | High (client-facing) | Test on branch before merging to main |
| n8n raw URLs break | Medium | Medium (affects doc display) | Grep all workflows pre-migration |
| `.mcp.json` secrets in GitHub | High (if not gitignored) | Medium | Add to `.gitignore` BEFORE first push |
| Forgotten path references | Low | Low (docs only, not runtime) | Grep + find/replace |
| Worktree `.env` missing | Certain (per worktree) | Low | Symlink or copy script |

### Rollback Plan

1. The old directory is preserved as `annual-reports-OLD`
2. The GitHub repo can `git revert` the merge commit
3. GitHub Pages can be reconfigured to deploy from root
4. n8n raw URLs can be reverted to original paths
5. Full rollback possible within 1 hour

### What This Solves

| Problem | Before | After |
|---------|--------|-------|
| Worktrees | Impossible (nested repo not cloned) | `git worktree add` works natively |
| Backup | Outer repo local-only, no backup | Everything on GitHub |
| Atomic commits | Can't commit api/ + frontend/ together | Single commit spans both |
| Claude Code context | Works but fragile (two repos, one CLAUDE.md) | Clean single-repo setup |
| node_modules tracked | 246 files in git | Properly gitignored |
| Submodule ceremony | Two-step commit dance | Normal git workflow |

---

## Step 5: Outstanding Questions for User

1. **Repo naming:** Keep `annual-reports-client-portal` as the GitHub repo name, or rename to `annual-reports`? (Renaming changes the GitHub Pages URL unless a custom domain is configured)
2. **History merge:** Simple migration (lose outer history) or `--allow-unrelated-histories` merge (preserve but messy)?
3. **Frontend directory name:** `frontend/` or keep at root? Keeping at root avoids GitHub Pages config changes but mixes api/ with HTML files.
4. **Root `node_modules/` and `package.json`:** Are the jszip/pdfkit/xlsx devDependencies still needed? Can we delete the root package.json entirely?
5. **Timing:** Do this during a quiet period (not during active client email campaigns)?
