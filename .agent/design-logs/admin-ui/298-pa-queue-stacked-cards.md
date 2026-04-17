# Design Log 298: PA Queue — Stacked Full-Width Cards with Internal Q&A | Docs Split
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-17
**Related Logs:**
- DL-292 (PA queue tab foundation — master/preview split view being replaced)
- DL-294 (preview panel redesign — sticky header + stats strip + Q&A grouping; repurposed into the card itself)
- DL-295 (2-col Q&A | Docs preview grid + age priority + inline doc status + `{placeholder}` fix)
- DL-296 (WF02 issuer-name extraction → `issuer_name_suggested` + ✨ accept chip)
- DL-227 (inline doc status tag menu — reused)
- DL-199 (client notes timeline)

## 1. Context & Problem

The current PA queue (DL-292) uses an AI-Review-style layout: a ~520px master column of narrow cards on one side and a sticky preview panel on the other. Live use revealed:

1. **Cards are cramped.** In 520px, answer chips + doc chips wrap aggressively, priority badge competes with date, ✨ suggestion chips (DL-296) get squeezed to a secondary row.
2. **Two clicks to see the full picture.** Scanning the card tells you only snippets; the full Q&A + doc list only appears after clicking into the preview. For a stage where the admin is making a send-or-not-send decision per client, "click to see the details" is friction.
3. **Preview & card duplicate information.** Every field shown on the card is also in the preview — NNGroup anti-pattern flagged in DL-292's own research (§3).
4. **DL-296 ✨ chips live in an awkward row.** Per DL-296 §6, chips render above actions, disconnected from the actual doc they belong to. Users have to mentally map `✨ אינטראקטיב` back to which template it's for.

**User ask (verbatim, paraphrased):** "Stacked full-width client cards taking the whole screen. Each card internally split — questionnaire on one side, required docs on the other — so reviewer sees both in parallel without flipping panels. Integrate the ✨ issuer suggestion feature per doc row."

## 2. User Requirements

