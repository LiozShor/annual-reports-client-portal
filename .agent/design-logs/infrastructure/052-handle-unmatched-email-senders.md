# Design Log 052: Handle Unmatched Email Senders in WF[05]
**Status:** [IMPLEMENTED]
**Date:** 2026-02-23
**Related Logs:** 034 (Phase 2 overview), 035 (WF05 AI classification), 038 (email router — DEPRECATED)

## 1. Context & Problem

WF[05] Inbound Document Processing (`cIa23K8v1PrbDJqY`) matches incoming emails by `sender_email` against the `clients` Airtable table. When no match is found, the pipeline silently continues with degraded data — client name defaults to "לקוח לא מזוהה", files go to an unidentified OneDrive folder, and pending classifications have no client link.

This misses two common real-world scenarios:
1. **Office staff forwarding** — Any `@moshe-atsits.co.il` sender is an office employee forwarding a client's documents. The actual client info is buried in the forwarded email body/subject/attachments.
2. **Unknown external sender** — A client sends from a personal email not registered in Airtable (secondary email, spouse's email, employer email).

Currently there is NO explicit handling for these cases — no branching after client lookup, no notification, no identification attempt. The `Prepare Attachments` Code node just defaults to `clientName = 'לקוח לא מזוהה'` via try/catch.

## 2. User Requirements

1. **Q:** What email addresses identify office staff?
   **A:** ANY address ending with `@moshe-atsits.co.il` — not just Moshe, could be any staff member.

2. **Q:** What's the forwarding format when staff forwards client emails?
   **A:** Inconsistent. Sometimes plain FW:, sometimes with notes. Can't rely on a standard pattern.

3. **Q:** What should happen for completely unknown senders?
   **A:** Same treatment as staff forwards — try to identify the client from hints (AI analysis). Not just flag.

4. **Q:** Should we use AI or rule-based matching?
   **A:** AI analysis. Send email metadata + client list to LLM, let it try to match.

5. **Q:** Could other office staff (not just Moshe) forward emails?
   **A:** Yes — any office staff might forward. Handle by domain, not individual addresses.

## 3. Research

### Domain
Email Entity Resolution, LLM-based Fuzzy Name Matching, Forwarded Email Parsing

### Sources Consulted
1. **email-forward-parser (npm/GitHub)** — Open source library that handles Outlook 365, Outlook 2013/2019, Gmail, and other clients. Key insight: forwarded email format is NOT standardized by any RFC. Different clients use different patterns ("From:", "מאת:", separators like "---------- Forwarded message ---------" or horizontal rules). Must handle multiple patterns.
2. **"Match, Compare, or Select?" (ACL 2025)** — Research on LLM entity matching strategies. Three approaches: matching (binary yes/no), comparing (pairwise), selecting (pick from list). For our 500-client list, the **select strategy** (give the LLM the full list, have it pick the best match) is most efficient — one API call instead of 500 pairwise comparisons.
3. **Salesforce Engineering — AI-based Identity Resolution** — Multi-signal approach: combine name matching, email domain clues, contextual hints. Key principle: use ALL available signals (sender name, subject, body, attachment filenames) rather than relying on a single field.

### Key Principles Extracted
- **Multi-signal identification** — Don't rely on a single clue. Combine sender name, forwarded-from email, subject line, body text, and attachment filenames for maximum match accuracy.
- **Rule-based first, AI fallback** — Regex extraction of forwarded email headers is cheap and reliable when the pattern exists. AI is the fallback for ambiguous cases. Avoids unnecessary API calls.
- **Select strategy for LLM matching** — Give the LLM the complete candidate list (500 clients) and let it select. ~10K chars = ~3K tokens. Cheap with Haiku.
- **Confidence-gated routing** — AI results below a threshold go to the "unidentified" path. Don't force a match when confidence is low.

### Anti-Patterns to Avoid
- **Regex-only approach** — Tempting because it's free, but forwarding formats are too inconsistent. Would miss many cases.
- **Embedding-based fuzzy matching** — Overkill for 500 clients. LLM select is simpler and more accurate for this scale.
- **Ignoring attachment filenames** — Clients sometimes include their name/ID number in attachment filenames. Easy signal to miss.

### Research Verdict
Two-tier approach: (1) Regex extraction of forwarded email headers → try direct email match; (2) If regex fails, AI identification using Claude Haiku with the full client list. The AI uses the select strategy — picks the best-matching client from the list based on all available email signals.

## 4. Codebase Analysis

### Current WF[05] Flow (31 nodes)
```
Webhook → Validation → Extract Notification → Respond 202 → Fetch Email →
Extract Email → Get Attachments → Process & Filter → Mark as Read →
Create Email Event → Search Client by Email → Get Active Report →
Get Required Docs → Resolve OneDrive Root → Prepare Attachments →
Loop → [Classify → Upload → Update Airtable per attachment] →
Update Email Event → Move to Documents Folder
```

### Client Matching Point
- **Search Client by Email** (Airtable Search): `LOWER({email}) = '{{ sender_email }}'`
- Returns client record with `name`, `email`, `client_id`, or empty result
- Has `onError: continueRegularOutput` — doesn't crash on zero results
- **No IF node after it** — result flows directly to `Get Active Report`

### Data Available at Match Point
From Extract Email: `sender_email`, `sender_name`, `subject`, `body_preview`, `email_id`, `internet_message_id`, `received_at`
From Process & Filter Attachments: all above + `attachments[]` array with names, content types, sizes

### Downstream Dependencies on Client Data
- **Get Active Report**: `$json.client_id` → finds active report for this client
- **Get Required Docs**: `$json.report_key` → finds required documents
- **Prepare Attachments**: `$('Search Client by Email').first().json` → gets client name (falls back to "לקוח לא מזוהה")

### Relevant Files/Nodes
- `Fetch Email by ID` — currently fetches `bodyPreview` only (255 chars). Need full `body` for forwarded email parsing.
- `Extract Email` — parses email fields, filters auto-replies
- `Prepare Attachments` — already has graceful degradation for missing client
- `Create Email Event` — created BEFORE client matching (no client info at creation time)
- `Update Email Event` — runs at end, sets `processing_status=Completed`

### Alignment with Research
- Current system uses single-signal matching (email only) — research says use multi-signal
- No fallback identification attempt — research says always try before giving up
- Graceful degradation exists but is silent — research says notify/flag

## 5. Technical Constraints & Risks

* **Security:** Client list sent to AI (name + email) — already using Anthropic API which has data processing agreement. Same as existing classification.
* **Risks:**
  - AI misidentifies client → documents filed under wrong client. Mitigated: confidence threshold + all docs go through admin review anyway (pending_review status).
  - `bodyPreview` truncated for long forwarded emails → might miss the forwarded-from header. Mitigated: fetch full `body.content` from MS Graph.
  - Airtable Search for all 500 active clients could be paginated → Airtable node handles pagination automatically.
  - Office staff email domain could change → domain check is a single constant, easy to update.
* **Breaking Changes:** None. All changes are additive. Existing "client found" path is unchanged.

## 6. Proposed Solution (The Blueprint)

### Architecture: Two-Tier Client Identification

```
Search Client by Email (existing)
  ↓
IF Client Found ─── TRUE ──────────────────────────────────┐
  │                                                         │
  FALSE                                                     │
  ↓                                                         │
Fetch Full Email Body (HTTP: MS Graph /messages/{id})       │
  ↓                                                         │
Fetch Active Clients (Airtable Search: all active)          │
  ↓                                                         │
Identify Client (Code: regex parse → direct match attempt)  │
  ↓                                                         │
IF Need AI ─── FALSE (regex matched) ──────────────────┐    │
  │                                                     │    │
  TRUE                                                  │    │
  ↓                                                     │    │
AI Identify Client (HTTP: Anthropic Claude Haiku)       │    │
  ↓                                                     │    │
Process AI Result (Code: parse response, output client) │    │
  ↓                                                     ↓    ↓
  └──────────────────────────────────────→ Get Active Report (existing)
```

### Logic Flow

**Step 1 — IF Client Found** (new IF node)
- Condition: `{{ $json.client_id }}` is not empty
- TRUE: Skip identification, go directly to Get Active Report
- FALSE: Enter identification pipeline

**Step 2 — Fetch Full Email Body** (new HTTP Request)
- GET `https://graph.microsoft.com/v1.0/me/messages/{{ email_id }}?$select=body`
- MS Graph credential (existing)
- Extracts `body.content` (HTML) for deeper parsing
- This runs ONLY when client not found, avoiding overhead for matched emails

**Step 3 — Fetch Active Clients** (new Airtable Search)
- Table: clients (`tblFFttFScDRZ7Ah5`)
- Formula: `{is_active} = TRUE()`
- Returns: name, email, client_id for all active clients (~500 records)

**Step 4 — Identify Client** (new Code node)
The core logic node. Does rule-based identification first:

```javascript
// Inputs
const emailData = $('Process & Filter Attachments').first().json;
const fullBody = $('Fetch Full Email Body').first().json.body?.content || '';
const activeClients = $('Fetch Active Clients').all().map(i => i.json);
const senderEmail = emailData.sender_email;
const senderDomain = senderEmail.split('@')[1] || '';

// Strip HTML from body for text parsing
const bodyText = fullBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// --- TIER 1: Parse forwarded email headers ---
const forwardedEmailPatterns = [
  /From:\s*.*?<([^>]+@[^>]+)>/i,           // English: From: Name <email>
  /מאת:\s*.*?<([^>]+@[^>]+)>/i,            // Hebrew: מאת: Name <email>
  /From:\s*([^\s<]+@[^\s>]+)/i,             // From: email (no angle brackets)
  /מאת:\s*([^\s<]+@[^\s>]+)/i,             // מאת: email (no angle brackets)
];

let extractedEmail = null;
for (const pattern of forwardedEmailPatterns) {
  const match = bodyText.match(pattern);
  if (match) {
    extractedEmail = match[1].toLowerCase().trim();
    break;
  }
}

// Try matching extracted email against client list
if (extractedEmail) {
  const matched = activeClients.find(c =>
    c.email && c.email.toLowerCase() === extractedEmail
  );
  if (matched) {
    return [{
      json: {
        ...matched,
        _match_method: 'forwarded_email',
        _match_confidence: 1.0,
        _extracted_email: extractedEmail
      }
    }];
  }
}

// --- TIER 1b: Try sender name → client name match ---
// (for unknown external senders whose display name matches a client)
const senderName = emailData.sender_name?.trim();
if (senderName && senderDomain !== 'moshe-atsits.co.il') {
  const nameMatch = activeClients.find(c =>
    c.name && c.name.trim().toLowerCase() === senderName.toLowerCase()
  );
  if (nameMatch) {
    return [{
      json: {
        ...nameMatch,
        _match_method: 'sender_name',
        _match_confidence: 0.8,
        _original_sender: senderEmail
      }
    }];
  }
}

// --- No rule-based match → prepare AI request ---
const clientList = activeClients.map(c =>
  `${c.client_id}: ${c.name} (${c.email || 'no email'})`
).join('\n');

const attachmentNames = emailData.attachments?.map(a => a.name).join(', ') || 'none';

const isOfficeForward = senderDomain === 'moshe-atsits.co.il';

const systemPrompt = `You are a client identification assistant for an Israeli CPA firm.
Given an incoming email, identify which client from the firm's client list is associated with this email.

${isOfficeForward ? 'This email was FORWARDED by office staff. The actual client is NOT the sender. Look for the original sender information in the email body, subject, or attachment filenames.' : 'This email is from an unknown sender. Try to match them to a client based on their name, email domain, subject line, or attachment filenames.'}

Client list:
${clientList}

Rules:
- Return the client_id of the best match, or null if you cannot identify the client.
- confidence: 0.0 to 1.0. Only return confidence >= 0.5 if you have strong evidence.
- Look for: original sender email in forwarded headers, client names in subject/body, client names or ID numbers in attachment filenames.
- Hebrew names may have slight variations (with/without middle name, shortened forms).
- If multiple clients could match, pick the most likely one and note alternatives in reasoning.`;

const userPrompt = `Email details:
- Sender: ${emailData.sender_name} <${senderEmail}>
- Subject: ${emailData.subject}
- Body: ${bodyText.substring(0, 2000)}
- Attachment filenames: ${attachmentNames}
${extractedEmail ? `- Extracted forwarded-from email: ${extractedEmail} (not found in client list)` : ''}`;

const anthropicRequestBody = {
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 300,
  messages: [
    { role: 'user', content: userPrompt }
  ],
  system: systemPrompt,
  temperature: 0
};

return [{
  json: {
    _match_method: null,
    _needs_ai: true,
    _anthropic_request: anthropicRequestBody,
    _active_clients: activeClients,
    _email_data: emailData,
    _extracted_email: extractedEmail
  }
}];
```

**Step 5 — IF Need AI** (new IF node)
- Condition: `{{ $json._match_method }}` is null (equals empty)
- TRUE (needs AI): → AI Identify Client
- FALSE (regex matched): → Get Active Report

**Step 6 — AI Identify Client** (new HTTP Request)
- POST `https://api.anthropic.com/v1/messages`
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- Body: `{{ JSON.stringify($json._anthropic_request) }}`
- Credential: HTTP Header Auth (or use existing Anthropic credential from Classify Document)

**Step 7 — Process AI Result** (new Code node)
```javascript
const input = $input.first().json;
const aiResponse = input.content?.[0]?.text || '{}';
const activeClients = input._active_clients || $('Fetch Active Clients').all().map(i => i.json);

let result;
try {
  result = JSON.parse(aiResponse);
} catch(e) {
  // AI didn't return valid JSON
  result = { client_id: null, confidence: 0, reasoning: 'Failed to parse AI response' };
}

// Find the matched client from our list
if (result.client_id && result.confidence >= 0.5) {
  const matched = activeClients.find(c => c.client_id === result.client_id);
  if (matched) {
    return [{
      json: {
        ...matched,
        _match_method: 'ai_identification',
        _match_confidence: result.confidence,
        _ai_reasoning: result.reasoning
      }
    }];
  }
}

// Unidentified — output degraded data
return [{
  json: {
    name: 'לקוח לא מזוהה',
    client_id: '',
    email: '',
    _match_method: 'unidentified',
    _match_confidence: result.confidence || 0,
    _ai_reasoning: result.reasoning || 'No match found'
  }
}];
```

### Connections Summary
| From | To | Branch |
|------|----|--------|
| Search Client by Email | IF Client Found | — |
| IF Client Found | Get Active Report | TRUE |
| IF Client Found | Fetch Full Email Body | FALSE |
| Fetch Full Email Body | Fetch Active Clients | — |
| Fetch Active Clients | Identify Client | — |
| Identify Client | IF Need AI | — |
| IF Need AI | Get Active Report | FALSE (regex matched) |
| IF Need AI | AI Identify Client | TRUE |
| AI Identify Client | Process AI Result | — |
| Process AI Result | Get Active Report | — |

### Data Output Format (All Identification Paths)
Every path outputs the same shape so downstream nodes work identically:
```json
{
  "client_id": "CPA-XXX",
  "name": "שם הלקוח",
  "email": "client@example.com",
  "_match_method": "email_match|forwarded_email|sender_name|ai_identification|unidentified",
  "_match_confidence": 0.0-1.0
}
```

### Update Email Event with Match Method
Modify the existing **Update Email Event** node (end of processing loop) to include:
- `match_method` field (new Airtable field on email_events): captures how the client was identified
- This enables admin to filter/audit identification quality

### Files/Nodes to Change

| Target | Action | Description |
|--------|--------|-------------|
| WF[05] — after Search Client by Email | Add 7 nodes | IF Client Found, Fetch Full Body, Fetch Active Clients, Identify Client, IF Need AI, AI Identify Client, Process AI Result |
| WF[05] — Update Email Event | Modify | Add `match_method` to update data |
| Airtable — email_events table | Add field | `match_method` (singleSelect: email_match, forwarded_email, sender_name, ai_identification, unidentified) |

**Node count:** 31 → 38

## 7. Validation Plan

* [ ] **Test 1 — Direct email match (existing):** Send email from known client email → client identified via original path, no identification pipeline triggered
* [ ] **Test 2 — Office staff forward with Outlook headers:** Forward from @moshe-atsits.co.il with "From: Client <client@email.com>" in body → regex extracts email → matches client
* [ ] **Test 3 — Office staff forward without headers:** Forward from @moshe-atsits.co.il with inconsistent body → regex fails → AI identifies client from context
* [ ] **Test 4 — Unknown external sender (name match):** Email from unknown address but sender display name matches a client → sender_name match
* [ ] **Test 5 — Unknown external sender (AI match):** Email from unknown address with client name in subject → AI identifies
* [ ] **Test 6 — Truly unidentified:** Email from unknown sender with no identifiable clues → falls through to "לקוח לא מזוהה" graceful degradation
* [ ] **Test 7 — Regression:** Full pipeline still works end-to-end for normal (matched) emails
* [ ] **Verify:** email_events `match_method` field populated correctly for each test case

## 8. Implementation Notes (Post-Code)

**Status:** IMPLEMENTED
**Date:** 2026-02-24

### Changes Made

**WF[05] `cIa23K8v1PrbDJqY`** — 31 → 39 nodes (8 new nodes)

**8 new nodes added:**
1. **IF Client Found** (`if-client-found`) — IF node. Checks `$json.client_id` notEmpty after Airtable search.
2. **Fetch Full Email Body** (`http-fetch-full-body`) — HTTP Request. GET MS Graph `/messages/{id}?$select=body`. Uses MS_Graph_CPA_Automation OAuth2.
3. **Fetch Active Clients** (`at-fetch-active-clients`) — Airtable Search. `{is_active} = TRUE()` on clients table.
4. **Identify Client** (`code-identify-client`) — Code. Three-tier identification: (a) regex parse forwarded email headers (Hebrew + English), (b) sender name → client name match, (c) prepare Anthropic API request.
5. **IF Need AI** (`if-need-ai`) — IF node. Checks `$json._match_method` is empty.
6. **AI Identify Client** (`http-ai-identify`) — HTTP Request. POST to Anthropic API (Claude Haiku 4.5). Uses same Anthropic credential as Classify Document.
7. **Process AI Result** (`code-process-ai`) — Code. Parses AI JSON response, validates against client list, gates on confidence >= 0.5.
8. **Search Client by Email** (`code-resolve-client`) — Code. Convergence node. All 3 identification paths merge here. Adds `_match_method: 'email_match'` for direct matches; passes through pipeline data otherwise.

**1 node renamed:**
- `Search Client by Email` → `Search Client by Email Direct` (the original Airtable Search node)

**Key architectural decision:** Instead of modifying the 31K-char `Prepare Attachments` jsCode, the new resolver Code node takes over the name "Search Client by Email". This makes `$('Search Client by Email').first().json` in Prepare Attachments automatically point to the resolved client data — zero changes to existing code.

**Existing node modified:**
- **Update Email Event** — Added `match_method` field to Airtable update, sourced from `$('Search Client by Email').first().json._match_method`.

### Match Method Values
| Value | Source | Confidence |
|-------|--------|------------|
| `email_match` | Direct Airtable email lookup | 1.0 |
| `forwarded_email` | Regex extracted email from forwarded body | 1.0 |
| `sender_name` | Sender display name matched client name | 0.8 |
| `ai_identification` | Claude Haiku identified from context | AI-reported (>= 0.5) |
| `unidentified` | No match found | 0 |

### Additional Changes (Session 2 — 2026-02-24)

**Airtable:** `match_method` singleSelect field added to `email_events` table via API. Values: `email_match` (green), `forwarded_email` (blue), `sender_name` (yellow), `ai_identification` (purple), `unidentified` (red). Field ID: `fldzDT5RR1bCAWGcf`.

**Prepare Attachments** (`22ed433d`) — Updated client sourcing from single-line `$('Search Client by Email')` to cascading try/catch: Process AI Result → Identify Client → Search Client by Email (resolver). Also adds `_match_method: matchMethod` to each output item. Code length: 30550 → 31721 chars.

**Update Email Event** (`at-update-email-event`) — Added `match_method` column to Airtable update. Expression uses IIFE with cascading try/catch to determine match method: Process AI Result → Identify Client → default 'email_match'.

### Completed Steps
- [x] Add `match_method` singleSelect field to Airtable `email_events` table
- [x] Update Prepare Attachments to source client data from identification pipeline
- [x] Update Email Event to write match_method to Airtable
