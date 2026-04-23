# Design Log 334: AI Review Cockpit — Middle Column Thin Rows + Right-Side Actions Panel (v2)

**Status:** [DRAFT]
**Date:** 2026-04-23
**Related Logs:** DL-053 (silent-refresh merge-by-id), DL-075 (original split-view), DL-086 (reviewed state transitions), DL-199 (client notes timeline), DL-237 (PDF split), DL-269/270/271 (contract period), DL-278 (scroll-into-view), DL-306 (deep-link), DL-314 (multi-template match), DL-320 (also-match UX), DL-330 (3-pane rework), DL-332 (pane 1 density), DL-NNN-on-hold (batch-questions dismissal adds `on_hold` review_status — in flight, ships first)

**Supersedes:** the previous DL-334 attempt (commit `1ef907f`, reverted from main via `f643a79`). That version over-engineered the panel, duplicated filename, was missing on_hold, and used color tokens without the flat-minimal discipline now required. This v2 plan is a full rewrite.

## 1. Context & Problem

DL-330 built the 3-pane split (clients → docs → preview). DL-332 densified pane 1. Today's pane 2 still renders full fat cards per doc — every card carries AI reasoning, 3–5 buttons, conditional banners, overflow menu. Result: 4–6 docs per 1080p viewport, preview pane is passive.

DL-NNN-on-hold (in flight, ships first) adds a new `review_status='on_hold'` state: the office can dismiss a client review while sending questions — docs with pending questions flip to on_hold and wait for the client to reply, instead of being rejected or deleted. The old fat-card UI gets on_hold support from that DL. DL-334 **must render on_hold as a first-class state in the cockpit from day one** — the office needs to scan pane 2 and immediately see which docs are waiting on a client reply.

DL-334 v2:
- Pane 2 becomes a flat, minimal list of ~28-30px thin rows. One color stripe per row conveys state.
- Pane 3 splits vertically into preview (top) + state-aware actions panel (bottom).
- All AI reasoning, filename, badges, actions relocate to the panel — filename renders **once** in the panel header, never in the row (row has truncated filename only).
- on_hold is a full state variant in every branch: row stripe, row category text, panel lozenge, panel body, panel actions.
- Bundles DL-053 silent-refresh merge-by-id.

## 2. User Requirements

From the visual spec + mockup:

1. **Q:** Visual style?
   **A:** Flat, minimal, lots of whitespace. No gradients, no shadows except functional focus rings. 0.5px borders only. Sentence case. Single weight scale (400 regular, 500 emphasis). Existing tokens only — no new hex values.
2. **Q:** Row height and density?
   **A:** 28–30px per row, 12px font, target ~15–20 docs per 1080p viewport.
3. **Q:** Pane 2 top?
   **A:** 28–30px sticky strip with `X/Y נבדקו` (start) + folder-open icon only (end). No client name, no pending count, no chevron.
4. **Q:** Client-notes + missing-docs?
   **A:** Both default collapsed on every client load. 28px collapsed headers. Rotate arrow `▸`/`▾` on toggle.
5. **Q:** Filename location?
   **A:** **Once**, in the panel header. Row shows middle-truncated filename (extension preserved). Sender/date renders as **visible text** below filename in panel, not tooltip.
6. **Q:** on_hold treatment?
   **A:** First-class state across stripe/category/lozenge/panel body/actions. Row category text swaps to `⏳ ממתין ללקוח` (no `?` glyph on on_hold rows — category text already signals). Panel body shows the question prominently; single `סיים את ההמתנה` button reveals the standard pending actions via existing `startReReview`.
7. **Q:** Pane 3 proportions?
   **A:** `flex: 1.3` preview / `flex: 1` actions, min-heights 240px / 260px. Both get the same card shell (0.5px border, --radius-md, 8–10px padding).
8. **Q:** Transient sub-panels scope?
   **A:** Cover **primary actions area only** — not the whole panel, not the iframe.
9. **Q:** Mobile?
   **A:** Untouched. `isAIReviewMobileLayout()` guard at every cockpit code path; mobile keeps `renderAICard` / `renderReviewedCard` (which DL-NNN-on-hold modifies for the fat-card path).

## 3. Research

### Domain
Information density in review UIs; cockpit pattern (preview + contextual actions); multi-state list rendering with waiting/held states.

### Sources Consulted (cumulative)
1. **DL-330 research** — 3-pane master-detail (Outlook / Mac Mail / Linear), `overscroll-behavior: contain`, fixed-width wide / collapse narrow. Reused verbatim; no new research on 3-pane fundamentals.
2. **DL-332 research** — row-density patterns (Linear, Superhuman). Applied here to pane 2 rows.

### Key Principles
- **Single visual affordance per row.** One color stripe, one category text, one trailing dot (flags merged). No buttons, no multiple chips. Row is a triage tool, not a workspace.
- **Cockpit relocation is lossless.** Every piece of info on today's fat card appears somewhere in the new layout — nothing gets deleted except the redundant "תצוגה מקדימה" button (row click opens preview).
- **Waiting states need their own visual language.** on_hold isn't "pending, just slower" — it's "resolved for now, waiting on human input." The ⏳ glyph + amber stripe + lozenge + single `סיים את ההמתנה` button all reinforce this.
- **Flat-minimal constrains the palette.** No decorative shadows, no gradients, no emoji beyond the functional ones (🤖 ✓ ⚠ ⏳ 📋 📄 ✂️ 💬 ✕ 🔄 📅 📎). Single weight scale (400/500).

