# Agentic Architecture Self-Audit — 2026-04-27

Reference: Alex Greenshpun's "Miss Chief" talk (autonomous Chief of Staff). Goal: pair every aggressive autonomy with an automated guardrail.

This file is a tracking baseline. Re-run quarterly; diff against prior audits.

---

## TL;DR

- **Strongest pillars:** Skills/Integrations, Brain (memory), local Safety Shield (commit-time secret + PII scanning).
- **Weakest pillars:** Self-Improvement loop (conceived, never executed — `.agent/insights-audits/` was empty before this file), CI/CD verification (only secret-scan runs in CI; no typecheck, no tests, no deploy gate), Heartbeat (no autonomous background monitors — UptimeRobot is the only passive watcher).
- **Biggest anti-pattern:** Wide-open permissions (`"*"` in `.claude/settings.local.json:5`) paired with **no prompt-injection scanner** on `WebFetch`/external `Read`. Autonomy without a guardrail.
- **Top 3 leverage moves:** (1) CI typecheck+test gate, (2) Monthly scheduled insights audit, (3) Tighten permissions + add prompt-injection sniff hook on external content reads.
- **Skip:** multi-CLI orchestration, calendar/Telegram integrations, knowledge graph, repo-forensics scanner. Solo dev + one production platform doesn't justify the maintenance.

---

## Part 1 — Current State Map (against the 6-component anatomy)

### 1. Brain — Memory (3-layer proactive recall)

| Layer | Have? | Evidence |
|---|---|---|
| Session recall | ✅ | `.agent/current-status.md` (47KB, updated per session) |
| Knowledge graph / typed memory | ✅ partial | `C:/Users/liozm/.claude/projects/C--Users-liozm-Desktop-moshe-annual-reports/memory/` — 37 files, 4 types (feedback/project/reference/user), index in `MEMORY.md` |
| Behavioral patterns | ⚠️ partial | Exists implicitly in `feedback_*.md` files (e.g. `feedback_design_log_branch_setup.md`, `feedback_n8n_code_node_mode.md`); no automatic distillation |
| Cross-session structured logs | ✅ | `.agent/design-logs/INDEX.md` — 221 logs, 10 domain folders |

**Gap:** memory is read on every session via `MEMORY.md` (always loaded), but there's no **automatic recall trigger** for the design-log archive. When working on a new email bug, the agent doesn't auto-pull `email-bilingual-card` or `common-mistakes.md` unless a CLAUDE.md rule forces it.

### 2. Safety Shield — Layered scanning before/after AI sees content

| Defense | Have? | Evidence |
|---|---|---|
| Secret leak in git diff | ✅ strong | `C:/Users/liozm/.claude/settings.json:71` PreToolUse Bash hook (regex on `git commit`); local pre-commit `gitleaks` + `ggshield`; CI `.github/workflows/secret-scan.yml` (TruffleHog `--only-verified`) |
| PII (CPA-IDs, Hebrew client data) in `.agent/` commits | ✅ | `.claude/hooks/agent-pii-guard.py` |
| Destructive shell guard | ✅ | `C:/Users/liozm/.claude/settings.json:79` rm-rf root-path block + project `settings.local.json:23` deny list |
| Sensitive Read warning | ✅ weak | Logs to stderr only — informational, not blocking |
| **Prompt-injection scan on external content** | ❌ **MISSING** | No hook on `WebFetch`, no scan of `Read` results from arbitrary file paths, no scan of MCP tool results before they enter context |
| **MCP tool poisoning detection** | ❌ MISSING | No allowlist of tool descriptions/hashes; new MCP tool definitions enter context unaudited |
| **Supply chain (npm install, pip install)** | ⚠️ partial | `npm install --no-audit` runs unattended on SessionStart (`settings.json:122`); deny rule on `npm publish` and `npx -y` only |

### 3. Heartbeat — Autonomous background monitors

