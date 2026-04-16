# Design Log 086: Persistent Batch Review — Docs Stay Until Notified
**Status:** [IMPLEMENTED — TESTING]
**Date:** 2026-03-03
**Related Logs:** [065-batch-completion-notification](065-batch-completion-notification.md), [069-review-classification-race-condition-guard](069-review-classification-race-condition-guard.md), [054-inline-stage-advancement-review-classification](054-inline-stage-advancement-review-classification.md)

## 1. Context & Problem

Documents disappear from the AI Review queue immediately after approve/reject. The `batchReviewTracker` is in-memory only (session-scoped JS variable). If the admin refreshes the browser or comes back the next day before sending the batch email, those reviewed docs are gone from the queue — the client never gets an email notification about them.

**Root cause:** The system conflates "business decision made" (approve/reject in Airtable) with "client notified" (batch email sent). There's no intermediate state between "reviewed" and "gone from queue."

**Goal:** Introduce a two-phase workflow: Phase 1 = review decision (persisted in Airtable), Phase 2 = client notification (email sent or explicitly dismissed). Documents stay visible in the queue between phases.

## 2. User Requirements

1. **Q:** Visual state for reviewed-but-unsent docs?
   **A:** Distinct visual state — card shows it was reviewed (lozenge badge, tinted background) but stays in queue until email sent.

2. **Q:** Can admin change decisions before sending?
   **A:** Yes — allow re-review. Admin can change approve→reject or vice versa before email is sent.

3. **Q:** When is "Send Batch Email" available?
   **A:** Only when ALL docs for a client are reviewed (same trigger as today).

4. **Q:** Audit trail for sent batch emails?
   **A:** No admin log needed — Outlook sent folder is enough.

5. **Q (user follow-up):** Dismiss option?
   **A:** Yes — admin can dismiss without sending email if no notification needed.

6. **Q (user follow-up):** Email CTA?
   **A:** Batch email must include link to `view-documents.html` so client can see current status.

## 3. Research

### Domain
Review Queue State Management, Two-Phase Workflow Persistence, Batch Action UX, Status Indicator Design

### Sources Consulted
1. **Transactional Outbox Pattern (microservices.io / AWS)** — Two-phase pattern: decision + staging area + relay/send. The "outbox" persists until the relay sends the notification. Maps directly to our problem: Airtable `notification_status` field acts as the outbox.
2. **GitHub PR Review Model** — Phase 1 (review) and Phase 2 (merge) are distinct. PRs stay in queue with status badges between phases. Items remain fully visible and interactive until Phase 2 completes.
3. **IBM Carbon Design System — Status Indicator Pattern** — Use 3 of 4 elements (text, color, shape, icon) for accessibility. Color semantics: gray=not started, blue=in progress, green=complete, yellow=warning. Blue for "approved but unsent" (not green — green means done).
4. **Atlassian Lozenge / Jira Statuses** — Pill badge system: Default (gray), In Progress (blue), Success (green), Moved (yellow). Text communicates specific state, color communicates category.
5. **Eleken — Bulk Actions UX Guidelines** — Communicate eligibility clearly (count badge), keep actions contextual/visible (persistent bar), require confirmation for high-stakes actions, provide clear feedback after send.

### Key Principles Extracted
- **Two-phase with intermediate state** — decision and notification are decoupled. Airtable field `notification_status` acts as the staging marker.
- **Blue for "in progress", not green** — approved-but-unsent uses blue (workflow ongoing). Green reserved for "complete/sent."
- **Text + color + icon** — never color alone for status indicators (Carbon accessibility rule).
- **Persistent batch action bar** — don't hide the send option behind a modal triggered by card removal. Show it inline as a visible reminder.
- **Confirmation for client-facing actions** — batch send shows summary before sending.

