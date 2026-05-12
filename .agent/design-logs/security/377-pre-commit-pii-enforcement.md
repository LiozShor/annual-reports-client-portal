# Design Log 377: Pre-commit + CI PII/Secret Enforcement (no-bypass)

**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-04-29
**Related Logs:**
- DL-089 (URL PII removal — archive) — historical PII work
- `.agent/design-logs/security/agent-subtree-split-proposal.md` — alternative path; not executed
- DL-373 (this session) — leaked PII that motivated this DL

## 1. Context & Problem

In a single session (2026-04-29), client PII landed in committed design logs and reached `origin/main`:
- Hebrew client name + email local-part + CPA-ID + OneDrive itemId + Airtable recId
- 5+ commits, all with `git commit --no-verify`
- The bypass was reached because pre-commit hooks (ggshield + gitleaks) hung at session start and the user's "kill the pythons" triage didn't restore hook execution

The local PII guard at `.claude/hooks/agent-pii-guard.py` exists and is well-tuned for CPA-IDs, Hebrew text, and tokens — but `--no-verify` skips it along with the secret scanners.

Server-side checks exist only as `.github/workflows/secret-scan.yml` (TruffleHog `--only-verified`), which doesn't catch our PII shapes (Hebrew names, CPA-IDs, itemIds) and won't fail on unverified strings.

## 2. User Requirements

1. **Q:** Which prevention layers do you want to install?
   **A:** Harness deny rule for `--no-verify` / `--force`; CI workflow with PII guard + gitleaks; wrap slow hooks with timeout. (CLAUDE.md text rule was *not* selected — enforcement preferred over text.)
2. **Q:** Where should the harness deny rule live?
   **A:** Project `.claude/settings.json` (versioned, applies in every worktree).
3. **Q:** What should CI do when it detects PII or secrets?
   **A:** Fail the workflow.
4. **Q:** Pre-commit hook timeout?
   **A:** 30 seconds.
5. **Q:** Should the PII guard regex be extended?
   **A:** Yes — OneDrive itemIds, Airtable recIds, real-client email local-parts.
6. **Q:** What about deeper history (`a2ad5fe0` etc.) that still has PII?
   **A:** Leave it. Forward-only enforcement; data was already public for weeks.

## 3. Research

### Domain
DevSecOps / Pre-commit Enforcement / Secrets-and-PII Defense in Depth.

### Sources Consulted
1. **OWASP Secrets Management Cheat Sheet** + **OWASP CI/CD Security Cheat Sheet** — secrets defense as a pipeline-wide concern; pre-commit is one layer of many, never the only one.
2. **Rafter — "Secret Scanning in CI/CD: detect-secrets vs gitleaks vs trufflehog"** (2026-03-02) — recommends layering: gitleaks for fast pre-commit/CI blocking (regex), TruffleHog for verified-secret scheduled scans. Different tools cover different failure modes.
3. **GitHub aider-ai/aider issue #5057** (2026-04-21) — "pre-commit hooks are used as real security controls, not just formatting checks. For example: secret scanning; blocking …" — community consensus that `--no-verify` is the canonical bypass risk.
4. **GitGuardian docs — git-hooks glossary** — pre-receive hooks (server-side) are the only enforcement layer that survives a client-side bypass.
5. **pre-commit.com fail-fast guidance** + **GitHub pre-commit/pre-commit#3167** — bound hooks must fail fast or developers will reach for `--no-verify`.

### Key Principles Extracted
- **Defense in depth:** local hooks are advisory, CI is mandatory. Treat `--no-verify` as a normal occurrence and design for it. Applies here: we add CI as the real gate.
- **Layered tools:** different scanners catch different things. We already have TruffleHog (verified secrets); add gitleaks (regex secrets) + agent-pii-guard.py (project-specific PII shapes) in CI.
- **Server-side wins:** the only thing a developer can't bypass is a hook that runs on push or merge. GitHub Actions on push to main / PR is our equivalent of pre-receive.
- **Bound hook execution time:** if a hook can hang, the next step is `--no-verify`. We add `timeout 30` to ggshield + gitleaks.
- **Shape-based PII detection beats name-based:** patterns (CPA-IDs, itemId prefix shape, recId prefix shape) generalize without enumerating clients.