| Monitor | Have? | Evidence |
|---|---|---|
| Worker uptime | ✅ external | UptimeRobot `https://stats.uptimerobot.com/8VXdFEnkD9` (per `MEMORY.md`) |
| Worker error trend | ⚠️ passive | `api/src/lib/error-logger.ts` writes to Airtable; no agent-side pull/alert |
| n8n workflow side-effect alerts | ✅ narrow | `.claude/hooks/n8n-wf-put-reminder.py` (PostToolUse) — only fires when *agent itself* PUTs |
| Airtable schema drift / record-count anomalies | ❌ | None |
| Email queue depth / send failures | ❌ | None |
| Daily digest of "what changed yesterday" | ❌ | None |

**Heartbeat is the most under-built component.** Nothing runs unless the agent is invoked.

### 4. Automation Engine — Cron / scheduled

| Scheduled task | Have? | Evidence |
|---|---|---|
| `loop` and `schedule` skills | ✅ | Listed in global allow-permissions; never invoked according to scheduled-tasks dir |
| Scheduled remote agents | ⚠️ stub | `C:/Users/liozm/.claude/scheduled-tasks/insights-rerun-baseline-check/SKILL.md` exists alone — no JSON config, no recent runs |
| GitHub Actions cron | ❌ | Only `secret-scan.yml` (push/PR triggered, not cron) |

**Net:** automation infrastructure is installed, but the cron list is essentially empty.

### 5. Skills + Integrations

| Bucket | Status |
|---|---|
| Project skills (`.claude/skills/`) | ✅ 9: find-skills, n8n-mcp, session-start, silent-failure-hunt, skill-creator, ssot-verify, subagent-driven-development, workers-best-practices, wrangler |
| Global skills (`C:/Users/liozm/.claude/skills/`) | ✅ 30+: design-log, consult, git-ship, second-opinion, supply-chain-risk-auditor, audit-context-building, etc. |
| Domain MCP servers | ✅ n8n-mcp, Airtable, Tally, Playwright, Figma, Canva, Gmail |
| Subagent custom types | ✅ 4 in `C:/Users/liozm/.claude/agents/`: code-analyzer, file-analyzer, parallel-worker, test-runner |

**Strongest pillar.** No gap worth filling.

### 6. Self-Improvement — Overnight loop with rollback

| Capability | Have? | Evidence |
|---|---|---|
| Periodic self-evaluation | ❌ | `.agent/insights-audits/` was empty (this file is the first) |
| Identify weakest area | ⚠️ manual | `audit-context-building` skill exists but is user-invoked |
| Attempt fix + measure | ❌ | None |
| Auto-rollback if worse | ❌ | None |

**This pillar effectively does not exist.** The infrastructure (memory, design logs, skills) supports it, but the trigger and measurement loop are missing.

### Verification Stack (cross-cutting)

| Layer | Status |
|---|---|
| Linters | ⚠️ manual: `./node_modules/.bin/tsc --noEmit` documented in global CLAUDE.md but not enforced |
| Testing | ⚠️ `api/test/` exists; not invoked by CI |
| CI/CD | ❌ only secret-scan; no typecheck, no test, no `wrangler deploy --dry-run` |
| Monitoring | ✅ UptimeRobot + Airtable error-log table |

The most important guardrail — *does the code build and pass tests?* — is **not** enforced before merge.

---

## Part 2 — Gap Analysis (impact × effort)