### Anti-Patterns to Avoid
- Auto-approve from list. Spec explicit: user opens every doc.
- Scroll-linked preview. DL-330 rejected; DL-334 inherits.
- Duplicating filename in both row and panel. Spec explicit: filename once, in panel header. Row gets middle-truncated for scan only.
- Adding visual cues beyond what the spec lists. Every new color/border/padding is a budget decision; ask before inventing.
- Card-level state tinting on the panel itself beyond the left-edge 3px stripe. Panel border + lozenge + stripe covers it.

### Research Verdict
The visual spec IS the verdict — a prescriptive flat design tuned for scan density plus a contextual cockpit. Our job is faithful implementation.

## 4. Coordination With DL-NNN-on-hold

**Ordering:** DL-NNN-on-hold ships first. By the time DL-334 starts, `review_status='on_hold'` is a production state. `aiClassificationsData` will contain rows with `review_status='on_hold'` and a valid `pending_question` field.

**Our consumption contract:**
- `dismissAndSendQuestions(clientName)` (mobile + desktop entry point from the "סיים בדיקה ושליחת שאלות" button): DL-NNN owns this handler. It partitions the client's items into (a) has `pending_question` → flipped to `review_status='on_hold'` in `aiClassificationsData`; (b) no `pending_question` → removed from `aiClassificationsData` (dismissed). DL-334 does NOT modify this handler.
- `dismissClientReview(clientName)`: same — DL-NNN owns. DL-334 does NOT modify.
- After either handler mutates `aiClassificationsData`, DL-334's cockpit re-renders via the standard mechanism: the affected rows get outerHTML-swapped; if the active item was dismissed (case b), we clear the actions panel to empty state; if the active item flipped to on_hold (case a), we re-render the panel in on_hold variant.

**Non-negotiable:** DL-334 does NOT change any logic in `dismissAndSendQuestions` / `dismissClientReview` / or the server-side flip. It only renders the result.

**Mobile compatibility:** `renderReviewedCard` and `renderAICard` receive on_hold support from DL-NNN. DL-334 does not touch those functions (they remain for mobile <768px only after DL-334).

## 5. Codebase Analysis

**Primary surfaces:**

| File | Lines (post DL-333 baseline) | What |
|------|------------------------------|------|
| `frontend/admin/index.html` | ~13 | CSS cache-bust `?v=` |
| `frontend/admin/index.html` | ~1020-1047 | Pane 3 DOM — wrap iframe in `.ai-preview-frame`, add sibling `.ai-actions-panel#aiActionsPanel` |
| `frontend/admin/index.html` | ~1518 | JS cache-bust `?v=` |
| `frontend/admin/css/style.css` | ~3315-3326 | 3-col grid (unchanged layout, add vertical split inside pane 3) |
| `frontend/admin/css/style.css` | ~3620+ | Add `.ai-preview-frame` / `.ai-actions-panel` / state variants / row styles |
| `frontend/admin/css/style.css` | ~4709-4858 | Mobile `@media` — ensure new cockpit DOM hidden on <768px |
| `frontend/admin/js/script.js` | ~3625, 3667 | `resetPreviewPanel` + `loadDocPreview` — dual-clear `.preview-active` / `.ai-doc-row.active` |
| `frontend/admin/js/script.js` | ~3765-3790 | Silent-refresh merge-by-id (DL-053 fix bundled) |
| `frontend/admin/js/script.js` | ~3926 | `getCardState` — add `on_hold` branch that returns `'on_hold'` |
| `frontend/admin/js/script.js` | ~3939, 3950 | `handleComparisonRadio` + `quickAssignSelected` — use `findItemActionsEl` scope |
| `frontend/admin/js/script.js` | ~3975-4091 | `buildClientAccordionHtml` — keep intact for mobile. Add new `buildDesktopClientDocsHtml` for desktop path |
| `frontend/admin/js/script.js` | ~4159-4186 | `selectClient` — desktop path uses new builder + auto-selects first pending doc |
| `frontend/admin/js/script.js` | Insert before `getCardState` | New: `findItemActionsEl`, `refreshItemDom`, `truncateMiddle`, `getRowStripeClass`, `getRowCategoryText`, `renderDocRow`, `renderActionsPanel` + state branches, `selectDocument`, `buildClientThinStrip`, `buildDesktopClientDocsHtml` |
| `frontend/admin/js/script.js` | ~4391-4689 | `renderAICard` — kept intact (mobile only after DL-334) |
| `frontend/admin/js/script.js` | ~4691-4826 | `renderReviewedCard` — kept intact (mobile only). Already receives `on_hold` support from DL-NNN-on-hold |
| `frontend/admin/js/script.js` | ~4829+ | `startReReview` — desktop path uses `refreshItemDom`; mobile keeps inline swap |
| `frontend/admin/js/script.js` | 5006, 5016, 5362, ~5755 (review-render sites), ~5920, ~6125, ~6265, 10669, 10713 | 14 call sites of `.ai-review-card[data-id]` — each branches via `findItemActionsEl` helper or `refreshItemDom` |
| `frontend/admin/js/script.js` | renderAICards ~4977 | Desktop pane 2 builder swaps from `buildClientAccordionHtml` to `buildDesktopClientDocsHtml` |
| `.agent/design-logs/ai-review/334-cockpit-middle-and-actions.md` | — | This file, already being written |
| `.agent/design-logs/INDEX.md` | — | Add DL-334 entry, bump counters |
| `.agent/current-status.md` | — | Section 7 TODOs |

