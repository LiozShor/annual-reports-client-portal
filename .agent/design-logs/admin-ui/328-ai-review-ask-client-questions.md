# DL-328: AI Review — Ask Client Questions About Reviewed Batch

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-22
**Domain:** admin-ui
**Branch:** DL-328-ai-review-ask-client-questions

---

## 1. Problem

After reviewing a client's AI-classified inbound documents, office staff often need to ask clarifying questions about specific files (e.g., "Is this the 2024 or 2025 statement?", "Which property does this contract cover?"). No in-app mechanism existed — staff resorted to phone calls or ad-hoc emails with no audit trail.

## 2. Solution

New "שאל את הלקוח" button appears next to "סיום בדיקה" once all docs in the client batch are reviewed. Clicking opens a compose dialog for per-file questions → preview → send standalone email → audit trail in `client_notes`.

## 3. Key Design Decisions

- **Standalone email** — NOT reusing `client_questions` Airtable field (DL-110 path) to avoid re-sending these questions in next Approve & Send.
- **Per-file binding** — each question card binds to a specific reviewed file (dropdown of batch items).
- **Stage unchanged** — sending questions does NOT advance stage; "סיום בדיקה" advances separately.
- **Preview** — reuses `email-preview-modal.js` with new `extraPayload` param for POST-based preview.
- **Audit** — snapshot persisted in `client_notes` as `{type:'batch_questions_sent', date, items, language}`.
- **Session-scoped hide** — button hidden after send via `_batchQuestionsSentClients` Set (no Airtable field needed).

## 4. Files Changed

| File | Change |
|------|--------|
| `api/src/routes/send-batch-questions.ts` | New POST endpoint |
| `api/src/index.ts` | Register new route |
| `api/src/lib/email-html.ts` | Added `buildBatchQuestionsSubject`, `buildBatchQuestionsHtml`, `BatchQuestionItem` |
| `frontend/shared/email-preview-modal.js` | Added optional `extraPayload` param (POST mode) |
| `frontend/admin/js/script.js` | New button in `showClientReviewDonePrompt`; new `openBatchQuestionsModal`; `_batchQuestionsSentClients` Set |
| `frontend/shared/endpoints.js` | Added `SEND_BATCH_QUESTIONS` endpoint |
| `frontend/admin/index.html` | Bumped `script.js?v=` |

## 5. Data Flow

```
Office reviews all docs in AI Review tab
→ showClientReviewDonePrompt() renders "שאל את הלקוח" button
→ openBatchQuestionsModal() opens compose modal
→ Office fills per-file questions
→ Preview (optional): POST /send-batch-questions?preview=true → returns {subject, html}
→ Send: POST /send-batch-questions → graph.sendMail() + append to client_notes
→ Toast "השאלות נשלחו ללקוח" + button hidden for this session
```

## 6. Email Format

- Subject (HE): `שאלות לגבי המסמכים שהעברת — {client_name}`
- Subject (EN): `Questions about the documents you sent — {client_name}`
- Per-file card: document name + question text
- Reply channel: plain email reply → existing inbound pipeline captures it

## 7. Validation Checklist

- [ ] Button appears only when `totalPending === 0` for client batch
- [ ] Button hides after successful send (session-scoped)
- [ ] "+ הוסף שאלה" / remove buttons work; numbering auto-renumbers
- [ ] Empty submit blocked (requires ≥1 non-empty question)
- [ ] Preview renders identical HTML to actual send
- [ ] Hebrew client receives RTL email with correct question cards
- [ ] English client receives LTR English email
- [ ] `client_notes` shows `batch_questions_sent` entry with correct items
- [ ] No regression: Approve & Send still works, DL-110 `client_questions` unaffected
- [ ] DL-308 preview modal still works for Approve & Send (helper still handles GET mode)
- [ ] Double-click Send doesn't double-fire (button disabled on submit)
- [ ] `wrangler deploy` succeeds; no startup errors
