# Design Log 112: Webhook Duplicate Prevention + Issuer Name Display
**Status:** [DRAFT]
**Date:** 2026-03-08
**Related Logs:** [035-wf05-ai-classification](035-wf05-ai-classification-onedrive-upload.md), [048-onedrive-dedup](048-onedrive-rename-dedup-improvements.md), [069-race-condition-guard](069-review-classification-race-condition-guard.md), [110-short-doc-names](110-questions-for-client-feature.md)

## 1. Context & Problem

**Bug 1 — Duplicate records:** MS Graph fires 2 webhook notifications ~141ms apart for a single incoming email. Both hit WF[05] concurrently. The existing `Check Duplicate` node (checks `file_hash` in `pending_classifications`) fails because both executions race past it before either writes. Result: 2 email_events, 2x pending_classifications per attachment, 2x OneDrive files (with auto-rename suffix like "טופס 106 1.pdf").

Evidence from CPA-XXX test (2026-03-08): 5 attachments produced 10 pending_classification records. Event IDs differ only in timestamp suffix: `_1772950934481` vs `_1772950934622` (141ms gap). Identical `content_hash` per pair.

**Bug 2 — Missing issuer name:** AI review cards in States A (full match) and C (fuzzy) don't display the AI-detected `issuer_name`. For multi-instance templates like Form 867, the card shows "טופס 867 (אישור ניכוי מס)" without indicating which institution (e.g., "מיטב טריד", "בנק הפועלים").

## 2. User Requirements

1. **Q:** Prevent dupes at source (WF[05]) or consumer (Get Pending Classifications)?
   **A:** Both — early dedup + safety net.

2. **Q:** Skip OneDrive upload for duplicates?
   **A:** Yes — skip upload entirely to avoid confusing duplicate filenames.

3. **Q:** Clean up existing duplicate test data?
   **A:** No — leave for testing.

## 3. Research

### Domain
Webhook Idempotency, Concurrency Control, MS Graph Notifications

### Sources Consulted
1. **MS Graph Webhook Docs** — MS Graph provides no unique notification ID for dedup. The only stable key is `resourceData.id` (message ID). If webhook response takes >3s, Graph retires with exponential backoff. At >15% slow responses, notifications are dropped entirely.
2. **Hookdeck: Webhook Idempotency Guide** — Gold standard: unique constraint on natural key. Insert-or-ignore pattern. For systems without DB constraints: upsert with `createdRecords` check.
3. **Airtable API `performUpsert`** — PATCH with `performUpsert.fieldsToMergeOn` is atomic server-side. Response includes `createdRecords` array (IDs of newly created records) vs `records` (all records). Two concurrent upserts are serialized — one creates, one updates. Enables reliable "claim" pattern.
4. **n8n Remove Duplicates Node** — "Previous executions" mode stores keys in `staticData`, saved at execution END (not mid-execution). Does NOT handle concurrent executions — both pass before either persists. Only catches sequential retries.
5. **DL-069: Race Condition Guard** — Prior art in this project: compare-and-set pattern for concurrent review actions on same document. Used file_hash as fencing token.