**Reuse verbatim:** `.ai-cn-section`, `.ai-missing-docs-group` markup; `toggleClientNotes`, `toggleMissingDocs`, `loadDocPreview`, `resetPreviewPanel`, `handleComparisonRadio`, `quickAssignSelected`, `showAIAlsoMatchModal`, `initAIReviewComboboxes`, `openSplitModal`, `editContractDate`, `openAddQuestionDialog`, `startReReview`, `rejectAIClassification`, `showRejectNotesPanel`, `executeReject`, `transitionCardToReviewed`, `animateAndRemoveAI`, `friendlyAIReason`, `getCardState`, `renderDocLabel`, `appendContractPeriod`, `formatPeriodLabel`, `renderDocTag`, `escapeHtml`, `escapeAttr`, `icon`.

## 6. Constraints & Risks

- **Vanilla JS + vanilla CSS only.** No React island for this DL.
- **No new tokens.** Every color, radius, spacing, font-size comes from `design-system.css`. Spec explicit: "If you think you need a new color, stop and ask me." Spec prescribes specific tokens per element — follow literally.
- **0.5px borders** render as hairline on high-DPI; on 1x displays browsers round up to 1px. Acceptable; no fallback needed.
- **on_hold must be first-class everywhere.** Each branch site (`getCardState`, stripe-class lookup, category-text lookup, lozenge lookup, body renderer, actions renderer) handles on_hold explicitly, not as an "else" fallback.
- **14 callers of `.ai-review-card[data-id]`** in script.js — each gets `findItemActionsEl` or `refreshItemDom`. Mobile path preserved via `isAIReviewMobileLayout()` guard.
- **No full list re-render.** Ever, except on client switch (`selectClient`). Post-mutation = row outerHTML swap + panel re-render + scroll preservation.
- **Short viewports.** `min-height: 240px` preview + `min-height: 260px` actions = 500px floor. On <700px tall viewports the panel overflows — scroll inside actions panel. Acceptable.

## 7. Proposed Solution — Visual Spec (reference)

### Global tokens and rules
- Fonts: 11px, 12px, 13px. Weights: 400 and 500 only.
- Borders: 0.5px everywhere except focus rings.
- Radii: `--radius-md` / `--radius-lg` for containers; 3px for chips/buttons; 4px for reasoning blocks.
- Colors: only from `design-system.css`. Specific tokens called out inline below.
- Sentence case Hebrew/English. No Title Case, no ALL CAPS.
- No gradients, no decorative shadows. `var(--shadow-sm)` only for the overflow-menu dropdown.

### PANE 2 — middle column

**Top strip (sticky):**
- Height 28–30px; padding 4px 8px; `border-bottom: 0.5px solid var(--gray-200)`.
- Start side: `18/19 נבדקו` · `font-size: 11px` · `color: var(--gray-500)` · `font-variant-numeric: tabular-nums`.
- End side: folder-open icon only (14px, `color: var(--brand-500)`). Link to doc-manager; `event.stopPropagation()`.
- No client name, no pending-count, no chevron.

**Collapsed section headers (client-notes + missing-docs):**
- Height 28px; padding 5px 8px.
- Font 12px, `color: var(--gray-600)`.
- Layout: `[▸ arrow 9px] [6px gap] [label]`. Arrow rotates `▾` on expand.
- Labels (unchanged semantics):
  - `📋 הודעות ללקוח (N)` — only if `N > 0`.
  - `📄 מסמכים נדרשים (X/Y התקבלו)` when `hasStatusVariation`, else `📄 מסמכים חסרים (N)`.
- Default **collapsed** on every client load (change from mobile, which keeps open).
- Click anywhere on header toggles.
- After the last section header: `0.5px border-bottom var(--gray-100) + margin-bottom 2px` separator before the doc list.

**Doc rows:**
- Height 28–30px; padding 5px 6px; `font-size: 12px`.
- Grid start → end: `[3px stripe] [6px] [filename flex:1 truncate-middle] [6px] [? glyph 10px color info-500 optional] [6px] [category 11px color gray-500] [6px] [trailing dot optional]`.
- Stripe: 3px wide, 16px tall, `border-radius: 2px`. Color table:
  | State | Stripe token |
  |-------|--------------|
  | pending + full | `--success-500` |
  | pending + fuzzy | `--success-500` |
  | pending + issuer-mismatch | `--warning-500` |
  | pending + unmatched | `--warning-500` |
  | on_hold | `--warning-500` |
  | approved | `--success-500` |
  | rejected | `--danger-500` |
  | reassigned | `--info-500` |
- Filename: `truncateMiddle(name, ~42)` preserving extension (.pdf/.jpeg/.png).
- Selected row: `background: var(--brand-50)` + filename `font-weight: 500`.
- Hover (non-selected): `background: var(--gray-50)`.
- Transition: `background 0.12s ease`.
- Click anywhere on row → `selectDocument(id)`.

**Category text (end-aligned):**
- Pending: matched template's short category name (e.g. "דוח שנתי").
- **on_hold**: render `⏳ ממתין ללקוח` in `color: var(--warning-600)` **instead** of the category. Critical scan affordance.
- Reviewed: same category name.

**Trailing `?` glyph:**
- Only when `item.pending_question` is set **AND** `review_status !== 'on_hold'`.
- 10px, `color: var(--info-500)`, `title` = first 80 chars of question.
- On on_hold rows, the `⏳ ממתין ללקוח` already signals — no duplicate glyph.

