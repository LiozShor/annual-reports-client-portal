# Design Log 105: Approve & Send — Guard Bypass Fix + Sent Badge

**Status:** [DEPRECATED — goals split between session 97 (inline send) and DL-113 (save UX)]
**Date:** 2026-03-06
**Related Logs:** DL-092 (approve-send-duplicate-prevention), DL-104 (doc-manager-phase2-fixes)

## 1. Context & Problem

DL-104 (session 96) added an `approveAndSendToClient()` function that opens the n8n approve-and-send webhook with `&confirm=1`. This **bypasses** the `approve-confirm.html` confirmation/warning page that DL-092 built to guard against duplicate sends.

**Three issues:**
1. **Guard bypass:** `confirm=1` skips the WF[03] "already sent" check — docs can be re-sent without any warning
2. **No visual indicator:** Document manager has no badge/indicator showing whether docs were already sent to the client
3. **Generic dialog:** The local confirm dialog always says "שלח ללקוח" regardless of sent status

## 2. User Requirements

1. **Q:** How should the button handle already-sent reports?
   **A:** Drop `confirm=1` — let `approve-confirm.html` handle the guard (DL-092's existing warning page)

2. **Q:** Should we add a visual indicator?
   **A:** Yes, badge in client bar using `docs_first_sent_at` (not a new stage)

3. **Q:** Keep local confirm dialog or open tab directly?
   **A:** Keep local dialog (two-step: dialog → approve-confirm.html)

4. **Q:** Add a new pipeline stage for "docs sent"?
   **A:** Defer to future DL — use `docs_first_sent_at` field for now (90% of value, 10% of effort)

## 3. Research

### Domain
Confirmation UX patterns, status badge design, idempotent send buttons

### Sources Consulted
1. **Smashing Magazine — Managing Dangerous Actions in UIs** — Two-step confirmation is justified for irreversible + context-switching actions. The split feels natural when first step sets expectations and second step confirms on the target page.
2. **IBM Carbon Design — Status Indicator Patterns** — Badges should indicate actionable state, not just metadata. Limit to 3-4 distinct colors. Always pair color with a second cue (icon, label).
3. **NNGroup — Indicators & Notifications** — Show past-tense state ("Sent on Mar 5") rather than graying out. Specific messages defeat autopilot.

### Key Principles
- **Two-step confirmation:** Dialog → confirmation page is a natural split for actions that open new tabs. The dialog's job is to set expectations.
- **Contextual messaging:** "Send to CLIENT?" vs "Already sent on DATE. Send again?" defeats autopilot and prevents accidental re-sends.
- **Past-tense state on badges:** "נשלח ללקוח 5 במרץ 2026" is more informative than a generic "Sent" pill.

### Patterns to Use
- **Contextual showConfirmDialog:** Different message/button text based on `docs_first_sent_at` status
- **Design system `.badge` classes:** `.badge-success` for "sent", `.badge-neutral` for "not yet sent"

### Anti-Patterns to Avoid
- **Double redundant confirmation:** Both dialog and page showing identical "are you sure?" — each step should add information/context
- **Color-only status:** Badge must include text label, not just a colored dot

### Research Verdict
Drop `confirm=1`, add contextual dialog text, add badge. Simple, leverages existing DL-092 infrastructure.

## 4. Codebase Analysis

### Existing Solutions Found
- **DL-092:** `approve-confirm.html` already handles `warning=already_sent` state with soft warning + "שלח שוב" button. WF[03] Build Confirm Page adds warning params when stage ≥ 3.
- **`docs_first_sent_at`:** Airtable field `fldpkLSpxWL7RRgBr` — set by WF[03] on first send, preserved on re-send.
- **Badge CSS:** `design-system.css` lines 267-307 — `.badge`, `.badge-success`, `.badge-neutral` classes ready to use.
- **Client bar:** `document-manager.html` — flex container with `.client-bar-item` children.

### Reuse Decision
- Reuse DL-092's `approve-confirm.html` guard entirely — just stop bypassing it
- Reuse `.badge` CSS classes — no new CSS needed
- Reuse `showConfirmDialog` — enhance with contextual message

### Relevant Files
- `assets/js/document-manager.js` — `approveAndSendToClient()`, `loadDocuments()`, globals
- `document-manager.html` — client bar, button
- n8n WF `Ym389Q4fso0UpEZq` node `Build Response` (ID: `4aca5e5a-3d8c-4b5c-baf2-4f279e14e5b6`)

### Dependencies
- WF[03] (`cNxUgCHLPZrrqLLa`) must be active for approve-confirm flow
- Airtable `docs_first_sent_at` field exists (DL-092)

## 5. Technical Constraints & Risks

- **Security:** `docs_first_sent_at` is office-internal — only added to office-mode response (requires `ADMIN_TOKEN`). NOT exposed in client-mode API.
- **Risks:** Low. Additive API change (new field). Frontend gracefully handles field being absent (`|| null`).
- **Breaking Changes:** None. Removing `confirm=1` doesn't break the webhook — it just takes the no-confirm branch instead.

## 6. Proposed Solution

### Change 1: n8n — Add `docs_first_sent_at` to API response

**Workflow:** `Ym389Q4fso0UpEZq` ([API] Get Client Documents)
**Node:** `Build Response` (ID: `4aca5e5a-3d8c-4b5c-baf2-4f279e14e5b6`)

In the office-mode return block, add after `stage: stage,`:
```js
docs_first_sent_at: report.docs_first_sent_at || null,
```

### Change 2: Frontend JS — Store state + fix approve function

**File:** `assets/js/document-manager.js`

**2a. New globals** (after existing globals):
```js
let CURRENT_STAGE = '';
let DOCS_FIRST_SENT_AT = null;
```

**2b. Store in `loadDocuments()`** (after YEAR block):
```js
CURRENT_STAGE = data.stage || '';
DOCS_FIRST_SENT_AT = data.docs_first_sent_at || null;
updateSentBadge();
```

**2c. Replace `approveAndSendToClient()`** — drop `confirm=1`, add contextual message:
```js
function approveAndSendToClient() {
    const alreadySent = !!DOCS_FIRST_SENT_AT;
    let message, confirmText;
    if (alreadySent) {
        const sentDate = new Date(DOCS_FIRST_SENT_AT)
            .toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
        message = `הרשימה נשלחה ל-${CLIENT_NAME} ב-${sentDate}. לשלוח שוב?`;
        confirmText = 'שלח שוב';
    } else {
        message = `שלח רשימת מסמכים ל-${CLIENT_NAME}?`;
        confirmText = 'שלח ללקוח';
    }
    showConfirmDialog(message, () => {
        const token = generateApprovalToken(REPORT_ID, 'MOSHE_1710');
        const url = `${API_BASE}/approve-and-send?report_id=${REPORT_ID}&token=${token}`;
        window.open(url, '_blank');
    }, confirmText, false);
}
```

**2d. Add `updateSentBadge()`:**
```js
function updateSentBadge() {
    const el = document.getElementById('sentBadge');
    if (!el) return;
    if (DOCS_FIRST_SENT_AT) {
        const d = new Date(DOCS_FIRST_SENT_AT)
            .toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
        el.innerHTML = `<span class="badge badge-success">נשלח ללקוח ${d}</span>`;
        el.style.display = '';
    } else if (CURRENT_STAGE && parseInt(CURRENT_STAGE, 10) >= 3) {
        el.innerHTML = '<span class="badge badge-neutral">טרם נשלח ללקוח</span>';
        el.style.display = '';
    } else {
        el.style.display = 'none';
    }
}
```

### Change 3: Frontend HTML — Add badge placeholder

**File:** `document-manager.html`

Add after the year `.client-bar-item`, before closing `</div>` of `.client-bar`:
```html
<div class="client-bar-item" id="sentBadge" style="display:none;"></div>
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| n8n WF `Ym389Q4fso0UpEZq` Build Response | Modify | Add `docs_first_sent_at` to office-mode return |
| `assets/js/document-manager.js` | Modify | Globals, loadDocuments, approveAndSendToClient, updateSentBadge |
| `document-manager.html` | Modify | Badge placeholder in client bar |

## 7. Validation Plan

- [ ] **Not-sent report (stage < 3):** No badge visible. Button shows "שלח ללקוח" dialog. Tab opens approve-confirm.html (normal confirm, no warning).
- [ ] **Not-sent report (stage >= 3, docs_first_sent_at = null):** Neutral "טרם נשלח ללקוח" badge. Button shows "שלח ללקוח" dialog. Tab opens approve-confirm.html (no warning since WF[03] checks stage, and stage already >= 3 means warning will show).
- [ ] **Already-sent report:** Green "נשלח ללקוח [date]" badge. Button shows "הרשימה נשלחה ל-CLIENT ב-[date]. לשלוח שוב?" with "שלח שוב". Tab opens approve-confirm.html with warning.
- [ ] **Regression:** Document editing (waive, status, name, notes) still works. Save flow unaffected.
- [ ] **Security:** Client-mode API does NOT return `docs_first_sent_at`.

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
