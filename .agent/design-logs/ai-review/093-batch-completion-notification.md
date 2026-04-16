# Design Log 093: Batch Completion Notification on AI Review Screen
**Status:** [DONE]
**Date:** 2026-02-26
**Related Logs:** [043-ai-review-card-redesign](043-ai-review-card-redesign.md), [050-inline-confirmation-ai-review-cards](050-inline-confirmation-ai-review-cards.md), [053-ai-review-silent-refresh](053-ai-review-silent-refresh.md), [054-inline-stage-advancement-review-classification](054-inline-stage-advancement-review-classification.md)

## 1. Context & Problem

The AI Review screen lets staff approve/reject AI-classified documents one at a time. Clients submit documents in batches (several docs in one email or across a few emails). Currently:

1. **No batch-complete signal.** When a reviewer finishes all docs for a client, there's no feedback — the accordion just disappears.
2. **No consolidated client notification.** Each approve/reject is silent. The client has no idea their documents were reviewed until they check the portal.
3. **No rejection notes.** The reject action sends `action: 'reject'` with no reason — the `notes` field in Airtable exists but is never populated by the frontend.
4. **No "return for correction" flow.** There's no way to tell the client *why* a document was rejected or what to fix.

**Goal:** When all pending docs for a client are reviewed, prompt the reviewer to send a single consolidated status email covering everything — approved docs, rejected docs with correction instructions.

## 2. User Requirements

1. **Q:** What defines a "batch"?
   **A:** All currently pending documents for a client = one batch. When the last one is reviewed, that's batch completion.

2. **Q:** Does a rejection notes field exist today?
   **A:** Airtable has `notes` (multilineText) on `pending_classifications` but frontend never populates it. This is new frontend work.

3. **Q:** Status update delivery channel?
   **A:** Email to client (via existing email system).

4. **Q:** Who writes the email content?
   **A:** System auto-generates, following existing email workflow patterns (WF[03] style).

5. **Q:** Partial review handling?
   **A:** Only prompt when ALL pending docs for a client are reviewed. No partial prompts.

6. **Q:** Multiple submission dates in queue — one batch or two?
   **A:** One batch. Everything pending = one batch.

7. **Q:** What does "exclude previous batches" mean?
   **A:** Documents already reviewed in earlier sessions are excluded. Only the current batch (just-reviewed docs) is included.

8. **Q:** UX for completion prompt?
   **A:** Research-driven decision (see below).

9. **Q (user follow-up):** What should the client email contain?
   **A:** Full details — list of approved docs, list of rejected docs, list of docs needing correction with explanations for each.

## 3. Research

### Domain
Review Queue Completion UX, Document Rejection Taxonomy, Consolidated Transactional Email Design

### Sources Consulted
1. **NN/g — "Indicators, Validations, and Notifications"** — Three-tier taxonomy: indicators (passive), validations (error), notifications (event). Batch completion is medium-high consequence (once per client) → modal justified, but must not block flow. A toast is too easily missed for this one-time moment.
2. **NN/g — "Transactional Notifications"** — Frontload key info: "3 approved, 2 need correction" in subject/first line. Don't bury action items below approved items.
3. **Pencil & Paper / Eleken — Success UX & Empty States** — Celebratory empty state when emptiness IS the goal. But: "Don't apply a huge party every time" for routine actions. Match celebration to scale — concise checkmark, not confetti.
4. **UX Planet — "Confirmation Dialogs Without Irritation"** — Buttons must NOT be "Yes/No" — use specific labels: "Send Update to Client" / "Skip for Now". Use `role="alertdialog"` for accessibility.
5. **Onfido/Entrust — Document Rejection Taxonomy** — Hierarchical: category → sub-category → actionable guidance. 11 categories with structured sub-breakdowns. Rejection reasons should be structured, not free-text only.
6. **Stripe Connect — Verification Rejection Flow** — Each error has `code` + `reason` + `requirement`. Client-facing instruction derived from code. Resubmission only requires the specific document, not everything.
7. **Greenhouse — Strategic Use of Rejection Reasons** — "The reason should be actionable and clear enough that someone without context can understand it." Avoid vague options like "Other" without elaboration.
8. **Adam Silver — Form Design Patterns** — Lead with what needs to happen ("Upload a clearer image"), not what went wrong ("Image was blurry"). Use icons alongside color — never color alone.
9. **Postmark — Transactional Email Best Practices (2026)** — "Design frequent notifications so they can be sent in batches." Remove heavy branding from notifications. Only include items with substantive updates.
10. **Moosend — Transactional Email Best Practices** — Single-column layouts for RTL reliability. Use headings and bold labels for scannability. CTA must be prominent with clear label.

