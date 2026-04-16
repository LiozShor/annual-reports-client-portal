# Design Log 032: Full UI/UX Redesign + Document Edit Flow Fix

**Status:** [COMPLETED]
**Date:** 2026-02-16
**Related Logs:** 026-display-library-migration-plan, 031-wf04-document-edit-handler-rebuild

## 1. Context & Problem

### UI/UX Redesign
The client portal (6 pages on GitHub Pages) had accumulated visual debt:
- Emoji icons throughout (no icon library)
- Heavy gradient backgrounds and mega-shadows
- 8+ different blues, inconsistent spacing/colors
- No shared design system — each page styled independently
- No typography scale (Heebo font not used consistently)
- Inline styles scattered across HTML files

### Document Edit Flow Bug
Workflow [04] "Airtable - Create Docs" node failed with HTTP 422:
> Field "report_record_id" cannot accept a value because the field is computed

Additionally, documents created via the edit flow were missing critical fields (`document_uid`, `document_key`, `issuer_name_en`) and had wrong field names (`report_record_id` instead of `report`), wrong `type` (hardcoded `general_doc`), and wrong `category` (hardcoded `other`).

## 2. User Requirements

This was a user-requested implementation of an already-approved comprehensive redesign plan. The edit flow bugs were discovered during testing post-deployment.

Key requirements:
- Warm/friendly Notion-inspired design (not cold/corporate)
- Lucide icons replacing all emoji
- Consistent design tokens (colors, spacing, typography, shadows)
- Zero business logic changes
- Bilingual support preserved
- RTL logical properties

## 3. Technical Constraints & Risks

* **Dependencies:** All 6 HTML pages, 4 CSS files, 4 JS files, 1 admin CSS, 2 admin HTML with inline JS
* **Risk:** Changing rendering functions in JS could break document display if class names don't match new CSS
* **Risk:** Lucide icons require `lucide.createIcons()` after every `innerHTML` update — missing calls = invisible icons
* **Constraint:** No changes to n8n workflows, Airtable schema, or API responses (UI-only for redesign)
* **Constraint:** `document_uid` format must match workflow [02] output: `{reportId}_{templateId}_{person}[_{issuerKey}]`

## 4. Solution

### Part A: Design System & UI Redesign

**New file created:** `assets/css/design-system.css`
- Color palette: warm indigo brand (`#6366F1`) + stone/warm grays
- Typography: Heebo (Hebrew) + Inter (English) via Google Fonts
- Spacing: 8px base grid (4–64px scale)
- Shadows: 4-level scale (xs/sm/md/lg), no heavy shadows
- Component classes: `.btn`, `.badge`, `.card`, `.modal-overlay/.modal-panel`, `.skeleton`, `.progress-bar`, `.spinner`, `.switch`, `.chip`, `.table`, `.tabs-nav`, `.collapsible`, `.alert`
- RTL utilities using CSS logical properties
- Accessibility: `:focus-visible` outlines, keyboard handlers

**Pages redesigned (all 6):**

| Page | Key Changes |
|------|------------|
| `index.html` | Skeleton loading, Lucide icons, flag images instead of emoji |
| `view-documents.html` | Progress bar, Lucide category icons, pill badges, clean grouped cards |
| `document-manager.html` | Collapsible instructions, compact stat pills, switch toggle, accessible modal |
| `admin/index.html` | White navbar (no gradient), Lucide replacing Font Awesome, underline tabs |
| `admin/document-types-viewer.html` | Design system tokens in inline styles, Lucide icons, `border-inline-start` |
| `admin/questionnaire-mapping-editor.html` | Category→Lucide icon mapping, accordion with design tokens |

**Emoji → Lucide mapping:** 30+ icons mapped (file-text, mail, briefcase, landmark, house, etc.)

### Part B: Document Edit Flow Fix (Workflow [04])

**Root cause 1:** "Prep Create Items" node output `report_record_id` (lookup/computed field) instead of `report` (linked record field).

**Root cause 2:** Frontend sent only display name strings to backend. No template metadata (template_id, category, person, issuer_key, English name) was transmitted.

**Root cause 3:** "Airtable - Create Docs" used `create` operation (no dedup protection).

**Fixes applied:**

| Layer | Change |
|-------|--------|
| Frontend | `docsToAdd` changed from `Set<string>` to `Map<string, metadata>` |
| Frontend | `buildDocMeta()` captures template_id, category, name_en, person, issuer_key |
| Frontend | Dropdown filters out single-instance templates already active in report |
| Frontend | Payload sends structured `extensions.docs_to_create` with full metadata |
| Backend (Extract & Validate) | Prefers `extensions.docs_to_create` over legacy CHECKBOXES parsing |
| Backend (Prep Create Items) | Generates proper `document_uid`/`document_key` matching wf02 format |
| Backend (Prep Create Items) | Converts `**bold**` markdown → `<b>bold</b>` HTML in names |
| Backend (Prep Create Items) | Uses `report` field (not `report_record_id`) |
| Backend (Prep Create Items) | Includes `issuer_name_en` and `issuer_key` |
| Backend (Airtable node) | Changed from `create` to `upsert` on `document_uid` |

**UID format fix:**
- Before: `reci3tdgn6r42hhtl_T001_client_אישור_תושבות_לשנת___2025_______כרמיאל__`
- After: `reci3tdgn6r42hhtl_t001_client_כרמיאל`

## 5. Files Changed

### New (1)
- `assets/css/design-system.css` — design tokens + component classes

### Modified (16)
- `assets/css/common.css` — slimmed to legacy aliases
- `assets/css/landing.css` — full rewrite
- `assets/css/view-documents.css` — full rewrite
- `assets/css/document-manager.css` — full rewrite
- `admin/css/style.css` — full rewrite
- `index.html` — structure + Lucide
- `view-documents.html` — structure + progress bar
- `document-manager.html` — structure + compact layout
- `admin/index.html` — structure + Lucide (replacing Font Awesome)
- `admin/document-types-viewer.html` — design tokens + Lucide
- `admin/questionnaire-mapping-editor.html` — design tokens + Lucide + category icon mapping
- `assets/js/landing.js` — Lucide helpers + icon rendering
- `assets/js/view-documents.js` — Lucide category icons + progress bar
- `assets/js/document-manager.js` — Map-based docsToAdd + structured metadata + dropdown filtering
- `admin/js/script.js` — Lucide replacing FA + createIcons calls

### Workflow Updated
- `[04] Document Edit Handler` (y7n4qaAUiCS4R96W) — Extract & Validate, Prep Create Items, Airtable node

### Airtable Record Patched
- `recTNnbWz4ngmnSpD` (record 56) — fixed issuer_name bold format + document_uid

## 6. Validation

- [x] All 6 pages load design-system.css
- [x] Zero Font Awesome remnants
- [x] Zero emoji in redesigned files (only in untouched n8n/data files)
- [x] 141 `data-lucide` references across 10 files
- [x] `lucide.createIcons()` called after every dynamic innerHTML update
- [x] `report_record_id` field no longer written to (uses `report` instead)
- [x] Document UIDs match wf02 format
- [x] Bold syntax uses `<b>` HTML tags (not `**` markdown)
- [x] Broken record 56 patched in Airtable

## 7. Commits

1. `4b1c18b` — `feat(view-documents): redesign page with design system tokens and Lucide icons`
2. `11d2fe8` — `feat(ui): full UI/UX redesign with design system, Lucide icons, and warm-professional theme`
3. `5c3d0dc` — `fix(document-manager): send template metadata when adding docs, filter dropdown`
4. `31e4410` — `fix(document-manager): proper document_uid format and issuer_key`
