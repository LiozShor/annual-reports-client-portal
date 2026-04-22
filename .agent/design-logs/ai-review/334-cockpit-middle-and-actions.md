# Design Log 334: AI Review Cockpit — Middle Column Thin Rows + Right-Side Actions Panel
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-23
**Related Logs:** DL-053 (silent-refresh), DL-075 (original split-view), DL-278 (scroll-into-view), DL-306 (deep-link PA-banner), DL-314 (multi-template match), DL-320 (also-match UX), DL-330 (3-pane rework), DL-332 (pane 1 density)

## 1. Context & Problem

DL-330 built the 3-pane split (clients → docs → preview). DL-332 densified pane 1. Today, pane 2 renders full "fat" cards per doc (`renderAICard` at `frontend/admin/js/script.js:4391`) — each with AI reasoning, action buttons, banners, overflow menu. Result: reviewers scan a handful of docs per viewport instead of dozens, and the preview pane is passive (iframe only).

DL-334 refactors pane 2 into a **thin, scannable row list** (~28-32px rows, color-stripe by state, filename + category only) and moves **all AI reasoning and per-doc actions into a new actions panel** in the bottom half of pane 3, re-rendered on selection. Mobile (<768px) remains untouched (continues using the existing fat-card accordion via `isAIReviewMobileLayout()` branch).

Bundles the **DL-053 silent-refresh merge-by-id fix**: current polling replaces `aiClassificationsData` wholesale (script.js:3790), which invalidates `activePreviewItemId` mid-review.

## 2. User Requirements

1. **Q:** Discovery questions skipped — brief is fully prescriptive (layout, states, workstream split, preservations, out-of-scope all specified).
   **A:** User approved "PROCEED" to skip Phase A.
2. **Q:** DL number?
   **A:** 334 via `reserve-dl-number.sh` (333 already claimed).
3. **Q:** Branch?
   **A:** `DL-334-ai-review-cockpit-middle-actions` from DL-332 shipped HEAD.

## 3. Research

### Domain
Information density in list-detail UIs; cockpit pattern (preview + contextual controls).

### Sources Consulted (cumulative reference)
1. **DL-330 research** — 3-pane master-detail (Outlook / Mac Mail / Linear), `overscroll-behavior: contain`, fixed-width wide / collapse narrow. Reused verbatim; no new research on 3-pane fundamentals.

### Key Principles Extracted (incremental)
- **Scan density (Tufte / Linear / Superhuman):** list rows are single-line, truncation-friendly, with one color affordance (stripe) for state prioritization. No badges, no buttons, no wrapping text.
- **Cockpit pattern (Gmail / Outlook reading pane):** detail pane holds both preview *and* contextual controls that change per selected item. Reduces pointer travel, keeps action context next to the artifact.
- **Lossless relocation:** every piece of information visible in today's card moves to the panel — nothing disappears.

### Patterns to Use
- **Thin-row master list** + **state-stripe color code** for at-a-glance triage.
- **Contextual cockpit** — right pane = preview (top) + per-item actions (bottom).
- **Merge-by-id state reconciliation** — polling preserves in-memory references.

### Anti-Patterns to Avoid
- **Auto-approve from list** — spec explicitly: user MUST open every doc.
- **Scroll-linked preview** — DL-330 rejected.
- **Rewriting working vanilla code for React** — Strangler Fig; CLAUDE.md rule.

### Research Verdict
Thin-row pane 2 + cockpit-style actions panel in pane 3. Mobile unchanged. Ship silent-refresh merge-by-id alongside.

## 4. Codebase Analysis

See approved plan at `C:\Users\liozm\.claude\plans\inherited-orbiting-cocke.md` for the full file/line map. Key touchpoints:

- **`frontend/admin/index.html`** lines 13 (CSS cache-bust), 977-1049 (AI Review tab), 1020-1047 (pane 3 detail), 1518 (JS cache-bust)
- **`frontend/admin/js/script.js`** lines 3589 (`activePreviewItemId`), 3623-3720 (preview), 3765-3790 (polling — DL-053 target), 3968-3970 (`isAIReviewMobileLayout`), 3975-4091 (`buildClientAccordionHtml`), 4095-4132 (`buildClientListRowHtml`), 4135-4186 (`initAIReviewComboboxes`, `selectClient`), 4391-4689 (`renderAICard`), 4691-4826 (`renderReviewedCard`), 4829+ (`startReReview`)
- **`frontend/admin/css/style.css`** lines 1799-1875 (fat cards — keep for mobile), 3315-3326 (3-col grid), 3620+ (pane 3), 4709-4858 (mobile breakpoint)

