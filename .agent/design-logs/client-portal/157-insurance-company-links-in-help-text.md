# Design Log 157: Insurance Company Links in Help Text
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-16
**Related Logs:** DL-117 (help section implementation)

## 1. Context & Problem
Clients see a "?" help icon next to each document in the view-documents page. For documents tied to insurance/pension companies (T501 deposits, T401 withdrawals, T301/T302 allowances), the help text should include a clickable link to the specific company's website where the client can download their tax certificate. Currently, help text is template-level with no company-specific links.

## 2. User Requirements
1. **Q:** Which document templates should show insurance company links?
   **A:** All documents that originate from these Tally questions: withdrawal companies (T401), allowance institutions (T301/T302), deposit companies (T501), and mortgage bank. Essentially any doc with a company/institution name.

2. **Q:** How should the link appear?
   **A:** Dynamic per-company — each document instance shows a link matching its specific company.

3. **Q:** Where should the company→URL mapping live?
   **A:** Airtable lookup table — easy to update without code changes.

4. **Q:** Link label format?
   **A:** Company name as the clickable link text.

## 3. Research
### Domain
Contextual help UX, inline help links

### Sources Consulted
1. **Nielsen Norman Group — Help & Documentation** — Just-in-time help, pull-over-push pattern. Keep inline help to 1-2 sentences. Link out for deep reference.
2. **Baymard Institute — Inline Help** — Three-tier pattern: inline description → tooltip → external link. External links should name the destination explicitly.
3. **Chrome Lighthouse — External Link Security** — Always `target="_blank" rel="noopener noreferrer"` for external links to prevent reverse tabnapping.

