# Severity rubric

Apply this verbatim. If a finding fits multiple tiers, take the higher.

## CRITICAL

Live, exploitable secret accessible without further information, OR a time-bomb expiring in <72h that breaks production.

Examples:
- Live, unrotated secret in HEAD of public repo (full string).
- Admin endpoint reachable without any auth.
- MS Graph subscription expiring in <72h with no renewal cron.
- Resurfaced 2026-05-02 leaked value (regression — by definition known-bad).
- CORS allowing `*` on an authenticated endpoint that returns PII.
- Pre-commit hooks completely missing on a repo that's supposed to have them.

Action template: "USER ACTION REQUIRED: rotate within 1 hour AND fix source."

## HIGH

Significant exposure that requires action this week, OR weakens the defense-in-depth posture meaningfully.

Examples:
- Live, unrotated secret in old commit on public repo (history-only, no longer in HEAD).
- Hardcoded secret-shaped constant in `api/src/` (e.g. ONEDRIVE_SHARING_TOKEN known case).
- Open GitHub Secret-Scanning alert.
- Branch protection on `main` missing required checks.
- Outside collaborator with write access to the repo.
- Inline secret literal in an active n8n workflow Code node (Credential-store drift).
- Office document (`.docx`/`.xlsx`/etc) tracked in git.
- n8n workflow export tracked in git.
- Real client name / email / phone / Israeli ID found in tracked file.
- HMAC token verified with non-timing-safe comparison (timing-attack).
- Phase-2 prevention hook missing or broken.

Action template: "Schedule fix this week. Specify timeline."

## MEDIUM

Worth fixing in the next sprint or two; not actively exploited but the gap is real.

Examples:
- Truncated key prefix >12 chars in HEAD (narrows guessing).
- n8n credential orphan (>30 days unused).
- Inline secret in DEACTIVATED n8n workflow (still leaks via export).
- Worker secret declared in `wrangler.toml` comment but missing on Worker (silent break risk).
- Deferred rotation older than 90 days.
- Stale NEED-TESTING DL older than 30 days.
- Out-of-band Worker on the CF account (not in repo).
- Playwright screenshot tracked.
- Drift between `.env` and Worker secrets.
- Anthropic API key older than 180 days.
- Azure client secret expiring <30 days.

Action template: "Add to backlog. Suggest grouping with related work."

## LOW

Hygiene-only; no realistic exploit path. Track but don't urgent-fix.

Examples:
- Rotated secret in old commit (history retains it but value is dead).
- Hebrew text in tracked file outside the guard scope (likely UI label).
- Stale worktree on already-merged branch.
- Audit-doc plaintext-marker pattern hit without an actual secret value nearby.
- Orphan GitHub Actions secret (no workflow references it).
- Read-only deploy key.
- Over-privileged GitHub PAT scope.

Action template: "Cleanup candidate. No deadline."

## INFO

Already-protected assertions and observability data. Always include some — it's how the user knows the audit actually checked the thing rather than silently skipping.

Examples:
- "Worker secret X exists and matches name in wrangler.toml comment."
- "DRIVE_ID hardcoded — identifier, not credential, acceptable."
- "Airtable base ID present in source (acceptable — public identifier)."
- "GitHub Push Protection enabled."
- "Branch protection on main: enforced."

## CLEAN

The category found nothing worth reporting. Emit ONE line per category that came back clean — required, so the report shows what was actually checked.

Format:
```json
{"category":"<N-name>","severity":"CLEAN","title":"<category> — no findings","location":"-","evidence_hash":"-","recommended_action":"-","effort_estimate":"-","manual_ui_check":false,"time_bomb_days":null}
```

## Time-bomb tagging

Set `time_bomb_days: <int>` on any finding where the recommended action becomes more expensive (or impossible) after the deadline. Examples:
- MS Graph subscription expires in 5 days → `time_bomb_days: 5`.
- Azure client secret expires in 12 days → `time_bomb_days: 12`.
- Deferred rotation hits its grace period → `time_bomb_days: 7`.

The render script promotes any finding with `time_bomb_days <= 7` into the "Time-bombs" section regardless of severity.

## Manual-UI-check tagging

Set `manual_ui_check: true` for any finding the agent literally cannot probe — Airtable PAT list, Tally tokens, Cloudflare dashboard settings the API doesn't expose. The recommended_action should be a precise click-path: "Open https://… → click X → verify Y → if missing, do Z."

## Evidence hashing

Never include the actual secret value in the finding. Compute:

```bash
echo -n "<value>" | sha256sum | cut -c1-12
```

Store as `"evidence_hash": "sha256:abc123def456"`. The hash is stable across runs — that's how the false-positive allowlist works.

If the evidence is a file location (no secret value), use `"location": "path/to/file:line"` and set `"evidence_hash": "loc:sha256:<hash-of-location-string>"`.
