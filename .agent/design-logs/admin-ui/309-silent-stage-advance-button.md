# Design Log 309: Silent Stage Advance Button (PA Card + Doc-Manager)
**Status:** [COMPLETED] (live 2026-04-20, tested)
**Date:** 2026-04-20
**Related Logs:** DL-267 (auto-advance-zero-docs-to-review), DL-297 (doc-manager stage dropdown), DL-298 (PA stacked cards), DL-304 (PA approve card removal + dashboard sync)

> UI button labels in this log are written in English for PII-guard compatibility. Actual rendered labels are Hebrew — see code for verbatim strings.

## 1. Context & Problem

Today the only one-click way to advance a report from stage 3 (`Pending_Approval`) to stage 4 (`Collecting_Docs`) on the PA card and the doc-manager is the primary **[Approve-and-send]** button (`pa-btn-approve`), which also fires the branded doc-request email. In practice, the office often communicates the doc list to a client out-of-band (WhatsApp, phone call) and wants to advance the stage **without** emailing. The existing workaround — using the DL-297 stage dropdown — is hidden and not adjacent to the primary CTA, so admins either send a duplicate email or leave the report stuck at stage 3.

## 2. User Requirements (Phase A)

1. **Q:** What should the new button do with email?
   **A:** Send no email at all — silent stage advance only.
2. **Q:** Where should it live?
   **A:** Sibling button right next to the primary approve-and-send button on both the PA card and the doc-manager sticky bar; in doc-manager, only when stage ≤ 3.
3. **Q:** Same side effects as the approve-and-send flow (e.g., `docs_first_sent_at`)?
   **A:** Stage change only — no side effects. Pure `ADMIN_CHANGE_STAGE` call.
4. **Q:** Confirmation UX?
   **A:** Single confirm dialog.
5. **Q:** UI/UX polish (user-specified after initial plan):
   **A:** Button label (Hebrew, as rendered): "Approve-without-sending". RTL reading order: `[Approve-and-send] → [Approve-without-sending] → [Ask-the-client]` (right to left). Must not feel confusing vs. the primary green approve button.

## 3. Research

### Domain
Admin UX — paired primary / secondary actions where the secondary is a variant of the primary with a suppressed side effect.

### Patterns Applied
- **Visual hierarchy (dominance + de-emphasis):** primary stays green-filled; secondary is outline. Same size, same icon scale.
- **Distinct iconography:** `send` vs `mail-off` — the "off" slash carries the no-email meaning at a glance.
- **Explicit confirm copy:** two-line dialog with ⚠ warning so the user knows they are opting out of the default (email) flow.
- **Non-green success toast:** info-blue rather than success-green — avoids the muscle-memory "green = email sent" misreading.
- **Silent stage transition already supported** (DL-267 auto-advance-zero-docs-to-review) — no new backend concept.

