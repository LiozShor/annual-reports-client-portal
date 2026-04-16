# Design Log 281: Queue View + Outlook as Source of Truth for Pending Deferred Sends
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-16
**Related Logs:** DL-264 (off-hours email queue), DL-266 (reply to client messages), DL-273 (Outlook deferred send)

## 1. Context & Problem

Follow-up to DL-273 (MS Graph deferred send replaced KV+cron). The deferred-send system works — emails arrive at 08:00 Israel — but the admin UI has two painful gaps:

1. **No visibility**: the dashboard shows a count `(N בתור לשליחה)` on the Pending Approval stat card, but Natan has no way to see *which* clients are in the queue.
2. **Stale count**: `queued_send_at` is set when Natan approves off-hours, but nothing clears it after Exchange delivers at 08:00 (Exchange has no callback). The count stays inflated all day, and rows that already moved to `Collecting_Docs` still appear "queued". Lioz observed this today at 08:00 — thought stage transitions failed. They didn't — the display is just misleading.

The fix: **query Outlook as the source of truth**. A message that's still in the Outbox with `PidTagDeferredSendTime` in the future is genuinely pending. A message that's no longer there has either delivered or been cancelled. No more staleness, no more guessing.

Scope: both deferred send types — **דרישת מסמכים** (approve-and-send) and **replies to client messages**.

## 2. User Requirements

1. **Q:** How should the admin open the queue view?
   **A:** Click the existing `(N בתור לשליחה)` subtitle on the Pending Approval stat card.
2. **Q:** Where should the list display?
   **A:** Modal overlay (existing `ai-modal-overlay` pattern).
3. **Q:** What info per row?
   **A:** Client name + filing type, queued-at timestamp, scheduled send time.
4. **Q:** Support cancelling a pending send?
   **A:** Read-only NOW, but add `graph_message_id` schema so follow-up can wire up cancel cheaply.
5. **Q:** How to handle stale rows?
   **A:** Hide rows already past send time — but ultimately solved by switching source of truth to Outlook (below).
6. **Q:** Entity scope?
   **A:** Match active entity tab (annual_report / capital_statement).
7. **Q:** Row sort order?
   **A:** Oldest queued-at first.
8. **Q:** Opening modal — refresh or cached data?
   **A:** Cached clientsData.
9. **Q:** (Mid-session pivot) Source of truth?
   **A:** Query Outlook Outbox directly, not Airtable. The DL-273 note "no way to query Outbox" turned out to be wrong.

## 3. Research

### Domain
MS Graph mail API; Exchange deferred delivery; source-of-truth dashboard patterns.

### Sources Consulted

1. **[MS Graph — List messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages)** — `/users/{mailbox}/mailFolders('Outbox')/messages?$expand=singleValueExtendedProperties($filter=id eq 'SystemTime 0x3FEF')` is the supported pattern. Extended-property *values* cannot be used in `$filter` (only `id`), so expand-then-filter-client-side.
2. **[MS Graph throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits)** — 10k req/10min per user per app; mailbox concurrency limit 4. One `GET Outbox` call per dashboard load (cached 60s) is ~0.01% of budget.
3. **DL-273 (internal)** — confirms `PidTagDeferredSendTime` = `SystemTime 0x3FEF`, Exchange holds in Outbox until deferredUtc. The note "no way to query Outbox via Graph" in §8 was incomplete — Graph supports it.

### Key Principles Extracted
- **Single source of truth wins**: trust Outlook for "is this still pending". Airtable's `queued_send_at` becomes a denormalised hint, not the authority.
- **One cheap call beats N expensive ones**: list the whole Outbox once per dashboard load, build a Set of message IDs, filter in memory. O(1) Graph cost regardless of queue size.
- **Self-healing over cron cleanup**: delivered/cancelled messages naturally drop out of the Outbox list — staleness resolves itself on next fetch.

### Patterns to Use
- **Expand-not-filter on extended properties**: fetch all Outbox messages with the property expanded, filter client-side by `value > now`.
- **Hybrid Airtable ID correlation**: store `graph_message_id` on the record (or note JSON) when queueing; join on dashboard load.
- **Short-TTL KV cache**: 60s TTL on the Outbox query eliminates per-page-load Graph calls without serving meaningfully stale data.

### Anti-Patterns Avoided
- **Per-record `GET /messages/{id}`**: O(N) Graph calls on every dashboard load — throttling risk with 10+ queued.
- **Match by to-address/subject**: ambiguous for clients with multiple filings or similar subjects.
- **Background cleanup cron for staleness**: DL-273 deliberately removed cron; don't bring it back.