### Patterns to Use
- **Defense in depth (local + CI + harness):** every layer covers another's weakness.
- **Fail-fast with timeout:** hooks finish in <5s normally; 30s cap gives slow networks slack but bounds total wait.
- **Allow-list for false-positives:** the email-handle regex needs an allow-list (dev/office/example handles) to avoid blocking on intentional placeholders already in the tree.
- **Digit-required heuristic for recId regex:** Airtable recIds always contain digits, but English camelCase words (e.g. `recoverTemplateId`) do not — gating on `\d` eliminates ~8 false positives in the existing tree without missing any real recId.

### Anti-Patterns to Avoid
- **Relying solely on pre-commit:** anyone with `--no-verify` skips it. We saw this directly today.
- **"Warn only" CI:** ignore-able, functionally equivalent to no enforcement.
- **Enumerating per-client PII manually:** doesn't scale, drifts, becomes another secret to manage.
- **Adding a CLAUDE.md rule alone:** instructions to the agent are not enforcement. The deny rule in `.claude/settings.json` is — the harness blocks the tool call regardless of agent reasoning.

### Research Verdict
The harness deny rule is the highest-leverage layer because it intercepts the call before it reaches git. CI is the unmissable backstop. Pre-commit timeout removes the cause that pushed the agent to `--no-verify` in the first place. The combination is the documented "defense in depth" pattern from OWASP CI/CD and aligns with rafter.so's gitleaks+TruffleHog layering.

## 4. Codebase Analysis

**Existing solutions (reused, not rebuilt):**
- `.claude/hooks/agent-pii-guard.py` — already has the diff-only / `--all` / sanitize-line architecture. We **extend** the `PATTERNS` list and add a `--diff-range BASE HEAD` mode for CI scanning.
- `.pre-commit-config.yaml` — already wires ggshield + gitleaks + agent-pii-guard. We **wrap** the secret-scanner entries with `timeout 30 …`.
- `.github/workflows/secret-scan.yml` — TruffleHog with `--only-verified`. Kept; we add a sibling `pii-guard.yml`.
- `.claude/settings.json` — exists with hooks; we add a `permissions.deny` block.

**Reuse decision:** all existing artifacts stay; we extend in place rather than introducing parallel mechanisms. No new dependencies in CI (gitleaks runs via `gitleaks/gitleaks-action@v2`).

**Relevant files:**
- `.claude/hooks/agent-pii-guard.py` (extending)
- `.pre-commit-config.yaml` (wrapping)
- `.claude/settings.json` (deny rules)
- `.github/workflows/pii-guard.yml` (new)
- `.agent/design-logs/INDEX.md` (new row)
- `.agent/current-status.md` (test items)

**Existing patterns:**
- Workflow style follows `.github/workflows/check.yml` and `secret-scan.yml`.
- Hook entries already use `repo: local` for project-owned scripts.

**Alignment with research:** the codebase's *intent* is correct (pre-commit + TruffleHog), the *enforcement* is just incomplete. We're not redesigning; we're closing the bypass.

**Dependencies:** GitHub Actions runner (Ubuntu, Python 3.11+); `gitleaks/gitleaks-action@v2` (public action).

## 5. Technical Constraints & Risks

- **Security:** the deny rule must be precise — too broad and it blocks legitimate `git commit -v` (verbose) etc. Patterns target the exact long-flag forms (`--no-verify`, `--force`, `--force-with-lease`, short `-f`).
- **False positives in PII guard:** the email-handle regex risks flagging the office `reports@moshe-atsits.co.il`, dev `liozshor1@gmail.com`, schema examples (`client@example.com`, `yosi@example.com`). Allow-list mitigates. The recId regex required a digit-presence heuristic to skip camelCase English words.
- **CI cost:** gitleaks + the python guard add ~30-60s per push. Acceptable; runs in parallel with `check.yml`.
- **Breaking changes:** none. Pre-existing `.agent/` content is grandfathered (default mode is diff-only, CI uses ref-range diff).
- **Bypass paths still open:** a developer could (a) edit `.claude/settings.json` and remove the deny rule, then commit. The CI gate catches this on push if `.claude/settings.json` change is part of the same PR. Long-term, GitHub branch-protection "required status checks" makes the CI gate non-negotiable; that's a separate config in repo settings (called out as a follow-up).