### Key Principles Extracted
- **Lightweight modal for batch-complete** — not toast (too easily missed), not full-page (over-celebration). This is a once-per-client moment during a review session.
- **Specific button labels** — "Send Update to Client" / "Skip for Now", never "Yes/No".
- **Structured rejection taxonomy** — 5-6 predefined categories mapping to Hebrew correction instructions, with optional free-text supplement.
- **Action-first email structure** — docs needing correction appear BEFORE approved docs. Lead with what the client needs to do.
- **Icons + color for status** — never color alone (accessibility).
- **Single consolidated email** — one email per client covering all reviewed docs, not per-document.

### Patterns to Use
- **Celebratory empty state in accordion:** When last card removed from a client accordion, transform it into a completion summary before removing.
- **Inline rejection notes:** When rejecting, show a dropdown for reason category + optional textarea, before the confirm step.
- **Batch-complete modal:** Lightweight modal showing summary stats + "Send Update" CTA.
- **Email digest pattern:** Single-column RTL email, action-required items first, approved items second.

### Anti-Patterns to Avoid
- **Toast for completion** — too easily missed; reviewer moves on without option to send email.
- **Free-text-only rejection** — inconsistent, no analytics, can't map to SSOT client instructions.
- **One email per document** — inbox spam, no holistic view.
- **Color-only status indicators** — accessibility failure for colorblind users.
- **Burying correction items** — action-required docs must appear before approved docs.
- **Over-celebration** — reviewers process many clients; keep it concise.

### Research Verdict
Use a **lightweight modal** triggered when the last card for a client is reviewed. The modal shows review summary (X approved, Y need correction) and offers to send a consolidated email. Rejection notes use a **hybrid approach**: predefined category dropdown (mapped to Hebrew client instructions) + optional free-text. The email follows existing WF[03] design patterns (single-column, RTL, `<table>` layout) but with a two-section structure (corrections first, then approved).

## 4. Codebase Analysis

### Relevant Files
- **`admin/js/script.js`** — Main admin JS (2900+ lines)
  - `animateAndRemoveAI()` (line 2010): Already checks if accordion is empty after card removal → **natural hook for batch completion detection**
  - `rejectAIClassification()` (line 1877): Sends `action: 'reject'` with no notes → needs rejection notes UI
  - `approveAIClassification()` (line 1848): Sends `action: 'approve'` → needs to track reviewed items for batch summary
  - `renderAICards()` (line 1412): Groups by client_name → grouping key exists
  - `showModal()` (line 2756): Existing modal infrastructure (icon + title + body + stats)
  - `showConfirmDialog()` (line 2877): Existing confirm dialog (message + callback)

### Existing Patterns
- **Inline confirmation** (line 2802): `showInlineConfirm()` replaces card action buttons with confirm/cancel strip — used for approve/reject/reassign
- **Modal system**: `showModal(type, title, body, stats)` for success/error/warning
- **Confirm dialog**: `showConfirmDialog(message, onConfirm, confirmText, danger)` — callback-based, not async
- **Card removal**: `animateAndRemoveAI()` removes card + checks if accordion empty + updates stats
- **Toast**: `showAIToast(message, type)` for quick feedback