### Key Principles Extracted
- **Respond immediately, process asynchronously** — webhook must return 200 within 3s or Graph retries (creating the very duplicates we're preventing)
- **Atomic claim mechanism** — Airtable upsert with `createdRecords` check is the only reliable dedup in our stack (no DB locks, no n8n mutex)
- **Defense in depth** — three layers: atomic lock, loop-level skip, consumer filter
- **Fail-open** — if dedup mechanism errors, continue processing (duplicates are annoying but dropped emails are data loss)

### Anti-Patterns to Avoid
- **n8n Remove Duplicates for concurrent dedup** — static data saved at execution end, not during. Both concurrent executions pass.
- **Search-then-create pattern** — race window between search and create. Both executions search simultaneously, both find nothing, both create.
- **Serializing all executions** — n8n Cloud has no workflow-level concurrency limit. Even if it did, throughput bottleneck.

### Research Verdict
Three-layer dedup: (1) Airtable upsert lock at message level, (2) enhanced Check Duplicate to skip entirely, (3) consumer-side hash dedup. The upsert is the critical layer — atomic server-side, returns `createdRecords` to distinguish "I created" from "I updated."

## 4. Codebase Analysis

### Existing Solutions Found
- **Check Duplicate node** (`code-check-dup-v2`): Searches `pending_classifications` by `file_hash`. Flags `_isDuplicate` but continues processing. Located at position [6720, 352] in the loop.
- **Create Email Event node** (`at-create-email-event`): Creates email_events record with unique `event_key` (includes `Date.now()`). Uses `source_message_id` field (MS Graph message ID) — this is our natural dedup key. Located at position [2016, 544].
- **Get Pending Classifications Build Response** (`code-build-response` in `kdcWwkCQohEvABX0`): Already fetches all pending records and builds enriched response. No dedup logic currently.

### Reuse Decision
- Reuse existing Check Duplicate node — enhance behavior from "flag" to "skip"
- Reuse existing `source_message_id` field in email_events as upsert merge key
- Reuse existing Create Email Event node — convert from CREATE to UPDATE

### Relevant Files
| File | Role |
|------|------|
| WF[05] `cIa23K8v1PrbDJqY` (43 nodes) | Inbound Document Processing — main pipeline |
| `[API] Get Pending Classifications` `kdcWwkCQohEvABX0` | Build Response code — consumer |
| `github/.../admin/js/script.js` | AI review card rendering — States A/C |

### Alignment with Research
- Current pipeline responds with 202 early (good — prevents Graph retries)
- Check Duplicate is in the right place (per-attachment in loop) but wrong behavior (flag vs skip)
- No message-level dedup exists (the gap that causes the bug)

## 5. Technical Constraints & Risks

* **Airtable upsert prerequisite:** `source_message_id` field must have unique values for upsert to work. If old records have duplicate `source_message_id` values, upsert returns `DUPLICATE_VALUES` error. Handled by fail-open (catch error, continue).
* **Email_events schema:** `source_message_id` already exists as a text field. No schema change needed.
* **Fail-open risk:** If Airtable API is down, dedup is bypassed. Duplicates may occur. Acceptable — better than dropping emails.
* **Loop stall risk:** If Check Duplicate returns empty (skip), downstream nodes don't execute, Loop Wait never triggers. Fixed by adding IF node that routes duplicates to Loop Wait.
* **MCP updateNode:** Changing Create Email Event from CREATE to UPDATE replaces entire parameters. Must include all Airtable params (operation, base, table, columns, id).

## 6. Proposed Solution (The Blueprint)

### Layer 1: Airtable Upsert Lock (new "Dedup Lock" node)

**Position:** [560, 544] — between Respond 202 [672, 544] and Fetch Email [896, 544]

```javascript
// Dedup Lock: Airtable upsert on email_events.source_message_id
const messageId = $json.message_id;
if (!messageId) return $input.all(); // fail-open

const AT_KEY = '<redacted — see .env AIRTABLE_API_KEY / n8n credential>';
const BASE_ID = 'appqBL5RWQN9cPOyh';
const TABLE_ID = 'tblJAPEcSJpzdEBcW'; // email_events

try {
  const resp = await $helpers.httpRequest({
    method: 'PATCH',
    url: `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`,
    headers: { 'Authorization': `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: ['source_message_id'] },
      records: [{ fields: {
        source_message_id: messageId,
        processing_status: 'Detected',
        workflow_run_id: $execution.id
      }}]
    }),
    json: true
  });

  const createdIds = resp.createdRecords || [];
  const recordId = resp.records?.[0]?.id;
  const weCreatedIt = createdIds.includes(recordId);

  if (!weCreatedIt) {
    console.log(`[DEDUP] Skipping message_id=${messageId}: already being processed`);
    return [];
  }

  console.log(`[DEDUP] Claimed message_id=${messageId}, event_id=${recordId}`);
  return [{ json: { ...$json, _email_event_id: recordId } }];
} catch (e) {
  if (e.message?.includes('DUPLICATE') || e.message?.includes('INVALID_VALUE_FOR_COLUMN')) {
    console.log(`[DEDUP] Existing duplicate email_events for message_id=${messageId}. Skipping.`);
    return [];
  }
  console.log(`[DEDUP] Error: ${e.message}. Continuing (fail-open).`);
  return $input.all();
}
```

**Rewire:**
- Remove: Respond 202 → Fetch Email by ID
- Add: Respond 202 → Dedup Lock → Fetch Email by ID

### Layer 1b: Convert Create Email Event to Update

Change existing `at-create-email-event` from `operation: "create"` to `operation: "update"`.
- Record ID: `={{ $('Dedup Lock').first().json._email_event_id }}`
- Fields: `event_key`, `source_internet_message_id`, `received_at`, `sender_email`, `subject`, `attachment_name`, `processing_status`
- Removes: `source_message_id` (already set by Dedup Lock), `workflow_run_id` (already set)

### Layer 2: Check Duplicate Skip

**Existing node** `code-check-dup-v2`: Add early return when duplicate found.

Change the end of the code from:
```javascript
return $input.all().map(item => ({
  json: { ...item.json, _dupRecords: records.length, _isDuplicate: isDuplicate },
  ...
}));
```
To:
```javascript
if (isDuplicate) {
  console.log(`[CheckDuplicate] SKIPPING duplicate hash=${fileHash.substring(0,12)}...`);
  return [];
}
return $input.all();
```

**New node: "IF Not Duplicate"** — not needed if Check Duplicate returns empty (flow stops at Check Duplicate for duplicates).

**Wait — loop stall issue:** If Check Duplicate returns empty, the loop doesn't advance to the next item. We need Loop Wait to still trigger.

**Fix:** Instead of returning empty, return items with `_isDuplicate=true` and add an IF node:

```
Check Duplicate → IF Not Duplicate → true: Upload to OneDrive
                                   → false: Loop Wait
