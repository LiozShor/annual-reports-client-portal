# Design Log 335: AI Review — On-Hold State for Docs Awaiting Client Reply
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-23
**Domain:** ai-review, admin-ui
**Branch:** DL-335-ai-review-on-hold-docs
**Related Logs:** DL-328 (batch questions feature), DL-333 (off-hours queue), DL-289 (per-client reply threading), DL-266 (reply-to-client messages)

---

## 1. Context & Problem

DL-328 added the "שאל את הלקוח" per-doc batch-questions feature. After questions are sent, `סיים בדיקה ושליחת שאלות` called `dismissClientReview` which deleted **all** the client's `pending_classifications` rows — including the ones that still had an unanswered `pending_question`. Those docs were effectively archived before the client replied.

New required behavior (boss request):
1. Docs with a `pending_question` must **stay in AI Review** in a "waiting for answer" hold state.
2. `סיים בדיקה ושליחת שאלות` should only dismiss docs **without** a `pending_question`.
3. The outgoing batch-questions email body should surface in the client's per-client messages timeline (הודעות הלקוח).
4. Office manually resolves held docs after the client replies (no auto-release).

## 2. User Requirements

| Q | A |
|---|---|
| Hold state data model | `pending_classifications` row kept; new `review_status='on_hold'` |
| Message destination | Per-client timeline only (DL-258 / `renderClientNotes`), NOT dashboard panel |
| Reply handling | Manual resolve — office clicks "סיים המתנה — טפל במסמך" on held card |
| Held card UX | Amber `ממתין ללקוח` badge + question text visible; actions behind one "resolve" button |
| Resolved docs on dismiss | Current behavior — delete rows without `pending_question` |
| Scope | New DL on fresh branch (DL-333 already `[IMPLEMENTED — NEED TESTING]`) |

## 3. Research

**Domain:** Ticketing UX — "Waiting on Customer" status pattern (Freshdesk/Freshservice).

**Key Principles Applied:**
- Distinct `on_hold` status that visually pauses from normal review flow (amber, not green/red).
- Single combined action (send + set status) to avoid 2-click friction — existing button kept.
- Don't block re-action: held card has a "resolve" button → restores standard action row (DL-086 `startReReview`).

## 4. Codebase Analysis

- `pending_classifications.review_status` is a free-text field — no schema change needed.
- `/get-pending-classifications` filter: `AND({notification_status} = '', {review_status} != 'splitting')` — `on_hold` rows ARE returned. No change.
- `renderAICard` routes `review_status !== 'pending'` → `renderReviewedCard`. Extended to early-return to `renderOnHoldCard` for `on_hold`.
- `dismissClientReview` refactored to accept `{ keepOnHold }` option.
- `renderClientNotes` in `document-manager.js` extended with a `batch_questions_sent` branch (rendered as amber outbound card with per-file question list).

## 5. Technical Constraints & Risks

- **DL-281 queue modal:** entry shape extended with new fields (`id`, `summary`, `source`) — `items[]`, `language`, `graph_message_id`, `queued` all preserved. No regression.
- **DL-333 off-hours queue:** still active; `queued: true` in entry shape kept.
- **`hasPendingQuestions` gate:** updated to check `pending_question && review_status !== 'on_hold'` so re-loading the page doesn't re-show the send button for already-held items.
- **Old `batch_questions_sent` entries** (before DL-335) stored in Airtable without `id`/`summary` fields — new renderer uses `entry.id || ''` and `entry.summary || ''` gracefully.

## 6. Proposed Solution

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/send-batch-questions.ts` | Modified | `review_status: 'on_hold'` instead of `pending_question: null`; extend `client_notes` entry with `id`, `summary`, `source`; return `held_count` |
| `frontend/admin/js/script.js` | Modified | `renderReviewedCard` → early return to `renderOnHoldCard`; new `renderOnHoldCard` fn; `showClientReviewDonePrompt` stats + hasPendingQuestions guard; `dismissAndSendQuestions` flip local state + `keepOnHold`; `dismissClientReview` with keepOnHold filter |
| `frontend/admin/css/style.css` | Modified | `.lozenge-on-hold`, `.reviewed-on-hold`, `.ai-held-question`, `.badge-warning` |
| `frontend/assets/js/document-manager.js` | Modified | `renderClientNotes` — new `batch_questions_sent` branch |
| `frontend/assets/css/document-manager.css` | Modified | `.cn-icon--office-question`, `.cn-entry--outbound`, `.cn-bq-items` |
| `frontend/admin/index.html` | Modified | `script.js?v=298→299` |

## 7. Validation Plan

- [ ] Ask 3 questions on 3 docs + approve 2 + reject 1 (6 total); click `סיים בדיקה ושליחת שאלות`; verify: 3 gone, 3 remain with amber "ממתין ללקוח" badge + question text visible.
- [ ] Verify `batch_questions_sent` entry renders in per-client timeline (doc-manager) as amber outbound card with per-file bullet list.
- [ ] Verify no `batch_questions_sent` entry appears in dashboard Recent Messages panel.
- [ ] Client replies by email; inbound pipeline captures it; reply shows in per-client timeline below the outbound questions entry.
- [ ] Click "סיים המתנה — טפל במסמך" on held card → standard approve/reject/reassign row appears → approve works → row deleted from `pending_classifications`.
- [ ] Refresh AI Review tab — held cards still present with `on_hold` status.
- [ ] DL-281 queue modal still renders `שאלות לאחר סקירה` rows correctly.
- [ ] DL-333 off-hours queue: deferred send still works; toast shows "נשלח לבוקר".
- [ ] Client with zero `pending_question` items — no hold state, behavior identical to before.
- [ ] Client with 100% `pending_question` items — all on_hold; accordion shows only held cards.
- [ ] `wrangler deploy` succeeds; no startup errors.

## 8. Implementation Notes

- Decided NOT to re-render the full accordion via `renderAICards` after keepOnHold path — instead, DOM surgery: remove non-held cards, remove done-prompt, update stats badge. Simpler and avoids full re-render flicker.
- `renderOnHoldCard` does NOT show the contract-period request buttons (T901/T902) — they're not relevant until the question is answered and the doc is resolved.
- `renderOnHoldCard` does NOT show the "also match" or overflow menu — office should resolve the pending question first, then act on the doc via `startReReview`.