| # | Gap | Impact | Effort | Unlocks | Min-Viable Version | Maint. cost |
|---|---|---|---|---|---|---|
| G1 | **No CI typecheck/test gate** | 🔴 high | 🟢 low | Catches `tsc` errors and broken Worker bundles before main; eliminates "deploy then realize it broke" | One workflow file: `.github/workflows/check.yml` running `npm ci && ./node_modules/.bin/tsc --noEmit && npm test --if-present && npx wrangler deploy --dry-run` on push to feature branches | ~0 — runs free on GitHub |
| G2 | **No prompt-injection scan on external reads** | 🔴 high | 🟡 med | Defense against poisoned web pages, n8n responses, email bodies (`Read` of fetched HTML) entering Claude's context with hidden instructions | PreToolUse hook on `WebFetch` + `Read`-of-`tmp/` that greps the result for known-injection sentinels (`ignore previous instructions`, `system:`, base64 blobs >2KB, etc.) and warns. Block on regex hit > N | ~10 LoC Python; rare false positives |
| G3 | **Self-improvement loop is null** | 🟡 med | 🟡 med | Compounds: each month the agent reads its own design logs + memory + git activity, finds the friction point, proposes one fix | Monthly `schedule` agent that opens an issue or appends to `.agent/insights-audits/YYYY-MM.md` summarizing top friction patterns from the prior month's design logs | ~1 audit/month; outputs reviewed by you |
| G4 | **Permissions: `"*"` is universal allow** | 🟡 med | 🟢 low | Replacing `"*"` with explicit category allows means new tool types (`mcp__*__write*`, `Bash(curl ... POST ...)`) require approval | Replace `"*"` with `["Read","Write","Edit","Bash","Glob","Grep","WebFetch","WebSearch","Task","Skill(*)"]` and rely on the existing deny list | ~0; surfaces new tools as they appear |
| G5 | **No proactive Worker error monitor** | 🟡 med | 🟡 med | Daily summary of new error categories without you having to ask | Cron-scheduled agent (or n8n workflow) that queries the Airtable error_log table for last 24h, groups by `category`, posts a digest into `.agent/current-status.md` if anomaly | Light — n8n + a tally |
| G6 | **MCP tool description not pinned** | 🟢 low | 🟡 med | Tool poisoning resistance | Hash `claude_ai_*` tool list at session start, diff against last known-good | Some friction; diminishing returns for solo |
| G7 | **CLAUDE.md violates its own token-cost rule** | 🟢 low | 🟢 low | Cheaper context | Project CLAUDE.md is ~6KB; global CLAUDE.md is ~10KB. Move bottom-half tables (jargon list, n8n quirks not used every session) into on-demand docs | One-shot trim |
| G8 | **`design-log` archive not auto-recalled** | 🟢 low | 🔴 high | Smarter pattern reuse | A semantic index over 221 design logs that surfaces relevant prior fixes when starting a new task | Big project; defer |

---

## Part 3 — Top 3 Concrete Proposals

### Proposal 1 — CI typecheck + test + dry-run-deploy gate

**Design.** A single GitHub Actions workflow that runs on every push to a `DL-*` branch and every PR to `main`. It executes `tsc --noEmit` for both the root and `api/`, runs whatever tests exist (`npm test --if-present` in `api/`), and a `wrangler deploy --dry-run` to catch bundle-size and binding errors. This is the single highest-leverage missing guardrail — the current setup ships every commit assuming it builds. Pair with required-status-check on `main` so a red CI blocks merge. This is the structural safety net that lets you keep shipping fast.

**Files to create / modify.**
- Create `.github/workflows/check.yml` with three jobs: `typecheck`, `test`, `dry-run-deploy`. Use `actions/setup-node@v4` (Node 20), cache `~/.npm`.
- Modify GitHub repo settings (manual, web UI): Branch protection on `main` → require `check.yml` to pass.
- Optionally add `package.json:scripts.check` aggregating the three commands so locally `npm run check` mirrors CI.

**Rollback.** Disable required status check; delete `check.yml`. No data effect.

**Success metric (next monthly insights audit).**
- Count merged commits to `main` in the prior month with broken `tsc` (currently unknown but discoverable via `git bisect` of `tsc --noEmit`). Target: zero after CI lands.
- Count of "fix: typecheck" / "chore: fix build" follow-up commits on `main`. Target: drops to zero.

---

### Proposal 2 — Monthly scheduled Insights Audit

