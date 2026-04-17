# Design Log 295: PA Queue Improvements — Two-Column Preview + Placeholder Fix + Priority + Inline Actions
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-17
**Related Logs:**
- DL-292 (PA queue tab foundation)
- DL-294 (preview panel redesign + bolded issuer rendering)
- DL-227 (inline waive/receive pattern on AI Review — reused here)
- DL-112 (`<b>issuer</b>` HTML convention)

## 1. Context & Problem

Live use of the DL-294 preview surfaced four issues:

1. **Stacked preview wastes horizontal space.** On desktop the preview panel is wide; Q&A and docs stack vertically so reviewer scrolls a lot to compare answers against the doc list.
2. **Unresolved `{placeholder}` tokens in doc chips.** Master card chips show raw template variables (e.g., `אישור תושבות לשנת 2025 – {city_name} –נהרייה`, `דוח שנתי מקוצר {deposit_type} {company_name}`) because the PA endpoint derives chips from the template's raw `short_name_he` field, which may contain unresolved `{...}` variables.
3. **No urgency signal.** All cards look the same. A 10-day-old submission and a 1-day-old one are indistinguishable at a glance.
4. **No inline doc actions.** If reviewer spots a doc that should be waived, they must leave the preview (→ doc-manager) and come back. The AI-Review tab already has a click-to-change-status menu on doc tags (DL-227); PA does not.

## 2. User Requirements

1. **Q:** Layout split behavior across viewports?
   **A:** 50/50 desktop, stacked mobile. Header + stats full-width on top; Q&A left / Docs right on ≥1024px; Notes + Questions full-width below; sticky approve footer.

2. **Q:** How to fix `{placeholder}` tokens in doc chips?
   **A:** Use the resolved doc name from Airtable (same pipeline the preview rows already use — `groupDocsByPerson` → `formatForOfficeMode`) instead of the template's raw `short_name_he`.

3. **Q:** Which additional PA improvements?
   **A:** Priority indicators (age badges) + inline doc actions (waive/fix from preview).

4. **Q:** Scope — one log or split?
   **A:** Single DL-295.

## 3. Research

### Domain
Detail-panel UX for approval/review queues; age-based priority indicators; inline row actions.

### Sources (incremental to DL-294)
DL-294 already covered Stripe/Linear/Gmail detail panels (summary header, stats strip, sticky CTA, grouped docs). Incremental findings:

1. **GitHub PR review + Linear issue detail** — both use a split column (file tree/properties + content/diff) at ≥1024px, stack below. The split uses CSS grid `1fr 1fr` or `auto 1fr`; no JS required. Validated for RTL by Linear's Hebrew locale (works via `direction: rtl` on the container).
2. **Linear / Jira age badges** — color + textual label (`10 days`), not just color. Accessible, scannable. Red > threshold, yellow in between, none below. We apply: red > 7d, yellow 3–7d, none < 3d.
3. **DL-227 inline doc tag menu** — existing in-repo implementation. Click tag → popover with status alternatives → optimistic UI + API. Reuse the exact DOM + CSS (`.ai-doc-tag-menu`), swap only the callback function.

### Key Principles Extracted
- **Use the viewport when you have it.** 50/50 splits shorten scroll distance for comparison tasks. Stack below 1024px where it would cause cramped columns.
- **Single source of truth for display text.** Don't re-derive doc names for chips when the preview pipeline already produces resolved names — flatten one data structure instead.
- **Inline actions beat round-trips** for single-field state changes.

### Anti-Patterns Avoided
- **Client-side placeholder substitution.** Tempting but fragile: missing-variable heuristics create false matches. Fix the source (server uses the already-resolved name).
- **Pure-color priority.** Red dot alone fails a11y. Pair color with `{N} ימים`.
- **Separate inline-action component.** DL-227 already built it; reuse DOM + CSS, vary only the callback.

### Research Verdict
Ship 50/50 split (grid), flatten `doc_chips` from `doc_groups` for chip names, age badge on master cards, reuse DL-227 DOM for inline doc menu with a PA-scoped callback.

## 4. Codebase Analysis

### Existing Solutions Found
- `formatForOfficeMode` (`api/src/lib/doc-builder.ts:438`) — produces per-doc `name` field (resolved, issuer-bolded) and drops internal fields. Used by `/get-client-documents` and now also by DL-294 PA `doc_groups[]`. Flattening this yields a clean chip list with zero new logic.
- `renderDocLabel` (`frontend/admin/js/script.js:7849`) — XSS-safe bold renderer.
- `openDocTagMenu` + `.ai-doc-tag-menu` (`script.js:5308`, CSS shared) — DL-227 inline status menu. Reuse verbatim; only the apply-status callback changes.
- `ENDPOINTS.EDIT_DOCUMENTS` — PATCH endpoint (status_changes array, `send_email: false`) used by DL-227 inline updates.