### Research Verdict
Use Outlook as source of truth via `listOutboxDeferred()`. Store `graph_message_id` when queueing (field on `annual_reports` for doc-request; key on note JSON for replies). New `/admin-queued-emails` route joins Outbox list with Airtable. Frontend subtitle + modal both consume this endpoint.

## 4. Codebase Analysis

### Existing Solutions Found
- **`api/src/lib/ms-graph.ts`** — has `sendMailDeferred()` (line 243) and `replyToMessageDeferred()` (line 271). Both currently return `void` but obtain `draft.id` internally (lines 263, 292) that we'll surface.
- **`api/src/lib/cache.ts`** — `invalidateCache()` + `CACHE_KV` KV namespace — ready for 60s Outbox cache.
- **`api/src/lib/israel-time.ts`** — `getNext0800Israel()` and `isOffHours()` already exist.
- **`.ai-modal-overlay` pattern** — 92 uses in `frontend/admin/js/script.js`. Standard admin modal.

### Reuse Decision
Extend existing methods (return type change), add one new method (`listOutboxDeferred`), one new route, one new frontend modal. No new libraries.

### Relevant Files
- `api/src/lib/ms-graph.ts` — add `listOutboxDeferred`; change return types of the two deferred methods.
- `api/src/routes/approve-and-send.ts` (line 188 → 215) — persist `messageId` in the Airtable update.
- `api/src/routes/dashboard.ts` (line 341, 348) — persist `messageId` on the reply note JSON entry; also add new route.
- `frontend/admin/js/script.js` (line 1588-1606) — API-backed count; clickable subtitle; `renderQueuedEmailsModal`.
- `frontend/admin/css/style.css` — cursor on `.queued-subtitle`.

### Existing Patterns
- Routes: Hono-style `dashboard.post/get('/path', async (c) => ...)`.
- Token verification: `verifyToken(token, c.env.SECRET_KEY)` guarded behind `Authorization: Bearer`.
- Airtable reads: `AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT)` → `getRecord`/`updateRecord`.

### Alignment with Research
Codebase already has the two-step draft→send pattern. We just surface the `messageId`. No divergence.

### Dependencies
- Airtable `annual_reports` table — new field `graph_message_id` (single-line text, nullable).
- Airtable PAT scope already has `schema.bases:write` (per memory).

## 5. Technical Constraints & Risks

- **Risk A — Outbox folder behavior**: must empirically verify deferred messages sit in `Outbox` (not `Drafts`). DL-273 assumed Outbox. Mitigation: first validation test.
- **Risk B — 08:00 race**: Exchange moves Outbox → SentItems at scheduled time. A dashboard load in the 1-second delivery window could see stale state. Mitigation: 60s cache, the exact moment is when "still pending" → "just delivered" is genuinely ambiguous; acceptable.
- **Risk C — Legacy queued records**: pre-DL-281 records have `queued_send_at` but no `graph_message_id`. Mitigation: fallback to old client-side `queued_send_at` filter for those, gated on "scheduled time in the future".
- **Security**: no new auth surfaces. Same Graph app creds, same admin-auth `verifyToken`.
- **Breaking changes**: `sendMailDeferred` + `replyToMessageDeferred` signature: `Promise<void>` → `Promise<{ messageId: string }>`. Only 3 call sites; updated in same PR.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Clicking `(N בתור לשליחה)` opens a modal listing clients whose deferred emails are *actually* still in the Outlook Outbox. The count + modal both filter by real Outbox presence, not by stale `queued_send_at`. Supports both דרישת מסמכים and reply emails.

### Logic Flow

**On queue (approve-and-send, off-hours):**
1. `graph.sendMailDeferred(...)` → returns `{ messageId }`
2. Airtable update includes `graph_message_id: messageId` alongside existing `queued_send_at`

**On queue (reply, off-hours):**
1. `graph.replyToMessageDeferred(...)` → `{ messageId }` (or fallback `sendMailDeferred` → `{ messageId }`)
2. Append `graph_message_id` key to the new note JSON entry before persisting to Airtable

**Dashboard load:**
1. Client calls `GET /api/admin/queued-emails?filing_type=annual_report`
2. Server: fetch Outbox (`listOutboxDeferred`, 60s cached) → build Set of message IDs with `deferredUtc > now`
3. Server: list active reports + scan `client_notes` JSON → filter to those whose `graph_message_id` is in the Set
4. Server: shape + sort by `queued_at` ascending → return
5. Client: set count subtitle length; bind click to open modal

### Data Structures / Schema Changes

**Airtable `annual_reports` (new field):**
- `graph_message_id` — single-line text, nullable. Stores Outlook message ID for the most recently queued approve-and-send email.

