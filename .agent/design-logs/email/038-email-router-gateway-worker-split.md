# Design Log 038: Email Router — Gateway + Worker Split
**Status:** [DEPRECATED] — User decided not to implement (2026-02-19)
**Date:** 2026-02-18
**Related Logs:** 034 (Phase 2 inbound processing), 035 (WF05 AI classification), 036 (AI review interface)

## 1. Context & Problem

WF05 currently has two jobs: (a) receiving and triaging incoming emails from MS Graph, and (b) classifying documents + uploading to OneDrive. This violates single responsibility and makes it hard to extend email routing.

Additionally, session 18 added 3 fire-and-forget nodes to WF02 (Wait for Delivery → Search Sent Notification → Move to Questionnaires Folder) to auto-move office notification emails into an Outlook folder. These nodes are broken:
- **Search Sent Notification** fails with 400 InefficientFilter (OData filter too complex for Graph)
- **Move to Questionnaires Folder** fails with 405 (no message ID because search failed)
- The approach is inherently fragile (timing-dependent search for a just-sent email)

**Better approach:** A dedicated Email Router workflow that receives ALL incoming emails and routes them — system notifications go to the right folder, client documents get forwarded to WF05 for processing.

## 2. User Requirements (The 5 Questions)

1. **Q:** WF02 sends questionnaire notifications, WF04 sends edit confirmations. Should the router handle both?
   **A:** Yes — any self-sent email is a system notification. All go to `שאלונים שהתקבלו` for now. Can add per-type folders later.

2. **Q:** How to identify system emails? Is `reports@moshe-atsits.co.il` a dedicated system-only address?
   **A:** Yes — any email FROM this address is system-generated. No clients send from it.

3. **Q:** MS Graph subscription — update existing or create new?
   **A:** Update existing [05-SUB] subscription manager to point to the new router webhook URL.

4. **Q:** WF05 trigger — Execute Workflow (synchronous) or Webhook call (async)?
   **A:** Execute Workflow (sub-workflow). Cleaner data passing, and the Graph notification is already acknowledged before the router reaches WF05.

5. **Q:** WF02's "Respond OK" node sits at the end of a 43s chain, causing timeouts. Fix as part of this?
   **A:** Yes — move Respond OK right after the Webhook trigger in WF02.

## 3. Technical Constraints & Risks

### Dependencies
- **MS Graph subscription** — currently points to WF05's webhook. Must update to router.
- **[05-SUB] Email Subscription Manager** (`qCNsXnAE06jAZOMe`) — manages subscription renewal. Needs webhook URL update.
- **MS Graph credential** (`GcLQZwzH2xj41sV7`) — needs `Mail.ReadWrite` scope for move operations.

### Risks
| Risk | Mitigation |
|------|-----------|
| Subscription URL swap causes gap | Update subscription during low-traffic period. Verify with test email immediately after. |
| Self-sent detection too broad | Only emails where `from == reports@moshe-atsits.co.il`. Auto-replies from this address are already filtered by subject pattern. |
| Execute Workflow keeps router execution open | Acceptable — Graph 202 already sent. Router execution just shows longer duration cosmetically. |
| Existing WF05 test executions reference old webhook | WF05 webhook node will be removed; old URLs return 404. No impact on production. |

## 4. Proposed Solution (The Blueprint)

### Architecture Overview

```
MS Graph Subscription (inbox notifications)
        ↓
[05-ROUTER] Email Router (NEW workflow)
  │  Webhook ← receives Graph push
  │  Check Validation ← Graph subscription handshake (moved from WF05)
  │  Extract Notification ← parse message ID (moved from WF05)
  │  Respond 202 ← acknowledge fast (moved from WF05)
  │  Fetch Email by ID ← get full email (moved from WF05)
  │  Route Email (Code node) ← NEW: triage logic
  │     │
  │     ├── SYSTEM (from == reports@moshe-atsits.co.il)
  │     │     → Move to שאלונים שהתקבלו folder → DONE
  │     │
  │     ├── AUTO-REPLY / BOUNCE (subject pattern match)
  │     │     → DONE (ignore)
  │     │
  │     ├── NO ATTACHMENTS (client email, no docs)
  │     │     → DONE (ignore)
  │     │
  │     └── CLIENT WITH ATTACHMENTS
  │           → Execute Workflow → WF05
  │                                  ↓
[05] Inbound Document Processing (MODIFIED — now a sub-workflow)
  │  Workflow Trigger (replaces Webhook)
  │  Get Attachments ← from email_id passed by router
  │  Process & Filter Attachments
  │  Mark as Read
  │  Create Email Event
  │  Search Client by Email
  │  ... (rest of pipeline unchanged)
  │  Move to מסמכים שהתקבלו ← stays here (tied to processing completion)
```

### Node-by-Node Changes

