# Design Log 289: Align "ממתין לסיווג" Reminder Stat With AI Review Badge
**Status:** [BEING IMPLEMENTED — DL-289]
**Date:** 2026-04-16
**Related Logs:** DL-112 (file_hash dedup on classifications), DL-216/219/228 (dual filing type), DL-271 (pending classification filter bypass), DL-277 (reminder progress bar math)

## 1. Context & Problem

The admin panel shows two counts of "clients with pending classifications" that disagree:

- **AI Review tab badge** (top nav, `id=aiReviewTabBadge`) = `15` — unique clients with at least one pending classification (any stage)
- **Reminder tab "ממתין לסיווג" card** (`id=reminder-stat-pending`) = `25` — reports in `Collecting_Docs` whose `pending_classifications` link-field has any entries

The user expects these to represent the same reality. They don't, because the two numbers are computed by different endpoints with different definitions, data sources, and dedup strategies.

## 2. User Requirements

1. **Q:** Which count reflects what you actually want to see?
   **A:** Unique clients, any stage (AI review's current 15) — that's the truth.
2. **Q:** What should count as "pending" for the reminder stat?
   **A:** Keep "anything in `pending_classifications`" (the rollup-length approach). Don't introduce a new `review_status` filter inside `reminders.ts`.
3. **Q:** How should dual filing-type clients (AR + CS) count?
   **A:** Once per client.
4. **Q:** Fix scope — which surface(s) should change?
   **A:** Undecided ("idk"). Assistant chose backend-only change in `reminders.ts` — lowest-risk path.

## 3. Research

### Domain
Dashboard metric consistency / single source of truth for counts across UI surfaces.

### Sources Consulted
1. **PowerMetrics — "What does single source of truth actually mean for metrics?"** — Metric drift happens when the business meaning and the math live in multiple places; the fix is a shared definition + single calculation path.
2. **Improvado — "The Metrics Layer"** — Define a metric once, use it everywhere; strict governance on who can edit.
3. **Surgere — "SSOT in SaaS" (Goodgame Studios case study)** — Real-world double-counting between internal and external dashboards, resolved by deduplicating at the boundary once a canonical ID was established.

### Key Principles Extracted
- **One definition, one implementation.** When two endpoints compute "the same" metric, drift is inevitable over time as one side gains filters the other lacks. Our case: classifications.ts gained `file_hash` dedup (DL-112) and `splitting`/`notification_status` filters; reminders.ts never got them.
- **Dedup by a stable canonical ID.** Client records have stable `client_id`; reports (per filing type × year) do not map 1:1 to clients. Counting reports for a "clients" metric guarantees drift for any dual-filing-type client.
- **Scope transparently.** A card labeled "ממתין לסיווג" reads as "clients waiting for classification," not "reports in Collecting_Docs." Label and math should match the user's mental model.

### Patterns to Use
- **Canonical ID dedup at the aggregation layer.** Compute `pending_review = Set(client_id).size` instead of `reports.length`.
- **Match the canonical endpoint's semantic where possible** — AI review defines "pending classification" as `review_status === 'pending'` (frontend) with server-side `notification_status=''` + `review_status != 'splitting'` pre-filter. Reminder side won't touch classifications directly (per Q2), but aligning the unit of counting (clients) closes most of the gap.

### Anti-Patterns to Avoid
- **Counting reports when the label says "clients."** Creates guaranteed drift the moment dual filing types ship (DL-216/219/228 already did).
- **Duplicating metric logic across endpoints.** Tempting to "just fix the number," but structural fix (shared definition or shared endpoint) is only marginally more work. Deferred for now: Q2 explicitly chose to keep the rollup source.

### Research Verdict
Change `reminders.ts` `pending_review` stat to dedupe by `client_id` across all rows with `pending_count > 0`, dropping the stage restriction. Keep the rollup-based `pending_count` definition per user choice (Q2). Accept the known residual drift (classifications linked to a report but none pending will still inflate the reminder card slightly) and document it for future cleanup.

## 4. Codebase Analysis

### Existing Solutions Found
- `api/src/routes/classifications.ts:188` — already fetches the reports table with `fields: ['client_id', 'filing_type']`. Confirms `client_id` exists as a field on the reports table and is usable from `buildReminderResponse`.
- `frontend/admin/js/script.js:5053` — reference implementation of the canonical dedup: `new Set(pendingItems.map(i => i.client_id).filter(Boolean)).size`.

### Reuse Decision
Reuse the exact dedup idiom from `script.js:5053` in `reminders.ts`. No shared helper needed for a one-liner.

### Relevant Files
| File | Role |
|---|---|
| `api/src/routes/reminders.ts` | Build reminder list + stats — **needs edit** |
| `api/src/routes/classifications.ts` | AI review canonical source — reference only, no change |
| `frontend/admin/js/script.js` | Renders both counts; `updateReminderStats` at 5515, `recalcAIStats` at 5037 — no change |
| `frontend/admin/index.html:631-632` | Reminder stat DOM — no change |

### Existing Patterns
Both endpoints already expose `stats` objects under `{ok, stats, items}`. Response shape stable — adding no new fields.

### Alignment with Research
Before: report-level count with stage restriction. After: unique-client count, stage unrestricted. Closer to SSOT principle (aligns unit of counting with the canonical endpoint). Full structural fix (shared definition module) left as future work.

### Dependencies
- Airtable reports table field `client_id` (rollup/lookup from client link, already used at classifications.ts:188).
- No schema changes.
- No new Airtable API calls — field is already fetched-able; just add to `REMINDER_FIELDS`.

## 5. Technical Constraints & Risks

### Security
None. Same endpoint, same auth, same data scope.

### Risks
- **Click-filter divergence.** Clicking the "ממתין לסיווג" card calls `filterReminders()` with `activeCardFilter='pending'`, which uses `getReminderStatus(r).key === 'pending'` = `pending_count > 0 AND stage === 'Collecting_Docs'`. Post-fix the card count could include Waiting_For_Answers rows (if any have `pending_count > 0`), but clicking the card wouldn't surface them. **Mitigation:** The reminder list's own filter (`buildReminderFilter`) only fetches Waiting_For_Answers + Collecting_Docs reports, and WFA rows rarely have pending classifications in practice (docs aren't uploaded until CD). Documented as known minor gap.
- **Residual drift vs. AI review badge.** AI review counts unique clients across **all stages** (via classifications table). Reminder endpoint only fetches reports in WFA + CD. A client in `Review` / `Moshe_Review` / `Before_Signing` with a pending classification will count in AI review's 15 but not in the reminder card. Accept — Q2 chose to keep the rollup source, so querying classifications directly would violate that.

### Breaking Changes
None. Response shape unchanged.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
The "ממתין לסיווג" card number on the reminder tab is within ±1 of the AI review tab badge, with the delta explainable by clients in late stages (Review+) that the reminder endpoint doesn't query.

### Logic Flow
1. Add `'client_id'` to `REMINDER_FIELDS` so the reports fetch returns it.
2. Read `client_id` into each `ReminderItem` during map.
3. Rewrite `stats.pending_review`:
   - Before: `mapped.filter(r => r.pending_count > 0 && r.stage === 'Collecting_Docs').length`
   - After: `new Set(mapped.filter(r => r.pending_count > 0).map(r => r.client_id).filter(Boolean)).size`

### Data Structures / Schema Changes
None. `client_id` field already exists on reports table.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/reminders.ts` | Modify | Add `client_id` to `REMINDER_FIELDS` + `ReminderItem` interface + mapping; rewrite `stats.pending_review` |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-289 active row |
| `.agent/current-status.md` | Modify | Add test TODO block |

### Final Step (Always)
Housekeeping per design-log skill Phase D & E.

## 7. Validation Plan

- [ ] Reload admin → note AI Review tab badge number (e.g., 15).
- [ ] Open Reminder tab → "ממתין לסיווג" card now within ±1–2 of the badge.
- [ ] Pick one dual-filing-type client with both AR + CS reports in Collecting_Docs with pending classifications — confirm they count ONCE toward the card (previously twice).
- [ ] Pick one client in Waiting_For_Answers with a pending classification (if any exists) — confirm they NOW count toward the card (previously didn't).
- [ ] Click the "ממתין לסיווג" card → verify the filter still works and shows Collecting_Docs-scoped rows (pre-existing behavior, intentional minor divergence).
- [ ] Regression: click the other 3 stat cards (scheduled, due_this_week, suppressed) — ensure their filters still work identically to before.

## 8. Implementation Notes (Post-Code)

* Research principles applied: canonical-ID dedup; align unit of counting across surfaces (SSOT, loose application).
* Known residual drift documented in §5 — two sources: (a) WFA rows included in count but not in click-filter, (b) late-stage clients (Review+) counted by AI review but not reachable from reminders endpoint's report scope. Both were explicitly accepted to stay within Q2's "keep rollup source" constraint.
* Future follow-up (if exact parity is needed later): either (i) add a filtered Airtable rollup `pending_classifications_active` that excludes confirmed/rejected/manual, OR (ii) have reminders.ts query the classifications table directly like AI review does. Both are larger changes deferred per current requirements.
