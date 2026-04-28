# Design Log 368: Cloudflare Pages Git Integration Stopped Firing Builds
**Status:** [BEING IMPLEMENTED — DL-368]
**Date:** 2026-04-28
**Related Logs:** None — first incident of this kind

## 1. Context & Problem

Cloudflare Pages project `annual-reports-client-portal` (serves `docs.moshe-atsits.com`) stopped auto-building from GitHub `main` pushes some time on 2026-04-27. Frontend changes pushed to main were not appearing on the live site without somebody manually running `wrangler pages deploy`. The user noticed because frontend changes from the last ~4 commits were not reflected in the browser.

## 2. User Requirements

1. **Q:** Which Cloudflare Pages project is affected?
   **A:** `annual-reports-client-portal` (`docs.moshe-atsits.com`).
2. **Q:** How was the symptom noticed?
   **A:** Frontend changes not live in browser despite pushes to main.
3. **Q:** Action scope?
   **A:** Diagnose + fix automatically (recommended).
4. **Q:** One-shot redeploy of missed commits?
   **A:** Yes — trigger a deploy of current main after fixing.

## 3. Research

### Domain
Cloudflare Pages git integration (GitHub App webhook delivery + repo binding).

### Sources Consulted
Skipped formal Tier-1/2/3 research — this is a CF/GitHub ops diagnostic where the answer comes from inspecting the live API state, not from books or articles. Operational evidence below replaces literature review.

### Key Principles Extracted
- **Verify both ends of an integration.** GitHub knew about the pushes; CF didn't. Checking only one side would have missed the broken binding.
- **Trust deployment metadata.** `deployment_trigger.type` and `commit_dirty` revealed that every recent prod deploy was a manual `wrangler pages deploy` from a dirty tree, not a push-driven build.
- **A repo's GitHub `id` is the stable join key, not its name.** Names get reused; IDs do not. Mismatched IDs are the canonical sign of "repo deleted and recreated".

### Patterns to Use
- For any future "integration silently stopped" report: pull `deployment_trigger.type` from CF, then compare CF `source.config.repo_id` against `gh api repos/{owner}/{repo} --jq .id`.

### Anti-Patterns to Avoid
- "Just click Reconnect and hope" — without first confirming the repo-ID mismatch, we wouldn't have known whether the reconnect was a real fix or a placebo.

### Research Verdict
Diagnose via CF + GitHub APIs (done), then fix via dashboard reconnect (only path — no public API for repo rebinding).

## 4. Codebase Analysis

* **Existing Solutions Found:** None — no existing automation for CF Pages integration health checks. `api/` has `wrangler.toml` for the Worker but Pages config is dashboard-managed.
* **Reuse Decision:** Nothing to reuse; this is a one-off ops fix, not a codebase change.
* **Relevant Files:** None changed. Project build config from CF API:
  - `build_command: ""`
  - `root_dir: ""`
  - `destination_dir: "frontend"`
  - → Pages uploads `frontend/` directly with no build step.
* **Existing Patterns:** Project history shows manual `wrangler pages deploy` has been a recurring fallback (see commit messages "manual deploy: ..."). That pattern masked the integration outage for ~18 hours.
* **Alignment with Research:** N/A
* **Dependencies:**
  - GitHub App: "Cloudflare Pages" installed on `LiozShor` GitHub account
  - CF Pages project source binding (`source.config` in project record)

## 5. Technical Constraints & Risks

* **Security:** Reconnect requires the user's CF + GitHub App owner permissions. No new secrets.
* **Risks:**
  - The reconnect flow may briefly disconnect git integration entirely. Acceptable — manual `wrangler pages deploy` still works as fallback during the gap.
  - If the GitHub App was actually uninstalled (not just out of sync), reconnect requires reinstalling.
* **Breaking Changes:** None.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
A push to `main` produces a CF Pages deployment where `deployment_trigger.type == "github:push"` (not `"ad_hoc"`) and `commit_dirty == false`, and `source.config.repo_id` matches GitHub's current repo ID `1222817442`.

