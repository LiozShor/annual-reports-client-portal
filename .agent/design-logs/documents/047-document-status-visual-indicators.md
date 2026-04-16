# Design Log 047: Document Status Visual Indicators Across All Surfaces
**Status:** IMPLEMENTED
**Date:** 2026-02-23
**Related Logs:** 045 (Status Overview Panel), 036 (AI Review Interface), 032 (UI Redesign), 027 (Document Service)

## 1. Context & Problem

Office staff scanning document lists (in emails, admin panel, AI review) couldn't quickly distinguish which docs a client already sent vs. which are still missing. All surfaces rendered documents identically regardless of status. This violated the SSOT uniformity principle — if a doc is marked Received in Airtable, that status should be visually reflected everywhere it appears.

## 2. User Requirements

1. **Q:** Should WF04 office emails split into sections or just decorate inline?
   **A:** Split into "חסרים" (missing) + "התקבלו" (received/strikethrough) sections.

2. **Q:** Should WF03 client emails show status?
   **A:** No change — keep showing only missing docs (clients shouldn't see internal status tracking).

3. **Q:** AI review page — show only missing or all docs?
   **A:** Show ALL docs with status indicators (received = strikethrough + green check).

4. **Q:** Should there be a progress summary in office emails?
   **A:** Yes — add "X מתוך Y התקבלו" line when status variation exists.

5. **Q:** Client notifications about doc receipt?
   **A:** Out of scope for this change.

## 3. Expert Consultation

Advisory board consulted before implementation:
- **Priya (Data):** Confirmed `all_docs` API field approach; backward-compatible additive fields
- **Renzo (Frontend):** Recommended CSS class toggle approach for live status dropdown updates
- **Noa (Content):** Validated visual vocabulary — strikethrough + muted for received, opacity for waived

## 4. Visual Vocabulary (Uniform Across All Surfaces)

| Status | Decoration | Color | Prefix |
|--------|-----------|-------|--------|
| `Required_Missing` | None | Normal | bullet |
| `Received` | `line-through` | Muted gray | green checkmark |
| `Requires_Fix` | None | Normal | badge only |
| `Waived` | `line-through` | Light gray, 0.5 opacity | em dash |

## 5. Implementation

### Surface 1: Client Portal (`view-documents.js` + `.css`)
- Added `doc-received` CSS class to `.doc-row` when `doc.status === 'Received'`
- CSS rule: `.doc-row.doc-received .doc-name { text-decoration: line-through; color: var(--gray-400); }`
- Deploy: Git

### Surface 2: Admin Document Manager (`document-manager.js` + `.css`)
- Added `status-received` class in `displayDocuments()` (skip if already `waived-item`)
- Added `item.classList.toggle('status-received', ...)` in `updateDocStatusVisual()` for live dropdown changes
- CSS rule: `.document-item.status-received .document-name { text-decoration: line-through; color: var(--gray-400); }`
- Deploy: Git

### Surface 3: Legacy Display (`document-display-n8n.js`)
- Added `renderDocLi(name, status)` helper function with inline styles for Received/Waived/default
- Updated both client and spouse doc loops to use `renderDocLi(name, doc.status)`
- Added to module exports
- Deploy: Git

### Surface 4: Email HTML (`code_Generate_HTML.js` in n8n)
- `documentRow(title)` → `documentRow(title, status)` — adds strikethrough + green checkmark for Received, strikethrough + opacity for Waived
- `generateDocListHtml()` now passes `doc.status` to `documentRow()`
- New `progressSummaryRow(docs)` — renders "X מתוך Y מסמכים התקבלו" box
- New `generateDocListHtmlSplit(docs, lang)` — splits into "חסרים (N)" + "התקבלו (N)" sections
- `buildDocSection()` accepts `splitMode` param, uses split renderer when true
- Assembly auto-detects `hasStatusVariation = documents.some(d => d.status && d.status !== 'Required_Missing')` to switch mode
- Client email calls `buildDocSection` without splitMode (undefined → normal rendering)
- Deploy: n8n MCP → workflow `hf7DRQ9fLmQqHv3u`

### Surface 5: AI Review Page (API + Frontend)
**API** (workflow `kdcWwkCQohEvABX0`, "Build Response" node):
- Expanded Airtable doc filter to fetch all statuses (not just Missing/Waived)
- Added `all_docs` array (all non-Waived docs with status) per report
- Added `docs_received_count` and `docs_total_count` per report
- Existing `missing_docs` field unchanged (backward compatible)
- Deploy: n8n MCP

**Frontend** (`admin/js/script.js` + `admin/css/style.css`):
- Uses `all_docs` if available, fallback to `missing_docs`
- Toggle header: "מסמכים נדרשים (X/Y התקבלו)" when status variation exists, else "מסמכים חסרים (N)"
- Received docs rendered with `.ai-doc-tag-received` class (green bg, strikethrough, muted)
- Missing docs keep existing `.ai-missing-doc-tag` class
- Deploy: Git

## 6. Safety & Backward Compatibility

- `undefined`/`null` status defaults to `Required_Missing` styling everywhere
- Strikethrough inherits through `<b>` tags naturally (CSS spec)
- Unicode checkmark (`&#x2713;`) used as HTML entity, not emoji (email-safe)
- All API changes additive (new fields alongside existing)
- WF03 client emails untouched (already filtered to missing docs only)
- WF02 first-submission emails: no status variation → renders normally (no split)

## 7. Files Modified

| File | Surface | Commit |
|------|---------|--------|
| `assets/js/view-documents.js` | 1 | `3d5c8a7` |
| `assets/css/view-documents.css` | 1 | `3d5c8a7` |
| `assets/js/document-manager.js` | 2 | `3d5c8a7` |
| `assets/css/document-manager.css` | 2 | `3d5c8a7` |
| `n8n/document-display-n8n.js` | 3 | `3d5c8a7` |
| n8n `hf7DRQ9fLmQqHv3u` (Generate HTML node) | 4 | n8n MCP |
| n8n `kdcWwkCQohEvABX0` (Build Response node) | 5 | n8n MCP |
| `admin/js/script.js` | 5 | `3d5c8a7` |
| `admin/css/style.css` | 5 | `3d5c8a7` |

## 8. Verification Checklist

- [ ] Client Portal: Load `view-documents.html?report_id=...` for mixed-status client → Received docs show strikethrough
- [ ] Admin Manager: Change status dropdown to Received → Strikethrough appears immediately
- [ ] Email HTML: Run SSOT test workflow `kH9GYY9huFQHQE2R` → All checks pass + received docs show strikethrough
- [ ] AI Review: Open admin AI review tab → Received docs with strikethrough + progress count in header
