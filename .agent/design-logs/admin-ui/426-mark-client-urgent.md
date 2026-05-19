# Design Log 426: Mark Client as Urgent — manual flag promoted across all admin queues
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-19
**Related Logs:** DL-295 (PA priority badge — age-based), DL-399 (email-bounce pin + badge), DL-404 (edit-client modal save + Airtable schema additions), DL-405 (unified client-row kebab + right-click), DL-406 (aging colors + WF07 digest), DL-410 (silent-refresh after mutation), DL-420 (typecast first-PATCH pattern)

## 1. Context & Problem

Office staff need to flag specific clients as **urgent** so they visibly stand out and rise to the top in every admin queue — independent of the existing age-based aging tints (DL-295/DL-406, automatic, content-driven) and the email-bounce pinning (DL-399, automatic). Today there is no manual override: a client who needs immediate attention for non-time-based reasons (audit deadline tomorrow, angry partner, partner-CPA hand-off) cannot be raised above the noise without manually shuffling rows or pasting reminders into notes.

This change adds a binary `is_urgent` flag with one consistent visual treatment across all internal surfaces, a toggle that fires silent refresh per CLAUDE.md P6, and a digest section in WF07 so the office wakes up to the urgent list every morning.

## 2. User Requirements

1. **Q:** Who can set/unset the urgent flag, and from where?
   **A:** Admin from kebab + PA queue + AI review cards.
2. **Q:** Where should the urgent indicator appear (which tables/surfaces must visibly show it)?
   **A:** Admin clients table (desktop + mobile), Dashboard messages widget, PA queue cards, AI Review cards.
3. **Q:** What's the data model for the urgent flag?
   **A:** Boolean `is_urgent` on clients table (no reason/timestamp fields).
4. **Q:** Should marking urgent affect behavior beyond visual indication?
   **A:** Pin urgent clients to top of every list + include in Natan's daily digest (WF07). No Telegram bot wiring for v1.

## 3. Research

### Domain

Admin-panel priority/urgency flag UX — visual encoding + sort behavior + accessibility, applied to a Hebrew-RTL CRM dashboard.

### Sources Consulted

1. **UX Stack Exchange 124624 — "How to show important items at the top in an ordered data table"** — confirms the pin-pattern: important rows move to the top of the table, with the existing secondary sort preserved below. Matches our existing DL-399 bounce-pin shape exactly.
2. **WCAG 1.4.1 "Use of Color" (wcag.dock.codes, accessibility.umich.edu)** — color cannot be the only visual signal. The urgent indicator must pair the red tint with an icon (🔥) and a Hebrew text label (`דחוף`) so colorblind users and screen readers still get the signal. DL-406's aging-colors module already follows this pattern (color + relative-time text).
3. **Hive priority pattern (help.hive.com / action-card priorities)** — explicit multi-level priority (1/2/3/4) is overkill for binary urgency. A boolean toggle with a single visible level is the right MVP — multi-level can be a later expansion if the office asks for it.

### Key Principles Extracted

- **Pin to top via stable sort, not by mutating data order** — keep the underlying data array as-is and stack the urgent check as the highest-priority comparator in the existing `sortClients` function.
- **Never color-only** — pair every red tint with the 🔥 glyph AND the Hebrew label `דחוף` (in title/aria attributes for screen readers).
- **Single source of truth for the toggle** — the kebab is the canonical entry point; per-card toggle buttons all call the same `UrgentFlag.toggle()` function and trigger the same silent refresh.

### Patterns to Use

- **Module-extraction pattern (DL-399 / DL-405 / DL-406):** all new helpers live in `frontend/admin/js/modules/urgent-flag.js`. `script.js` only consumes via `${UrgentFlag.badgeHtml(client)}` splice points so the ratchet baseline is preserved.
- **Typecast first-PATCH pattern (DL-420):** the new `is_urgent` field auto-creates on first write via `airtable.updateRecord(..., { typecast: true })`. No manual schema edit step.
- **Silent refresh after mutation (CLAUDE.md P6, DL-410):** after the PATCH resolves, mutate `clientsData[i].is_urgent` in place and re-render every visible queue — no page reload, no scroll jump.
- **Triple-priority stable sort:** urgent → bounced → existing column. JS `.sort()` is stable since ES2019, so order is preserved within each tier.