### Logic Flow

**Step 1 (automated, this session) — Catch-up deploy:**
1. `git fetch origin main`
2. `git worktree add ../tmp-deploy-main origin/main` (clean checkout)
3. `npx wrangler pages deploy frontend --project-name=annual-reports-client-portal --branch=main --commit-hash=$(git rev-parse HEAD) --commit-message="<HEAD msg> (manual catch-up — DL-368)"`
4. `git worktree remove ../tmp-deploy-main`

**Step 2 (manual, user does in browser):**
1. CF Dash → Workers & Pages → `annual-reports-client-portal` → Settings → Builds & deployments → Git integration → Manage GitHub App permissions
2. On GitHub Cloudflare Pages app: confirm `LiozShor/annual-reports-client-portal` is in allowed repos; Save.
3. CF Dash → Disconnect Git → Reconnect → select same repo → Save.

**Step 3 (verification, this or next session):**
1. `git commit --allow-empty -m "chore(deploy): verify CF Pages git integration restored (DL-368)" && git push origin main`
2. ~30s later, `wrangler pages deployment list` newest row should show `Source = <new-sha>`, trigger `github:push`, dirty `false`.
3. `curl .../pages/projects/annual-reports-client-portal | jq .result.source.config.repo_id` → expect `1222817442`.

### Data Structures / Schema Changes
None.

### Files to Change

| File | Action | Description |
|---|---|---|
| `.agent/design-logs/infrastructure/368-cf-pages-git-integration-broken.md` | Create | This file |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-368 row |
| `.agent/current-status.md` | Modify | Add DL-368 test entry under Active TODOs (Step 2 user action + Step 3 verification) |

### Final Step (Always)
Mark log `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items into `current-status.md`.

## 7. Validation Plan

- [ ] Catch-up deploy succeeds → `wrangler pages deployment list` shows fresh prod deploy with current `main` HEAD SHA
- [ ] `docs.moshe-atsits.com` serves expected current-main content (cache-bust check in browser)
- [ ] **USER ACTION:** Complete CF Dashboard reconnect (Step 2)
- [ ] Test push to main triggers `github:push` deploy (not `ad_hoc`) — visible in `wrangler pages deployment list`
- [ ] CF API `source.config.repo_id` == `1222817442` after reconnect
- [ ] Decide whether to add a periodic integrity check (e.g. nightly script comparing CF `repo_id` vs GitHub repo `id`) — defer to follow-up DL if approved

## 8. Implementation Notes (Post-Code)

### Evidence captured during diagnosis (2026-04-28T12:14Z)

- GitHub `repos/LiozShor/annual-reports-client-portal` → `id`: **1222817442** (current)
- CF Pages `source.config.repo_id`: **1136319991** (stale, points to a no-longer-existent repo record)
- GitHub `repos/.../events` → 5 PushEvents on `main` between 11:43:39Z and 12:10:37Z, all delivered.
- CF Pages last `github:push` deploy to **production**: 2026-04-27T18:24:31Z (commit `5bc63b16`).
- Every prod deploy on 2026-04-28 (10 deploys) had `deployment_trigger.type=ad_hoc` and `commit_dirty=true` → all manual `wrangler pages deploy` from local checkouts.
- CF project flags: `production_deployments_enabled: true`, `deployments_enabled: true`, `path_includes:["*"]`, `path_excludes:[]`. So the cause is NOT pause/path-filter.

### Note for future
- The repo was at some point deleted+recreated (or transferred and restored) on GitHub, which orphaned CF's binding. We don't have a record of when/why; suggest checking older sessions (`.agent/design-logs/INDEX.md` around 2026-04-27 evening) if recurrence investigation is ever needed.
- Consider a guard: a small script (could live in `scripts/`) that does `gh api repos/LiozShor/annual-reports-client-portal --jq .id` vs CF `source.config.repo_id` comparison and fails CI if they drift. Out of scope for DL-368.