### Reuse Decision
No new utilities; no new endpoints. Backend change is a data reshape. Frontend change adds one grid wrapper, one age-badge helper, and three PA-scoped functions that mirror DL-227.

### Relevant Files
| File | Role |
|---|---|
| `api/src/routes/admin-pending-approval.ts` | Build `doc_chips[]` by flattening `doc_groups` |
| `frontend/admin/js/script.js` | Card age badge; 2-col preview; `renderPaDocTag` + `openPaDocTagMenu` + `updatePaDocStatusInline` |
| `frontend/admin/css/style.css` | `.pa-preview-cols` grid + responsive breakpoint; `.pa-card__priority` chip |

### Dependencies
- No Airtable schema changes.
- No new endpoints.
- `ENDPOINTS.EDIT_DOCUMENTS` (existing) handles inline status updates.

## 5. Technical Constraints & Risks

- **Payload size:** flattening `doc_groups` → `doc_chips` lightly duplicates text. Negligible (<10 KB per report).
- **Shape change for chips:** `doc_chips[].short_name_he` and `.issuer_name` are dropped in favor of `.name` (resolved HTML) and `.name_short`. Only consumer is `buildPaCard` — handled in lockstep.
- **Optimistic update rollback:** if `EDIT_DOCUMENTS` fails, revert `doc_groups` mutation and re-render both preview + master card chip.
- **Mobile sheet (`loadPaMobilePreview`):** reuses `buildPaPreviewBody`. CSS `@media (max-width: 1023px)` collapses the grid to a single column — no JS change required.
- **XSS:** `d.name` is issuer-bolded HTML (`<b>`). Pass through `renderDocLabel` whitelist, never raw `innerHTML` of any user text.

## 6. Proposed Solution

### Success Criteria
Reviewer opens PA tab → cards show `{N} ימים` priority chip when >3d waiting (red for >7d) → clicks a card → preview shows Q&A and docs side-by-side on desktop → clicks a doc name → popover lets them change status without leaving the preview → chip text contains no raw `{placeholder}` tokens.

### Backend — `api/src/routes/admin-pending-approval.ts`

Replace the current template-derived chip builder with a flattening of `doc_groups`:

```ts
const doc_chips = doc_groups.flatMap((g) =>
  (g.categories as any[]).flatMap((cat) =>
    (cat.docs as any[]).map((d) => ({
      doc_id: d.doc_record_id || d.id || '',
      name: d.name || '',                     // resolved HTML, <b>issuer</b>
      name_short: d.name_short || d.name || '',
      category_emoji: cat.emoji || '📄',
      status: d.status || 'Required_Missing',
    }))
  )
);
```

Remove the old `reportDocRecords.map(d => { ... short_name_he: tmpl?.short_name_he ... })` block.

### Frontend — `buildPaCard` (`script.js:5783`)

- Chip: `renderDocLabel(d.name_short || d.name)` — already-bolded resolved name. Drop the `${short} – ${issuerHtml}` concatenation.
- Age badge: compute `ageDays` from `submitted_at`, inject pill next to `pa-card__date`.

### Frontend — `buildPaPreviewBody` (`script.js:5919`)

Wrap Q&A and Docs sections in a grid:
```html
<div class="pa-preview-cols">
  <div class="pa-preview-col pa-preview-col--qa">{qaHtml}</div>
  <div class="pa-preview-col pa-preview-col--docs">{docsHtml}</div>
</div>
{notesHtml}{questionsHtml}
```

Doc rows in the preview use `renderPaDocTag(d, reportId)` instead of the static `<span class="pa-preview-doc-name">`.

### New functions (mirror DL-227)

- `renderPaDocTag(d, reportId)` — returns clickable tag with `data-report-id`, `data-doc-record-id`, status class, renderDocLabel-rendered name.
- `openPaDocTagMenu(event, el)` — identical menu markup to `openDocTagMenu`, but `selectPaDocTagStatus` callback.
- `updatePaDocStatusInline(reportId, docRecordId, newStatus)` — mutate `pendingApprovalData` entry's `doc_groups`, re-render preview body + master card chips, POST to `EDIT_DOCUMENTS` with `send_email: false`, rollback + toast on failure.