### Alignment with Research
- NN/g recommends modal for once-per-entity completion moments → our `showModal`/`showConfirmDialog` infrastructure can be extended
- Research says use specific button labels → `showConfirmDialog` currently supports custom `confirmText` but we need a richer modal (summary + CTA)
- Card grouping by `client_name` already exists → batch boundaries are naturally defined

### Dependencies
- **Airtable:** `pending_classifications.notes` field (exists, unused), `pending_classifications.review_status`
- **n8n:** `[API] Review Classification` (c1d7zPAmHfHM71nV) — needs to accept `notes` + `rejection_reason` params
- **n8n:** New workflow or sub-workflow for sending batch status email
- **Email:** Microsoft Graph API via existing patterns

## 5. Technical Constraints & Risks

- **Security:** No new auth needed — uses existing `authToken` session
- **Risks:**
  - If reviewer closes browser mid-batch, the in-memory tracking is lost. This is acceptable — the "batch" concept is session-only, not persisted.
  - If two reviewers work on the same client's docs simultaneously, both might get a batch-complete prompt. Low risk given small team size.
- **Breaking Changes:** None — this is additive. Existing approve/reject still works, just gains notes capability and completion detection.
- **SSOT:** Rejection reason categories should be defined as a constant in the frontend (not SSOT-level since these are admin-facing, not document titles).

## 6. Proposed Solution (The Blueprint)

### Part A: Rejection Notes on Reject Action

**Flow:**
1. Reviewer clicks "Reject" on a card
2. Instead of inline confirm, show a **rejection notes panel** (replaces card actions area):
   - Dropdown with predefined reason categories (Hebrew)
   - Optional free-text textarea for additional notes
   - Confirm "Reject" + Cancel buttons
3. On confirm → POST to `/webhook/review-classification` with `action: 'reject'`, `rejection_reason: <category_code>`, `notes: <free_text>`

**Rejection Reason Categories:**
| Code | Hebrew Label | Client Instruction (auto-generated) |
|------|-------------|-------------------------------------|
| `image_quality` | מסמך לא קריא | נא לשלוח צילום ברור וקריא של המסמך |
| `wrong_document` | מסמך שגוי | נא לשלוח את המסמך הנכון |
| `incomplete` | מסמך חלקי / חסרים עמודים | נא לשלוח את המסמך המלא כולל כל העמודים |
| `wrong_year` | שנת מס שגויה | נא לשלוח מסמך לשנת המס הנכונה ({year}) |
| `wrong_person` | לא שייך ללקוח | המסמך אינו שייך לתיק זה — נא לבדוק ולשלוח מחדש |
| `other` | אחר | (uses free-text as client instruction) |

**Storage:** `pending_classifications.notes` stores JSON: `{ "reason": "image_quality", "text": "optional additional notes" }`

### Part B: Batch Completion Detection

**Tracking mechanism (in-memory, session-scoped):**
```javascript
// Track reviewed items per client during this session
const batchReviewTracker = {};
// Structure: { "Client Name": [{ recordId, action, docName, rejectionReason, notes }] }
```

**Hook point:** Inside `animateAndRemoveAI()` (line 2010), after card removal, when the accordion becomes empty (line 2020-2025):
1. Before removing the empty accordion → check `batchReviewTracker[clientName]`
2. If it has entries → show batch-complete modal
3. Then remove the accordion

### Part C: Batch-Complete Modal

**Custom modal** (not reusing `showModal` — needs richer content):

```
┌──────────────────────────────────────────┐
│  ✅  סיום סקירה — [Client Name]          │
│                                          │
│  סקרת X מסמכים:                          │
│  ● 3 אושרו                              │
│  ● 2 דורשים תיקון                        │
│                                          │
│  [שלח עדכון ללקוח]  [דלג]                │
└──────────────────────────────────────────┘
```

