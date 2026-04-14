# Design Log 071: Bilingual Document Lists Across All Email Types
**Status:** [COMPLETED]
**Date:** 2026-03-01
**Related Logs:** 030-bilingual-client-email.md, 060-reminder-ssot-doc-display.md, 068-document-list-visual-hierarchy.md

## 1. Context & Problem

When an English-speaking client (`source_language='en'`) receives emails, the document lists should show English document names in the EN section and Hebrew names in the HE section. Currently:

- **WF[06] Type B (missing docs reminder):** Uses `doc_list_html` (always Hebrew) in the EN section. The HE section of the bilingual email has NO doc list at all.
- **Batch Status email:** Entirely Hebrew — no bilingual support despite session 55 claiming to have added it (changes appear lost/not deployed).
- **WF[06] Type A (questionnaire reminder):** Already fully bilingual. No doc list needed. **No changes required.**
- **Document Service:** `doc_list_html` output is always Hebrew. No EN version exists.

**Root cause:** Document Service generates EN doc sections internally for `client_email_html` (WF[03]) but never exposes them as a separate output field.

## 2. User Requirements

1. **Q:** Should HE section of bilingual Type B email also get a doc list?
   **A:** Yes — both sections get doc lists (EN names in EN section, HE names in HE section).

2. **Q:** Scope — just Type B or all email types?
   **A:** All three: Type B, Type A (already done), Batch Status.

3. **Q:** Should `doc_list_html_en` always be generated?
   **A:** Yes — always generate regardless of language input.

4. **Q:** Doc list format for reminders?
   **A:** Split mode — "Missing (N)" and "Received (N)" sections for action-oriented display.

## 3. Research

### Domain
Bilingual transactional email rendering, RTL/LTR mixed-direction document lists.
Prior research: DL-030 (bilingual email structure), DL-060 (SSOT doc display), DL-068 (visual hierarchy).

### Sources Consulted (Incremental)
1. **Remarkety — RTL Subject Lines** — Keep languages in separate `dir`-wrapped sections, never inline mixed.
2. **ContactMonkey — Multilingual Internal Emails** — Clear language selector/separator between sections is standard UX.
3. **Campaign Monitor — Email Localization** — Width should adapt to content; Hebrew often expands beyond English. Status indicators (☐/☑) are language-agnostic.

### Key Principles Extracted
- **Separate sections, not mixed**: Each language gets its own `dir`-wrapped section. Already implemented by our bilingual pattern.
- **Status indicators are universal**: ☐/☑ checkboxes and strikethrough work in both languages — show in both sections.
- **Category headers need translation**: Not just doc names — category headers (e.g., "💼 עבודה ושכר" vs "💼 Employment & Salary") need EN versions too. Document Service already handles this via `cat.name_en`.

### Research Verdict
Extend the existing Document Service to expose `doc_list_html_en` as a separate output. Each email node uses the appropriate version per language section. No architectural changes needed — just plumbing.

## 4. Codebase Analysis

### Document Service "Generate HTML" (hf7DRQ9fLmQqHv3u, node: generate-html)
- **Line 342:** `officeDocSection = buildDocSection(clientDocs, spouseDocs, 'he', isMarried, clientName, spouseName, hasStatusVariation)`
- **Line 379:** `enDocs = buildDocSection(..., 'en', ...)` — already built for `client_email_html` but NOT exposed
- **Line 437:** `docListHtml = officeDocSection` — always Hebrew
- **Return (line 439-448):** Missing `doc_list_html_en` field
- `buildDocSection()` at line 317 already accepts `lang` param and uses `cat.name_en`/`doc.issuer_name_en`
- `generateDocListHtmlSplit()` at line 291 splits by Missing/Received status — already works with any lang

### WF[06] "Build Type B Email" (FjisCdmWc4ef0qSV, node: build_type_b_email)
- **Line:** `const docListHtml = svc.doc_list_html || '';` — always Hebrew
- EN branch: inserts `docListHtml` once after EN progress bar — shows Hebrew doc names in English section
- EN branch: HE section has NO doc list (only greeting + progress + instructions)
- HE branch: correctly uses `docListHtml` (Hebrew-only email)

