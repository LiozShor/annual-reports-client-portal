---
name: monthly-insights
description: Run the monthly agentic-architecture audit. Triggered by the GitHub issue auto-opened on the 1st of each month by `.github/workflows/monthly-audit.yml`. Produces `.agent/insights-audits/YYYY-MM.md` and flags stale memory entries.
---

# /monthly-insights

Triggered when the agentic-audit issue fires on the 1st of the month. Goal: produce a one-month audit file in the same shape as the baseline `.agent/insights-audits/agentic-architecture-audit-2026-04-27.md`, plus a memory-decay pass.

## Inputs (gather before writing)

1. **Git activity since last audit.** `git log --since='1 month ago' --pretty=oneline` — count merges to main, reverts, "fix" commits.
2. **Design-log window.** Files in `.agent/design-logs/**/*.md` with a `Last Updated` or commit timestamp inside the window. Bucket by domain folder. Flag any with status `[REVERTED]` or follow-up "fix-of-fix" pattern.
3. **Memory diff.** New files in `C:/Users/liozm/.claude/projects/C--Users-liozm-Desktop-moshe-annual-reports/memory/` since the last audit. List filename + one-line summary.
4. **Prior audit's proposals.** Read the previous file in `.agent/insights-audits/` and check each proposal's success metric.
5. **CI signal.** GitHub API or `gh run list --workflow=check.yml --limit 50` — count red runs, what failed.
6. **Open agentic-audit issues.** `gh issue list --label agentic-audit --state open` to confirm you're addressing the right month.

## Outputs

Write `.agent/insights-audits/YYYY-MM.md` (where YYYY-MM matches the issue's tag) with sections in this order:

1. **TL;DR** (5 bullets max).
2. **Prior-proposal review.** For each proposal from the prior audit: `Shipped` / `Partial` / `Abandoned` / `In-progress`, with evidence (commit SHA, file path, or "no signal").
3. **Friction signals.** Reverts, fix-of-fix commits, repeated bug patterns. Cite `DL-NNN` or commit SHAs.
4. **Memory decay pass (REQUIRED).** Walk memory files; for each, judge: `keep` / `update` / `remove`. Reasons:
   - Cites a file path, function, or flag that no longer exists in the codebase.
   - Refers to a workflow ID / DL number that has been superseded.
   - Duplicates a now-codified rule in CLAUDE.md.
   List files to remove (do NOT remove them in this run — list and let the user approve).
5. **One concrete proposal for next month.** Single highest-leverage gap. Include: design paragraph, files to modify, rollback, success metric.
6. **Tracking signals delta.** Numeric: red-CI-runs, friction-commit count, new-memory-files count, etc., to feed the next month's audit.

## Format anchor

Match the structural style of `.agent/insights-audits/agentic-architecture-audit-2026-04-27.md` (markdown tables, bold "Why" / "How to apply" lines). Length target: 1/3 of the baseline — this is a delta report, not a full re-audit.

## After writing

Commit on a `DL-monthly-audit-YYYY-MM` branch, push, and append the file path + commit URL as a comment on the triggering GitHub issue. Do NOT close the issue — the user closes it after reviewing.

## Constraints

- Do NOT re-walk the entire 6-component anatomy each month — that's the quarterly job. Monthly = delta + decay + one proposal.
- Do NOT delete memory files autonomously. List them in the decay section.
- Do NOT propose changes outside the `Cloudflare Workers + Hono + TypeScript / Airtable / n8n Cloud / GitHub Pages / Tally / Claude Code on Windows` stack.