### Key Principles Extracted
- **Name the destination** — link text should be the company name, not "click here" (matches user's choice)
- **Graceful fallback** — if company not in lookup, omit the link entirely rather than showing broken placeholder
- **Security** — all external links must have `rel="noopener noreferrer"` (already enforced by `sanitizeHelpHtml`)

### Research Verdict
Straightforward feature. The existing help text infrastructure (DL-117) supports HTML links. We need to add a placeholder system for company-specific data and a lookup table.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `sanitizeHelpHtml()` in `view-documents.js:30-50` — already allows `<a href>` tags with `target="_blank" rel="noopener noreferrer"`
  - `{year}` placeholder replacement already exists in render loop (`view-documents.js:309`)
  - `doc.issuer_name` available on every document object at render time (from Airtable `documents.issuer_name`)
  - `doc.issuer_name_en` available for English

* **Reuse Decision:** Extend the existing `{year}` placeholder pattern to add `{company_name}` and `{company_url}` placeholders. No new rendering infrastructure needed.

* **Key Challenge:** Help text is per-template (from `documents_templates`), but company is per-document-instance. The template says the same thing for all T501 docs — but each T501 has a different company. Solution: use `doc.issuer_name` at render time to resolve the `{company_url}` placeholder.

* **Relevant Files:**
  - `github/annual-reports-client-portal/assets/js/view-documents.js` — frontend render + sanitizer
  - `github/annual-reports-client-portal/n8n/document-display-n8n.js` — Document Service display lib
  - n8n `[SUB] Document Service` (hf7DRQ9fLmQqHv3u) — API that returns docs to frontend
  - Airtable `documents_templates` — help text source
  - Airtable `documents` — per-instance data with `issuer_name`

## 5. Technical Constraints & Risks
* **Security:** External links must use `target="_blank" rel="noopener noreferrer"` — already enforced by sanitizer.
* **Risks:** Company names from Tally are user-entered free text. "הפניקס" vs "פניקס" vs "Phoenix" must all resolve to the same URL. Need alias matching.
* **Breaking Changes:** None — additive only. Existing help text without `{company_url}` continues to work unchanged.

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. **Create Airtable table `company_links`** with: `name_he`, `name_en`, `aliases` (one per line), `url`
2. **Populate** with 14 insurance companies + URLs
3. **Update n8n Document Service** to fetch `company_links` and include in API response
4. **Update help text templates** in Airtable for T501, T401, T301/T302 to include `{company_name}` and `{company_url}` placeholders
5. **Update `view-documents.js`** to:
   a. Store `currentData.company_links` from API response
   b. In render loop, after `{year}` replacement, also replace `{company_name}` and `{company_url}` using `doc.issuer_name` + lookup
   c. If no URL found → replace `{company_url}` link with just the company name (no link)

### Company→URL Data (14 companies)

| Hebrew Name | Aliases | URL |
|-------------|---------|-----|
| AIG | aig | https://services.aig.co.il/ |
| IDI / ביטוח ישיר | איי די איי, idi, 555 | https://www.555.co.il/ |
| איילון | ayalon | https://www.ayalon-ins.co.il/ |
| אלטשולר שחם | אלטשולר, altshuler | https://online.as-invest.co.il/login |
| הכשרה | hakhshara | https://customers.hcsra.co.il/ |
| הפניקס | פניקס, phoenix, fnx | https://my.fnx.co.il/ |
| הראל | harel | https://www.harel-group.co.il/ |
| כלל | clal | https://www.clalbit.co.il/ |
| ליברה | libra, lbr | https://www.lbr.co.il/PersonalArea/ |
| מגדל | migdal | https://www.migdal.co.il/support/self-service/tax-certificate |
| מנורה מבטחים | מנורה, menora | https://www.menoramivt.co.il/customer-login/ |
| שומרה | shomera | https://myinfo.shomera.co.il/ |
| ילין לפידות | yelin, yl | https://online.yl-invest.co.il/ |

### Alias Matching Algorithm (in frontend JS)
```javascript
function resolveCompanyUrl(issuerName, companyLinks) {
  if (!issuerName || !companyLinks) return null;
  const normalized = issuerName.trim().toLowerCase();
  for (const company of companyLinks) {
    // Check primary name
    if (company.name_he.trim().toLowerCase() === normalized) return company.url;
    if (company.name_en && company.name_en.trim().toLowerCase() === normalized) return company.url;
    // Check aliases
    if (company.aliases) {
      for (const alias of company.aliases) {
        if (alias.trim().toLowerCase() === normalized) return company.url;
      }
    }
  }
  // Fuzzy: check if issuer contains any company name or vice versa
  for (const company of companyLinks) {
    const cn = company.name_he.trim().toLowerCase();
    if (normalized.includes(cn) || cn.includes(normalized)) return company.url;
  }
  return null;
}
```

### Help Text Template Example (Airtable `documents_templates.help_he` for T501)
```
ניתן להוריד את המסמך מהאזור האישי באתר חברת הביטוח.
<br><a href="{company_url}">{company_name} ← לאזור האישי</a>
```

### Part B: Admin Company Correction Dropdown (document-manager)

**Problem:** Clients enter company names as free text in Tally. Misspellings (e.g., "מגדאל" instead of "מגדל") break the link resolution. Admin needs a way to correct the company name.

**Solution:** Add a combobox dropdown to the document-manager's inline name edit for documents that have `issuer_name`.

**Flow:**
1. Admin clicks edit (pencil icon) on a T501/T401 document row
2. Instead of (or alongside) the free-text input, a combobox dropdown appears with all companies from `company_links`
3. Admin can type to filter, or select from the list
4. Selecting a company:
   - Updates `issuer_name` + `issuer_name_en`
   - Regenerates document title by replacing old company name in `name_he`/`name_en` with new one (simple string replace — old `issuer_name` → new `issuer_name` within the existing title)
5. Changes are batched in the existing `nameChanges` Map and submitted via `/edit-documents` POST

**Reuse:**
- Status dropdown positioning pattern (`document-manager.js:511-571`)
- Design system combobox (`.doc-combobox` from `docs/ui-design-system-full.md`)
- Existing `nameChanges` + `saveNameEdit()` submission flow

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| Airtable: new `company_links` table | Create | 14 records with name/aliases/url |
| n8n: `[SUB] Document Service` | Modify | Fetch company_links, include in response |
| `view-documents.js` | Modify | Add company placeholder resolution in render loop |
| `document-manager.js` | Modify | Add company combobox dropdown for issuer_name editing |
| `document-manager.css` | Modify | Combobox styles (reuse design system `.doc-combobox`) |
| Airtable: `documents_templates` | Modify | Update help text for T501, T401, T301/T302 with placeholders |

### Final Step
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Test Case 1: T501 document with known company (e.g., מגדל) → help text shows clickable link to migdal.co.il
* [ ] Test Case 2: T401 withdrawal with company (e.g., הראל) → help text shows clickable link
* [ ] Test Case 3: Document with unknown company → help text shows company name without link (no broken placeholder)
* [ ] Test Case 4: Alias matching — "פניקס" resolves to הפניקס URL
* [ ] Test Case 5: Language toggle → HE shows Hebrew link text, EN shows English
* [ ] Test Case 6: Link opens in new tab with proper rel attributes
* [ ] Test Case 7: Documents without company (e.g., T002 ספח ת״ז) → help text unchanged, no broken placeholders
* [ ] Test Case 8: Admin panel — click edit on T501 doc → company combobox dropdown appears with all companies
* [ ] Test Case 9: Admin panel — type to filter companies in combobox → correct filtering
* [ ] Test Case 10: Admin panel — select company from dropdown → document title updates, issuer_name saved to Airtable

## 8. Implementation Notes (Post-Code)

### What was built
1. **Airtable `company_links` table** (`tblDQJvIaEgBw2L6T`) — 14 records with name_he, name_en, aliases, url
2. **n8n [SUB] Document Service** — Added "Get Company Links" Airtable node (5th input to Wait For All merge), Merge Config extracts into `companyLinks` map (flattens aliases), passes through via `...input` spread
3. **n8n [API] Get Client Documents** — Added "Get Company Links" node, Build Response includes `company_links` in both office and client responses. Added `issuer_name`/`issuer_name_en` to client doc objects.
4. **view-documents.js** — Substring matching: iterates company names and checks if doc title contains the company name. Graceful fallback removes link entirely if no match.
5. **document-manager.js** — `COMPANY_TEMPLATES = ['T501', 'T401', 'T301']`. `startNameEdit` detects these types and calls `startCompanyEdit` which renders `.doc-combobox` with searchable dropdown. Company selection replaces `<b>old_name</b>` with `<b>new_name</b>` in doc title via regex.
6. **document-manager.css** — Combobox styles matching design system pattern.
7. **Airtable help text** — Updated T501, T401, T301 templates with Hebrew and English help text containing `{company_name}` and `{company_url}` placeholders.

### Deviations from plan
- Used **substring matching** instead of exact match for company→URL resolution (doc titles contain embedded company names like "...ב<b>מגדל</b>")
- Company list differs slightly from the design log's table — populated with 14 companies from the user's actual list
- T302 (NII allowances) not updated since it already has NII-specific help text (government institution, not insurance company)
- Did NOT implement the alias matching algorithm from Section 6 — used simpler approach: all aliases flattened into same map server-side, substring matching client-side
