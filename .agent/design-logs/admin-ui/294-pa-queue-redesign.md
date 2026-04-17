# Design Log 294: PA Queue Preview Panel Redesign + Bold Issuer Rendering
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-16
**Related Logs:**
- DL-292 (built the PA queue tab; this refines the preview panel)
- DL-112 (webhook dedup + issuer name display — established `<b>issuer</b>` convention)
- DL-110 (`short_name_he` template field introduced)
- DL-291 (mobile UX audit — parent catalog)

## 1. Context & Problem

DL-292 shipped the "סקירה ואישור" queue tab. Three defects surfaced in live use:

1. **Raw `<b>` tags visible as text** — Airtable stores issuer names as `<b>מיטב דש</b>`. The PA preview panel passes them through `escapeHtml()`, so users see literal `<b>אובדן כושר עבודה</b>` strings instead of bolded text. The AI-Review tab handles this correctly via `renderDocLabel()` (escape everything, then un-escape only `<b>/</b>`).
2. **Doc chips are too long + missing names** — The backend returns `short_name_he` as the issuer-cleaned name, but the field is overloaded: it sometimes contains the full template name + issuer (e.g., "אישור שנתי למס הכנסה לשנת 2025 (נקרא גם דוח שנתי מקוצר) על הפקדות ל..."). The template's actual `short_name_he` column ("טופס 106", "ניכוי ביטוח") is ignored.
3. **Preview panel UI looks amateurish** — Flat label/value rows, weak section dividers, no client context header, no sticky approve CTA, no stats overview. Feedback: "total vibe coding."

## 2. User Requirements

1. **Q:** Preview panel hierarchy — what dominates the top?
   **A:** **Client summary + stats strip + approve CTA sticky at bottom.** Large name + filing_type + year + submitted-ago at top. Small stat strip (📝 answers · 📂 docs · 💬 notes · ❓ questions). Approve button always reachable.

2. **Q:** Doc list grouping in the preview?
   **A:** **By person (client/spouse), then by category.** Matches doc-manager.html convention and the office's existing mental model.

3. **Q:** Questionnaire answers scope in the preview?
   **A:** **Non-"No" only, grouped by Yes vs free-text.** No ✗ לא clutter by default; optional toggle to reveal.

4. **Q:** Chip text on master cards?
   **A:** **`short_name_he` + bolded issuer** (e.g., "טופס 106 – **יובל חינוך**"). Keep info density, just render `<b>` properly.

## 3. Research

### Domain
Dense detail-panel UX, safe HTML rendering in RTL Hebrew, scanable approval review surfaces.

### Sources (incremental to DL-292)
1. **Stripe / Linear / Gmail detail panels (visual inspection of mature products)** — all three anchor with an entity-summary header card, use a scannable stats strip or meta row to compress metadata, and sticky the primary action at the bottom of the panel. Linear's issue detail is the closest analogue to our use case.
2. **Existing codebase — `renderDocLabel()` at `frontend/admin/js/script.js:7849`** — prior art. XSS-safe whitelist: `escapeHtml(name).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>')`. Used throughout AI-Review. Reuse verbatim.
3. **DL-112 + `edit-documents.ts:55` `mdBoldToHtml()`** — confirms the `<b>issuer</b>` convention is intentional and consistent. Server converts markdown `**text**` → `<b>text</b>` on write; frontend renders on read.

### Key Principles Extracted
- **Entity anchor at top.** The master card is a summary; the preview must re-establish full client context (name + id + filing + year + waiting time) so the reviewer knows who they're approving without scrolling back.
- **Sticky primary action.** One-at-a-time approval flow benefits from a persistent CTA — no thumb-travel to find it on mobile, no scroll-to-find on desktop.
- **Density ≠ clutter.** Stats strip (4 icons + counts) replaces 4 paragraphs. A single row, scanned in <1 second.
- **Reuse safe-HTML helpers.** Never write ad-hoc `innerHTML` with user data. Use `renderDocLabel` (whitelist) or `escapeHtml` (escape).
- **Group by the user's mental model.** Office files per-person per-category. Match their taxonomy.

### Anti-Patterns Avoided
- **Tabs inside a preview panel.** Adds state + clicks. One-column scroll is simpler when total content < 2 viewports.
- **Rendering `innerHTML` directly from Airtable.** Tempting but enables XSS if any field accepts admin-free-text. `renderDocLabel` constrains to `<b>` only.
- **Showing every questionnaire answer including "No".** Visual noise. Office already filters mentally.