### CSS — `style.css`

```css
.pa-preview-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
  align-items: start;
}
@media (max-width: 1023px) {
  .pa-preview-cols { grid-template-columns: 1fr; }
}
.pa-card__priority {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
}
.pa-card__priority--med  { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
.pa-card__priority--high { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/admin-pending-approval.ts` | Modify | Flatten `doc_chips[]` from `doc_groups`; drop template-derived `short_name_he` |
| `frontend/admin/js/script.js` | Modify | `buildPaCard` age badge + resolved chip names; `buildPaPreviewBody` 2-col grid; add `renderPaDocTag` + `openPaDocTagMenu` + `updatePaDocStatusInline` |
| `frontend/admin/css/style.css` | Modify | `.pa-preview-cols` grid + responsive; `.pa-card__priority` |
| `.agent/design-logs/admin-ui/295-pa-queue-improvements.md` | **Create** | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-295 row |
| `.agent/current-status.md` | Modify | Session summary + Section 7 tests |

### Final Step
Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`; unchecked Section 7 → `current-status.md`.

## 7. Validation Plan

- [ ] Master card chips contain no raw `{xxx}` tokens for any test report
- [ ] Chip renders bolded issuer (no literal `<b>` text visible)
- [ ] Desktop (≥1024px): Q&A left, Docs right; Notes + Questions full-width below
- [ ] Tablet/mobile (<1024px): sections stack vertically
- [ ] Age badge: red + `N ימים` for >7d, yellow for 3–7d, hidden for <3d
- [ ] Click doc in preview → status menu anchors at the tag
- [ ] Select "לא נדרש" → toast confirms, doc row re-renders waived, chip on master card updates, Airtable PATCHed
- [ ] Select other statuses (Received, Requires_Fix, Required_Missing) → same flow, no email sent
- [ ] Network failure → optimistic rollback + error toast
- [ ] DL-294 sticky footer still sticks; stats strip counts correct
- [ ] AI-Review tab doc-tag menu unchanged (no regression)
- [ ] XSS: `<script>` in test issuer escapes (whitelist)
- [ ] Mobile sheet (`loadPaMobilePreview`) renders with stacked layout

## 8. Implementation Notes (Post-Code)

**Backend (`admin-pending-approval.ts`):** Chip source swapped from template-map-derived `short_name_he` to a flattened `doc_groups[].categories[].docs[]` with only `name`, `doc_id`, `category_emoji`, `status`. Dropped `template_id`, `short_name_he`, `issuer_name` fields from chips — no other consumer existed. `templateMap` still passed to `groupDocsByPerson` (unchanged).

**Frontend — `buildPaCard`:** chip renders `renderDocLabel(d.name)` directly (resolved + bolded in one field). Priority age badge injected into `pa-card__meta` next to the relative-date span. Fallback kept: `d.name || d.short_name_he` so any pre-cache-refresh response still renders.

**Frontend — `buildPaPreviewBody`:** wrapped Q&A and Docs into `.pa-preview-cols` grid; Notes/Questions remain full-width below. Doc rows route through new `renderPaDocTagRow`.

**Frontend — inline doc menu:** four functions added after `updateDocStatusInline` block (around `script.js:5470`): `renderPaDocTagRow`, `openPaDocTagMenu`, `selectPaDocTagStatus`, `applyPaDocStatusChange`, `updatePaDocStatusInline`. Reuses DL-227's `.ai-doc-tag-menu` DOM + CSS and `closeDocTagMenu` teardown. Re-renders both preview body AND master card on status change so chip counts stay in sync. Four status options (Missing/Received/Requires_Fix/Waived) vs. DL-227's three (adds Requires_Fix).

**CSS (`style.css`):** `.pa-preview-cols` grid + `@media (max-width: 1023px)` stack fallback; `.pa-card__priority--med` / `--high` pills; `.pa-doc-tag-clickable` hover + active states.

**Deviations:** plan referenced `name_short` from doc-builder — that field doesn't exist (only templates have `short_name_he`, which is the bug we're fixing). Dropped `name_short` from the payload; chips use `d.name` exclusively.

**Research principles applied:**
- DL-294: detail-panel anchor summary + sticky CTA (preserved unchanged).
- DL-227 inline-action pattern: reused DOM + CSS, new callback scoped to `pendingApprovalData`.
- GitHub/Linear split columns: grid `1fr 1fr` at ≥1024px, single column below.
- Linear/Jira age chips: color + textual days.