### Patterns to Use
- **Outbox pattern:** `notification_status` field = outbox. Empty = pending relay. `sent`/`dismissed` = processed.
- **Lozenge badges:** Blue pill for approved-unsent, amber pill for rejected-unsent.
- **Inline batch bar:** Sticky summary + actions at top of accordion when all reviewed.

### Anti-Patterns to Avoid
- **Green for approved-unsent** — misleading as "done" when notification hasn't been sent.
- **Opacity/dimming as sole differentiator** — reads as "disabled/inactive," wrong message for re-reviewable cards.
- **Auto-send after each review** — defeats batching purpose, sends incomplete info.
- **Modal for batch actions** — cards no longer disappear, so the accordion-empty trigger that showed the modal never fires. Use inline bar instead.

### Research Verdict
Two-phase approach with Airtable `notification_status` field as the outbox. Cards stay in queue with blue/amber lozenge badges. Inline batch action bar replaces the batch-complete modal. Re-review supported by preserving the `document` link on reject.

## 4. Codebase Analysis

### Relevant Files
- **`admin/js/script.js`** — Main admin JS
  - `batchReviewTracker` (line 1444): In-memory tracker, lost on refresh
  - `approveAIClassification()` (line 2162): Calls API → `trackReviewAction()` → `animateAndRemoveAI()` → card removed
  - `executeReject()` (line 2244): Same pattern — API → track → animate-remove
  - `animateAndRemoveAI()` (line 2392): Removes card from DOM + data array, triggers batch modal when accordion empty
  - `showBatchCompleteModal()` (line 2688): Modal with summary stats + "Send Update" / "Skip" buttons
  - `sendBatchStatus()` (line 2763): POSTs to `/send-batch-status`, payload from in-memory tracker
  - `renderAICards()` (line 1721): Groups by client, renders accordions + cards
  - `loadAIClassifications()` (line 1547): Fetches from `/get-pending-classifications`, stores in `aiClassificationsData`
  - `recalcAIStats()` (line 2563): Counts from `aiClassificationsData`, updates stat bar + tab badge
  - `applyAIFilters()` (line 1621): Filters by search/confidence/type

- **`admin/css/style.css`** — AI review styles
  - `.ai-accordion` (line 1294): Accordion container
  - `.ai-review-card` (line 1402): Card base styles, `.match-full`/`.match-unmatched` variants
  - `.batch-complete-modal` (line 3155): Current modal styles

### Existing Patterns
- **Inline confirm:** `showInlineConfirm()` replaces action buttons with confirm/cancel strip
- **Card states:** 4 states based on match quality (full/fuzzy/mismatch/unmatched) with colored left border
- **Badge system:** `.ai-accordion-stat-badge` with color variants (matched/mismatch/unmatched)
- **Loading overlay:** `setCardLoading()`/`clearCardLoading()` for async operations

### Alignment with Research
- Accordion badges align with Atlassian lozenge pattern — add "ready to send" variant
- Card left-border color system can be extended with reviewed state tinting
- Existing `showConfirmDialog()` for dismiss confirmation
- `showAIToast()` for success/dismiss feedback

### Dependencies
- **Airtable:** `pending_classifications` table — add `notification_status` field
- **n8n:** `[API] Get Pending Classifications` — change filter, return extra fields
- **n8n:** `[API] Review Classification` — stop clearing document link on reject
- **n8n:** `[API] Send Batch Status` — add action param, set notification_status, add CTA

## 5. Technical Constraints & Risks

- **Security:** No new auth needed — uses existing `authToken` session
- **Risks:**
  - **Reject re-review:** Currently reject clears `document` link in `pending_classifications`. Must stop doing this to support rejected→approved re-review. Verify no downstream logic depends on this link being null for rejected items.
  - **Reassign re-review:** Safe — `onedrive_item_id` persists across all file moves/renames, `pending_classifications` record still exists until batch send/dismiss, and workflows use document record IDs (not file paths). Re-opening a reassigned card for a new decision works through the same review workflow.
  - **Documents table timing:** Business actions (file move, doc status update) still happen immediately on review. This means the documents table is already updated even though notification is pending. Acceptable — the portal shows current truth.
  - **Two admins:** If admin A reviews 2 docs and admin B sends batch email (only seeing those 2 + 1 they reviewed), admin A's reviewed docs would be included. Low risk — small team.