### Anti-Patterns to Avoid

- **Color-only signal** — would fail WCAG 1.4.1 and the Hebrew label requirement.
- **Per-surface bespoke markup** — would drift like DL-405's kebab-vs-right-click did before unification. All five urgent visuals route through one module.
- **Reading `is_urgent` in `filterByFormula` before the field has propagated** — would 422 the first dashboard fetch after typecast (memory rule `feedback_airtable_typecast_field_existence`).

### Research Verdict

Binary `is_urgent` boolean on `clients`. Visual = red 🔥 glyph + warm-red `border-inline-start` stripe + Hebrew `דחוף` tooltip. Sort = urgent rows first (pin), then existing comparator. Toggle entry from kebab + per-queue card buttons, all hitting the same `/webhook/admin-update-client` endpoint with `{ is_urgent: true|false }`. WF07 gets a dedicated "Urgent clients" section at the top of the digest, suppressed when none are flagged.

## 4. Codebase Analysis

- **Existing Solutions Found:** DL-399 bounce-pin pattern (sortClients pinning + `bounceBadgeHTML` from extracted module), DL-405 unified kebab via `client-row-actions.js`, DL-406 aging-colors module (window-IIFE shape mirrors what we need), DL-410 silent-refresh after mutation, DL-420 `typecast: true` first-PATCH pattern, DL-365 `logEvent` ADMIN category.
- **Reuse Decision:** Reuse every one of the above. New code lives in `urgent-flag.js`; `script.js` adds ≤2-line splice points at each render site. The kebab gets one new menu item. The Worker write route extends its existing `update` whitelist.
- **Relevant Files:**
  - `api/src/routes/dashboard.ts:60-69, 136-156, 183-296` — clients-field select, report-row merge, recent-messages route reused for WF07.
  - `api/src/routes/client.ts:44, 198-214` — admin-update-client write route + `action: 'update'` branch.
  - `api/src/lib/airtable.ts:109-128` — `updateRecord(table, id, fields, opts)` signature with `typecast` flag.
  - `api/src/lib/activity-logger.ts:115` — `logEvent` for the admin audit trail.
  - `frontend/admin/js/script.js` — render paths at the documented anchor lines for clients table (D+M), sortClients, buildPaCard, renderPendingApprovalCards, buildClientListRowHtml, AI groups builder, renderMessages.
  - `frontend/admin/js/modules/client-row-actions.js:159-178` — kebab menu item builder.
  - `frontend/admin/js/modules/aging-colors.js`, `bounce-warning.js` — reference shapes for the new module.
  - `frontend/admin/index.html:12, 1568, 1555` — cache-bust anchors.
- **Existing Patterns:** DL-399 bounce flow is the single closest precedent — same shape of "boolean on clients → badge in row → pin to top → toggle from edit-client → silent refresh". The new feature mirrors that flow.
- **Alignment with Research:** Research-recommended pin-pattern is already the codebase pattern (DL-399). WCAG 1.4.1 dual-encoding is already the codebase pattern (DL-406 aging colors). No deviation needed.
- **Dependencies:** Airtable (new field on `clients` via typecast), Workers `/webhook/admin-update-client` + `/webhook/admin-dashboard` (existing), n8n WF07 (`0o6pXPeewCRxEEhd`, separate update step).

## 5. Technical Constraints & Risks

- **Security:** None new. Same admin-token gate as every other admin-* route. Activity log records `client_id` only (no PII per DL-365).
- **Operational Risks:**
  - **Ratchet:** `script.js` baseline 16112. Per-surface insertions must be line-neutral. Mitigation: all logic in `urgent-flag.js`; script.js splice points are 1-2 line additions of `${UrgentFlag.badgeHtml(client)}` / `${UrgentFlag.toggleButtonHtml(client)}` / sort-comparator prepend.
  - **Typecast propagation lag:** First write auto-creates the column; subsequent reads in the same minute may briefly 422 a `filterByFormula` referencing the new field. Mitigation: we never query by `is_urgent` server-side; we read it as a returned field and gate `undefined` → `false` in JS.
  - **Silent refresh races:** Two admins toggle simultaneously → Airtable last-write-wins. Acceptable for binary flag.