### Research Verdict
Ship the client-summary + stats-strip + sticky-CTA layout with per-person/per-category doc grouping. Return a new backend field `full_name_he` (issuer-bolded) so the frontend can render chips correctly, while keeping `short_name_he` as the clean template name.

## 4. Codebase Analysis

### Existing Solutions Found
- `renderDocLabel()` at `script.js:7849` — XSS-safe HTML-bold renderer. Already used in AI-Review. **Reuse verbatim in PA.**
- `buildTemplateMap()` at `doc-builder.ts:124` — already extracts `short_name_he`. Currently used by `name_en/name_he`, not separately exposed.
- `groupDocsByPerson()` at `doc-builder.ts:265` — full grouping logic with per-person/per-category output. Currently called for `/get-client-documents` office mode. **Can be called here too.**
- `stripHtml()` at `doc-builder.ts:246` — tag-strip helper for text-only contexts.

### Reuse Decision
- Backend: call `groupDocsByPerson()` to assemble the preview's grouped structure. Remove the current flat `docs[]` collapse logic and instead return both `doc_chips[]` (flat, for cards) AND `doc_groups[]` (for preview).
- Frontend: reuse `renderDocLabel()` for all doc names. Reuse `escapeHtml()` for everything else.
- No new utilities needed.

### Relevant Files
| File | Role |
|---|---|
| `api/src/routes/admin-pending-approval.ts` | Return split shape: `doc_chips[]` (short_name_he + bolded issuer) + `doc_groups[]` (per-person per-category) |
| `frontend/admin/js/script.js` | Rewrite `buildPaCard()` to render issuer with `renderDocLabel`; rewrite `buildPaPreviewHtml()` for new layout |
| `frontend/admin/css/style.css` | New preview panel styles: `.pa-preview-header`, `.pa-preview-stats`, `.pa-preview-sticky-footer`, grouped doc tree |

### Dependencies
- Airtable fields: `short_name_he` (templates), `issuer_name` (documents). Both already populated.
- No schema changes.
- No new endpoints.

## 5. Technical Constraints & Risks

- **XSS:** `issuer_name` comes from AI classifier output + office edits. Must pass through `renderDocLabel` whitelist, NOT raw `innerHTML`.
- **Breaking change on frontend:** the `docs[]` shape changes. Only one caller (the PA tab, shipped in DL-292, not yet live-used heavily). Update in lockstep.
- **Backend response size:** adding `doc_groups[]` roughly doubles the payload. For ~20 reports × ~10 docs each = tolerable (~50KB). If it grows, paginate.
- **Prior-year placeholder stays.** Still out of scope — DL-292 deferred.

## 6. Proposed Solution

### Success Criteria
Reviewer opens the PA tab → clicks a card → preview panel shows a clear client header, at-a-glance stats, grouped docs with bolded issuer names (NOT literal `<b>` text), and a sticky approve CTA. Chips on the master card show `short_name – **issuer**` rendered correctly.

### Backend changes (`api/src/routes/admin-pending-approval.ts`)

1. After fetching doc records for a report, call `groupDocsByPerson()` + `formatForOfficeMode()` — same pipeline as `/get-client-documents`.
2. Build **two** outputs per report:
   - `doc_chips[]` — flat, for master card chips. Each chip: `{ template_id, short_name_he, issuer_name, category_emoji, status }` where `short_name_he` is the **template's** short_name (not overloaded), and `issuer_name` is the raw `<b>...</b>` HTML.
   - `doc_groups[]` — from `formatForOfficeMode(groupDocsByPerson(...))`. Per-person, per-category, with full doc entries.
3. Remove the old flat `docs[]` collapse + `cleanDocName()` helper (no longer needed — grouping + `renderDocLabel` on the frontend handles display cleanly).

### Frontend card rendering (`buildPaCard()`)

Chip HTML:
```html
<span class="pa-chip pa-chip--doc">📄 {short_name_he} – {renderDocLabel(issuer_name)}</span>
```

Uses `renderDocLabel` so `<b>issuer</b>` renders as bold. Truncate the whole chip at ~25 chars with `text-overflow: ellipsis`, full text on `title=`.