### Anti-Patterns Avoided
- Hiding the new action inside a kebab / overflow menu (low discoverability for a frequently-used action).
- Using a destructive-red button (this isn't destructive; admins might over-avoid it).
- Adding a `suppress_email=1` flag to `APPROVE_AND_SEND` (couples two concerns; `ADMIN_CHANGE_STAGE` already exists and is the clean separation).

### Research Verdict
Reuse the existing `ADMIN_CHANGE_STAGE` endpoint directly from the frontend. No backend changes, no flag proliferation.

## 4. Codebase Analysis

**Reuse decision:** reuse everything — endpoint, confirm helper, toast helper, card removal pattern, dashboard sync pattern.

| Artifact | File | Why reused |
|---|---|---|
| `ADMIN_CHANGE_STAGE` endpoint | `frontend/shared/endpoints.js:34` → `api/src/routes/stage.ts:17` | Already accepts `target_stage: 'Collecting_Docs'`; no backend work |
| `showConfirmDialog(msg, onConfirm, confirmText, danger)` | `script.js:9610`, `document-manager.js:2685` | Standard dialog across admin |
| `showAIToast(msg, type)` / `showToast(msg, type)` | `script.js` / `document-manager.js:193` | Info/danger variants available |
| PA card removal + dashboard sync | `approveAndSendFromQueue` (`script.js:7392`) | Mirrored exactly for visual consistency |
| `STAGE_ORDER` | `frontend/shared/constants.js:27` | Gates the doc-manager button on stage ≤ 3 |
| `updateStickyBar()` | `document-manager.js` near L3475 | Re-renders after stage change → button self-removes |

## 5. Technical Constraints & Risks

- **Security:** Uses the same `authToken` / `ADMIN_TOKEN` + `Bearer` header as the existing approve flow. No new auth surface.
- **Data integrity:** `ADMIN_CHANGE_STAGE` is idempotent per `api/src/routes/stage.ts`; validates `target_stage` against `VALID_STAGES` and updates the Airtable report row. No write-write race with approve-and-send (the card slides out and the report leaves the PA queue immediately).
- **Regression risk:** zero backend changes. Only two frontend hunks per file. Existing `approveAndSendFromQueue` / `approveAndSendToClient` unchanged.

## 6. Proposed Solution (Implemented)

### Success Criteria
Admin can one-click advance a stage-3 client to stage 4 without emailing, from either the PA queue card or the doc-manager sticky bar. The new button is visually secondary to the primary approve-and-send button and hides itself on doc-manager once stage ≥ 4.

### Files Changed

| File | Change |
|---|---|
| `frontend/admin/js/script.js` | PA card footer: inserted `pa-btn-advance` button between `pa-btn-questions` and `pa-btn-approve` (L5956). New handler `advanceToCollectingDocs(reportId, clientName)` at L7470 — mirrors `approveAndSendFromQueue` card-removal + dashboard-sync pattern, calls `ADMIN_CHANGE_STAGE`, info-blue toast |
| `frontend/assets/js/document-manager.js` | Sticky bar render (`updateStickyBar()`, L3475): new button gated by `(STAGE_ORDER[CURRENT_STAGE] \|\| 0) <= 3`. Handler `advanceToCollectingDocsFromDm()` at L2781 — calls `ADMIN_CHANGE_STAGE`, sets `CURRENT_STAGE = 'Collecting_Docs'` + re-runs `updateStickyBar()` so button self-removes |

No backend changes. No CSS changes (`.btn .btn-sm .btn-outline` already exists).

## 7. Validation Plan

Functional:
- [ ] PA queue: click the silent-advance button on a stage-3 client → confirm dialog appears → confirm → toast, card slides out, dashboard stage-3 count decrements, client row moves to stage 4 without refresh
- [ ] Verify NO email was sent: check Outlook Sent folder + `email_messages` Airtable table — zero new rows for that client
- [ ] Airtable report row: `stage` field = `Collecting_Docs`; `docs_first_sent_at` unchanged; `reminder_next_date` refreshed per DL-155 logic
- [ ] Doc-manager on a stage-3 client: silent-advance button visible next to the primary send-to-client button → click → confirm → stage advances → button disappears (now stage 4)
- [ ] Doc-manager on a stage-4+ client: button is NOT rendered
- [ ] Cancel confirm dialog → no state change, no network call
- [ ] Backend error path: temporarily block the endpoint → toast shows error, no stage change, no visual "sent" state

UX:
- [ ] Primary approve-and-send remains visually dominant (green fill); new button is clearly secondary (outline)
- [ ] Icons differ — `send` vs `mail-off` — readable at `icon-xs` size
- [ ] RTL reading order is exactly `[Approve-and-send] → [Approve-without-sending] → [Ask-the-client]` (right to left) on both PA card and doc-manager
- [ ] Confirm dialog body shows the ⚠ line on a separate visual row (not truncated)
- [ ] Success toast is blue/info, not green/success (no implied "email sent")
- [ ] Hover tooltip (`title=`) describes the no-email behavior

## 8. Implementation Notes (Post-Code)

- Both edits implemented in parallel via `/subagent-driven-development` wave (T1 script.js, T2 document-manager.js — disjoint files).
- PA card markup landed at `script.js:5956`; handler at `script.js:7470`.
- Doc-manager markup landed inside `updateStickyBar()` at `document-manager.js:3482` (conditional `silentBtn` template literal); handler at `document-manager.js:2781`.
- Doc-manager re-renders via `updateStickyBar()` call after `CURRENT_STAGE` flips — button self-removes without any manual DOM manipulation.
- Research principle applied: "distinct iconography for variant actions" (`send` vs `mail-off`) and "non-default side-effect success cues" (info toast, not success toast).
