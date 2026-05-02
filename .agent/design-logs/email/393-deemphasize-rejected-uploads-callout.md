# DL-393 — De-emphasize "previously received / rejected uploads" callout

**Status:** [IMPLEMENTED — NEED TESTING]
**Domain:** email
**Branch:** `claude-session-20260502-094105`
**Created:** 2026-05-02

## 1. Context & Problem

The amber-yellow callout titled **"מסמכים שקיבלנו ממך בעבר"** ("Files we received from you previously") in Type-B reminder emails is too visually loud and is positioned **above** the missing-docs list (DL-244 / DL-253). Two problems:

1. **Color overload** — bright amber bg `#FEF3C7` + orange border `#F59E0B` + bold dark-amber title `#92400E`, identical palette to the high-priority DL-127 "questions from office" card. Two competing alert cards in one email.
2. **Steals focus from the action** — sits above the required-docs section. The eye lands on past/rejected files instead of what the client needs to send now.

Goal: visually demote the callout to a footnote-style note and place it after the doc list.

## 2. User Requirements (Q&A)

- **Style:** soft amber, no border (`#FFFBEB` bg, smaller heading).
- **Position:** below required docs.
- **Title:** keep current wording.
- **Scope:** Type-B reminder emails (DL-244 main path); SSOT-mirror the same change in the Worker helper to preserve the uniformity rule.

## 3. Research

`docs/email-design-rules.md` § 7 — Information Hierarchy: primary action above the fold; one alert card per email; reference info muted and late. The callout is reference content, not action — should not share the alert palette.

Principles applied:
- **Primary > secondary** — missing-docs list is the action.
- **One alert at a time** — DL-127 questions card already owns the amber-alert role.
- **Late & muted for history** — past/rejected info is informational, render after the action.

## 4. Codebase Analysis

Two render surfaces (existing SSOT divergence — DL-244 added flat list in n8n, DL-253 added grouped-by-reason in Worker only):

| # | File | Used by |
|---|------|---------|
| 1 | n8n workflow `FjisCdmWc4ef0qSV` (Reminder Scheduler) → Code node `Build Type B Email` (`buildRejectedUploadsCallout`) | **Live reminder emails (the screenshot)** — Type B Hebrew + bilingual cards |
| 2 | `api/src/lib/email-html.ts:235-291` (`buildRejectedUploadsCallout` grouped-by-reason) | Worker batch-status / generic emails via `buildDocSection` (lines 313, 316, 343) |

## 5. Constraints & Risks

- n8n Cloud — `$env`/`fetch` blocked but irrelevant here (pure HTML string build).
- Email clients with weak CSS support — keep inline styles, table-based layout, no new features.
- No backfill — change applies to future emails only.

## 6. Proposed Solution

### Style (applied inside `buildRejectedUploadsCallout` in both surfaces)

| Property | Before | After |
|---|---|---|
| Outer `<td>` background | `#FEF3C7` | `#FFFBEB` |
| Outer `<td>` border | `1px solid #F59E0B` | (removed) |
| Outer `<td>` padding | `20px` | `12px 16px` |
| Title font-size | `16px` | `13px` |
| Title font-weight | `700` | `600` |
| Title padding-bottom | `12px` | `6px` |
| Row font-size | `14px` | `13px` |
| Row color | `#92400E` | `#78350F` |
| Wrapper margin | `0 0 16px 0` | `16px 0 0 0` |

### Position

Move callout from **before** docs list to **after** it, in all reminder paths (Hebrew-only, bilingual EN card, bilingual HE card) + Worker `buildDocSection` (non-split + split).

## 7. Validation Plan

- [ ] Render Type-B reminder preview for a test client with ≥1 rejected upload (Hebrew-only) — confirm soft amber, no border, BELOW docs list.
- [ ] Same for bilingual (English-speaking client) — both EN and HE cards.
- [ ] Worker-side batch-status preview with rejected uploads via admin panel — same look/position.
- [ ] No regression when 0 rejected uploads (callout absent — guarded by `entries.length === 0`).
- [ ] Visual diff vs original screenshot: title no longer competes with the purple-bar header above it.

## 8. Implementation Notes

- Worker side (`api/src/lib/email-html.ts`) — done in this DL.
- n8n side — pending: Code node `Build Type B Email` in workflow `FjisCdmWc4ef0qSV` needs the same style + position change in 3 paths (he-only, EN card, HE card). Will patch via `n8n_update_partial_workflow` MCP.
- Mid-session worktree wipe: my first worktree (`claude-session-20260502-092947`) was pruned by `cleanup-worktrees.sh` while edits were live; recovered by re-applying in `claude-session-20260502-094105`. Memory entry `feedback_cleanup_script_safety_guards.md` already added by user.
