# Design Log 396: Group Recent Messages by Client (Dashboard Side Panel)

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-03
**Related Logs:** DL-261 (panel), DL-289 (✓ + threads), DL-263 (hide), DL-272 (load more), DL-360 (doc-manager thread grouping)

## 1. Context & Problem

The dashboard side panel "הודעות אחרונות מלקוחות" lists each inbound email as its own `.msg-row`. When one client (e.g. [H:client-name] in the user's screenshots) writes multiple times — even days apart — they occupy multiple rows in the top-10, pushing other clients off-screen. DL-360 solved the equivalent shape problem in the doc-manager timeline by grouping by Outlook `conversationId`; here we group by `client_name` instead — one row per client, regardless of subject. Office should see "this client wrote — here's the latest, with N earlier", not three separate cards from the same person.

Current `renderMessages()` (`frontend/admin/js/script.js:1114-1169`) maps `_allMessages` 1:1 to `.msg-row`. Pagination (`_messagesVisible`, +10) counts **messages**, not clients.

## 2. User Requirements (Q&A)

1. **Q:** Group key — Outlook `conversation_id` or `client_name`?
   **A:** `client_name`. All messages from one client collapse into one row, regardless of subject.
2. **Q:** What does the collapsed (top-level) row show?
   **A:** Latest message preview (snippet/summary + relative time) + counter badge like "3 הודעות".
3. **Q:** Where do office replies sit inside a group?
   **A:** Under the message they replied to (unchanged — preserve current `m.replies[]` nesting per inbound).
4. **Q:** What does the ✓ "mark as handled" button do at the group level?
   **A:** No group-level ✓. Per-message ✓ inside the expanded view only.

## 3. Research

### Domain
Activity feed grouping; "stacked notification" UX (Gmail "by sender", iOS notification stacks).

### Sources Consulted
- **DL-360** — Outlook thread grouping in doc-manager timeline. Same bucket-then-render pattern; older rows behind a toggle. Reused conceptually.
- **DL-289** — established `replies[]` array per inbound and the per-message ✓. Preserved as-is inside groups.
- **DL-261/263/272** — original panel, soft-hide, load-more pagination. Pagination semantic changes from "messages" to "groups".

External research skipped — pattern is identical to DL-360 which already cited dashboard UX / progressive-disclosure sources, and the change is a frontend-only re-bucketing of an existing data shape.

### Key Principles Applied
- **Degrade gracefully:** Single-message group renders exactly as today (no counter, no toggle).
- **Preserve nested context:** Replies stay under their parent message — DL-289 invariant.
- **Pagination by group, not message:** "הצג עוד" reveals the next 10 *clients*, otherwise a chatty client never lets the panel reach anyone else.

### Anti-Patterns Avoided
- **Group-level ✓ that hides everyone in the bucket:** user explicitly rejected — too coarse.
- **Server-side grouping:** unnecessary. Payload is small. Frontend bucketing keeps the API shape stable.
- **Re-fetching after expand:** all messages already in `_allMessages`. Pure DOM toggle.

## 4. Codebase Analysis

### Reuse
- `_allMessages` (`script.js:999`) already holds the full sorted array.
- Existing `.msg-row` / `.msg-content` / `.msg-thread-replies` / `.msg-actions` CSS at `style.css:3188+` and `:3452+` — reused per nested message, untouched.
- `markMessageHandled()` (`script.js:1172`) and `deleteRecentMessage()` (`script.js:1177`) filter `_allMessages` by `id` and re-render — works unchanged because the bucket re-derives each render.
- `formatRelativeTime`, `escapeHtml`, `escapeAttr`, `icon()` helpers — reused.

### Files to Touch
| File | Action | Description |
|---|---|---|
| `frontend/admin/js/script.js` | Modify | `renderMessages()` — bucket by `client_name`, render group cards; pagination counts groups; degrade gracefully for size-1 groups; new `toggleGroup()`; new `_expandedClients` Set |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=400` → `v=401` |
| `frontend/admin/css/style.css` | Modify | Add `.msg-group`, `.msg-group-header`, `.msg-group-counter`, `.msg-group-older`, chevron rotation |

No backend change.

## 5. Constraints & Risks
- **Pagination semantic change** (`_messagesVisible` now = visible *group* count). Internal-only.
- **Hide animation scope:** fade-out targets `.msg-row[data-note-id="..."]` — still works on the nested per-message row inside the expanded group.
- **Expanded state preservation across re-renders:** track in `_expandedClients` Set keyed by `${client_name}|${client_id}`; re-apply on every render.
- **Sort order:** groups by `messages[0].date` desc (latest first by client).
- **Single-message group:** must not show counter or toggle (visually identical to today).
- **Client-name collisions:** composite key `${client_name}|${client_id||''}`.

## 6. Proposed Solution

Frontend-only `renderMessages()` rewrite. Bucket `_allMessages` by composite client key. Single-message groups render today's exact `.msg-row` markup (zero visual delta). Multi-message groups render a `.msg-group` wrapper with `.msg-group-header` (chevron + name + counter + latest snippet preview) and `.msg-group-older` containing every message (including the latest) using the today's `.msg-row` markup so all action buttons (reply, folder, ✓) stay reachable per message. `toggleGroup()` flips `.expanded` and updates `_expandedClients`. Pagination increments by 10 groups.

### Files Changed
| File | Action |
|---|---|
| `frontend/admin/js/script.js` | Modify `renderMessages()`; add `toggleGroup()`; add `_expandedClients` Set |
| `frontend/admin/index.html` | Bump cache-bust `v=400 → v=401` |
| `frontend/admin/css/style.css` | Add `.msg-group*` classes |

## 7. Validation Plan

- [ ] Client with 1 message: row renders identically to before (no counter, no toggle).
- [ ] Client with 2+ messages: shows ONE card, header shows chevron + client name + "N הודעות" counter + latest relative time + latest snippet preview.
- [ ] Click header → expands, shows ALL messages (latest + older) with full action buttons (reply, folder, ✓) per message.
- [ ] Office replies (DL-289 `replies[]`) appear nested under their parent inbound message inside the expanded view.
- [ ] Click ✓ on a message inside the expanded group → that message fades out; group stays expanded; counter decrements on re-render.
- [ ] Click ✓ on the LAST remaining message in a group → entire group disappears.
- [ ] Click ✓ on the only message in a 1-message (non-grouped) row → row disappears (existing behavior preserved).
- [ ] Pagination: "הצג עוד..." reveals 10 *more groups* (not 10 more messages).
- [ ] Groups sorted by latest message date descending — most recently active client at top.
- [ ] Search bar (DL-274): filters `_allMessages`; grouping recomputes; works identically.
- [ ] Reply modal (DL-289 expanded compose) opens from inside an expanded group.
- [ ] Verify with the [H:client-name] screenshots: two rows become one card, "2 הודעות" badge, 09:11 at top, "לפני 4 ימים" message visible under expand.
- [ ] Mobile (<900px): groups still readable; counter and chevron don't wrap awkwardly.
- [ ] No console errors; no orphan Lucide warnings; cache-bust v=401 reflected in DevTools.

## 8. Implementation Notes (Post-Code)

- **Row markup extracted** to `_renderMessageRowHtml(m)` so single-message groups (zero visual delta), expanded-group children, and DL-289 ✓/reply/folder action buttons all reuse the *same* HTML — no risk of drift between today's row and the new nested row.
- **Composite key `${client_name}|${client_id}`** used for bucketing and `_expandedClients` Set keying. Handles the rare case of two distinct CPAs sharing a `client_name`.
- **Sort guarantee:** `_allMessages` is already sorted newest-first by the backend (`dashboard.ts:250`), so encounter order makes `messages[0]` the latest. Added an explicit group sort by `messages[0].date` desc as belt-and-suspenders.
- **Expanded state survives re-render:** `_expandedClients` Set is module-scope; `markMessageHandled` → `deleteRecentMessage` → `renderMessages` flow no longer collapses the group the user is reading.
- **Pagination semantic flipped** — `_messagesVisible` now counts groups, not messages. Single producer (`renderMessages`) and the inline `onclick="_messagesVisible += 10"` updated together; no other consumer in the codebase.
- **DL-289 invariant preserved:** per-message ✓/reply/folder buttons live inside each `.msg-row` regardless of nesting depth. No group-level ✓ added (per user requirement Q4).
- **CSS:** `.msg-group-older` hidden by default, revealed via `.expanded` parent class. Chevron rotation 180deg on expand. Logical properties (`padding-inline-start`, `border-inline-start`) used throughout for RTL safety.