1. **Q:** How should each card split Q&A vs docs? **A:** 50/50 equal columns, stacked vertically below 1024px.
2. **Q:** Cards collapsed or expanded on load? **A:** First 3 expanded, rest collapsed; click card header to expand.
3. **Q:** Where does the ✨ issuer suggestion live? **A:** Inline next to each doc row, next to the doc's name. Click ✓ to accept.
4. **Q:** Should "Client Questions" stay a modal? **A:** Yes, keep the existing DL-292 modal behavior.
5. **Q:** Remove preview panel entirely? **A:** Yes, remove it. The card IS the preview.
6. **Q:** Max card width on ultra-wide? **A:** Match the current overall PA tab container width — i.e., the current `.ai-review-split` container width becomes the single-column card stack width; cards fill it.
7. **Q (follow-up):** Doc-manager shortcut on each card? **A:** Add an inline folder-open icon button in the card header that opens `document-manager.html?client_id=<client_id>` in a new tab — identical pattern to AI-Review accordions (`script.js:3847` — `.ai-doc-manager-link` + `folder-open` icon + `onclick="event.stopPropagation()"` so it doesn't toggle expand).

## 3. Research

### Domain
List-of-detail-views (stacked expandable cards) vs master-detail split — UX trade-offs for approval queues. Incremental to DL-292/294/295 (which covered Linear Triage, NNGroup cards, Stripe/Linear/Gmail detail panels, and 50/50 split columns).

### Sources (incremental only)
1. **GitHub PR "Files changed" (stacked diff cards)** — each file is a full-width expandable card with internal sub-layout (old | new). Default behavior: some files auto-expanded based on size heuristic, others collapsed with "Load diff" button. Proves stacked-expandable works for dense, detail-rich review flows where scanning + drilling coexist.
2. **Shopify Polaris "ResourceList + ResourceItem"** — recommends card = primary unit when the item has 3+ secondary actions or needs in-row detail panels (Q&A + docs + notes + questions). Stacked with inline expand is their default pattern for order-review flows.
3. **NNGroup "Accordions on Desktop: Usability"** — accordions OK when (a) items are independent, (b) users rarely compare items, (c) content is dense. All three hold for PA queue: each client is independent, review is client-by-client, content is dense. Anti-pattern they flag: using accordions for "scannable" lists — we mitigate by keeping the collapsed-card header informative (name, age badge, stats counts).
4. **DL-292 §3 (prior research)** — Linear Triage's "empty state = done" and "one primary action per card" principles carry over directly. Approve-and-send remains the single green CTA.

### Key Principles Extracted
- **Collocation over split views when comparing ≤2 surfaces.** Q&A and docs are compared *within* one client, not across clients. Side-by-side inside the card beats a separate sticky panel.
- **Progressive disclosure by FIFO priority.** First 3 cards (oldest) expanded by default — reviewer starts work immediately. Rest collapsed — fast render, low visual noise.
- **Collapsed header must be informative.** Client name + age badge + counts (answers / docs / ✨ suggestions / questions / notes) visible without expanding, so the reviewer can triage "which to open next" at a glance.
- **Anchor AI suggestions to the thing they modify.** ✨ chip sits on the exact doc row it belongs to, not in a floating group.

### Patterns to Use
- **Stacked `<details>`-semantics card** (but built with a button + aria-expanded, not `<details>`, so we control animation + default-open state). Each card: summary header always visible; body (2-col Q&A | Docs + Notes + Questions) shown when expanded.
- **Reuse DL-295's `.pa-preview-cols` grid verbatim** inside the card body — 1fr 1fr desktop, 1fr mobile. Zero new CSS for the internal split.
- **Reuse DL-227 inline doc-tag menu + DL-295 `renderPaDocTagRow` verbatim** — the row-level UI already works; it just gets rendered inside the card instead of inside the sticky preview.
- **Reuse DL-296's `.pa-suggest-chip` + `acceptIssuerSuggestion` verbatim** — the chip DOM is identical; only its placement changes (inline in the doc row instead of a floating `pa-card__suggestions` band).

### Anti-Patterns to Avoid
- **Separate "master" list with different summary than "detail" body** (current state — drops the cognitive bridge).
- **All-expanded-on-load.** At 30+ queued reports the initial paint stalls and users lose their place when scrolling. First-3 expanded balances scannability with immediate work.
- **Animating height on every toggle.** CSS max-height transitions on arbitrary content are janky. Use `hidden` attribute + a single fade-in so the paint is instant.
- **New endpoint.** Backend already returns everything the card needs (`answers_all`, `doc_groups`, `client_questions`, `notes`, `client_notes`, `issuer_name_suggested` per DL-296). Zero API changes.

### Research Verdict
Delete the master/preview split for the PA tab only. Render a single stacked column of full-width cards, each a composition of the DL-292 summary header + DL-294 stats strip + DL-295 2-col Q&A | Docs body + DL-296 inline ✨ chip per doc row + DL-292 notes/questions/actions. First 3 cards expanded on load; the rest are collapsed (header-only) with expand-on-click. Preview panel, `loadPaPreview`, `loadPaMobilePreview`, `_activePaReportId`, and `.preview-active` state are removed. AI-Review tab is untouched.

## 4. Codebase Analysis

### Existing Solutions Found
- `buildPaCard()` (`script.js:5783`) — current summary renderer. Becomes the **collapsed header** renderer (slightly trimmed + expand chevron + counts).
- `buildPaPreviewHeader()` (`script.js:5923`) — stats strip. Folded into the expanded card body.
- `buildPaPreviewBody()` (`script.js:5952`) — current preview body. Becomes the **expanded card body** renderer, unchanged internally.
- `.pa-preview-cols` grid (`style.css`) — reuse as-is for card body.
- `renderPaDocTagRow()` (`script.js:6070`) — doc row with inline DL-227 status menu. Unchanged; add suggestion chip rendering inside the row.
- `acceptIssuerSuggestion()` / `acceptAllIssuerSuggestions()` (DL-296) — reused. Only the DOM hook (`data-doc-id`, `data-suggestion`, `data-report-id`) moves from a card-level band to the doc-row element.
- `openQuestionsForClient()` — unchanged, stays modal.
- `approveAndSendFromQueue()` — unchanged. Slide-out animation already targets `.pa-card`.
- `loadPaPreview()`, `loadPaMobilePreview()`, `buildPaPreviewHtml()`, `_activePaReportId`, `paReviewDetail` div, `paPreviewHeaderBar`, `paPreviewPlaceholder`, `paPreviewBody` — **all deleted**.

### Reuse Decision
No new endpoints, no new data shape. Pure frontend restructure + tiny CSS addition for the expand/collapse animation and the wider card. The card body is literally `buildPaPreviewBody(item)` output placed inside the card, swapping the parent from `.ai-review-detail` to `.pa-card__body`.

### Relevant Files
| File | Role |
|------|------|
| `frontend/admin/index.html` | Replace `.ai-review-split` block (lines ~781-818 in pending-approval tab) with a single `<div id="paCardsContainer" class="pa-stack">…</div>` column |
| `frontend/admin/js/script.js` | Rewrite `buildPaCard` → returns full card (header + optional expanded body); delete `loadPaPreview`, `loadPaMobilePreview`, `buildPaPreviewHtml`, `_activePaReportId`; add `togglePaCard(reportId)`; re-render suggestion chips inside doc rows |
| `frontend/admin/css/style.css` | `.pa-stack` single-column container with same max-width as prior `.ai-review-split`; `.pa-card--collapsed` / `.pa-card--expanded`; `.pa-card__body` padding + animation; DL-295's `.pa-preview-cols` reused inside `.pa-card__body` (no change) |
| `.agent/design-logs/INDEX.md` | Add DL-298 row |
| `.agent/current-status.md` | Session summary + Section 7 tests |

### Dependencies
- None added.
- DL-296 backend payload (`issuer_name_suggested` on each doc) — already live.
- `ENDPOINTS.EDIT_DOCUMENTS` (existing) for inline status + suggestion accept — unchanged.
- `APPROVE_AND_SEND` (existing) — unchanged.

## 5. Technical Constraints & Risks
- **Risk:** Large queues (20+) with all cards in the DOM could render more HTML than before (previously only the summary row + 1 open preview). Mitigation: collapsed cards render header-only HTML (~200 bytes of DOM each); full body only renders on expand. For the 3 initially-expanded, that's a known fixed cost.
- **Risk:** Losing the "sticky preview always visible" ergonomics for users who liked scrolling cards while reading one in the preview. Mitigation: user explicitly requested removal; the expand-card is the replacement. If regret surfaces post-live, a follow-up DL can add a pop-out-to-modal action on the card header, but we ship without it.
- **Mobile:** `.pa-preview-cols` already collapses to 1 column at <1024px (DL-295). Cards stack naturally. The deleted `loadPaMobilePreview` bottom sheet goes away — mobile users just expand inline.
- **Scroll position after approve-and-send:** card slide-out removes one card; we must not jump-scroll the page. The existing animation targets the card's own height, so neighbors shift naturally.
- **DL-296 ✨ chip placement change:** existing tests in DL-296 §7 assume a floating `pa-card__suggestions` band. After this log, that band is gone; tests need an update (covered in §7 below).
- **XSS:** no new user-text sinks — all renders reuse existing `escapeHtml` / `renderDocLabel` paths.

## 6. Proposed Solution

### Success Criteria
Admin opens "סקירה ואישור" tab → sees a vertical stack of full-width client cards → first 3 (oldest FIFO) are pre-expanded showing Q&A on one side and required docs on the other side at ≥1024px → each doc row carrying an issuer suggestion shows an inline ✨ chip after the doc name that accepts in one click → remaining cards collapsed with informative header (name, age, counts); click header to expand → approve-and-send button on each expanded card works identically to today → no sticky preview panel exists. AI-Review tab, doc-manager, and all other surfaces are unchanged.

### Layout Blueprint

```
┌── Client: Client Name  [CPA-XXX]  לפני 9 ימים  🔴 9 ימים  ────  ▲ ──┐
│  ┌──────── תשובות שאלון (left 50%) ─┬─── רשימת מסמכים (right 50%) ──┐│
│  │ ✓ כן (4): chips…                 │ 📂 Client docs                 ││
│  │ תשובות פתוחות (2):               │   📄 T106 (employer)  ✨אינטראקטיב ✓││
│  │   • q1: ...                      │   📄 T867              ✨ג'ויה ✓ ││
│  │   • q2: ...                      │   💼 T501 (pension)            ││
│  │ ▸ הצג תשובות "לא" (8)           │ 📂 Spouse docs                 ││
│  │                                  │   📄 T106                       ││
│  └──────────────────────────────────┴────────────────────────────────┘│
│  ─── הערות (full-width) ─────────────────────────────────────────────│
│  "…"                                                                  │
│  ─── שאלות ללקוח (1) (full-width) ───────────────────────────────────│
│  1. "…"                                                               │
│  ─── [שאל את הלקוח] [✓ אשר ושלח] ──────────────────────────────────┘

┌── Client: Next (collapsed)  [CPA-XXX]  לפני 4 ימים  🟡 4 ימים  📝4 📄6 ✨2 ▼ ┐
└───────────────────────────────────────────────────────────────────────────┘
```

### Logic Flow
1. `loadPendingApprovalQueue()` fetches as today.
2. `renderPendingApprovalCards()` maps items through `buildPaCard(item, i)`; pass index so the first 3 are flagged expanded.
3. `buildPaCard(item, index)`:
   - Always renders header: name, id, date, priority, compact stat counts (answers / docs / ✨ / questions / notes), **folder-open doc-manager link** (`<a href="../document-manager.html?client_id=…" target="_blank" class="ai-doc-manager-link" onclick="event.stopPropagation()">` — reuse existing class from AI-Review accordions), and expand chevron.
   - If `index < 3` or `_paExpanded.has(reportId)` → also render `.pa-card__body` = `buildPaPreviewHeader(item)` (stats strip) + `buildPaPreviewBody(item)` (existing 2-col grid) + actions footer.
   - Else → body omitted; clicking the header adds reportId to `_paExpanded` + re-renders that card only (replaceHTML).
4. Doc rows (`renderPaDocTagRow`) gain a trailing inline `<span>` with the ✨ chip when `d.issuer_name_suggested` is non-empty.
5. Delete the floating `pa-card__suggestions` band from `buildPaCard`.
6. Delete `loadPaPreview`, `loadPaMobilePreview`, `buildPaPreviewHtml`, and the `.ai-review-detail` / `paReviewDetail` DOM.
7. `approveAndSendFromQueue` stays as-is; the card slide-out still works because the card element is intact.
8. Pagination unchanged (50/page).

### Data Structures / Schema Changes
None. Backend payload unchanged.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/index.html` | Modify | Replace PA tab's `.ai-review-split` container with `<div id="paCardsContainer" class="pa-stack">`; delete `paReviewDetail`, `paPreviewHeaderBar`, `paPreviewPlaceholder`, `paPreviewBody` |
| `frontend/admin/js/script.js` | Modify | Rewrite `buildPaCard` (header + optional body, respects `_paExpanded` set); add `togglePaCard(reportId)`; delete `loadPaPreview`, `loadPaMobilePreview`, `buildPaPreviewHtml`, `_activePaReportId`; move ✨ chip render into `renderPaDocTagRow`; drop the `pa-card__suggestions` band |
| `frontend/admin/css/style.css` | Modify | `.pa-stack` (single column, max-width matching prior split container, margin-inline:auto); `.pa-card--collapsed` / `.pa-card--expanded` (chevron rotation, body show/hide); move `.pa-preview-cols` usage inside `.pa-card__body` (no CSS change — class already works); `.pa-doc-row__suggest` inline placement; remove rules scoped to `.ai-review-detail` for PA |
| `.agent/design-logs/admin-ui/298-pa-queue-stacked-cards.md` | Create | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-298 row |
| `.agent/current-status.md` | Modify | Session summary + §7 tests |

### Final Step (Always)
* **Housekeeping:** Update DL-298 status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked §7 items to `current-status.md`, commit. **Pause before push/merge** (per `feedback_ask_before_merge_push`).

## 7. Validation Plan
* [ ] Open "סקירה ואישור" tab → no sticky preview panel exists; single stacked column of cards
* [ ] First 3 cards expanded on load; rest collapsed with informative header (name, id, date, priority badge, count badges, folder-open doc-manager link)
* [ ] Click folder-open icon in header → opens `document-manager.html?client_id=<id>` in a new tab; does NOT toggle expand/collapse state
* [ ] Expanded card at ≥1024px: Q&A on one side, docs on the other side, 50/50
* [ ] Expanded card at <1024px: Q&A and docs stack vertically
* [ ] Click collapsed card header → expands inline with fade-in; chevron rotates
* [ ] Click expanded card header → collapses back
* [ ] Card with ≥1 ✨ suggestion → ✨ chip renders INLINE in the matching doc row (right after the doc name), not in a floating band
* [ ] Click ✨ chip → optimistic UI removes chip, doc name updates, toast shown, Airtable PATCHed (DL-296 behavior preserved)
* [ ] Inline doc status menu (DL-227 pattern via `renderPaDocTagRow`) still works inside the card
* [ ] "שאל את הלקוח" modal still opens from card actions footer (DL-292 behavior preserved)
* [ ] Approve & Send → card slides out → toast "נשלח ל…" → stage advances; next card is NOT auto-focused (no preview to focus into); queue just re-renders minus that card
* [ ] Empty state "כל השאלונים נסקרו" renders when no items
* [ ] Pagination (50/page) renders below the stack; page change resets expand state per spec (first-3 of new page open)
* [ ] Year + filing-type filters still work
* [ ] AI-Review tab visually unchanged (no CSS regression from shared `.ai-review-split` edits — we edit PA-scoped rules only)
* [ ] Doc-manager, dashboard, reminders tabs unchanged
* [ ] Mobile (390px): cards stack full-width, body sections stack, ✨ chip still inline, actions footer full-width
* [ ] RTL: chevron rotates the correct direction; inline ✨ chip sits at the end of the doc name (logical, not left)
* [ ] No console errors; no dangling references to `paPreview*` DOM ids or `_activePaReportId`

## 8. Implementation Notes (Post-Code)

**HTML (`frontend/admin/index.html`):** replaced `.ai-review-split` block (master + sticky detail panel) with a single `<div id="paCardsContainer" class="pa-stack">`; removed `paReviewDetail`, `paPreviewHeaderBar`, `paPreviewPlaceholder`, `paPreviewBody`, and the mobile `paMobilePreviewModal`. `paPagination` now renders below the stack with a `.pa-stack-pagination` wrapper.

**JS (`frontend/admin/js/script.js`):**
- `_activePaReportId` → `_paExpanded: Set<reportId>`. Seeded additively with first 3 of current page on every `renderPendingApprovalCards()` call.
- Added `togglePaCard(reportId, ev)` — flips presence in `_paExpanded` and re-renders that single card via `outerHTML` swap.
- Rewrote `buildPaCard(item)`: header = name + id + relative date + priority pill + count badges (answers/docs/✨/questions/notes) + doc-manager `.ai-doc-manager-link` (reused from AI-Review accordions at `script.js:3847`) + chevron; body (rendered only when expanded) = `buildPaPreviewBody(item)` + approve/questions action footer.
- Rewrote `renderPaDocTagRow(d, reportId)` to render an inline ✨ suggestion chip (`.pa-doc-row__suggest.pa-suggest-chip`) at the end of each doc row when `d.issuer_name_suggested` is non-empty. Chip reuses `acceptIssuerSuggestion()` verbatim — only the DOM location changed.
- Deleted `loadPaPreview`, `loadPaMobilePreview`, `closePaMobilePreview`, `buildPaPreviewHtml`, `buildPaPreviewFooter`, the floating `.pa-card__suggestions` band from `buildPaCard`, and all `_activePaReportId` refs in `approveAndSendFromQueue` / `updatePaDocStatusInline`.
- `togglePaShowNo(reportId)` now re-renders the single card (was: re-render preview body).
- `approveAndSendFromQueue`: on success, removes `reportId` from `_paExpanded` before `renderPendingApprovalCards()`; no more auto-focus-next call.

**CSS (`frontend/admin/css/style.css`):**
- New `.pa-stack` (flex column), `.pa-stack-pagination` (padding), `.pa-card--stack` (full-width, max-width none, amber `border-inline-start` preserved).
- `.pa-card__header` as a 3-group flex row: `.pa-card__header-main` (name + meta) / `.pa-card__header-badges` (count pills) / `.pa-card__header-actions` (folder-open link + `.pa-card__chevron`).
- `.pa-card__body` with 160ms `pa-card-fade-in` keyframe; `.pa-card--expanded .pa-card__header` gets a bottom divider + margin.
- `.pa-count-badge` + `.pa-count-badge--suggest` (amber) for the inline header counts.
- Moved DL-295's `.pa-preview-cols` rules into `.pa-card__body` scope (collapses 1fr at <1024px, unchanged semantics).
- `.pa-doc-row__suggest` margin-inline-start to separate from doc name.
- Removed the stale `#paReviewDetail { display:none }` mobile rule.
- Mobile ≤640px: header groups wrap so main row takes 100% and badges/actions stack below.

**Research principles applied:**
- Collocation over split when comparing ≤2 surfaces within one client (§3 principle #1) — Q&A + docs side-by-side inside the card.
- Progressive disclosure by FIFO priority (§3 principle #2) — first 3 cards pre-expanded, rest click-to-expand.
- Informative collapsed header (§3 principle #3) — name, age pill, and 5 count badges replace the former summary chip rows.
- Anchor AI suggestions to the thing they modify (§3 principle #4) — DL-296 ✨ chip moves from card-level band to the individual doc row.

**Deviations:**
- The DL-294 stats strip (`buildPaPreviewHeader`) is not reused inside the body — its info (year / filing type / spouse / stat counts) is either redundant with the new header count badges or low-value repeated context; kept the body focused on Q&A/Docs/Notes/Questions. `buildPaPreviewHeader` is retained in the file (unused) in case a future DL wants it — no runtime cost.
- The collapsed header dropped the "answers chips preview" + "doc chips preview" + prior-year placeholder rows from the previous card. The count badges give an at-a-glance signal; the full detail is one click away. Prior-year placeholder was a DL-292 TODO anyway.
