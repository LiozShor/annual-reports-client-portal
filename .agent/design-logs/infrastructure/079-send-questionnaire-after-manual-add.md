# Design Log 079: Send Questionnaire After Manual Client Add
**Status:** [DONE]
**Date:** 2026-03-02
**Related Logs:** [064-fix-type-a-questionnaire-link.md], [073-type-a-single-cta-mirror-wf01.md]

## 1. Context & Problem

When an admin manually adds a single client (via the "Add Client" form), the client record + annual report are created at stage `1-Send_Questionnaire`, but the questionnaire email is NOT sent. The admin must then navigate to the "Send" tab, find the client, and trigger the send separately. This creates unnecessary friction for the most common single-client workflow.

**Current flow:**
1. Admin fills name + email + year → clicks "Add"
2. `addManualClient()` → `performServerImport()` → `[Admin] Bulk Import` n8n workflow
3. Client + annual_report created (stage `1-Send_Questionnaire`)
4. Success modal shown → admin clears form
5. **Admin must manually navigate to Send tab to send questionnaire** ← friction point

**Desired flow:**
1-4 same as above
5. After success modal closes, a **toast with action button** appears: "Send questionnaire?" with a "Send" button
6. Clicking "Send" triggers `sendQuestionnaires([reportId])` for the just-created report

## 2. User Requirements

1. **Q:** UI pattern for the prompt?
   **A:** Success toast with action button — auto-dismissing notification with a "Send Questionnaire" action button

2. **Q:** Scope — manual add only or also bulk import?
   **A:** Manual single-client add only. Not for bulk import from Excel.

3. **Q:** Which workflow to call?
   **A:** `[Admin] Send Questionnaires` (the newer authenticated workflow, not legacy WF01)

4. **Q:** Post-send navigation?
   **A:** Stay on the add-client form, show success toast — ready to add another client

## 3. Research

### Domain
Post-creation action prompts, toast notification UX

### Sources Consulted
1. **Nielsen Norman Group — Indicators, Validations, Notifications** — Toasts must not be the sole delivery mechanism for important actions; they're shortcuts. If missed, the action should be reachable elsewhere (the Send tab still exists).
2. **LogRocket UX Blog — Toast Notification Best Practices** — Action-carrying toasts need longer persistence (8-10s or until dismissed). One action max, 2-word label. Button should be visually distinct but not louder than the message.
3. **Canva Design Guidelines / UX Files** — Auto-dismiss toasts with actions should pause on hover. Non-action toasts: 4-5s. Action toasts: 8-10s minimum.

### Key Principles Extracted
- **Persistence for action toasts:** 8s minimum (vs current 3s for plain toasts). Pause-on-hover recommended.
- **Single action, short label:** "שלח שאלון" (Send Questionnaire) — one button, 2 words.
- **Fallback exists:** Even if toast is missed, admin can always use the Send tab. Toast is a convenience shortcut.
- **Ghost/text button style:** Action button should not overpower the message.

### Patterns to Use
- **Action Toast pattern:** Extended `showAIToast` with optional action callback + longer timeout
- **Progressive disclosure:** Don't clutter the add form — show the option only after success

### Anti-Patterns to Avoid
- **Modal for optional action:** A confirm dialog would be too heavy for something skippable
- **Auto-sending:** Never send the questionnaire without explicit admin action

### Research Verdict
Extend `showAIToast` to support an optional action button. 8s timeout for action toasts (vs 3s for plain). This is the lightest touch — minimal UI disruption, easy to miss = easy to fall back to existing flow.

## 4. Codebase Analysis

### Key Finding: Bulk Import Doesn't Return report_id
The `[Admin] Bulk Import` workflow (DjIXYUiERMe-vMYnAImuO) returns only `{ ok, created, skipped, failed }` — NO record IDs. The "Count Results" code node discards the Airtable response. We need the `report_id` to call `sendQuestionnaires([reportId])`.

