# Design Log 302: PA Card — Q↔Doc Hover Cross-Highlight
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-18
**Related Logs:** DL-294/DL-295/DL-298 (PA card layout), DL-299 (issuer edit + notes + ✓ chip removal), DL-301 (add-doc affordance), DL-151 (question_mappings table), DL-227 (inline status menu)

## 1. Context & Problem

The PA card shows a client's questionnaire answers on the left and their required-doc list on the right. When the admin reviews a complex submission they often need to ask "why is this doc here?" / "what docs did this answer generate?" — today they have to mentally map back via the Airtable `question_mappings` table they can't see. This adds a bidirectional hover (desktop) / tap (mobile) cross-highlight: hovering an answer tints the doc(s) it triggered, hovering a doc tints the source answer(s). Orphan docs (uploaded, AI-classified, or DL-301 add-doc) show `אין שאלה מתאימה` on hover with no link highlight.

## 2. User Requirements (Phase A answers)

1. **Granularity:** by template family (T501 answer highlights ALL T501 docs regardless of issuer).
2. **Direction:** bidirectional.
3. **Mobile:** tap to activate, tap outside or same row to clear.
4. **Visual:** soft tinted background + 3px start-edge accent bar.
5. **Data source:** backend precomputes the join per PA item from `question_mappings` (tblWr2sK1YvyLWG3X). No new endpoint, no static mapping file.
6. **Scope v1:** free-text answers only (`freeAnswers` path); yes/no chips are not rendered today (DL-299), so their docs become orphan-annotated.

## 3. Research

### Domain
Brushing & linking (infoviz), linked-view cross-highlight UX, hover-reveal accessibility.

### Sources Consulted
1. **Becker & Cleveland, "Brushing Scatterplots" (1987)** — foundational pattern: transient highlight on hover propagates across linked views, sub-100ms feedback, opacity/tint changes read cleaner than color swaps.
2. **Linking and Brushing (InfoVis:Wiki)** — brush must paint related data in all connected views nearly instantaneously.
3. **Tableau Highlight Actions** — canonical enterprise pattern; on hover, matching marks stay full opacity, non-matching dim. We invert (tint matched, don't dim unmatched) because rows are text-dense and dimming hurts readability.
4. **W3C WCAG 2.2 SC 1.4.13 "Content on Hover or Focus"** — pure visual highlight (no new DOM content) is not strictly in scope, but keyboard-focus parity is best practice. Added `tabindex="0"` + `:focus-visible`.
5. **NN/G + Material Design touch guidance** — "tap to activate, tap outside/again to clear" is the established mobile replacement for hover-only reveals.

### Principles Applied
- Transient + linked: hover adds a short-lived CSS class; no persistent state on desktop.
- Tint matched, don't dim unmatched (text-dense content).
- Keyboard parity via focus events.
- Backend precompute, no second round-trip.

## 4. Implementation Summary

### Backend
- `api/src/lib/format-questionnaire.ts` — `AnswerEntry` extended with optional `tally_key` (raw Airtable column key, before `cs_` strip) and `template_ids`.
- `api/src/lib/question-mapping-join.ts` — **new**. Indexes `question_mappings` records by `airtable_field_name` and `tally_key_he`, then `attachTemplateIds(answers, mappings, filingType)` runs the trigger predicate (`shouldGenerateDocs` ported from `workflow-processor-n8n.js`) and mutates each answer with the templates it triggers.
- `api/src/routes/admin-pending-approval.ts` — adds `QUESTION_MAPPINGS: 'tblWr2sK1YvyLWG3X'`, fetches the table cached in KV (`cache:question-mappings`, 1h TTL), and calls `attachTemplateIds` on every PA item's `answers_all` before returning. Both `answers_all` and `answers_summary` shapes broadened to include `tally_key` + `template_ids`.

### Frontend
- `frontend/admin/js/script.js`:
  - `buildPaPreviewBody` — `.pa-preview-qa-row` now carries `data-answer-idx`, `data-template-ids="T501,T202,…"`, `tabindex="0"`, `role="button"` when the answer has any linked templates.
  - `renderPaDocTagRow` — `.pa-preview-doc-row` now carries `data-template-id="<d.type>"` + `tabindex="0"`.
  - New module: `_paLinkState`, `_paLinkApply`, `_paLinkOn/Off`, `_paLinkAnnotateOrphans`, `bindPaLinkHover`, `bindPaLinkHoverAll`.
  - Pointer detection via `matchMedia('(pointer: coarse)')` — coarse pointer uses tap-to-pin, fine uses mouseover/out + focusin/out.
  - Idempotent binding via `data-link-bound="1"` on `.pa-card__body` so re-renders (status menu, notes, add-doc) don't stack listeners.
  - Re-bind hooks added in `renderPendingApprovalCards`, `togglePaCard`, `togglePaShowNo`.
- `frontend/admin/css/style.css`:
  - `.pa-link-highlight` rule (tint + 3px inset start-edge bar via `box-shadow`).
  - `.pa-preview-doc-row--orphan:hover` muted dashed outline.
  - `:focus-visible` parity outline.

## 5. Files Changed

| File | Action |
|---|---|
| `api/src/lib/format-questionnaire.ts` | Modify — extend `AnswerEntry` |
| `api/src/lib/question-mapping-join.ts` | **Create** |
| `api/src/routes/admin-pending-approval.ts` | Modify — fetch + attach |
| `frontend/admin/js/script.js` | Modify — DOM attrs + interaction module |
| `frontend/admin/css/style.css` | Modify — highlight + orphan rules |
| `.agent/design-logs/admin-ui/302-pa-card-hover-cross-reference.md` | Create |
| `.agent/design-logs/INDEX.md`, `.agent/current-status.md` | Modify |

## 6. Out of Scope (v1)
- Yes/No chip answer rendering (DL-299 removed the ✓ כן block; revisit only if user wants hover surface there).
- Per-issuer matching (Phase A locked to template family).
- AI-Review cards (different layout).

## 7. Verification (Validation Plan)

- [ ] Desktop hover on a free-text answer whose mapping targets T501 → all T501 doc rows in the card get the tinted bg + start-edge bar within 100ms. Mouse-leave clears instantly.
- [ ] Desktop hover on a T501 doc row → the triggering answer on the left gets the same treatment. Orphan docs (added via DL-301 or uploaded) show `title="אין שאלה מתאימה"` and no link highlight.
- [ ] Keyboard Tab into an answer row → same highlight via `:focus-visible`. Tab off → clears.
- [ ] Mobile (iPad Safari + Android Chrome): tap an answer → docs highlight + pinned. Tap anywhere else on the card clears. Tap same answer again clears.
- [ ] Answer whose mapping condition is `"yes"` and raw value is `"✓ כן"` triggers highlight on matched docs. `"✗ לא"` does NOT trigger.
- [ ] Spouse-scope mappings resolve to spouse-side docs (not client-side duplicates).
- [ ] No regression in PA card load time (mappings fetch + join < 150ms cold; KV cache makes warm path negligible).
- [ ] No regression on DL-227 status menu, DL-299 notes/pencil, DL-301 add-doc popover when hovering is active.
- [ ] RTL sanity — the accent bar renders on the start edge (right side in Hebrew).
- [ ] Works on a client with 30+ docs and 20+ answers without visible jank.