- **Breaking Changes:** None — existing flow continues to work. The `notification_status` field defaults to empty, so all existing records are unaffected.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

```
Page Load → loadAIClassifications()
  API returns items where notification_status IS EMPTY
  Items include review_status field
  ↓
renderAICards() groups by client
  For each item:
    review_status = 'pending' → normal card (approve/reject/reassign buttons)
    review_status != 'pending' → reviewed card (lozenge + "Change Decision" button)
  ↓
  If ALL items for client are reviewed → show batch action bar in accordion
  ↓
Admin reviews a pending card:
  approveAIClassification() / executeReject()
    → API call to /review-classification (same as today)
    → transitionCardToReviewed() instead of animateAndRemoveAI()
    → Card transitions to reviewed state in-place
    → Check if all client items reviewed → maybe show batch bar
  ↓
Admin clicks "Send Update":
  sendBatchStatus()
    → POST /send-batch-status { action: 'send', classification_ids, items }
    → n8n: build email with CTA to view-documents, send via Graph API
    → n8n: set notification_status = 'sent' on all classification_ids
    → Frontend: animate-remove all reviewed cards for client
  ↓
Admin clicks "Dismiss":
  dismissBatch()
    → showConfirmDialog confirmation
    → POST /send-batch-status { action: 'dismiss', classification_ids }
    → n8n: set notification_status = 'dismissed' (no email)
    → Frontend: animate-remove all reviewed cards for client
  ↓
Admin clicks "Change Decision" on reviewed card:
  → Restore action buttons → make new selection → API call → card updates
```

### Data Structures / Schema Changes

**Airtable — `pending_classifications`:**
- ADD: `notification_status` singleSelect (`sent`, `dismissed`), default empty

**n8n filter change:**
- FROM: `review_status = 'pending'`
- TO: `notification_status IS EMPTY`