### Batch Status "Build Email" (QREwCScDZvhF9njF, node: code-build-email)
- Currently Hebrew-only — no `source_language` check
- Builds rejected/approved doc sections inline from `params.items`
- `REASONS` map is Hebrew-only
- Uses `item.docName` (Hebrew display name from admin frontend)
- Does NOT call Document Service — builds HTML from batch data directly
- `report` object (from "Get Report" node) has `source_language`

### Frontend Batch Status POST (script.js)
- Items sent as: `{docName, action, rejectionReason, notes}`
- `docName` is the Hebrew display name — no English version passed

## 5. Technical Constraints & Risks

* **Security:** No new data exposure — same doc names already visible to client.
* **Risks:**
  - Document Service change affects ALL consumers (WF[02], WF[03], WF[04], WF[06]) — but only ADDS a field, doesn't modify existing ones.
  - Batch Status `item.docName` is Hebrew-only. Need to pass `docNameEn` from frontend or use same name with translated headers.
* **Breaking Changes:** None — additive only. `doc_list_html_en` is a new field; existing fields unchanged.

## 6. Proposed Solution (The Blueprint)

### Change 1: Document Service "Generate HTML" — Add `doc_list_html_en`

**Node:** "Generate HTML" in `[SUB] Document Service` (hf7DRQ9fLmQqHv3u)

Add after line 342 (`officeDocSection`):
```javascript
const enDocSection = buildDocSection(clientDocs, spouseDocs, 'en', isMarried, clientName, spouseName, hasStatusVariation);
```

Add to return object:
```javascript
doc_list_html_en: enDocSection,
```

This reuses `buildDocSection()` with `lang='en'` — same function already used for `client_email_html`. Category headers use `cat.name_en`, doc titles use `doc.issuer_name_en || doc.issuer_name`.

### Change 2: WF[06] "Build Type B Email" — Use EN/HE doc lists

**Node:** "Build Type B Email" in `[06] Reminder Scheduler` (FjisCdmWc4ef0qSV)

**In the bilingual (EN) branch:**
1. Read EN doc list: `const docListHtmlEn = svc.doc_list_html_en || docListHtml;`
2. Replace `${docListHtml}` in EN section with `${docListHtmlEn}`
3. Add doc list row to HE section (currently missing):
   ```html
   <tr><td style="..." dir="rtl">${docListHtml}</td></tr>
   ```
   (Insert after HE progress bar, before HE instructions)

**Hebrew-only branch:** No changes needed (already uses `docListHtml`).

### Change 3: Batch Status "Build Email" — Full Bilingual Support

**Node:** "Build Email" in `[API] Send Batch Status` (QREwCScDZvhF9njF)

1. Read `source_language`: `const sourceLang = report.source_language || 'he';`
2. Add `REASONS_EN` map:
   ```javascript
   const REASONS_EN = {
     image_quality: 'Poor image quality',
     wrong_document: 'Wrong document',
     incomplete: 'Incomplete / partial document',
     wrong_year: 'Wrong tax year',
     wrong_person: 'Not related to the client',
     other: 'Other'
   };
   ```
3. If `sourceLang === 'en'`: Build bilingual email:
   - EN section (dir="ltr"): EN greeting, EN section headers ("Documents Requiring Correction" / "Approved Documents"), EN rejection reasons, EN instructions
   - Separator: `גרסה בעברית / Hebrew version`
   - HE section (dir="rtl"): Original Hebrew content (unchanged)
   - Bilingual footer: `Moshe Atsits CPA Firm / משרד רו"ח Client Name`
4. EN subject: `Document Status Update — ${clientName}`
5. HE subject (unchanged): `עדכון סטטוס מסמכים — ${clientName}`
6. Doc names: Use `item.docName` in both sections (Hebrew names). The admin panel sends Hebrew names. A follow-up task can add `docNameEn` to the frontend POST.
7. Bilingual CTA: `View Documents / צפייה בתיק המסמכים`

### Change 4: Frontend — Pass `docNameEn` (Optional Enhancement)

**File:** `github/annual-reports-client-portal/admin/js/script.js`

In the batch status POST body assembly, add `docNameEn: doc.issuer_name_en` alongside `docName`. This enables proper English doc names in the Batch Status email.

If the API already returns `issuer_name_en` in the document data, this is a one-line change per item.

### Files to Change