### Frontend preview rendering (`buildPaPreviewHtml()`)

New structure:
```
┌─ pa-preview-header ───────────────────────┐
│ 👤 {client_name}              {client_id} │
│ {filing_type} · {year} · הוגש לפני X ימים  │
└───────────────────────────────────────────┘
┌─ pa-preview-stats ────────────────────────┐
│ 📝 {N} · 📂 {N} · 💬 {N} · ❓ {N}         │
└───────────────────────────────────────────┘

📝 תשובות שאלון
  ▸ כן (6)                          [collapsed group]
    טופס 106 ✓  ·  דמי ליכה ✓  ·  ביטוח ✓
  ▸ תשובות פתוחות (8)
    פירוט הכנסות נוספות: ברית של הילד
    ...

📂 מסמכים של {client_name}
  💰 הכנסות מעבודה
    ✗  טופס 106 – **יובל חינוך**
    ✗  טופס 106 – **משרד החינוך**
  🏠 נכסים
    ✗  אישור תושבות 2025 – **נהרייה**

📂 מסמכים של {spouse_name}
  ...

💬 הערות
  {notes text}

❓ שאלות ללקוח (N)
  1. {question text}

┌─ pa-preview-sticky-footer ────────────────┐
│ [ 📝 שאל את הלקוח ]    [ ✓ אשר ושלח ]    │
└───────────────────────────────────────────┘
```

- Header: large client name + client_id right-aligned + meta line
- Stats: 4 icon+count chips in one row
- Q&A: two collapsible groups — "כן" (chip grid) + "תשובות פתוחות" (list). Toggle at bottom: "הצג גם תשובות 'לא' (N)".
- Docs: per-person section with `📂 מסמכים של {name}` header, then per-category sub-section with emoji + name, then rows. Issuer rendered via `renderDocLabel`.
- Sticky footer: "שאל את הלקוח" (ghost) + "אשר ושלח" (green primary).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/admin-pending-approval.ts` | Modify | Return `doc_chips[]` + `doc_groups[]` (via `groupDocsByPerson` + `formatForOfficeMode`); drop `cleanDocName` |
| `frontend/admin/js/script.js` | Modify | `buildPaCard` uses `renderDocLabel` for chip issuer; `buildPaPreviewHtml` rewritten per layout above; add toggle for "No" answers |
| `frontend/admin/css/style.css` | Modify | `.pa-preview-header`, `.pa-preview-stats`, `.pa-preview-sticky-footer`, `.pa-preview-person-section`, `.pa-preview-category`, `.pa-yes-chips-grid` |
| `.agent/design-logs/admin-ui/294-pa-queue-redesign.md` | **Create** | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-294 row |
| `.agent/current-status.md` | Modify | Add session summary + Section 7 tests |

### Final Step
Housekeeping: commit + merge + deploy + test handoff per skill protocol.

## 7. Validation Plan

- [ ] Chip on card shows bolded issuer (e.g., "טופס 106 – **יובל חינוך**") not `<b>יובל חינוך</b>`
- [ ] Chip is truncated with `…` at ~25 chars; hover tooltip shows full text
- [ ] Preview header shows client name + client_id + filing_type + year + relative date
- [ ] Stats strip shows correct counts for 📝 answers / 📂 docs / 💬 notes / ❓ questions
- [ ] Q&A "כן" group collapsible; free-text group collapsible; "No" toggle reveals/hides
- [ ] Docs grouped per-person (client, then spouse if any), per-category, with emoji header
- [ ] Issuer name bolded via `renderDocLabel`; no literal `<b>` text visible
- [ ] Spouse-only reports render correctly (no empty client section)
- [ ] Approve button sticks to bottom of preview panel, always visible while scrolling
- [ ] Questions button opens existing modal (unchanged behavior)
- [ ] Empty state (no answers / no docs / no notes) renders without layout glitch
- [ ] Mobile (390px): header stacks; stats strip wraps to 2 rows; sticky footer persists
- [ ] XSS: inject `<script>` into a test issuer_name field — confirm it escapes (whitelist only allows `<b>`)
- [ ] No regression: AI-Review preview panel unchanged; doc-manager approve flow unchanged; DL-092 duplicate-send guard still fires

## 8. Implementation Notes (Post-Code)

*Filled after implementation.*