**Frontend payload — sendBatchStatus:**
```json
{
  "token": "...",
  "action": "send",
  "report_key": "rec...",
  "client_name": "...",
  "classification_ids": ["recXXX", "recYYY"],
  "items": [
    { "docName": "...", "action": "approve" },
    { "docName": "...", "action": "reject", "rejectionReason": "image_quality", "notes": "..." }
  ]
}
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| Airtable `pending_classifications` | Manual | Add `notification_status` singleSelect field |
| n8n `[API] Get Pending Classifications` (kdcWwkCQohEvABX0) | Modify | Filter: `notification_status` empty, return `review_status`/`notes`/`reviewed_at`, split stats |
| n8n `[API] Review Classification` (c1d7zPAmHfHM71nV) | Modify | Stop clearing `document` link on reject |
| n8n `[API] Send Batch Status` (QREwCScDZvhF9njF) | Modify | Accept `action` + `classification_ids`, set `notification_status`, add view-documents CTA button |
| `github/.../admin/js/script.js` | Modify | `transitionCardToReviewed()`, reviewed card rendering, batch action bar, `dismissBatch()`, re-review, remove modal, stats/filters, reconstruct tracker on load |
| `github/.../admin/css/style.css` | Modify | Reviewed card styles, lozenge badges, batch action bar, ready-send accordion badge |

## 7. Validation Plan

* [ ] **Persistence (core feature):** Review 2 of 3 docs → refresh page → 2 docs show reviewed state (blue/amber lozenge), 1 still pending with action buttons
* [ ] **Batch bar trigger:** Review last pending doc → batch action bar appears in accordion with correct counts
* [ ] **Send batch:** Click "Send Update" → email received → email has approved section + corrections section + CTA link to view-documents → cards animate-removed → Airtable `notification_status = 'sent'`
* [ ] **Dismiss:** Click "ללא עדכון" → confirm dialog → cards removed → no email → Airtable `notification_status = 'dismissed'`
* [ ] **Re-review (approve→reject):** Approve a doc → click "Change Decision" → reject with reason → card shows amber state → batch bar updates
* [ ] **Re-review (reject→approve):** Reject a doc → "Change Decision" → approve → card shows blue state → documents table re-confirmed
* [ ] **Email CTA:** Click CTA button in email → opens `view-documents.html?report_id=...` correctly
* [ ] **Email bilingual:** English-speaking client gets bilingual email with CTA in both languages
* [ ] **Stats & badge:** Tab badge shows pending count only (not reviewed-unsent). Stats bar shows both counts.
* [ ] **Filters:** "Reviewed (unsent)" filter shows only reviewed cards
* [ ] **Edge case:** Client has 1 doc → review it → batch bar appears immediately
* [ ] **Edge case:** All clients' docs reviewed → empty state NOT shown (reviewed cards still visible)
* [ ] **Accordion header:** Shows "📩 מוכן לשליחה" badge when all items reviewed
* [ ] **Reassign re-review:** Reassign a doc → card shows "שויך מחדש" lozenge → click "שנה החלטה" → action buttons appear → can approve/reject/reassign-again
* [ ] **Reassign→approve re-review:** Reassign a doc → "שנה החלטה" → approve → card shows blue approved lozenge

## 8. Implementation Notes (Post-Code)

### Session 77 (2026-03-04) — Implementation + Testing + Fixes

**Tasks 1-4 (Airtable + 3 n8n workflows):** Completed in prior session.

**Tasks 5-6 (Frontend JS + CSS):** Implemented in this session.

**Bugs found & fixed during testing:**

1. **IF Conflict malformed connection (exec 5158):** MCP tool stored the false branch under key `"1"` with `type: "0"` instead of in `main` array at index 1. Fixed via REST API — proper `main: [[true_branch], [false_branch]]` format.

2. **Respond Success not sending response (exec 5173):** `Update Notification Status` node was between `Send Email` and `Respond Success`, breaking webhook response context. Fixed by reordering: `Send Email → Respond Success → Update Notification Status`.

3. **Respond Success returning empty body (exec 5193):** After reordering, node had `options: {}` with no `responseBody` — forwarded empty data. Fixed by setting explicit `respondWith: 'json'` and `responseBody: '={{ JSON.stringify({ ok: true, message: "Email sent successfully" }) }}'`.

4. **Post-send cleanup (user request):** Changed both send and dismiss paths from PATCH `notification_status` to DELETE records from `pending_classifications`. Records are fully removed after batch email sent or dismissed — keeps table clean.

**Research principles applied:**
- Two-phase outbox pattern: review decision persisted independently from notification
- Blue lozenge for "in progress" (not green) per Carbon design system
- Inline batch action bar replaces modal (cards don't disappear, so accordion-empty trigger never fires)

**Deviation from plan:**
- Plan specified `notification_status` field as outbox marker → changed to DELETE records entirely (user preference for clean table over audit trail)
- ~~Reassign re-review deferred to future investigation~~ → Enabled (see session below)

### Session 79 (2026-03-04) — Enable Reassign Re-Review

Investigation confirmed reassign re-review is safe:
- `onedrive_item_id` persists across all file moves/renames — workflows use this ID, not file paths
- `pending_classifications` record still exists (not deleted until batch send/dismiss)
- Review workflow handles all actions (approve/reject/reassign) using document record IDs

**Change:** Removed `canChangeDecision = reviewStatus !== 'reassigned'` guard in `renderReviewedCard()` — all reviewed cards now show "שנה החלטה" button, including reassigned ones. `startReReview()` already handled reassigned cards (removes `reviewed-reassigned` class and restores buttons).
