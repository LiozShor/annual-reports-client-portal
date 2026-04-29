# Design Log 379: Encrypted-PDF Lock Indicator on AI Review Cards

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-29
**Related Logs:** DL-373 (password-protected PDF unlock from preview)

## 1. Context & Problem

DL-373 (shipped 2026-04-29) added an in-app unlock flow for password-protected PDFs, but detection only fires after the user clicks a card and the preview iframe loads. Moshe wants the lock state visible on the AI Review card grid so he can identify encrypted files at a glance — without opening each one.

The signal already exists: when the Anthropic classifier hits an encrypted PDF, it returns HTTP 400 `"The PDF specified is password protected"`, and the inbound processor writes that message verbatim into `pending_classifications.ai_reason`. No new detection path, no schema change.

## 2. User Requirements

1. **Signal:** Match `ai_reason` substring `"password protected"` — no new Airtable field
2. **Surface:** AI Review tab cards only (encrypted PDFs are blocked at classification, never reach Documents tab or client portal)
3. **Visual:** 🔒 lock icon badge + amber tint on the card border
4. **Post-unlock:** Indicator clears naturally — DL-373 unlock decrypts + re-classifies, producing a new row without the error in `ai_reason`

## 3. Research

### Domain
UI status indicators / badge patterns — surfacing latent state (already stored in DB) without user action.

### Key Findings
- `ai_reason` already returned in `/webhook/get-pending-classifications` response (`classifications.ts:441`) — zero API change needed
- Existing badge pattern (`.ai-duplicate-badge`, `.ai-unrequested-badge`, `.ai-pre-questionnaire-badge`) uses conditional span in `renderAICard` template — direct reuse
- Warning palette tokens (`--warning-50/300/800`) already defined in design-system; amber tone is available
- 8 live records confirmed in `pending_classifications` with `ai_reason` containing "password protected" — verified during planning

### Verdict
Frontend-only change. Detect via regex on existing field, render badge + card border modifier using existing CSS token/pattern.

## 4. Codebase Analysis

| Item | Location |
|------|----------|
| `renderAICard(item)` — card template | `frontend/admin/js/script.js:5828–6116` |
| `cardClass` assignment | `script.js:5842` |
| Badge insertion point (after existing badges) | `script.js:6091` |
| Existing badge CSS pattern | `frontend/admin/css/style.css:1903` |
| `icon()` helper (SVG sprite) | inline in script.js; `lock` icon in `scripts/icon-list.txt` |
| `ai_reason` returned from API | `api/src/routes/classifications.ts:441` |

## 5. Constraints & Risks

- **False positive:** any non-encryption `ai_reason` containing "password protected" verbatim. Checked all 8 matches — all are the Anthropic 400 error string. Acceptable risk.
- **Field truncation:** Anthropic error puts "password protected" early in the string; practically safe.

## 6. Proposed Solution (Implemented)

### script.js — detection + card modifier
```js
// Added after rawConfidence / cardClass block:
const isEncrypted = !!(item.ai_reason && /password\s*protected/i.test(item.ai_reason));
const cardClass = 'match-' + state + (isEncrypted ? ' is-encrypted' : '');
```

### script.js — badge in card template (after pre_questionnaire badge)
```js
${isEncrypted ? `<span class="ai-encrypted-badge" title="קובץ מוגן בסיסמה — לחצו לפתיחה">${icon('lock','icon-xs')} נעול</span>` : ''}
```

### style.css — new rules (after `.ai-pre-questionnaire-badge`)
```css
.ai-encrypted-badge { /* amber pill — warning palette */ }
.ai-review-card.is-encrypted { /* subtle amber border tint */ }
```

### index.html — cache bust to v=379 (script.js + style.css)

## 7. Validation Plan

- [ ] Load AI Review tab → encrypted-PDF cards show 🔒 "נעול" badge + amber border
- [ ] Hover badge → tooltip "קובץ מוגן בסיסמה — לחצו לפתיחה"
- [ ] Click encrypted card → DL-373 password panel still appears (no regression)
- [ ] Unlock via DL-373 → new decrypted row shows NO lock badge
- [ ] Non-encrypted card → no badge, no border tint
- [ ] Card with both `is_duplicate=true` AND encrypted → both badges visible side-by-side
- [ ] Mobile viewport → badge wraps gracefully in `.ai-file-info`
- [ ] RTL alignment → lock icon left of Hebrew text "נעול"

## 8. Implementation Notes

- No Worker change, no Airtable schema change — purely frontend
- `lock` icon was already in `scripts/icon-list.txt` (from earlier DL); sprite rebuild not required
- Cache bust: `style.css?v=321→379`, `script.js?v=388→379`