**Trailing colored dot:**
- 6px × 6px, border-radius 50%.
- `color: var(--warning-500)` if any of `is_duplicate` / `is_unrequested` / `pre_questionnaire` is set.
- Merged into one dot. `title` attribute lists all applicable Hebrew labels joined with ` · `.

### PANE 3 — preview + actions

**Vertical split container (`.ai-review-detail`):**
- `display: flex; flex-direction: column; gap: 6px`.
- `.ai-preview-frame` — `flex: 1.3; min-height: 240px`.
- `.ai-actions-panel#aiActionsPanel` — `flex: 1; min-height: 260px; overflow-y: auto`.
- Both: `background: var(--white); border: 0.5px solid var(--gray-200); border-radius: var(--radius-md); padding: 8–10px`.

**Preview frame:** unchanged from today. Wrap existing iframe + header-bar + placeholder/loading/error inside `.ai-preview-frame`.

**Actions panel outer container:**
- `border-inline-start: 3px solid` — color matches row stripe:
  | State | Panel border-start |
  |-------|-------------------|
  | pending + full/fuzzy | `--success-500` |
  | pending + issuer-mismatch/unmatched | `--warning-500` |
  | on_hold | `--warning-500` |
  | approved | `--success-500` |
  | rejected | `--danger-500` |
  | reassigned | `--info-500` |
  | empty | `--gray-300` |
- Padding 10px 12px. Internal `flex column, gap: 8px`.

**Actions panel header (every state):**
- Line 1: `[optional lozenge] [filename 13px weight-500] [filing-type chip 11px] [optional flag chips]`.
- Line 2: `senderEmail · receivedAt`
  - 11px, `color: var(--gray-500)`
  - Format `sender@domain.com · DD.MM.YYYY`
  - Either piece missing → show other alone. Both missing → omit line entirely.
- Filename appears ONCE (here). Not repeated in body.

**Divider:** `padding-top: 6px; border-top: 0.5px solid var(--gray-200);` between header and body.

**Lozenges** (reviewed + on_hold):
- Inline at start of Line 1 (before filename).
- Padding 1px 6px; border-radius 3px; font 11px weight 500.
- Variants:
  | State | Lozenge bg | Lozenge fg | Text |
  |-------|-----------|-----------|------|
  | approved | `--success-100` | `--success-700` | `✓ אושר` |
  | rejected | `--warning-100` | `--warning-700` | `⚠ דורש תיקון` |
  | reassigned | `--info-100` | `--info-700` | `✓ שויך מחדש` |
  | **on_hold** | `--warning-100` | `--warning-700` | `⏳ ממתין ללקוח` |

**Filing-type chip:** reuse existing `.ai-filing-type-badge.ai-ft-*`.

**Flag chips** (duplicate / unrequested / pre_questionnaire):
- Only when flag true. Padding 1px 6px; border-radius 3px; font 11px.
- `background: var(--warning-50); color: var(--warning-700)`.
- Full Hebrew label (e.g. `כפול`, `לא נדרש`, `טרם מולא שאלון`).

### BODY CONTENT BY STATE

**State A (full) / State C (fuzzy):**
- Single line, 12px, `color: var(--gray-700)`.
- `🤖 AI חושב שזה: <matched name in weight 500> (87%)` — percent in `color: var(--gray-500)`.

**State B (issuer-mismatch):**
- Line 1 (12px): `🤖 AI חושב שהתקבל מ: <aiIssuer in weight 500>`.
- Gap 6px.
- Line 2 (11px `color: var(--gray-600)`): `האם זה אחד מהבאים?`.
- Gap 4px.
- Radio list (vertical):
  - Each label: padding 4px 6px; font 11px.
  - Hover: `background: var(--gray-50)`; border-radius 3px.
  - Selected: `color: var(--brand-700)`; `background: var(--brand-50)`.
  - Layout: `[radio] [6px gap] [doc label]`.
- If `sameTypeDocs.length === 0`: show `⚠️ כל מסמכי X כבר התקבלו` and fall through to combobox (State D style).

**State D (unmatched):**
- Line 1 (12px): `🤖 לא זוהה` — `🤖` `color: var(--gray-500)`, `לא זוהה` weight 500 `color: var(--gray-800)`.
- Gap 6px.
- Reasoning block (most important for this state):
  - `background: var(--gray-50); border-radius: 4px; padding: 8px 10px`.
  - Font 11px; `color: var(--gray-700); line-height: 1.5`.
  - Full `friendlyAIReason` text, NOT truncated.
- Gap 8px.
- `שייך ל:` label (11px `color: var(--gray-600)`).
- Combobox (via `initAIReviewComboboxes` unchanged):
  - Full width; height 30px; `border: 0.5px solid var(--gray-200); border-radius: 3px; padding: 0 8px; font-size: 12px`.
  - Placeholder `🔍 חפש מסמך...` `color: var(--gray-400)`.
- `.ai-inline-ft-toggle` placeholder preserved (unchanged, `display: none` until combobox triggers it).

**on_hold state (new, equal weight):**
- Line 1: lozenge + filename already in panel header.
- Body (key content for this state):
  - Label (11px `color: var(--gray-600)`): `💬 שאלה נשלחה ללקוח:`.
  - Question block: `background: var(--warning-50); border-radius: 4px; padding: 8px 10px; font-size: 12px; color: var(--warning-800); line-height: 1.5`. Full question text, NOT truncated.