**`client_notes` JSON entry (existing field, new key):**
```json
{ "id": "reply_...", "date": "...", "summary": "...",
  "source": "manual", "type": "office_reply",
  "reply_to": "...",
  "graph_message_id": "AAMkAD..."  // NEW — only when queued
}
```

**API response shape:**
```json
{
  "ok": true,
  "queued": [
    {
      "report_id": "rec...",
      "client_name": "חברה ...",
      "filing_type": "annual_report",
      "type": "doc_request" | "reply",
      "queued_at": "2026-04-15T22:14:00Z",
      "scheduled_for": "2026-04-16T05:00:00Z",
      "graph_message_id": "AAMkAD..."
    }
  ]
}
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/ms-graph.ts` | Modify | Return `{messageId}` from `sendMailDeferred` + `replyToMessageDeferred`; add `listOutboxDeferred(mailbox)` |
| `api/src/routes/approve-and-send.ts` | Modify | Persist `messageId` into `graph_message_id` field on the Airtable update |
| `api/src/routes/dashboard.ts` | Modify | Persist `messageId` on reply note JSON entry; add new `GET /admin-queued-emails` route |
| `frontend/admin/js/script.js` | Modify | Clickable subtitle with keyboard a11y; `renderQueuedEmailsModal()`; replace `queued_send_at` filter with API-backed list |
| `frontend/admin/css/style.css` | Modify | `cursor: pointer` + hover underline on `.queued-subtitle` |
| Airtable (manual) | Add field | `graph_message_id` text on `annual_reports` |

### Final Step (Always)
* **Housekeeping:** status → `[IMPLEMENTED — NEED TESTING]`, INDEX entry, current-status.md update, architecture diagram update, commit, merge to main.

## 7. Validation Plan

- [ ] **Graph capability check**: approve off-hours message in staging → `curl GET /users/reports@.../mailFolders/outbox/messages?$expand=...` → verify message appears with `singleValueExtendedProperties[0].value` = scheduled UTC
- [ ] **approve-and-send**: off-hours approval writes `graph_message_id` on the report record
- [ ] **reply (threaded)**: off-hours reply writes `graph_message_id` into the note JSON entry
- [ ] **reply (non-threaded fallback)**: same as above via `sendMailDeferred` path
- [ ] **`GET /admin-queued-emails`**: returns correct list sorted by `queued_at` ascending, filtered by filing_type
- [ ] **Subtitle click**: opens modal with identical list as count
- [ ] **08:00 delivery**: next dashboard load after delivery shows count=0 / hides subtitle / empty modal for delivered items
- [ ] **Legacy fallback**: pre-DL-281 records with `queued_send_at` + no `graph_message_id` show only if computed send time is in the future
- [ ] **Manual Outbox deletion**: delete a queued message from Outlook directly → next dashboard load shows it removed from queue view
- [ ] **Throttling**: 60s cache — 20 rapid dashboard loads = 1 Graph call
- [ ] **Business hours**: business-hours sends don't pollute `graph_message_id` (should be null or immediately cleared)
- [ ] **No regression**: toast + locked-button UX on doc-manager page unchanged

## 8. Implementation Notes (Post-Code)

- **Airtable field added via Meta API** — `graph_message_id` (singleLineText, id `fldVd7760NGefZeIw`) on `annual_reports` table.
- **Legacy fallback kept simple** — for pre-DL-281 records with `queued_send_at` but no `graph_message_id`, we use a 12-hour-window heuristic instead of computing exact 08:00 Israel boundary. These rows die out once they cycle through a daytime approval, so the heuristic only matters for records in flight during the rollout.
- **Reply path does 2 writes in off-hours flow** — note saved first (preserves on email failure), then stamped with `graph_message_id` after successful deferred send. Small cost, acceptable.
- **Frontend degrades gracefully** — if `/admin-queued-emails` fails, `queuedEmailsData` stays empty, and the count subtitle falls back to the legacy `clientsData.filter(...)` path. Modal still opens (will show "no items" if the fetch silently failed).
- **Architecture diagrams NOT updated** — `docs/architecture/` is gitignored in this repo, so diagrams aren't tracked. If diagrams are maintained locally, add `GET /admin-queued-emails` to `email-generation-flow.mmd`.
- **Type-check clean** — only 2 pre-existing errors (backfill.ts ADMIN_SECRET, classifications.ts pageCount) unrelated to this change.

---

## Out of Scope (Deferred)

- **Cancel/edit a queued send** — schema foundation (`graph_message_id`) is laid; follow-up DL will add DELETE endpoint + confirm dialog.
- **Reschedule** — same reasoning.
- **Cleanup cron for stale `queued_send_at`** — unnecessary; Outlook is now the source of truth.