## 6. Proposed Solution

### Success Criteria
A `git commit --no-verify` attempt by the agent in any worktree is blocked by the harness; any push that reaches origin with PII or secrets in a diff fails CI; pre-commit hooks always exit within 30s.

### Logic Flow
1. Agent attempts `git commit --no-verify`. Harness reads `.claude/settings.json` deny rule → blocks tool call → user is informed.
2. Developer commits normally. `pre-commit` runs ggshield + gitleaks + `agent-pii-guard.py` with `timeout 30` wrapper. On hang, exits in 30s with non-zero — commit blocked, no `--no-verify` available to the agent.
3. Branch is pushed. `pii-guard.yml` runs on the push event:
   - `python3 .claude/hooks/agent-pii-guard.py --diff-range BASE HEAD <changed .agent/ files>`
   - `gitleaks/gitleaks-action@v2` over the diff
   - Either fails → workflow red → branch-protection blocks merge.
4. PR opened against main: same workflow runs in PR context (BASE = `pull_request.base.sha`).

### Data Structures / Schema Changes
None. All edits are config or regex.

### Files Changed
| File | Change |
|------|--------|
| `.claude/settings.json` | Added `permissions.deny` block |
| `.github/workflows/pii-guard.yml` | New CI workflow |
| `.pre-commit-config.yaml` | Wrapped gitleaks + ggshield entries with `timeout 30` |
| `.claude/hooks/agent-pii-guard.py` | Added itemId, recId, client-email patterns; added `--diff-range BASE HEAD` CI mode |

### Final Step (Always)
- **Housekeeping:** flip status to `[IMPLEMENTED — NEED TESTING]`, add Section 7 items to current-status.md, push branch, pause for explicit merge approval.

## 7. Validation Plan
- [ ] Harness deny works: attempt `git commit --no-verify` in a fresh Claude session — blocked
- [ ] Harness deny works (force push): attempt `git push --force-with-lease origin <branch>` — blocked
- [ ] CI fails on PII: open draft PR with a CPA-ID literal in a `.agent/` file — `pii-guard.yml` red
- [ ] CI fails on secret: open draft PR with fake AWS key in any file — `pii-guard.yml` red (gitleaks)
- [ ] CI passes on clean diff: any benign PR shows green
- [ ] Hook timeout fires: simulate slow network → hook exits ~30s with timeout error, not a hang
- [ ] PII guard catches itemId: stage an itemId-shaped literal in a `.agent/` file → blocked
- [ ] PII guard catches recId: stage a recId-shaped literal in a `.agent/` file → blocked
- [ ] PII guard catches client email: stage a real-shaped client email under `.agent/` → blocked; allow-listed handles do not
- [ ] No regression on existing `.agent/` tree: `python3 .claude/hooks/agent-pii-guard.py --all` produces no NEW errors vs. pre-DL baseline (run before+after, diff the output) — confirmed pre-merge: 429 → 474 (45 new matches are real recIds/itemIds in grandfathered content; no new false positives)
- [ ] Followup TODO: enable GitHub branch-protection "required status checks" for `pii-guard.yml` so the CI gate becomes mandatory — one-time GitHub UI step

## 8. Implementation Notes (Post-Code)
- Extended `.claude/hooks/agent-pii-guard.py` `PATTERNS` with itemId / recId / client-email regexes, plus a `--diff-range BASE HEAD` mode so CI can scan the push/PR diff (default mode still uses `git diff --cached` for pre-commit).
- Tightened the recId regex with a `(?=[A-Za-z0-9]*\d)` lookahead so camelCase English words like `recoverTemplateId` don't trigger; verified ~8 false-positive lines disappeared between the first regex draft and the final.
- Switched gitleaks from the upstream pre-commit hook to a local `timeout 30 gitleaks protect --staged` entry so the `timeout` wrapper is actually applied (the upstream hook builds gitleaks via Go and hides its entry from override).
- Research principles applied: defense in depth (OWASP CI/CD), fail-fast (pre-commit.com), shape-based PII detection (rafter.so).