- Gap 8px.
- If AI had a classification guess when the question was created, show as secondary context:
  - Line (11px `color: var(--gray-600)`): `🤖 AI זיהה כ: <matched template name in weight 500>`.
  - Informational — not an action.
- Primary actions: ONE button, full width, centered:
  - `סיים את ההמתנה` → `startReReview(id)` (existing DL-086 handler).
  - `background: transparent; border: 0.5px solid var(--warning-500); color: var(--warning-700); font-weight: 500; height: 32px`.
- **No approve/reject/reassign buttons visible.** They appear only after the user clicks `סיים את ההמתנה` (existing re-review reveal).

**Reviewed (approved / rejected / reassigned):**
- Line (12px): `תואם ל:` `color: var(--gray-500)` + space + resolved template name in weight 500.
  - Approved: `appendContractPeriod(matched_short_name || matched_template_name, item)`.
  - Reassigned: resolve via `[...all_docs, ...other_report_docs]` by `onedrive_item_id` + `status === 'Received'`; fallback chain.
  - Rejected: `attachment_name || matched_short_name || 'לא ידוע'`.
- If rejected with notes: second block — same style as State D reasoning block (`background: var(--gray-50)`), showing `<REJECTION_REASONS[reason]>: <notes.text>`.

### PRIMARY ACTIONS ROW

Layout: `flex row; gap: 4px`. Button base: 30px tall; 12px font; padding 6px 10px; border-radius 3px.

**State A / C:**
- `[✓ נכון]` `flex: 1; background: var(--success-100); color: var(--success-700); weight: 500`.
  - If `is_unrequested && matched_template_id`: label `✓ נכון - הוסף מסמך זה לרשימת המסמכים הדרושים` → `approveAIClassificationAddRequired`.
  - If `is_unrequested` no template: `aria-disabled="true"` + title.
  - Else: `approveAIClassification`.
- `[שייך מחדש]` `flex: 1; transparent; border: 0.5px solid var(--gray-300); color: var(--gray-700)` → `showAIReassignModal`.
- Below, new row: `[✕ מסמך לא רלוונטי]` full width; transparent; `border: 0.5px solid var(--danger-300); color: var(--danger-700)` → `rejectAIClassification`.

**State B (radios shown):**
- `[אישור ושיוך]` `flex: 1; background: var(--success-100); color: var(--success-700); weight: 500`; disabled until a radio is picked; `quickAssignSelected`.
- `[✕]` 40px wide; transparent; `border: 0.5px solid var(--danger-300); color: var(--danger-700)` → `rejectAIClassification`.
- Below: `[לא מצאתי ברשימה]` full width; ghost style → `showAIReassignModal`.

**State B (fallback, no same-type docs):** use State D layout (combobox + שייך + ✕).

**State D:**
- `[שייך]` `flex: 1`; disabled initially (`background: var(--gray-100); color: var(--gray-500)`); success styling when combobox selection made; `assignAIUnmatched`.
- `[✕]` 40px wide; same as State B.

**on_hold:**
- Single `[סיים את ההמתנה]` button, full width. See body spec above. No other buttons.

**Reviewed:**
- `[🔄 שנה החלטה]` full width; transparent; `border: 0.5px solid var(--gray-300); color: var(--gray-700)` → `startReReview`.
- If approved: below, `[📋 הקובץ תואם למסמך נוסף]` same style → `showAIAlsoMatchModal`.

### SECONDARY ACTIONS ROW (additive)

Separator: `border-top: 0.5px solid var(--gray-200); padding-top: 4px; margin-top: 4px`.

Layout: `flex row; gap: 4px` — small buttons.

- **Split PDF** (if `page_count >= 2`): `✂️ פיצול PDF` — 26px tall; 11px font; padding 4px 10px; transparent; `border: 0.5px solid var(--gray-200); color: var(--gray-600)` → `openSplitModal`.
- **Contract period** (T901/T902 only):
  - Full-year: `📅 חוזה שנתי מלא ✓` — `background: var(--success-50); color: var(--success-700); padding: 4px 8px; border-radius: 3px; 11px`.
  - Partial: `📅 <חוזה חלקי|לא זוהו תאריכים>: מ [start] עד [end]` with editable date spans + request-missing-period buttons — reuse `editContractDate` + `requestMissingPeriod` handlers.
- **Overflow menu (⋮)**: always at end of the secondary row.
  - Button 26×26; transparent; `border: 0.5px solid var(--gray-200); color: var(--gray-500); border-radius: 3px`.
  - Dropdown: absolute, end-aligned below button; white bg; `border: 0.5px solid var(--gray-200); border-radius: 4px; box-shadow: var(--shadow-sm); padding: 4px; font-size: 12px`.
  - Menu items:
    - Pending (not on_hold): `הוסף שאלה` / `ערוך שאלה` (label flips on `pending_question`).
    - Reviewed: `שנה החלטה` + (approved only) `הקובץ תואם למסמך נוסף` + `הוסף שאלה` / `ערוך שאלה`. Duplication with inline buttons intentional (matches today).
    - on_hold: `הוסף שאלה` / `ערוך שאלה` only (no re-review duplicate — the primary `סיים את ההמתנה` already covers it).

**Pending-question secondary block** (non-on_hold pending states only, when `pending_question` is set):
- Renders between primary actions and secondary actions row.
- `background: var(--info-50); border-radius: 4px; padding: 6px 8px; 11px; color: var(--info-700)`.
- Content: `💬 שאלה נשמרה: <full question text>` — NOT truncated.
- On on_hold cards this block is NOT shown — question is already the primary body content.