Reuse verbatim: `.ai-cn-section`, `.ai-missing-docs-group`, `toggleClientNotes`, `toggleMissingDocs`, `loadDocPreview`, `resetPreviewPanel`, `handleComparisonRadio`, `showAIAlsoMatchModal`, `initAIReviewComboboxes`, `openSplitModal`, `editContractDate`, `openAddQuestionDialog`, `startReReview`, `friendlyAIReason`, `getCardState`, `renderDocLabel`, `escapeHtml`, `escapeAttr`.

## 5. Technical Constraints & Risks

- Vanilla JS + vanilla CSS only. No React island for this DL. No new tokens.
- Many callers depend on `.ai-review-card[data-id]` DOM selector. Desktop path must target `.ai-doc-row[data-id]` + `#aiActionsPanel`; mobile keeps `.ai-review-card[data-id]`. Introduce `refreshItemDom(item)` helper.
- Pane 3 vertical split may feel cramped on short viewports. `min-height: 280px` floor on actions panel.
- IntersectionObserver collapse for client-notes/missing-docs can feel twitchy — use `rootMargin: "-40px 0px 0px 0px"` + debounce.
- Mobile layout must remain 100% untouched.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
A reviewer on desktop sees 15-20 docs per viewport in pane 2 (vs. ~5 today), clicks any row to see the AI reasoning + state-appropriate controls in the bottom of pane 3, and approves/rejects/reassigns without any full-list re-render. Mobile behavior is unchanged.

### Logic Flow

**Selection (desktop):**
1. Row click → `selectDocument(recordId)`
2. Mobile guard: `isAIReviewMobileLayout()` → fall through to legacy `loadDocPreview` and exit
3. Set `activePreviewItemId = recordId`
4. Toggle `.active` on matching `.ai-doc-row[data-id]`
5. `loadDocPreview(recordId)` unchanged
6. Re-render `#aiActionsPanel` via `renderActionsPanel(item)` + `initAIReviewComboboxes` + `safeCreateIcons`

**Post-mutation (approve/reject/assign/re-review):**
1. API handler unchanged
2. Mutate `aiClassificationsData` entry by id
3. Row-swap `.ai-doc-row[data-id]` outerHTML via `renderDocRow(mutatedItem, true)`
4. Re-render `#aiActionsPanel` via `renderActionsPanel(mutatedItem)`
5. Recompute client-level "X/Y נבדקו" cheaply

**Silent-refresh merge-by-id:**
```js
const byId = new Map(aiClassificationsData.map(i => [i.id, i]));
for (const n of newItems) byId.set(n.id, n);
aiClassificationsData = newItems.map(n => byId.get(n.id));
```

### Files to Change
Full table in plan file. Summary:
- **Modify:** `frontend/admin/index.html`, `frontend/admin/css/style.css`, `frontend/admin/js/script.js`
- **Cache bumps:** CSS v=294 → 295, JS v=298 → 299
- **Workstreams:** A (pane 2 rows + selectDocument), B (actions panel renderer), C (pane 3 DOM + CSS), D (merge-by-id + housekeeping)
- **Sequencing:** C → A → B; D in parallel

### Final Step (Always)
Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, Section 7 items copied to `current-status.md`, INDEX.md updated, CSS/JS cache bumped, commit + push, **pause for explicit merge approval**.

## 7. Validation Plan

### Pane 2 thin-rows
- [ ] Row renders at 28-32px tall, single line, no wrap
- [ ] Filename truncated from middle, extension always visible
- [ ] Category text muted, end-aligned (RTL)
- [ ] Stripe color: pending+full → teal, pending+fuzzy → teal, pending+issuer-mismatch → amber, pending+unmatched → amber, approved → teal, rejected → red, reassigned → blue
- [ ] `?` glyph present when `item.pending_question` set
- [ ] Duplicate / unrequested / pre-questionnaire flags merge into one trailing dot with `title=` tooltip listing all applicable
- [ ] Selected row shows subtle `--brand-50` fill (no border change)
- [ ] Row click: no full list re-render

### Pane 3 actions panel — per state
- [ ] Empty state: placeholder label shown
- [ ] State A (full match): filename + filing-type chip + AI classification line + confidence % + [approve] / [reject] / [reassign] buttons
- [ ] State C (fuzzy): same as A + low-confidence cue
- [ ] State B (issuer-mismatch): aiIssuer + compare-radios prompt + [approve] / [reject]; combobox fallback when no sameTypeDocs
- [ ] State D (unmatched): no-match label + full friendlyAIReason + combobox + ai-inline-ft-toggle + [assign] (disabled) + [reject]
- [ ] Approved reviewed: approved lozenge + matched name + [change-decision] + [also-match] buttons
- [ ] Rejected reviewed: rejected lozenge + reason + notes + [change-decision]
- [ ] Reassigned reviewed: reassigned lozenge + resolved target name + [change-decision]
- [ ] Split PDF button iff `page_count >= 2` → `openSplitModal`
- [ ] Contract period: T901/T902 full-year → badge; partial → editable dates + request-missing-period buttons
- [ ] Pending-question: full text + inline [edit-question]
- [ ] Overflow menu: [add-question] or [edit-question] depending on state
- [ ] Confidence percent rendered