**Design.** Use the `schedule` skill (already permissioned globally) to register a recurring routine on the 1st of each month. The routine: read `git log --since='1 month ago'`, scan `.agent/design-logs/` for logs created/closed in window, grep memory files for new entries, and produce `.agent/insights-audits/YYYY-MM.md` summarizing: (a) friction signals (commit messages with "fix" or "revert"), (b) memory churn (new feedback files = lessons learned), (c) one concrete improvement proposal for the next month. This compounds — each month's audit cites the prior one's proposal, creating an accountability chain. It's the missing self-improvement pillar.

**Files to create / modify.**
- Create `.agent/skills/monthly-insights/SKILL.md` describing the audit prompt (inputs, outputs, format).
- Register the schedule via the `schedule` skill: cron `0 9 1 * *` (9 AM local on the 1st), command: invoke the skill above.
- Add a single line to project `CLAUDE.md` under "Operating Mode": `12. **Monthly insights:** automatic audit on the 1st of each month → .agent/insights-audits/`.

**Rollback.** `schedule list` → `schedule delete <id>`. Delete the skill file.

**Success metric.** Three signals at the next quarterly audit:
- File count in `.agent/insights-audits/` grows by ≥ 1 per month.
- Each audit references the prior audit's proposal and notes whether it was implemented (yes/no/abandoned).
- Friction signal count (revert + "fix typo" commits per month) trends down quarter over quarter.

---

### Proposal 3 — Tighten permissions + prompt-injection sniff hook

**Design.** Two paired changes that restore the autonomy/guardrail balance. (1) Replace the `"*"` allow in `.claude/settings.local.json:5` with an explicit category list — this is mostly cosmetic (existing deny list already blocks dangerous Bash) but it makes new MCP write tools surface for approval rather than silently auto-allowing. (2) Add a PreToolUse hook on `WebFetch` and `Read` (path matcher: `tmp/*`, `**/*.html`, `*.eml`) that greps the *result* for prompt-injection sentinels and emits a warning to stderr if hit. The pattern set: `ignore (all )?previous instructions`, `system:\s*[A-Z]`, `</?(s|sys|admin)>`, base64 blobs > 2KB, `<!--\s*claude:`, etc. This is the missing input-side defense layer — currently nothing scans content the agent ingests, only what it commits.

**Files to create / modify.**
- Modify `.claude/settings.local.json`: replace `"*"` with `["Read","Write","Edit","Bash","Glob","Grep","WebFetch","WebSearch","Task","Skill(*)","mcp__n8n-mcp__*","mcp__playwright__*"]`.
- Create `.claude/hooks/prompt-injection-sniff.py`: reads `CLAUDE_TOOL_RESULT` (or stdin), greps sentinels, exits 0 with warning to stderr, never blocks (warn-only for first month to gauge false-positive rate).
- Wire as `PostToolUse` (not `PreToolUse` — we need the result) for matchers `WebFetch`, `Read` in `.claude/settings.json`.

**Rollback.** Revert `settings.local.json` to `"*"`. Remove the hook block. Delete the script.

**Success metric.**
- New tool surface: count of tools that prompted for approval in the first month after tightening (signals real coverage gain). Target: ≥ 1.
- Hook fires: count of `[prompt-injection-warn]` lines logged in the first month. Target: any number > 0 with zero blocks (warn-only) confirms the sniff is wired and seeing real content. After 30 days, decide whether to escalate to blocking.

---

## Part 4 — Anti-Patterns Spotted (autonomy without guardrail / theater)

1. **Wide-open `"*"` permission + no input-side scan.** The single biggest violation. Aggressive autonomy on tools, zero scanning of what the tools return. (Addressed by Proposal 3.)

