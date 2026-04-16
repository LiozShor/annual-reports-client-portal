# Design Log 176: View Documents — Badge Positioning & Help Link Fixes
**Status:** [COMPLETED]
**Date:** 2026-03-24
**Related Logs:** DL-117 (help icons), DL-157 (insurance company links in help text)

## 1. Context & Problem
Two visual bugs on the `view-documents` page:

**Bug A — Badge positioning inconsistency:** The "התקבל/נדרש" status badge is sometimes pinned to the far-left (correct in RTL) but sometimes appears vertically misaligned for documents with long multi-line titles. This is because `.doc-row` uses `align-items: center`, causing badges to vertically center against multi-line text.

**Bug B — Raw `<a href="">` showing as text:** For deposit/insurance documents (T501), the help text shows literal `<a href="">` HTML instead of a clickable link. Root cause chain:
1. `resolveHelpText()` in `doc-builder.ts` extracts company name from the FIRST `<b>` tag in the doc title
2. T501 titles have multiple `<b>` tags: `<b>2025</b>`, `<b>מקוצר</b>`, `<b>ביטוח חיים</b>`, `<b>"הראל"</b>`
3. First match = `2025` (the year), NOT the company name
4. `companyLinks.get("2025")` = undefined → `{company_url}` replaced with `""` → creates `<a href="">`
5. Frontend `sanitizeHelpHtml` regex only un-escapes `<a>` tags with `https://` hrefs → `<a href="">` stays as literal text

## 2. User Requirements
1. **Q:** Badge positioning preference?
   **A:** Always pinned to far-left edge (in RTL), regardless of title length.

2. **Q:** Broken help link — is it a source data or code issue?
   **A:** Code issue. Airtable company links table is correct with proper URLs.

3. **Q:** Should sanitizer allow non-https URLs?
   **A:** No, only `https://` — security-first.

## 3. Research
### Domain
CSS Flexbox RTL, HTML sanitization

### Sources Consulted
Skipped — both are straightforward bug fixes with clear root causes. Prior research in DL-117 and DL-157 covers the domain.

## 4. Codebase Analysis

**Bug A — Badge CSS:**
- File: `github/.../assets/css/view-documents.css:155-182`
- `.doc-row` has `display: flex; align-items: center;` — centers badge vertically against multi-line text
- Fix: `align-items: flex-start` to pin all items to top, with padding-top on badge for visual alignment

**Bug B — Company name extraction:**
- File: `api/src/lib/doc-builder.ts:196-223` — `resolveHelpText()`
- Line 208: `docTitle.match(/<b>(.*?)<\/b>/i)` — gets FIRST bold match (year `2025`)
- Should try ALL bold matches against the company links map
- Line 219: fallback replaces `{company_url}` with `""` → should strip entire `<a>` tag

**Bug B — Frontend sanitizer:**
- File: `github/.../assets/js/view-documents.js:30-43` — `sanitizeHelpHtml()`
- Line 39 regex: only matches `href="https://..."` — empty hrefs pass through as literal text
- Fallback fix: strip `<a>` tags with empty/non-https hrefs, keep text content

**Frontend duplicate resolution (lines 308-330):**
- The frontend ALSO resolves `{company_name}`/`{company_url}` placeholders
- This is redundant since the Worker already resolves them in `resolveHelpText()`
- After fixing the Worker, the frontend code will never trigger (placeholders already resolved)
- Keep as safety net but it also needs the same fix

## 5. Technical Constraints & Risks
* **Two codebases:** Worker fix (doc-builder.ts) + Frontend fix (view-documents.js/css)
* **KV cache:** company_links are cached for 1h — fix applies on next cache refresh
* **No breaking changes:** Both fixes are backwards-compatible

## 6. Proposed Solution (The Blueprint)

### Fix A: Badge CSS
**File:** `github/.../assets/css/view-documents.css`
- Change `.doc-row` from `align-items: center` to `align-items: flex-start`
- Add `padding-top: 2px` to `.doc-row .badge` and `.help-toggle-btn` for baseline alignment with first line of text

### Fix B1: Worker — Company name extraction
**File:** `api/src/lib/doc-builder.ts` — `resolveHelpText()`
- Extract ALL bold matches, try each against company links map
- If no match from bold texts, fall back to substring search in full title
- When no URL found: strip entire `<a href="{company_url}"...>...</a>` tag instead of replacing URL with ""

### Fix B2: Frontend sanitizer fallback
**File:** `github/.../assets/js/view-documents.js` — `sanitizeHelpHtml()`
- Add fallback: strip `<a>` tags with empty or non-https hrefs, keep inner text content

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/.../assets/css/view-documents.css` | Modify | `align-items: flex-start` + badge padding |
| `api/src/lib/doc-builder.ts` | Modify | Fix company name extraction + fallback |
| `github/.../assets/js/view-documents.js` | Modify | Fix sanitizer for empty hrefs |

### Final Step
- Deploy Worker (`wrangler deploy`)
- Push frontend to GitHub Pages
- Update design log → `[IMPLEMENTED — NEED TESTING]`

## 7. Validation Plan
* [ ] View documents page: all badges pinned to far-left, consistent across short and long titles
* [ ] T501 deposit doc with known company (e.g., הראל): help text shows clickable company link
* [ ] T501 deposit doc with unknown company: help text shows clean text (no raw HTML tags)
* [ ] Other help text (non-T501): still renders correctly with links, bold, etc.
* [ ] No regression in document viewing, status badges, help accordions

## 8. Implementation Notes (Post-Code)
* Root cause for help link was deeper than initial analysis: T401 `issuer_name` has **nested bold tags** (`<b>קרן פנסיה – <b>הראל</b></b>`), breaking regex extraction
* Switched from bold-tag-based extraction to **substring matching against company links map** — more robust, handles any tag nesting
* Prefers longest company name match to avoid partial hits
* Two deploys needed: first fix (bold match iteration) didn't handle nested tags; second fix (substring match) resolved it
* Badge fix: `align-items: flex-start` + `margin-top` on icon/badge/help-btn for baseline alignment