### Empty state (no doc selected):
- Centered vertically + horizontally.
- Icon: muted `◉` glyph 24px `color: var(--gray-300)`.
- Text: `בחר מסמך לבדיקה` 12px `color: var(--gray-500)`.

### TRANSIENT SUB-PANELS (reject-notes, inline-confirm, loading)

**Scope:** cover primary actions area only. NOT whole panel, NOT iframe.

**Implementation:** replace `.ai-ap-primary-actions` innerHTML; stash `dataset.originalHtml`; restore on cancel. Same mechanism as today. Escape-key cleanup preserved.

**Reject-notes panel:**
- Reason select: full width; 30px; `border: 0.5px solid var(--gray-200); border-radius: 3px; 12px`.
- Gap 6px.
- Notes textarea: full width; 60px tall; same border/radius; 12px; placeholder `הערות נוספות (אופציונלי)`.
- Gap 6px.
- Buttons row:
  - `[מסמך לא רלוונטי]` danger-styled; `flex: 1`; disabled until reason selected.
  - `[ביטול]` ghost; 60px wide.

**Loading overlay:**
- Semi-transparent `rgba(255,255,255,0.8)` over primary actions area only.
- Centered spinner + `מעבד...` text.

### STATE TRANSITIONS

After approve / reject / reassign succeeds:
1. Mutate `aiClassificationsData.find(i => i.id === id).review_status`.
2. Capture `pane2.scrollTop`.
3. Replace `.ai-doc-row[data-id="X"]` outerHTML with `renderDocRow(mutated, true)` — stripe flips.
4. Re-render actions panel via `renderActionsPanel(mutated)`.
5. Restore `pane2.scrollTop`.
6. Run `safeCreateIcons(panel) + initAIReviewComboboxes(panel)` after re-render.

**on_hold transition INTO:**
- Triggered by `dismissAndSendQuestions` (owned by DL-NNN-on-hold).
- That handler mutates `review_status` of items-with-questions to `'on_hold'` and removes items-without-questions from `aiClassificationsData`.
- DL-334 cockpit response: re-render each affected row via the same outerHTML swap. For dismissed rows (case b), the row is simply absent from the list on next render; our `renderDocList` (inside `buildDesktopClientDocsHtml`) handles list shrinking cleanly.
- If `activePreviewItemId` points to a dismissed doc → clear it and show empty state.
- If `activePreviewItemId` flipped to `on_hold` → re-render panel in on_hold variant.

**on_hold transition OUT:**
- User clicks `סיים את ההמתנה` in the panel → `startReReview(id)` (existing).
- `startReReview` on desktop calls `refreshItemDom(item)` which calls `renderActionsPanel(item)`; because `_aiReReviewing.has(item.id)` is now true, the panel renders State A/B/C/D per `getCardState(item)` (ignoring the `on_hold` review_status for render). Row stripe remains amber via the pending-state stripe rule.
- After user decides (approve/reject/reassign): `transitionCardToReviewed` sets `review_status`; `_aiReReviewing.delete(id)`; stripe flips to approved/rejected/reassigned color.
- Cancel (`ביטול`) → `cancelReReview(id)` → `_aiReReviewing.delete(id)` → panel re-renders back to on_hold variant.

**Silent refresh preservation:**
- Merge-by-id fix (DL-053) ensures item object refs stay stable.
- If a poll tick returns `review_status='on_hold'` for the currently-selected doc (same as we already rendered) — no change; panel stays in on_hold mode.
- If a poll tick flips a doc FROM `on_hold` TO something else (another tab resolved it) — cockpit re-renders accordingly; `activePreviewItemId` stays valid because we merge by id; `selectClient`/`renderAICards` re-apply `.active` + re-render panel with fresh data.

**No full list re-render.** Ever. Except on client switch.

### RESPONSIVE / MOBILE

- `isAIReviewMobileLayout()` returns true on `(max-width: 768px)`.
- `selectDocument(id)` on mobile falls through to `loadDocPreview(id)` only — no panel, no row `.active` toggle.
- Mobile keeps rendering fat cards via `renderAICard` + `renderReviewedCard` (the latter gets on_hold support from DL-NNN-on-hold; DL-334 does not modify that function).
- Cockpit DOM hidden on mobile via `@media (max-width: 768px) { .ai-preview-frame, .ai-actions-panel { display: none; } }` — complementing the existing `.ai-review-docs`/`.ai-review-detail` display:none mobile rule.

## 8. Workstream Split (for `/subagent-driven-development`)

