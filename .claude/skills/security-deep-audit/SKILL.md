---
name: security-deep-audit
description: "End-to-end security and exposure audit of the Annual Reports CRM stack (n8n + Cloudflare Workers + Pages + Airtable + Microsoft Graph + GitHub). Triggers on /security-deep-audit, /audit-security, /full-security-audit, or phrases like 'deep security audit', 'find all leaks', 'audit everything', 'find loose ends', or after a secret rotation completes (post-rotation paranoid sweep), or as a monthly cadence run. Hunts ten categories in parallel: public-repo git-history leakage, document/PII leakage, n8n credential and inline-secret drift, Worker/Pages drift, GitHub posture, local laptop hygiene, third-party SaaS posture, code-level auth/access patterns, time-decaying risks, and known dual-use HEAD constants. Read-only — never auto-rotates, commits, or pushes. Writes a prioritized report to .agent/audits/. Does NOT trigger for n8n silent-drop or workflow-correctness bugs (use silent-failure-hunt instead), single-PR secret reviews (use /security-review), or one-off targeted lookups."
allowed-tools: Bash, Read, Grep, Glob, Agent, WebFetch, WebSearch
---

# Security Deep Audit

Hunts every loose end and exposure across the Annual Reports CRM stack. Output is a prioritized findings report at `.agent/audits/security-deep-audit-YYYY-MM-DD.md` plus a one-line update to `.agent/current-status.md`. Read-only — proposes actions, never takes them.

## When this triggers

- User invokes `/security-deep-audit`, `/audit-security`, or `/full-security-audit`.
- User asks for a "deep security audit", "full security audit", "audit everything", "find all leaks", "check all exposures", "find loose ends".
- Immediately after completing a secret rotation (post-rotation paranoid sweep — verify nothing was missed).
- Monthly cadence (pair with `/loop` or `/schedule`).
- The user mentions a fresh leak incident and wants the blast radius scoped.

## When this does not trigger

- The user is debugging a silent-drop / data-missing bug in n8n or Workers — that is `silent-failure-hunt`.
- The user wants a one-off targeted check ("does this PR leak secrets?") — use `gitleaks detect` directly or invoke `/security-review`.
- The user wants to rotate a known-leaked secret — that is the rotation runbook flow (`.agent/secret-rotation-*.md`), not an audit.
- The user wants a dependency / SCA audit specifically (`npm audit`, `cargo audit`) — out of scope; run those tools directly.
- The user wants UI/UX or feature-correctness review — wrong skill entirely.

## Inputs required

Before running, identify:

- Optional `focus` arg from the slash-command: `secrets-only`, `github-only`, `n8n-only`, `local-only`, `time-bombs-only`, `code-auth-only`. Empty / absent = run all 10 categories.
- Optional `since=<git-ref>` arg to limit the public-repo history scan window. Default = full history (`--all`).
- The canonical clone path (`C:/Users/liozm/Desktop/moshe/annual-reports`). Skill aborts if invoked from any other working directory.

## Workflow

1. **Pre-flight**. Run `bash scripts/preflight.sh`. If exit ≠ 0, surface the missing tool/path/credential and STOP. Do not partial-run.
2. **Estimate runtime**. Sum category cost from `references/category-checks.md` § "Runtime budget". Warn user inline if total >15 minutes; ask confirmation only if >25 minutes.
3. **Load false-positive allowlist** from `.agent/audits/false-positive-allowlist.yaml` if present. Hashes here suppress matching findings (re-fire prevention).
4. **Fan out the 10 categories**. Spawn one Agent per category in parallel using `Agent` tool with `subagent_type=general-purpose` and `model="haiku"` for the read-heavy ones (1, 2, 5, 6, 9, 10) and `subagent_type=Explore` for codebase greps (4, 8). Each subagent gets the matching category section of `references/category-checks.md` verbatim plus the report-finding format from `references/severity-rubric.md`. Each returns a JSON-lines block: `{category, severity, location, evidence_hash, recommended_action, effort_estimate}`. Subagents MUST NOT print actual secret values — only SHA-256 hashes or `[seen at file:line]` references.
5. **Synthesize**. Concatenate per-category output. Apply allowlist suppressions. Sort by severity (CRITICAL→HIGH→MEDIUM→LOW→INFO). Detect duplicate findings across categories (same evidence_hash) and merge.
6. **Render report**. Run `bash scripts/render-report.sh < findings.jsonl > .agent/audits/security-deep-audit-YYYY-MM-DD.md`, using the `assets/report-template.md` skeleton. Include the four mandatory sections: prioritized table, "Time-bombs", "Manual UI checks needed", "Already-protected".
7. **Update status**. Append one line to `.agent/current-status.md` with the count of CRITICAL+HIGH findings, the report path, and the run timestamp. Use Edit, not Write.
8. **Print summary**. Tell the user: report path, top 3 CRITICAL/HIGH findings (one line each), time-bombs count, manual-check count. Stop. Do NOT auto-act on any finding.

## Decision gates