| File / Node | Action | Description |
|-------------|--------|-------------|
| Document Service → "Generate HTML" | Modify | Add `doc_list_html_en` output |
| WF[06] → "Build Type B Email" | Modify | Use EN/HE doc lists, add HE section doc list |
| Batch Status → "Build Email" | Modify | Full bilingual support (wrapper, REASONS_EN, bilingual CTA) |
| Frontend `script.js` | Modify (optional) | Pass `docNameEn` in batch status POST |

## 7. Validation Plan

### Type B — English Client
* [ ] Trigger WF[06] for CPA-XXX (source_language='en', stage 3, missing docs)
* [ ] Verify EN section: English category headers, English doc names (issuer_name_en)
* [ ] Verify EN section: ☐ for missing, ☑ for received (status-aware)
* [ ] Verify HE section: Hebrew category headers, Hebrew doc names
* [ ] Verify HE section: Same ☐/☑ status indicators
* [ ] Verify separator between sections: `גרסה בעברית / Hebrew version`
* [ ] Verify bilingual footer: `Moshe Atsits CPA Firm / משרד רו"ח Client Name`
* [ ] Verify progress bar in both sections (EN: Received X of Y | HE: התקבלו X מתוך Y)

### Type B — Hebrew Client (Regression)
* [ ] Trigger WF[06] for a Hebrew client (source_language='he' or null)
* [ ] Verify Hebrew-only email with Hebrew doc names — no English section
* [ ] Verify footer: `משרד רו"ח Client Name | reports@moshe-atsits.co.il`

### Batch Status — English Client
* [ ] From admin panel, review docs for a client with source_language='en'
* [ ] Click "Send Update to Client"
* [ ] Verify EN subject: `Document Status Update — {name}`
* [ ] Verify EN section: English greeting, EN rejection reason headers, EN approved section
* [ ] Verify separator → HE section with Hebrew content
* [ ] Verify bilingual footer

### Batch Status — Hebrew Client (Regression)
* [ ] Review docs for a Hebrew client
* [ ] Verify Hebrew-only email, Hebrew subject, Hebrew footer

### Document Service Output
* [ ] Verify `doc_list_html_en` is returned for ALL Document Service calls (not just EN clients)
* [ ] Verify `doc_list_html` (Hebrew) is unchanged
* [ ] Verify no regression in WF[02] office email, WF[03] client email, WF[04] edit notification

## 8. Implementation Notes (Post-Code)

**Implementation session:** Session 56 (2026-03-01), continued from session 55b plan.

### Step 1: Document Service — `doc_list_html_en`
- Added `enDocSection = buildDocSection(clientDocs, spouseDocs, 'en', ...)` after line 342
- Added `doc_list_html_en: enDocSection` to return object
- `buildDocSection()` already supported `lang='en'` using `cat.name_en` and `doc.issuer_name_en` from Airtable config
- Deployed to n8n: OK

### Step 2: WF[06] "Build Type B Email"
- Added `docListHtmlEn = svc.doc_list_html_en || docListHtml` (fallback to Hebrew)
- EN section: `${docListHtml}` → `${docListHtmlEn}` for English doc names
- HE section: Added `<tr><td>` with `docListHtml` after progress bar (was missing entirely)
- Hebrew-only branch: unchanged
- Deployed to n8n: OK

### Step 3: Batch Status "Build Email"
- Discovery: Node already had bilingual support (REASONS_EN, isEnglish branch) from session 55 — plan's initial analysis was outdated
- Added `docListHtmlEn` declaration pulling from Document Service `doc_list_html_en`
- EN section: `${docListHtml}` → `${docListHtmlEn}`
- HE section of bilingual email: Added `<tr><td>${docListHtml}</td></tr>` after `heApprovedHtml`, before divider
- HE-only branch: unchanged (already had `${docListHtml}`)
- Deployed to n8n: OK

### Step 4: Validation
- All 3 workflows validated: 0 new errors, 0 invalid connections
- Pre-existing false positives only (Code node return warnings, expression suggestions, outdated typeVersions)

### Deviation from plan
- Step 3 was a targeted edit (3 insertions) rather than a full rewrite, since bilingual support already existed.
- Change 4 (frontend `docNameEn` in POST) deferred — doc names in Batch Status currently show Hebrew in both sections.