All workstreams serialize on `frontend/admin/js/script.js` (shared tooling state → no parallelism benefit per the subagent-driven-development skill's "When to Serialize" rule). Expected order of execution:

**C — Pane 3 DOM split + CSS scaffolding**
- `index.html`: wrap iframe in `.ai-preview-frame`, add sibling `.ai-actions-panel#aiActionsPanel`; bump cache `?v=`.
- `style.css`: pane 3 vertical flex split; all `.ai-doc-row`, `.ai-ap-*`, stripe modifier classes, sticky strip, collapsed section headers, lozenge styles, empty state, transient sub-panel styles. Mobile media: hide `.ai-preview-frame` + `.ai-actions-panel` + keep existing mobile accordion rules intact.

**A — Pane 2 thin rows + `selectDocument` wiring**
- New: `truncateMiddle`, `getRowStripeClass` (handles on_hold), `getRowCategoryText` (handles on_hold swap), `renderDocRow`, `buildClientThinStrip`, `buildDesktopClientDocsHtml`, `selectDocument`.
- Modify `selectClient` desktop path → use new builder; auto-select first pending (or on_hold) doc.
- Modify `renderAICards` desktop branch → use `buildDesktopClientDocsHtml`.
- DL-278 scroll-into-view target: swap `.ai-review-card` for `.ai-doc-row.active`.
- Mobile path untouched.

**B — Actions panel renderer + post-mutation refresh**
- New: `findItemActionsEl`, `refreshItemDom`, `renderActionsPanel` (single entry point) with branches: `_renderPanelHeader`, `_renderPanelFullOrFuzzy`, `_renderPanelIssuerMismatch`, `_renderPanelUnmatched`, `_renderPanelOnHold`, `_renderPanelReviewed`, `_renderPanelAdditive` (pending-question block + split + contract period + overflow).
- Transient `_aiReReviewing` Set; re-review mode path through the F/Z/I/U renderers.
- Audit 14 callers of `.ai-review-card[data-id]` → replace with `findItemActionsEl` (query-scope) or `refreshItemDom` (swap).
- Preserve mobile path at every branch via `isAIReviewMobileLayout()` guard.

**D — DL-053 silent-refresh merge-by-id + cache bumps + housekeeping**
- Polling merge-by-id: `aiClassificationsData` merged via `Map` + `Object.assign` to preserve refs.
- `resetPreviewPanel` only when no `activePreviewItemId` survives.
- `selectClient` + `renderAICards` desktop branch re-apply `.ai-doc-row.active` + re-render panel when active item survives.
- Cache-bust: CSS `?v=` and JS `?v=` bumps (will check current values post-revert; likely 294→296 and 298→300 to avoid collision with DL-333's `?v=298`).
- Update `.agent/design-logs/INDEX.md` (add entry, bump counts).
- Update `.agent/current-status.md` (Section 7 TODOs).
- Commit + push. **No merge to main** — pause for explicit approval.

## 9. Section 7 — Validation Plan

### Pane 2 thin rows
- [ ] Row height 28–30px, single line, no wrap.
- [ ] Filename middle-truncated; extension always visible.
- [ ] Stripe color table matches spec across all 8 states (full, fuzzy, issuer-mismatch, unmatched, on_hold, approved, rejected, reassigned).
- [ ] Category text muted (`--gray-500`), end-aligned.
- [ ] Selected row: `--brand-50` fill + filename weight 500.
- [ ] Hover (non-selected): `--gray-50` fill.
- [ ] Click anywhere → `selectDocument(id)` fires; no full-list re-render.

### on_hold row
- [ ] Row stripe amber (`--warning-500`).
- [ ] Category swaps to `⏳ ממתין ללקוח` in `--warning-600`.
- [ ] `?` glyph NOT shown on on_hold rows (even if `pending_question` set).
- [ ] Trailing dot still renders for duplicate/unrequested/pre_questionnaire flags.

### Pane 2 top + sections
- [ ] Top strip: `X/Y נבדקו` (start, tabular-nums, 11px, `--gray-500`) + folder-open icon (end, 14px, `--brand-500`). No other content.
- [ ] Client notes section header: default collapsed; click toggles; arrow rotates; renders only if `N > 0`.
- [ ] Missing-docs section header: default collapsed; click toggles; arrow rotates; label logic correct.
- [ ] Separator between last section and doc list: 0.5px `--gray-100` + 2px margin.

### Pane 3 cockpit layout
- [ ] Preview `flex: 1.3`, min-height 240px.
- [ ] Actions panel `flex: 1`, min-height 260px, `overflow-y: auto`.
- [ ] Both share card shell (0.5px border, radius-md, padding 8–10px).
- [ ] Actions panel border-inline-start 3px color matches row stripe table.

### Panel header (every state)
- [ ] Line 1: `[lozenge?] [filename 13px weight-500] [filing chip 11px] [flag chips]`.
- [ ] Line 2: `sender · DD.MM.YYYY` 11px `--gray-500`; omit entirely when both missing.
- [ ] Filename renders ONCE (panel header only — never in body).

### Body variants
- [ ] State A/C: single line, template name weight 500, `(87%)` in `--gray-500`.
- [ ] State B: issuer line + radios; hover/selected styles correct.
- [ ] State B fallback: shows `⚠️ כל מסמכי X כבר התקבלו` + combobox (State D layout).
- [ ] State D: reasoning block `--gray-50` bg, full `friendlyAIReason`, combobox + `ai-inline-ft-toggle` preserved.
- [ ] on_hold: `💬 שאלה נשלחה ללקוח:` label + warning-50 question block (full text) + secondary `🤖 AI זיהה כ:` line + single `סיים את ההמתנה` button.
- [ ] Reviewed: `תואם ל:` line + resolved template name; rejected shows notes block.

### Primary actions
- [ ] State A/C: `✓ נכון` (success-100 bg) `flex:1` + `שייך מחדש` ghost `flex:1` + `✕ מסמך לא רלוונטי` below.
- [ ] `is_unrequested && matched_template_id`: approve label expands to `✓ נכון - הוסף מסמך זה לרשימת המסמכים הדרושים` → `approveAIClassificationAddRequired`.
- [ ] `is_unrequested` no template: approve `aria-disabled="true"` with tooltip.
- [ ] State B (radios): `אישור ושיוך` (disabled until radio) + `✕` 40px; below ghost `לא מצאתי ברשימה`.
- [ ] State D: `שייך` disabled until combobox selection + `✕` 40px.
- [ ] on_hold: single `סיים את ההמתנה` full-width (warning styling); NO approve/reject/reassign visible.
- [ ] Reviewed: `🔄 שנה החלטה` full-width; approved also gets `📋 הקובץ תואם למסמך נוסף` below.

### Secondary actions
- [ ] Separator 0.5px `--gray-200` + 4px padding.
- [ ] Split PDF button only when `page_count >= 2`; opens `openSplitModal`.
- [ ] T901/T902 full-year: `📅 חוזה שנתי מלא ✓` success-50 badge.
- [ ] T901/T902 partial: editable date spans + request-missing-period buttons; `editContractDate` + `requestMissingPeriod` handlers work.
- [ ] Overflow `⋮` 26×26; dropdown aligned end-below.
- [ ] Overflow items: pending = הוסף/ערוך שאלה; reviewed = שנה החלטה + (approved) הקובץ תואם + הוסף/ערוך שאלה; on_hold = הוסף/ערוך שאלה only.
- [ ] Pending-question secondary block (non-on_hold): info-50 bg, 11px info-700, full text not truncated.

### Empty state
- [ ] `◉` glyph 24px `--gray-300` + `בחר מסמך לבדיקה` 12px `--gray-500`; centered.
- [ ] Border-inline-start on panel = `--gray-300`.

### Transitions
- [ ] Approve/reject/reassign: stripe flips, panel switches variant, pane 2 scrollTop preserved, no full list re-render.
- [ ] Split PDF flow (DL-252) works end-to-end.
- [ ] Re-review from reviewed → flips to pending variant + `ביטול`.
- [ ] Re-review cancel → restores reviewed variant.
- [ ] on_hold → `סיים את ההמתנה` → pending variant A/B/C/D per `getCardState`.
- [ ] After on_hold re-review decision: stripe flips to approved/rejected color, row swaps, panel re-renders.

### on_hold integration with DL-NNN
- [ ] `סיים בדיקה ושליחת שאלות` on a client with mixed docs (some with questions, some without): docs without questions disappear from pane 2; docs with questions flip to on_hold in place without full list re-render.
- [ ] If currently-selected doc was dismissed (no question): actions panel clears to empty state.
- [ ] Silent refresh mid-review on an on_hold doc: state preserved.
- [ ] Poll tick flips an on_hold doc to another state (another tab resolved): panel re-renders correctly; `activePreviewItemId` stays valid.

### Preservations
- [ ] DL-053 silent-refresh: mid-review `loadAIClassifications(true)` → preview + row + panel stay intact.
- [ ] DL-278 scroll-into-view: targets `.ai-doc-row.active`.
- [ ] DL-306 `?client=CPA-XXX` deep-link: auto-selects client AND auto-opens first pending doc.
- [ ] DL-314 multi-match modal: launches from the panel's `הקובץ תואם למסמך נוסף` (approved only).
- [ ] DL-320 cascade-revert: `shared_ref_count > 1` confirm dialog on `שנה החלטה`.
- [ ] Mobile <768px: resize → accordion fat cards return; cockpit hidden; no JS errors.
- [ ] on_hold on mobile: `renderReviewedCard` handles it (from DL-NNN-on-hold); DL-334 does not regress mobile.
- [ ] Scroll position in pane 2 preserved across row swap.

### Housekeeping
- [ ] Hard-reload loads new cache-bust values; no stale CSS/JS.
- [ ] No console errors on tab load / client switch / row click / poll tick / re-review / dismiss.
- [ ] INDEX.md updated, current-status.md updated.
- [ ] No regression on DL-075 / DL-086 / DL-199 / DL-237 / DL-252 / DL-269-271 / DL-306 / DL-314 / DL-320 / DL-330 / DL-332 / DL-NNN-on-hold.

## 10. Ordering With DL-NNN-on-hold

1. DL-NNN-on-hold lands first (fat-card UI updated for on_hold). Its changes to `renderReviewedCard` remain untouched by DL-334.
2. DL-334 starts on a main that already has on_hold live. When Wave A/B land, on_hold is rendered in the cockpit everywhere it matters from the first implementation commit.
3. DL-334 does NOT ship without on_hold support. Every state branch in the new code names `on_hold` explicitly.

## 11. Risks

- **Token availability.** Spec names `--success-100`, `--success-700`, `--warning-50/100/600/700/800`, `--info-50/100/500/700`, `--danger-300/700`, `--brand-50/500/700`. Verify all exist in `design-system.css` before Wave C; if any are missing, stop and surface to user. Do not invent.
- **on_hold branch coverage.** Easy to miss one (stripe / category / lozenge / body / actions / overflow / panel border / row ? glyph suppression). Workstream A + B each enumerate the on_hold branch explicitly in a checklist before marking done.
- **14 `.ai-review-card[data-id]` callers.** Missed one = broken handler on desktop. Each caller gets a one-line audit comment: mobile-or-desktop-targetable.
- **Short viewport < 700px tall.** Panel overflows into its own scroll. Acceptable per spec; verify in Section 7.
- **Cache-bust conflict.** DL-333 is at `?v=298`; DL-334's final bump must exceed that.

## 12. Implementation Notes (Post-Code)
*(To be filled during/after implementation.)*