- If pre-flight fails (missing wrangler / gh / gitleaks / not in canonical clone), STOP and report what's missing. Do not partial-run.
- If a category subagent times out or returns malformed JSON, mark that category as "FAILED — see logs" in the report; continue with the others.
- If a finding's `recommended_action` would be destructive (rotation, deletion, force-push), prefix it with "USER ACTION REQUIRED:" and never auto-execute.
- If a finding matches an entry in `.agent/audits/false-positive-allowlist.yaml`, suppress it silently and add to the "Suppressed (allowlisted)" appendix with the hash.
- If `focus=` arg is set, only run the matching category and skip pre-flight checks irrelevant to it (e.g. skip `wrangler` check for `github-only`).
- If the user says a finding was a false positive after the report lands, add its hash + reason to `.agent/audits/false-positive-allowlist.yaml` (instructions in `assets/false-positive-allowlist.example.yaml`).
- If a probe needs an API token the user has not provided (Azure, Tally), mark it `SKIPPED — credential needed: <env var name>`. Never prompt for the secret inline.
- If runtime estimate >25 min, ask user "Run all (Y/n) or pick a focus area?". <25 min runs without asking.

## Output format

Prints inline (concise — full report is on disk):

```md
# Security Deep Audit — YYYY-MM-DD

**Report:** .agent/audits/security-deep-audit-YYYY-MM-DD.md
**Categories:** 10/10 ran (or N/10 — list skipped + reason)
**Findings:** {CRITICAL: N, HIGH: N, MEDIUM: N, LOW: N, INFO: N} · {S} suppressed by allowlist
**Time-bombs (action <7d):** N — see report § Time-bombs
**Manual UI checks needed:** N — see report § Manual UI checks needed

## Top critical findings

1. [SEV] <one-line> — see report § <anchor>
2. [SEV] <one-line> — see report § <anchor>
3. [SEV] <one-line> — see report § <anchor>

## Next step

Review the full report. Skill is read-only — no actions taken.
```

The on-disk report follows `assets/report-template.md`.

## Gotchas

- **Never print actual secret values.** Even truncated. Use `sha256sum | cut -c1-12` for evidence references. Subagents are explicitly told this in `references/category-checks.md`; if a subagent returns a raw value, drop it and re-prompt with a stricter instruction.
- **Pre-flight is non-negotiable.** Running from a session worktree instead of canonical clone gives false negatives (wrangler reads `wrangler.toml` from cwd; gh reads repo from cwd; .env is at canonical root). Abort, don't try to "be helpful" by guessing paths.
- **Subagent fan-out is not free.** 10 parallel Haiku subagents cost ~10× one. The `focus` arg exists so the user can scope cost when they only need one category. Do not silently run all 10 if they ask for one.
- **The allowlist is hash-based, not value-based.** Never store the actual secret in the allowlist file. Only `sha256` of the evidence. This means if the same secret leaks twice with different surrounding context, the hash differs and it re-fires — that is the desired behavior.
- **External SaaS dashboards are JS-only.** Airtable Builder Hub, Anthropic console, Azure portal, Tally dashboard cannot be probed by `WebFetch`. Always emit those as "Manual UI check needed" — never claim "clean" without an API call.
- **gitleaks `detect` vs `protect`.** Use `gitleaks detect --source .` (no `--no-git`) for the public-repo history scan in category 1. `--no-git` would scan the working tree only and miss the actual leak surface (git history). Pair with `--no-git` as a second pass for working-tree-only leaks (gitignored files like `docs/wf05-backup-*.json` that are still on disk).
- **`audit-n8n-credentials.sh` already exists.** Category 3 wraps it — do not re-implement credential drift detection in the skill. If the script's output format changes, the wrapper here breaks; pin the version in `references/category-checks.md`.
- **Time-bomb deduplication.** A subscription expiring in 5 days is in BOTH category 3 (n8n) AND category 9 (time-bombs). Render once with both category tags rather than twice.
- **Don't grow the false-positive allowlist silently.** Each entry needs a `reason` field and an optional `expires_at` so dead allowlists get pruned. The render-report script warns when an allowlist entry is older than 180 days.
- **`docs/multi-tenant-audit.md` redaction baseline.** This file used to leak; current HEAD is redacted. The audit MUST verify the redaction is intact every run — if any of the `[REDACTED-*]` markers gets removed, that is a CRITICAL finding (regression of the 2026-05-02 incident).

## References

- `references/category-checks.md` — the 10 audit categories with exact probes, commands, and report-line format. Load before fan-out.
- `references/severity-rubric.md` — CRITICAL/HIGH/MEDIUM/LOW/INFO definitions with worked examples. Subagents follow this verbatim.

## Assets

- `assets/report-template.md` — the .agent/audits/ report skeleton with the four mandatory sections.
- `assets/false-positive-allowlist.example.yaml` — schema + worked examples for the FP feedback loop.

## Scripts

- `scripts/preflight.sh` — verify canonical clone, .env sourceable, wrangler+gh+gitleaks installed, git clean enough.
- `scripts/render-report.sh` — synthesize JSON-lines findings into the report markdown. Stdin = findings.jsonl, stdout = report.

## Evaluation checklist

- Pre-flight aborts cleanly when invoked outside the canonical clone, with a clear message.
- All 10 category subagents return well-formed JSON-lines (one finding per line, required keys present).
- No raw secret values appear in the report or in chat — only SHA-256 hashes or location references.
- Findings are sorted CRITICAL → INFO and duplicates merged across categories.
- The report contains all four mandatory sections (prioritized table, Time-bombs, Manual UI checks needed, Already-protected).
- `.agent/current-status.md` gets a one-line append, not a Write-overwrite.
- The skill never executes a destructive action even if a finding's recommended_action looks safe.
- The false-positive allowlist suppresses on hash match across runs (re-run with same allowlist → same finding stays suppressed).
- Focus-area arg trims the run to the matching category only.
- `bash scripts/preflight.sh` exits 0 from canonical clone with valid env, ≠0 otherwise.