### Relevant Files
| File | Role |
|------|------|
| `admin/js/script.js:670-703` | `performServerImport()` — calls bulk import, returns `true/false` |
| `admin/js/script.js:745-786` | `addManualClient()` — orchestrates manual add |
| `admin/js/script.js:2445-2465` | `showAIToast()` — current toast implementation (no action buttons) |
| `admin/js/script.js:890-924` | `sendQuestionnaires(reportIds)` — existing send function |
| `admin/index.html:602-606` | Toast HTML element |
| `[Admin] Bulk Import` (n8n) | "Count Results" node needs to return IDs |

### Existing Patterns
- `showAIToast(msg, type)` — simple icon + text, 3s auto-dismiss, no actions
- `sendQuestionnaires([ids])` — already handles single-id sends perfectly
- `performServerImport()` returns boolean, discards response data

## 5. Technical Constraints & Risks

* **Security:** No concerns — uses existing authenticated `sendQuestionnaires` flow
* **Risks:**
  - If bulk import workflow update fails, the toast action won't have a report_id → graceful degradation (just don't show the action button)
  - The `showModal` for success appears BEFORE the toast — modal must close first, then toast appears
* **Breaking Changes:** None — `showAIToast` extension is backward-compatible (new params are optional). `performServerImport` change returns data instead of boolean but callers only check truthiness.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. **Extend `showAIToast`** to accept optional `action` param: `showAIToast(message, type, action?)`
   - `action = { label: string, onClick: Function }`
   - When action provided: 8s timeout (vs 3s), show action button, add close button
   - Pause timeout on hover, resume on mouse leave
   - Action button: ghost/link style, white text

2. **Modify n8n bulk import response** to include `report_ids` array
   - Update "Count Results" code node to collect IDs from Airtable create output
   - Only when `created > 0`

3. **Modify `performServerImport`** to return response data + support modal suppression
   - Add optional `options` param with `suppressModal: boolean`
   - Return `data` object on success, `null` on failure (truthy/falsy — backward compatible)
   - When `suppressModal: true`, skip the success modal, just return data

4. **Modify `addManualClient`** post-success flow
   - Call `performServerImport(..., { suppressModal: true })` — no success modal
   - Extract `data.report_ids?.[0]` from response
   - Show action toast: "הלקוח נוסף בהצלחה" with "שלח שאלון" action button
   - Clean UX: loading → single toast (no modal+toast overlap)
   - If no report_id (edge case), show plain toast without action

### Toast HTML Update
Add action button container to existing toast element:
```html
<div id="aiToast" class="ai-toast">
    <i data-lucide="check-circle" class="icon-sm" id="aiToastIcon"></i>
    <span id="aiToastText"></span>
    <button id="aiToastAction" class="ai-toast-action" style="display:none"></button>
    <button id="aiToastClose" class="ai-toast-close" style="display:none">&times;</button>
</div>
```

### CSS Addition
```css
.ai-toast-action {
    background: none;
    border: 1px solid rgba(255,255,255,0.4);
    color: white;
    font-size: var(--text-xs);
    font-weight: 600;
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    margin-right: var(--sp-2);
    white-space: nowrap;
}
.ai-toast-action:hover { background: rgba(255,255,255,0.15); }
.ai-toast-close {
    background: none;
    border: none;
    color: rgba(255,255,255,0.6);
    font-size: 18px;
    cursor: pointer;
    padding: 0 var(--sp-1);
    line-height: 1;
}
.ai-toast-close:hover { color: white; }
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Extend `showAIToast`, modify `performServerImport` return, modify `addManualClient` post-success |
| `admin/index.html` | Modify | Add action button + close button to toast HTML |
| `admin/css/styles.css` | Modify | Add `.ai-toast-action` and `.ai-toast-close` styles |
| `[Admin] Bulk Import` (n8n) | Modify | Update "Count Results" node to include `report_ids` |

## 7. Validation Plan

* [ ] Manual add a test client → verify action toast appears with "שלח שאלון" button
* [ ] Click the action button → verify questionnaire sends (check Airtable stage moves to 2)
* [ ] Let the toast auto-dismiss (8s) → verify no errors, toast gone
* [ ] Add client via bulk import → verify NO action toast appears
* [ ] Test `showAIToast` without action (existing calls) → verify 3s behavior unchanged
* [ ] Test duplicate email flow (confirm dialog → add anyway) → verify action toast still appears after
* [ ] Verify `sendQuestionnaires` success modal shows correctly after toast action

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
