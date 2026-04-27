# Design Log 360: Group Doc-Manager Client-Notes by Outlook Conversation
**Status:** [BEING IMPLEMENTED — DL-360]
**Date:** 2026-04-27
**Related Logs:** DL-266 (office reply threading), DL-337 (raw text over AI summary), DL-267 (backfill-note-sender pattern)

## 1. Context & Problem
The doc-manager.html client-notes timeline renders every inbound email as its own card.
In practice, a client email thread (one Outlook שרשור) produces multiple cards — one per
message — stacking vertically and obscuring the conversation's shape.

The goal: one card per Outlook conversation, latest message visible, older messages
collapsed behind a "▸ הצג N הודעות קודמות בשרשור" toggle. Office replies (DL-266) stay
threaded inline under the message they originally replied to.

Doc-Manager was previously carved out of DL-337 (raw text) as an explicit exception.
In this same session, that exception was reverted — doc-manager now shows raw_snippet too.

## 2. User Requirements
1. **Q:** How to detect thread membership?
   **A:** Outlook `conversationId` from MS Graph. Must be persisted (not currently stored).
2. **Q:** Render style?
   **A:** Single card, collapsed replies — latest visible, older behind a toggle.
3. **Q:** Message order within thread?
   **A:** Newest first (top).
4. **Q:** Thread date in timeline?
   **A:** Latest message date.
5. **Q:** Backfill strategy?
   **A:** Both going-forward (processor change) AND historical (one-shot backfill endpoint).

## 3. Research
### Domain
UX — conversation grouping patterns; email timeline design.

### Sources Consulted
1. **DL-266** — established `reply_to` field linking office_reply → parent note. Reused directly.
2. **DL-337** — raw_snippet fallback pattern (raw_snippet || summary). Already applied this session.
3. **DL-267 / DL-315** — backfill endpoint pattern in `api/src/routes/backfill.ts` (Bearer auth, dryRun param, Airtable loop). Followed verbatim.

### Key Principles Applied
- **Degrade gracefully:** Notes without `conversation_id` (pre-backfill) render as standalone cards — no data loss.
- **Thread has 1 message → no visual change:** Don't add a toggle for a thread with one message.
- **Office replies follow the message they reply to**, not the thread's latest message.

### Research Verdict
Frontend-only grouping plus a one-field backend addition. No schema change, no new Airtable field, no new helper functions — reuse existing patterns.

## 4. Codebase Analysis
- **Thread detection field NOT persisted today:** `api/src/lib/inbound/processor.ts:700` $select lacks `conversationId`. Note literal (lines 407-415) has no `conversation_id`.
- **Office reply linkage:** `reply_to` field (document-manager.js:3241-3242 `replyMap`).
- **Collapse pattern available:** `.cn-snippet` uses `max-height` + transition (document-manager.css ~line 2142). Reused for `.cn-thread-older`.
- **No existing versioning on document-manager.js** — hard reload is sufficient (no `?v=` in document-manager.html:569).
- **Backfill pattern:** `api/src/routes/backfill.ts` — two existing endpoints; third endpoint added here following exact same pattern.

### Relevant Files
| File | Role |
|------|------|
| `api/src/lib/inbound/processor.ts:699-415` | MS Graph fetch + note literal |
| `api/src/routes/dashboard.ts:311-319` | office_reply note creation |
| `api/src/routes/backfill.ts` | Backfill endpoint home |
| `api/src/index.ts:75` | Route mounting |
| `frontend/assets/js/document-manager.js:3240-3360` | `renderClientNotes` |
| `frontend/assets/css/document-manager.css:~2142` | Collapse/expand CSS pattern |

## 5. Technical Constraints & Risks
- **Legacy notes:** no `conversation_id` → render standalone. No regression.
- **Thread with 1 message:** renders exactly as before (no toggle).
- **Graph lookup during backfill:** one API call per note; throttle between Reports rows.
- **Office replies in older messages:** replyMap must be consulted per-message within the thread, not just for the latest.
- **conversationId missing for some Graph messages:** falls through to standalone.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
The three client@example.com messages from the screenshot appear as one card with a "▸ הצג 2 הודעות קודמות בשרשור" toggle after running the backfill endpoint.

### Logic Flow
1. `processor.ts`: add `conversationId` to `$select`, add `conversation_id` to note entry.
2. `dashboard.ts`: office_reply inherits `conversation_id` from parent.
3. `backfill.ts`: new endpoint `/webhook/backfill-conversation-ids` — fetches `conversationId` from Graph for each historical note missing it, patches office_replies from their parent.
4. `document-manager.js` `renderClientNotes`: pre-pass buckets notes by `conversation_id`; sorts threads newest-first; renders one card per thread; adds toggle for `older` messages.
5. CSS: `.cn-thread-toggle`, `.cn-thread-older` styles.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/processor.ts` | Modify | `conversationId` in $select + note literal |
| `api/src/routes/dashboard.ts` | Modify | office_reply inherits `conversation_id` |
| `api/src/routes/backfill.ts` | Modify | New backfill endpoint |
| `api/src/index.ts` | Modify | Mount backfill route (1 line) |
| `frontend/assets/js/document-manager.js` | Modify | Thread grouping + toggle |
| `frontend/assets/css/document-manager.css` | Modify | Toggle + collapse CSS |

### Final Step
- Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, INDEX updated, current-status updated, commit + push feature branch, deploy Worker.

## 7. Validation Plan
- [ ] New email arrives → check `client_notes` JSON in Airtable includes `conversation_id`.
- [ ] Run `POST /webhook/backfill-conversation-ids?dryRun=1` → reasonable counts returned.
- [ ] Run without `dryRun` → notes backfilled; reload doc-manager → thread grouped.
- [ ] client@example.com thread (screenshot client) shows one card with "▸ הצג 2 הודעות קודמות בשרשור".
- [ ] Toggle expands/collapses older messages correctly.
- [ ] Office replies stay attached to the message they replied to (not floated to latest).
- [ ] Manual note (no conversation_id) still renders as standalone card.
- [ ] No regression on Dashboard Recent Messages or AI Review tab (they don't use conversation_id).

## 8. Implementation Notes (Post-Code)
- Applied backfill-note-sender pattern verbatim (Bearer + dryRun).
- `conversation_id` snake_case on note (JS/JSON convention); `conversationId` camelCase in Graph response.