```

**IF Not Duplicate** (position [6832, 352]):
- Condition: `{{ $json._isDuplicate }}` is not true

### Layer 3: Consumer Dedup in Build Response

In Get Pending Classifications Build Response, after fetching `pendingRecords`:

```javascript
// Dedup by file_hash — keep first record per hash (safety net)
const seenHashes = new Set();
const dedupedPending = pendingRecords.filter(rec => {
  const hash = rec.fields.file_hash;
  if (!hash) return true;
  if (seenHashes.has(hash)) return false;
  seenHashes.add(hash);
  return true;
});
```

Replace `pendingRecords` with `dedupedPending` in all downstream logic.

### Fix 2: Issuer Name in States A/C

In `script.js`, for both State A and State C card rendering, change:

```javascript
// BEFORE:
const docDisplayName = templateLabel && docName && !docName.includes(templateLabel)
    ? `${templateLabel} – ${docName}`
    : (docName || templateLabel);

// AFTER:
const aiIssuer = item.issuer_name || '';
const docDisplayName = templateLabel && docName && !docName.includes(templateLabel)
    ? `${templateLabel} – ${docName}`
    : (docName || (templateLabel + (aiIssuer ? ` – ${aiIssuer}` : '')));
```

### Files to Change

| Location | Action | Description |
|----------|--------|-------------|
| WF[05] `cIa23K8v1PrbDJqY` | Add node | "Dedup Lock" Code node at [560, 544] |
| WF[05] `cIa23K8v1PrbDJqY` | Rewire | Respond 202 → Dedup Lock → Fetch Email |
| WF[05] `cIa23K8v1PrbDJqY` | Modify node | Create Email Event → UPDATE mode |
| WF[05] `cIa23K8v1PrbDJqY` | Modify code | Check Duplicate: flag + continue (keep for IF) |
| WF[05] `cIa23K8v1PrbDJqY` | Add node | IF Not Duplicate at [6832, 352] |
| WF[05] `cIa23K8v1PrbDJqY` | Rewire | Check Dup → IF Not Dup → true: Upload / false: Loop Wait |
| Get Pending `kdcWwkCQohEvABX0` | Modify code | Build Response: add file_hash dedup |
| `admin/js/script.js` | Modify | States A/C: show AI issuer when docName empty |

## 7. Validation Plan

### Dedup
* [ ] Send test email → only 1 execution processes fully (check n8n logs for "[DEDUP] Skipping")
* [ ] Only 1 email_event record per email in Airtable
* [ ] Only 1 pending_classification per attachment
* [ ] Only 1 OneDrive file per attachment (no "filename 1.pdf")
* [ ] Normal single-notification emails still process correctly
* [ ] Airtable API error in Dedup Lock → fail-open, email still processed
* [ ] Existing duplicate pending_classifications → Build Response dedup filters them

### Issuer Name
* [ ] State A card (full match) with issuer → shows "טופס 867 – מיטב טריד"
* [ ] State A card without issuer (null) → shows just template name
* [ ] State C card (fuzzy) with issuer → shows issuer appended
* [ ] State B card → unchanged (already shows issuer)
* [ ] Reviewed cards → unchanged

## 8. Implementation Notes (Post-Code)

### Layer 1.5 attempt — reverted (2026-03-26)
Attempted to add "Check Already Processed" Code node between Extract Email and Get Attachments. **Reverted** — Code node HTTP calls don't work on n8n Cloud. See **DL-199** for full findings and next steps. The fix needs HTTP Request nodes instead of Code-node API calls.