- **Breaking Changes:** None. New optional field, default `false` for every existing client.
- **Mitigations:** As above. Plus a defensive `UrgentFlag.isUrgent(client)` helper that handles `undefined`/`null`/string-`"false"` from Airtable serialization quirks.

## 6. Proposed Solution

### Success Criteria

A flagged client visibly stands out (🔥 + red stripe + Hebrew tooltip) and appears at the top of the clients table, PA queue, AI Review, and messages widget. The toggle works from the kebab and from per-card buttons in PA + AI Review, with no page reload. Natan's daily digest opens with a "🔥 לקוחות דחופים" section listing all currently-flagged clients.

### Logic Flow

1. Admin clicks "סמן כדחוף" in kebab OR the 🔥 button on a PA / AI Review card.
2. Frontend calls `POST /webhook/admin-update-client` with `{ action: 'update', report_id, is_urgent: true }`.
3. Worker PATCH `clients` row with `typecast: true` (auto-creates field on first write). Activity log `client_urgent_set`.
4. Frontend updates `clientsData[i].is_urgent` in place, re-renders visible queues (no reload).
5. Next dashboard fetch returns `is_urgent` on every client; sort + badge render automatically.
6. WF07 daily digest reads `urgent_clients` array from the existing `admin-recent-messages` endpoint and prepends a section to the email.

### Data Structures / Schema Changes

- **New Airtable field:** `clients.is_urgent` (checkbox, boolean). Auto-created on first PATCH via typecast.
- **API response additions:**
  - `GET /webhook/admin-dashboard` — each report row gains `is_urgent: boolean`.
  - `GET /webhook/admin-recent-messages` — response gains top-level `urgent_clients: Array<{ client_id, name, stage_he }>`.
- **No migration needed.** All existing clients implicitly `false`.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `.agent/design-logs/admin-ui/426-mark-client-urgent.md` | Create | This file |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-426 active row |
| `frontend/admin/js/modules/urgent-flag.js` | Create | `UrgentFlag` window IIFE — badgeHtml / toggleButtonHtml / toggle / isUrgent |
| `frontend/admin/js/script.js` | Modify | Splice points in renderClientsTable (D+M), sortClients, buildPaCard, renderPendingApprovalCards, buildClientListRowHtml, AI groups builder, renderMessages |
| `frontend/admin/js/modules/client-row-actions.js` | Modify | New kebab item "סמן כדחוף" / "הסר דחיפות" |
| `frontend/admin/css/style.css` | Modify | `.urgent-badge` + 5 `--urgent` modifier classes |
| `frontend/admin/index.html` | Modify | New `<script src=".../urgent-flag.js?v=1">`; bump `script.js` + `style.css` + `client-row-actions.js` cache versions |
| `api/src/routes/dashboard.ts` | Modify | Add `is_urgent` to clients select + merge into report rows + new `urgent_clients` payload on recent-messages route |
| `api/src/routes/client.ts` | Modify | Extend `update` whitelist with `is_urgent`; pass `typecast: true`; log `client_urgent_set`/`client_urgent_cleared` |
| `docs/airtable-schema.md` | Modify | Document the new `is_urgent` checkbox on the clients table |

### Final Step

- Update design log status to `[IMPLEMENTED — NEED TESTING]`.
- Update `.agent/design-logs/INDEX.md`.
- Copy unchecked Section 7 items to `.agent/current-status.md` under Active TODOs.
- Invoke `git-ship` for commit/push/merge workflow when implementation is complete.

## 7. Validation Plan

- [ ] `./node_modules/.bin/tsc --noEmit` clean (or only pre-existing errors).
- [ ] `cd api && CLOUDFLARE_API_TOKEN="" npx wrangler deploy --dry-run -c wrangler.toml` clean.
- [ ] `python .claude/hooks/script-size-ratchet.py` shows no upward bump for `script.js`.
- [ ] Live: toggle urgent on a test client from kebab → badge appears in clients table without reload, row pins to top.
- [ ] Live: toggle from PA card → PA queue re-orders urgent-first, dashboard messages widget shows red stripe on matching group.
- [ ] Live: toggle from AI Review header → AI Review re-orders, badge on `.ai-client-row`.
- [ ] Live: untoggle → badge disappears, row returns to natural sort slot, `client_urgent_cleared` activity event emitted.
- [ ] Live: combined flag stack — flag a client who is ALSO `email_bounced` → urgent wins the pin, both badges render side-by-side.
- [ ] WCAG: tab-focus the badge → screen reader announces "דחוף".
- [ ] Typecast first-write: confirm Airtable schema auto-grew the column, no 422 on the following dashboard fetch.
- [ ] WF07: trigger digest manually → "🔥 לקוחות דחופים" section appears with N=1; unflag the test client → section is suppressed.