2. **`MEMORY.md` keeps growing — no decay protocol.** Some memories cite "DL-287", "DL-180" etc. The CLAUDE.md says "memory can become stale" but nothing prunes. The "before recommending from memory, verify it still exists" instruction is honor-system. *Pair-the-guardrail fix:* an annual memory-decay pass (could be part of Proposal 2's monthly audit).

3. **Project CLAUDE.md prohibits asking before pushing, but global memory says the opposite.** `MEMORY.md` line 4 (`feedback_ask_before_merge_push.md`) overrides the project rule. This is fine in intent — the tighter rule wins — but it's confusing and shows up as conflicting instructions in context. Consolidate into the project CLAUDE.md.

4. **Auto-`npm install` on SessionStart, no signature pin.** `settings.json:122` runs `npm install --no-audit --no-fund` unattended. Combined with `enableAllProjectMcpServers: true`, a malicious dependency could land in your tree before you see anything. *Guardrail:* either drop `--no-audit` or run `npm ci` (lockfile-strict) instead of `npm install`.

5. **n8n PUT-reminder hook is a *reminder*, not a *block*.** The hook tells you to toggle `availableInMCP` back on after a REST PUT. If you miss the message, the workflow silently breaks for future MCP reads. A real guardrail would be a *blocking* `PreToolUse` rejecting `PUT api/v1/workflows/*` and forcing the agent to use `n8n_update_partial_workflow` instead.

6. **`.agent/insights-audits/` was empty for ~2 weeks** (folder created Apr 15, this is the first file). Self-improvement was an aspiration, not a process. (Addressed by Proposal 2.)

7. **Design-log Phase C requires plan-mode approval, but commits + pushes auto-fire.** The early gate is strong (you approve the plan); the late gate is gone (project CLAUDE.md says "Always push after committing — do NOT ask"). For this single dev/single-platform setup that's reasonable; just be aware it's a deliberate asymmetry.

8. **Subagent dispatch pushes a model-routing rule** ("default to haiku for data-gathering") *but* there's no mechanism that enforces it. It's instruction text, not a hook. Could be a legitimate skip — costs are visible in usage data — but worth flagging as theater-vs-mechanism.

---

## Part 5 — Don't-Build List (overkill for a solo CPA-firm automation)

| Reference architecture component | Verdict | Why skip |
|---|---|---|
| **Multi-CLI orchestration (Claude/Codex/Gemini)** | ❌ skip | Single dev, single Anthropic billing. Multi-CLI = three cost ceilings, three context windows to manage, three sets of skills to maintain. The marginal model-quality gain is invisible against the operational overhead. |
| **Calendar / Telegram / WhatsApp / Slack glue** | ❌ skip | Miss Chief is a Chief of Staff for a person with meetings. You have one office stakeholder (Natan), and the existing Gmail MCP + email digests cover everything. |
| **3-layered proactive memory (session/graph/behavioral)** | ❌ skip | The 4-type system in `MEMORY.md` already does behavioral patterns (`feedback_*`) and references (`reference_*`). A formal knowledge graph adds query overhead with no concrete query you'd run. |
| **Repo-Forensics scanner (auto-scan on git clone)** | ❌ skip | You don't `git clone` random repos as part of operations. The supply chain you actually consume is `npm install` against a pinned `api/package.json`. Proposal 3 + an `npm ci` swap covers the realistic threat. |
| **Heartbeat with content/pipeline/ops monitors** | ⚠️ partial | UptimeRobot covers ops. *One* additional monitor (Worker error digest, Proposal 5 in Gap table — not in Top 3) is worth it; a fleet of three is not. |
| **Self-improvement with auto-rollback** | ⚠️ keep manual | Proposal 2 builds the audit + identification step. The "auto-attempt-fix and rollback" loop adds significant complexity (sandboxed branch, A/B comparison, rollback heuristics) for a workflow where you can read the audit and decide in 5 minutes. Manual approval keeps you in the loop without building a meta-agent. |
| **Safety classification of every input** | ⚠️ scoped | Full Miss Chief layered classification is overkill. Proposal 3's *single* sniff hook on `WebFetch` + selected `Read` paths catches 90% of the realistic threat (poisoned doc, malicious email body) for ~30 lines of Python. |
| **Knowledge-graph over design logs** | ❌ skip | Build it only if Proposal 2's monthly audit ever reports "I keep solving the same bug pattern and the design-log archive isn't surfacing it." Until that signal exists, `Grep` over 221 markdown files is fine. |

---

## Tracking signals for the next audit (2026-05-27)

When this is re-run, check:

1. Did Proposal 1 (CI gate) ship? → yes/no, broken-build commit count delta.
2. Did Proposal 2 (monthly audit) ship and fire at least once? → file in `.agent/insights-audits/2026-05.md`?
3. Did Proposal 3 (perms + sniff) ship? → false-positive count, blocked-tool count.
4. Memory churn in the month: new files in `C:/Users/liozm/.claude/projects/.../memory/` count; any decayed/removed?
5. New design logs in window with category "revert" or "fix-of-fix" — friction signal.
6. Anti-pattern #4 (auto-`npm install`) addressed by switching to `npm ci`?

If two consecutive audits show no movement on Proposal 1, that's the "abandoned" signal — re-evaluate whether CI is actually wanted or if the proposal was wrong.

---

## Wave 1 Implementation — 2026-04-27

Branch: `DL-CI-wave1` (commit `942ff9e`).

### Change 1 — SessionStart `npm install` → `npm ci` — **PARTIAL**

- File: `C:/Users/liozm/.claude/settings.json:96` — replaced. Now runs `npm ci --prefer-offline` and SKIPs with a visible message if `package-lock.json` is missing rather than auto-regenerating.
- Local `npm ci` in `api/` completed cleanly during verification.
- Memory entry added: `reference_session_start_npm_ci.md` + `MEMORY.md` index line.
- **Why partial:** the hook only fires when `node_modules` is missing. In day-to-day use it rarely runs. The bigger discovery is in Change 2 below — the lockfile isn't even tracked in git, so any future `npm ci`-based reproducibility (CI, fresh clone, new worktree) is blocked at a more fundamental level.

### Change 2 — CI typecheck + dry-run gate — **BLOCKED on a pre-existing repo policy**

- File created: `.github/workflows/check.yml` — two jobs (`typecheck`, `dry-run-deploy`), Node 20, npm cache, runs on `push: DL-*` and `pull_request -> main`.
- File created: root `package.json` with `npm run check` mirroring CI locally. Repo had no root `package.json` previously — confirmed before adding. No script conflict.
- Verified `npx wrangler deploy --dry-run --outdir=/tmp/dist` works in `api/` with **no** Cloudflare secrets — only reads bindings from `wrangler.toml`. CI workflow therefore needs no `CLOUDFLARE_API_TOKEN`.
- **Blocker:** both `api/package-lock.json` and root `package-lock.json` are listed in `.gitignore:55-56`. CI's `actions/setup-node@v4` with `cache-dependency-path: api/package-lock.json` fails immediately with `##[error]Some specified paths were not resolved, unable to cache dependencies` because the lockfile is not in the tree. Even without caching, `npm ci` itself requires a committed lockfile and would fail.
- **Verification status:**
  - DoD called for a `DL-CI-test` branch with a deliberate `tsc` error to confirm red CI. Branch was created, pushed, run went red — but red at the setup-node cache step, **before** `tsc` executed. So CI is wired but not yet meaningfully validating typescript.
  - CI red run URL (DL-CI-test, the deliberate-error commit): https://github.com/LiozShor/annual-reports-client-portal/actions/runs/24982285249
  - Wave1 branch's own check run (also red, same root cause): https://github.com/LiozShor/annual-reports-client-portal/actions/runs/24982267765
  - Remote DL-CI-test branch deleted. Local DL-CI-test ref retained (denied delete; harmless).
- **Resolution path — needs your call:** Two choices, listed in order of strength.
  1. **Un-gitignore the lockfiles, commit them, keep `npm ci` in CI.** This is the supply-chain-correct answer (deterministic builds, audit trail of dependency upgrades). It changes the repo's historical posture but matches the audit's own anti-pattern #4 fix.
  2. **Keep lockfiles gitignored, switch CI to `npm install` (no cache).** Looser but works immediately. Means CI may install a different transitive tree than your laptop — which is exactly what `npm ci` is supposed to prevent.
- **Branch protection settings to flip manually after lockfile is committed (GitHub web UI):** Settings → Branches → Add classic rule for `main` → enable "Require status checks to pass before merging" → search and select both `typecheck` and `dry-run-deploy` → also enable "Require branches to be up to date before merging" → Save.

### Change 3 — Monthly audit GitHub-issue trigger — **PARTIAL**

- File created: `.github/workflows/monthly-audit.yml` — cron `0 6 1 * *`, `workflow_dispatch` enabled, single job opens an issue labeled `agentic-audit` linking to the most recent audit file in `.agent/insights-audits/` and including the 6 tracking signals + DoD checklist.
- File created: `.agent/skills/monthly-insights/SKILL.md` — inputs (git/design-log/memory diff, prior-proposal review, CI red-count), outputs (`.agent/insights-audits/YYYY-MM.md` with required memory-decay section), constraints.
- File modified: project `CLAUDE.md` operating-mode line 12 added.
- **Why partial:** GitHub limits `workflow_dispatch` to workflows present **on the default branch**. The workflow exists only on `DL-CI-wave1` until merged. Manual dispatch attempt returned `HTTP 404: workflow monthly-audit.yml not found on the default branch`. **Verification deferred until merge to `main`.** Cron `schedule:` triggers have the same default-branch restriction — the first scheduled fire on 2026-05-01 will only happen if the workflow lives on `main` by then.
- **DoD-required test issue URL: not yet available** — cannot create until merge.

### Deferred

These were noticed but not fixed, per Wave 1 scope rules:

1. **Lockfiles gitignored (`.gitignore:55-56`).** This is the actual blocker for Change 2 and the deeper version of anti-pattern #4. Decision needed from you (see Change 2 resolution paths).
2. **`PostToolUse: n8n-wf-put-reminder.py` uses a relative path.** When the agent's shell cwd drifts (e.g. `cd api`), the hook fires from `api/.claude/hooks/...` and prints "No such file or directory" for every Bash call. Fix: change `python3 .claude/hooks/...` to use `$CLAUDE_PROJECT_DIR` or an absolute path. (`.claude/settings.json` PostToolUse Bash entry.)
3. **Bash tool sticky cwd.** Discovered mid-session: `cd api && ...` persists across Bash calls in this harness, contradicting my mental model. Not a fix needed in the repo, but worth a memory entry — would prevent the hook noise above and the `git add` failure I hit. Suggest: `feedback_bash_cwd_sticky.md`.
4. **Memory decay backlog.** `MEMORY.md` already has stale-looking entries (DL-180, DL-287, DL-311, DL-314 referenced as "live" with dates). The monthly audit's required memory-decay pass will start chewing through these.
5. **Local `DL-CI-test` ref retained.** Remote deleted; local kept after permission denial. Run `git branch -D DL-CI-test` manually if you want it gone — or it'll auto-prune on next gc.
6. **`api/test/` exists, never wired.** Out of scope for Wave 1 by your instruction. When you audit it for Wave 2, the existing `npm test` script in `api/package.json:8` (`node --test test/**/*.test.mjs`) already works locally; CI integration is two more lines in `check.yml`.
7. **Wrangler version drift.** `npx wrangler --dry-run` printed an "update available 4.85.0 → current 4.76.0" notice. Cosmetic but worth tracking.

### Branch-protection settings — exact UI clicks

(Repeat from Change 2 for ease of reference.) GitHub web UI → repository **Settings** → **Branches** → **Add branch protection rule** → Branch name pattern: `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- Status checks search box: add `typecheck` and `dry-run-deploy`
- (optional) ✅ Do not allow bypassing the above settings

Save. **Do this only after the lockfile question (Deferred #1) is resolved and you've seen at least one green run on a feature branch.**