### Transitions
- [ ] Approve/reject/assign: stripe flips, panel switches, no whole-list re-render
- [ ] Split PDF flow (DL-252) still works end-to-end
- [ ] Re-review from reviewed → returns to pending variant

### Preservations
- [ ] DL-306: `?client=CPA-XXX` deep-link auto-selects client AND auto-opens first pending doc
- [ ] DL-053 silent-refresh: mid-review poll preserves preview + selected row
- [ ] DL-278: scroll-into-view works on `.ai-doc-row.active`
- [ ] DL-314: multi-match modal launches from panel
- [ ] Mobile <768px: accordion cards return; actions panel hidden; no JS errors
- [ ] Scroll position: pane 2 scrollTop preserved across row swap

### Housekeeping
- [ ] CSS cache → v=295, JS cache → v=299
- [ ] No console errors on tab load
- [ ] INDEX.md updated
- [ ] current-status.md updated

## 8. Implementation Notes (Post-Code)

Implemented as 4 sequential waves in a single session (C → A → B → D). The `/subagent-driven-development` skill's "When to Serialize: shared tooling state" rule applied — all four workstreams modify `frontend/admin/js/script.js`, so write-write conflict forced serialization and the subagent dispatch overhead would exceed any parallelism benefit. Instead executed as one implementer with a final holistic self-review.

### Deviations from plan

1. **Polling silent-refresh preservation moved from polling block to `selectClient` + `renderAICards`.** The plan had a preservation block inside `loadAIClassifications`'s change-path; during coding it became clearer that `applyAIFilters → renderAICards` always rebuilds pane 2 on desktop, so the preservation logic belongs inside `renderAICards` (the rebuilder) and `selectClient` (the user-initiated rebuilder). Single source of truth for "rebuild + preserve active". The polling block only decides whether to call `resetPreviewPanel` first.

2. **`_aiReReviewing` transient Set instead of data mutation.** Spec said: "🔄 שנה החלטה → startReReview". Rather than mutating `item.review_status` back to `'pending'` (which would flip the stripe color misleadingly — the server state is still approved), introduced a module-level `Set<itemId>` that `renderActionsPanel` consults via `isReReviewing`. Stripe stays on the original color until an actual decision lands.

3. **`refreshItemDom` helper replaces inline card-swap at 5 callsites** (transitionCardToReviewed, the two add-question flush sites, cancelReReview, startReReview-cancel). Saved ~60 lines of duplicated code.

4. **`findItemActionsEl` helper replaces 8 inline `.ai-review-card[data-id]` selectors** in handlers that do scoped UI ops inside a card (handleComparisonRadio, quickAssignSelected, setCardLoading, clearCardLoading, showRejectNotesPanel, showInlineConfirm, cancelInlineConfirm). Returns the panel on desktop + card on mobile. Worked because `renderActionsPanel` output reuses the same class names inside the panel (`.ai-card-actions`, `.ai-comparison-radio`, `.btn-ai-comparison-assign`, `.doc-combobox-container`, `.ai-inline-ft-toggle`).

5. **`animateAndRemoveAI` dual-targets** `.ai-doc-row` (desktop) and `.ai-review-card` (mobile fallback). Also now calls `resetPreviewPanel` if the removed item was the active one — needed because row disappears but the panel would otherwise render stale content.

6. **`.ai-cn-section` and `.ai-missing-docs-group` default-expanded in desktop path.** Plan mentioned "IntersectionObserver collapse on scroll past" — deferred to a follow-up DL. Default-expanded with `.open` class was simpler and the user can scroll past them naturally. Will revisit if reviewers complain about vertical space.

7. **Research:** skipped fresh web search (cumulative-knowledge rule) — DL-330 had already researched 3-pane master-detail + scroll isolation thoroughly. Incremental additions were cockpit (Gmail/Outlook reading pane) + thin-row density (Linear/Superhuman), both well-understood patterns embodied in the user's brief.

### Risks to watch during testing

- **Pane 3 vertical split on short viewports.** `min-height: 280px` on both halves means on <~720px tall viewports the panel overflows. Acceptable for admin workstation (typically ≥1080p); logged as spot-check.
- **Silent-refresh + in-flight action.** If user clicks approve and silent-refresh fires mid-flight with updated data, `refreshItemDom` + selectClient's preservation should reconcile safely (Object.assign merges new fields into existing ref, panel re-renders from merged item). Tested mentally; needs live verification.
- **Accessibility:** row click handler is on the outer div only (not keyboard-focusable). Pre-existing gap in DL-330 design; not regressed.
