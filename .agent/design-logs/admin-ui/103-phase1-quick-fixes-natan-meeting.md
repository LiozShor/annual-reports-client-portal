# Design Log 103: Phase 1 Quick Fixes — Natan Meeting Action Items
**Status:** [DRAFT]
**Date:** 2026-03-05
**Related Logs:** DL-033 (Review Queue tab), DL-066 (Reminder Counter Reset), DL-102 (7-Stage Pipeline)

## 1. Context & Problem
Four quick fixes from the meeting with Natan (see `docs/meeting-with-natan-action-items.md`, Group 1). These are low-risk, single-surface changes that can ship immediately.

| # | Item | Issue |
|---|------|-------|
| 1.1 | Tab rename | "מוכנים לבדיקה" (Ready for Review) misleads — actual next step is report preparation, not QA review |
| 1.2 | GENERAL_DOC display | Client portal shows empty/undefined for custom docs instead of actual name |
| 1.3 | Form 867 subtitle | Clients don't recognize "טופס 867" — need alias "(אישור ניכוי מס)" |
| 1.4 | Reset last_sent on 2→3 | Already implemented in DL-066 — user wants a test reminder |

## 2. User Requirements
1. **Q:** Should 867 subtitle appear everywhere or just client-facing?
   **A:** Everywhere (SSOT title) — add to the template itself.
2. **Q:** Item 1.4 — verify or skip?
   **A:** Add test reminder to current-status.md. Don't implement (DL-066 already did it).

## 3. Research
### Domain
UX Taxonomy & Naming Conventions

### Sources Consulted
1. **NNGroup — Taxonomy 101** — Synonyms and alternative labels help users recognize content they know by a different name. Adding "(אישור ניכוי מס)" is exactly this pattern.
2. **UX Planet — Naming Conventions** — Names should be descriptive and unambiguous. "Ready for Preparation" is more accurate than "Ready for Review" for the actual workflow step.
3. **DL-066 (prior research)** — Reminder field resets on stage transitions already designed and implemented.

### Research Verdict
All items are straightforward UX naming/display fixes. No architectural decisions needed.

## 4. Codebase Analysis

### 1.1 — Tab Rename
**4 locations in HTML, 1 in JS:**
- `admin/index.html:67` — tab button label
- `admin/index.html:435` — tab content header
- `admin/index.html:449` — empty state message (implicit — "אין לקוחות מוכנים לבדיקה כרגע")
- `admin/js/script.js:1255` — empty state in renderReviewTable()
- `admin/js/script.js:1384` — Excel export sheet name
- No n8n workflow references to this text.

### 1.2 — GENERAL_DOC Display
**Root cause:** `view-documents.js:251` — `const docName = isHe ? doc.name_he : (doc.name_en || doc.name_he)` — no `issuer_name` fallback.
- GENERAL_DOC documents have `issuer_name` but NOT `name_he`/`name_en`
- n8n display library (`document-display-n8n.js:10`) already has correct fallback: `doc.issuer_name || doc.description || 'מסמך'`
- Admin popover (`script.js:740`) uses `doc.title || doc.name || 'מסמך'` — also missing `issuer_name` but different field names (API returns different structure for admin)

### 1.3 — Form 867 Subtitle
**Title generation flow:**
- SSOT template (T601): `טופס 867 לשנת **{{year}}** – **{{institution_name}}**`
- `questionnaire-mapping.json:41` — base name: `"טופס 867"` / `"Form 867"`
- `workflow-processor-n8n.js:438-466` — `formatDocumentName()` tries SSOT module, falls back to legacy DOCUMENT_TYPES
- The actual running code is in n8n Document Service workflow (`hf7DRQ9fLmQqHv3u`)
- Admin shorthand label: `script.js` TEMPLATE_LABELS has `T601:'טופס 867'`

**What needs to change:**
- SSOT document (source of truth documentation)
- questionnaire-mapping.json (base name used by legacy mode)
- n8n Document Service Code node (actual running title template)
- TEMPLATE_LABELS in admin script.js (shorthand display)

### 1.4 — Already Implemented
DL-066 implemented reminder field resets (count, next_date, last_sent, suppress) on 2→3 transitions. Just need a test reminder.

## 5. Technical Constraints & Risks
* **SSOT Compliance:** 867 subtitle is static text (not dynamic), so no bold needed per SSOT rules.
* **Title length:** Adding subtitle makes titles longer. Current: `טופס 867 לשנת 2025 – בנק לאומי`. New: `טופס 867 (אישור ניכוי מס) לשנת 2025 – בנק לאומי`. Acceptable length.
* **Two codebases:** 1.3 requires updating BOTH GitHub repo AND n8n Code node.
* **No breaking changes:** All items are additive text changes or fallback additions.

## 6. Proposed Solution (The Blueprint)

### 1.1 — Tab Rename
Replace "מוכנים לבדיקה" → "מוכנים להכנה" and "Ready for Review" → "Ready for Preparation" in all 5 locations.
Also update empty state: "אין לקוחות מוכנים לבדיקה כרגע" → "אין לקוחות מוכנים להכנה כרגע"

### 1.2 — GENERAL_DOC Fix
Add `issuer_name` fallback in `view-documents.js:251`:
```javascript
const docName = isHe
  ? (doc.name_he || doc.issuer_name || 'מסמך')
  : (doc.name_en || doc.issuer_name || doc.name_he || 'Document');
```

### 1.3 — Form 867 Subtitle
**Hebrew:** Add `(אישור ניכוי מס)` after "טופס 867"
**English:** Add `(Tax Deduction Certificate)` after "Form 867"

Update in:
1. `SSOT_required_documents_from_Tally_input.md` — template T601 documentation
2. `questionnaire-mapping.json` — base name
3. n8n Document Service Code node — title template (via MCP)
4. `admin/js/script.js` — TEMPLATE_LABELS shorthand

### 1.4 — Test Reminder Only
Add test checklist to `current-status.md`.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/index.html` | Modify | Rename tab label + header + empty state (3 spots) |
| `admin/js/script.js` | Modify | Rename empty state + Excel sheet name + TEMPLATE_LABELS |
| `assets/js/view-documents.js` | Modify | Add issuer_name fallback (line 251) |
| `questionnaire-mapping.json` | Modify | Update form_867 base name |
| `SSOT_required_documents_from_Tally_input.md` | Modify | Update T601 template |
| n8n Document Service (MCP) | Modify | Update 867 title template in Code node |
| `.agent/current-status.md` | Modify | Add 1.4 test reminder |

## 7. Validation Plan
* [ ] Admin panel: "מוכנים להכנה" tab label, header, empty state all show new text
* [ ] Admin panel: Excel export sheet named "מוכנים להכנה"
* [ ] Client portal: GENERAL_DOC shows actual document name, not empty/undefined
* [ ] Form 867 titles show "(אישור ניכוי מס)" in document lists
* [ ] Form 867 English titles show "(Tax Deduction Certificate)"
* [ ] Test DL-066: verify reminder fields reset on stage 2→3 transition

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