#### NEW: [05-ROUTER] Email Router
| # | Node | Type | Source |
|---|------|------|--------|
| 1 | Email Notification | Webhook | Moved from WF05 (same path/method) |
| 2 | Check Validation | IF | Moved from WF05 |
| 3 | Respond Validation | Respond to Webhook | Moved from WF05 |
| 4 | Extract Notification | Code | Moved from WF05 |
| 5 | Respond 202 | Respond to Webhook | Moved from WF05 |
| 6 | Fetch Email by ID | HTTP Request | Moved from WF05 |
| 7 | Route Email | Code | **NEW** — triage logic |
| 8 | Move to System Folder | HTTP Request | **NEW** — POST /messages/{id}/move |
| 9 | Call WF05 | Execute Workflow | **NEW** — passes email data to WF05 |

**Route Email logic (Code node):**
```javascript
const email = $input.first().json;
const subject = (email.subject || '').toLowerCase();
const from = (email.from?.emailAddress?.address || '').toLowerCase();
const SYSTEM_EMAIL = 'reports@moshe-atsits.co.il';

// Auto-reply / bounce detection
const isAutoReply = /automatic reply|out of office|תשובה אוטומטית|undeliverable|delivery.status/i.test(subject);
if (isAutoReply) {
  return []; // ignore
}

// System notification (self-sent)
if (from === SYSTEM_EMAIL) {
  return [{ json: { ...email, _route: 'system' } }];
}

// Client email without attachments
if (!email.hasAttachments) {
  return []; // ignore
}

// Client email with attachments → forward to WF05
return [{ json: { ...email, _route: 'client_docs' } }];
```

Then an IF node routes by `_route`:
- `system` → Move to System Folder
- `client_docs` → Call WF05

#### MODIFIED: [05] WF05 — Inbound Document Processing
**Remove these nodes (moved to router):**
- Email Notification (Webhook)
- Check Validation (IF)
- Respond Validation (Respond to Webhook)
- Extract Notification (Code)
- Respond 202 (Respond to Webhook)
- Fetch Email by ID (HTTP Request)
- Extract Email (Code) — routing logic now in router

**Add:**
- Workflow Trigger (replaces Webhook — receives email data from router)

**Keep unchanged (from Get Attachments onward):**
- Get Attachments, Process & Filter Attachments, Mark as Read
- Create Email Event, Search Client by Email, Get Active Report, Get Required Docs
- Resolve OneDrive Root, Prepare Attachments, Classify Document
- Process and Prepare Upload, Upload to OneDrive, Prep Doc Update
- Create Pending Classification, Route by Match, IF Has Match
- Update Document Record, Update Email Event, Move to Documents Folder

**WF05 input data (from router via Execute Workflow):**
```json
{
  "email_id": "AAMkAG...",
  "sender_email": "client@example.com",
  "sender_name": "John Doe",
  "subject": "Documents for tax season",
  "body_preview": "...",
  "received_at": "2026-02-18T10:30:00Z",
  "internet_message_id": "<...>"
}
```

#### MODIFIED: [02] WF02 — Questionnaire Response Processing
**Remove these nodes (broken, replaced by router):**
- Wait for Delivery (Wait 5s)
- Search Sent Notification (HTTP Request — 400 InefficientFilter)
- Move to Questionnaires Folder (HTTP Request — 405)

**Remove connection:**
- MS Graph - Send Email → Wait for Delivery

**Fix:**
- Move "Respond OK" right after "Webhook" node (currently at end of 43s chain, causing timeout)

#### MODIFIED: [05-SUB] Email Subscription Manager
- Update `notificationUrl` to the new router webhook URL
- Keep everything else unchanged (renewal interval, clientState, resource filter)

### Folder IDs (from session 18)
- `שאלונים שהתקבלו` = `AAMkAGNlNTUzYjFhLThiNjItNDVkNy04ZDg4LTk5ZGFmY2Q3Mjk4OQAuAAAAAABkJX1h1wKBRYTdkpeLuY7IAQCvdIGqh9POR5eOxKWAcHHiAAAmsyM4AAA=`
- `מסמכים שהתקבלו` = `AAMkAGNlNTUzYjFhLThiNjItNDVkNy04ZDg4LTk5ZGFmY2Q3Mjk4OQAuAAAAAABkJX1h1wKBRYTdkpeLuY7IAQCvdIGqh9POR5eOxKWAcHHiAAAmsyM3AAA=`

## 5. Validation Plan

- [ ] **Test 1 — System email routing:** Submit a Tally form → WF02 sends notification → router detects self-sent → moves to שאלונים שהתקבלו
- [ ] **Test 2 — Client document routing:** Send email with PDF attachment from external address → router detects attachments → triggers WF05 → full classification pipeline
- [ ] **Test 3 — Auto-reply ignored:** Send auto-reply pattern email → router drops it silently
- [ ] **Test 4 — No attachments ignored:** Send plain text email from client → router drops it
- [ ] **Test 5 — WF02 cleanup:** Verify WF02 no longer has the 3 broken nodes, Respond OK fires immediately
- [ ] **Test 6 — Subscription renewal:** Verify [05-SUB] points to new router URL and auto-renew works
- [ ] **Regression:** Existing WF05 classification pipeline still works end-to-end (no change from Get Attachments onward)

## 6. Implementation Notes (Post-Code)

*To be filled during implementation.*