## 8. Implementation Notes

Started 2026-05-19. Branch: `claude-session-20260519-170545` (DL-426 claim ref pushed via `reserve-dl-number.sh` per memory `reference_dl_number_reservation`).

**Plan-mode deviation:** the plan file was constrained to a single path (`C:\Users\liozm\.claude\plans\wiggly-drifting-ladybug.md`) so the DL file is created in Phase D start (here), not inside plan mode. Approved plan content was copied verbatim from the plan file.

**Research principles applied:**
- Stable triple-tier sort (UX SE 124624) — `sortClients` gains `urgent ? -1 : 1` as the leading comparator.
- WCAG 1.4.1 dual-encoding — `.urgent-badge` always carries `title="דחוף"` + 🔥 glyph alongside the red tint.
- Boolean over multi-level (Hive insight) — single `is_urgent` field; future multi-level can come as DL-426-followup if requested.

**WF07 update:** out-of-band n8n change deferred until after the Worker payload is live (the `urgent_clients` array must exist on the response before the workflow can render it). Tracked in Section 7.

### Mid-implementation scope additions (user, 2026-05-19)
Mid-implementation, the user requested two additions on top of the approved plan:
1. **Promote urgent clients in the `מוכנים להכנה` (Moshe-Review) tab too.** Originally the plan said "Moshe-Review FIFO queue intentionally untouched" — overridden by direct user instruction. Implementation: `renderReviewTable` (`script.js:3258`) sorts the queue urgent-first BEFORE pagination via `window.UrgentFlag.sortPin`; mobile `<li>` + desktop `<tr>` gain `.mobile-card--urgent` / `.client-row--urgent` classes; client name gets the 🔥 badge. The FIFO `fifo-number` is still rendered after the sort, so urgent clients now show low FIFO numbers (correct — they ARE next in line by design choice).
2. **Filter for the main clients table.** New `<button id="urgentFilterBtn">🔥 דחופים</button>` in the filter bar (`index.html:498-507`); state in `window._urgentFilterActive`; toggle implementation in the urgent-flag module (`toggleFilter`); `filterClients` gains a one-line filter clause. Visual: button flips from `btn-ghost` to `btn-primary` when active (`aria-pressed="true"`).

### Ratchet outcome
`script.js` baseline 16112 → 16109 after implementation. Hook auto-ratcheted DOWN. No upward bumps.

### Commands run
- `./node_modules/.bin/tsc --noEmit` — clean for `client.ts` and `dashboard.ts` (4 pre-existing errors in unrelated files unchanged).
- `python .claude/hooks/script-size-ratchet.py` — `baseline ratcheted down ✓`.
- `cd api && CLOUDFLARE_API_TOKEN="" npx wrangler deploy --dry-run -c wrangler.toml` — clean dry-run build (all bindings present, no type errors).

### Deviations from the approved plan
- DL file written in Phase D start (not inside plan mode) due to plan-mode harness restricting edits to a single plan file.
- Added two new surfaces beyond plan (Moshe-Review pin + clients-table filter) per mid-implementation user instruction.
- Added `client_rec_id` to the dashboard response payload (was already needed by the urgent-flag module's potential future direct-by-record-id lookup path; harmless additional field).
- Activity logger `logEvent` call wrapped in try/catch — `client.ts` route must never fail a save because of an audit-log issue (existing pattern in the codebase).

### Research principles applied (verbatim from Section 3)
- Stable triple-tier sort (UX SE 124624) → `sortClients` urgent > bounced > column comparator.
- WCAG 1.4.1 dual-encoding → every red surface carries 🔥 + `title="לקוח דחוף"` + `aria-label="דחוף"`.
- Boolean over multi-level (Hive) → single `is_urgent` field. Multi-level deferred to a hypothetical DL-426-followup.