- **Primary CTA:** "שלח עדכון ללקוח" (Send Update to Client) → triggers email
- **Secondary:** "דלג" (Skip) → dismisses modal, accordion removed
- Shows summary with approved count (green) and correction-needed count (amber)

### Part D: Status Update Email

**Trigger:** Reviewer clicks "Send Update to Client" in batch-complete modal

**Frontend action:** POST to new endpoint `/webhook/send-batch-status` with:
```json
{
  "token": "...",
  "client_name": "...",
  "report_id": "...",
  "reviewed_items": [
    { "doc_name": "טופס 106 — Intel", "action": "approve" },
    { "doc_name": "אישור יתרה — לאומי", "action": "reject", "reason": "image_quality", "notes": "..." }
  ]
}
```

**n8n workflow (new or extension):**
1. Receive webhook payload
2. Build email HTML following WF[03] patterns (single-column, RTL, `<table>`, inline styles)
3. Two sections:
   - **Section 1 (if rejections exist):** "מסמכים שדורשים תיקון" — list with ⚠ icon, doc name, correction instruction
   - **Section 2:** "מסמכים שאושרו" — list with ✓ icon, doc name
4. CTA button: Link to client portal
5. Send via Microsoft Graph API from `reports@moshe-atsits.co.il`
6. Subject: "עדכון סטטוס מסמכים — {client_name}" (starts with Hebrew char per encoding rules)

### Logic Flow Summary

```
Reviewer reviews cards (approve/reject with notes)
    ↓ each action recorded in batchReviewTracker[clientName]
    ↓
animateAndRemoveAI() removes card
    ↓ accordion empty check
    ↓
Last card for client? → Show batch-complete modal
    ↓
"Send Update" clicked → POST /webhook/send-batch-status
    ↓
n8n workflow → Build email → Microsoft Graph → Client inbox
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add rejection notes UI, batch tracker, batch-complete modal, send-status API call |
| `admin/css/styles.css` | Modify | Styles for rejection notes panel + batch-complete modal |
| n8n: New workflow `[API] Send Batch Status` | Create | Webhook → build email → send via Graph API |
| n8n: `[API] Review Classification` | Modify | Accept `rejection_reason` + `notes` params, write to Airtable |

## 7. Validation Plan

* [ ] **Rejection notes:** Reject a doc → verify reason dropdown appears → select reason + type notes → confirm → verify `notes` field populated in Airtable
* [ ] **Batch detection (happy path):** Review all 3 docs for a client → verify modal appears after last one
* [ ] **Batch detection (multi-client):** Review 2 of 3 docs for Client A, all 2 for Client B → verify modal appears for Client B only, not Client A
* [ ] **Skip action:** Click "Skip" on modal → verify accordion removed, no email sent
* [ ] **Send update:** Click "Send Update" → verify email received by client with correct content
* [ ] **Email content:** Verify email shows approved list + correction list with instructions
* [ ] **Email encoding:** Verify Hebrew renders correctly, subject starts with Hebrew char
* [ ] **Idempotency:** Refresh page mid-review → verify no stale batch data (tracker is session-only, clean start)
* [ ] **Edge case:** Client has only 1 pending doc → review it → verify modal still appears

## 8. Implementation Notes (Post-Code)

### Bilingual Requirement (added per audit DL-030 propagation)
**Bilingual requirement:** The batch status email must check `source_language` from `annual_reports` and follow the EN-first/HE-second pattern from WF[03] (design-log 030) for English clients. Add EN translations for rejection reason labels and section headers. Hebrew clients continue to receive Hebrew-only emails. This was implemented as part of the bilingual email audit (Fixes 1-4) applied to WF[06] and [API] Send Batch Status.

### Implementation Status
* **Part D (Status Update Email):** `[API] Send Batch Status` workflow (`QREwCScDZvhF9njF`) — implemented and live with bilingual support.
* **Parts A-C (Frontend):** Rejection notes UI, batch tracker, batch-complete modal — implemented in `admin/js/script.js` and `admin/css/styles.css`.
