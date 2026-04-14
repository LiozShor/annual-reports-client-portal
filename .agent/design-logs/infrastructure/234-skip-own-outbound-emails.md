# Design Log 234: Skip Own Outbound Emails in Inbound Pipeline
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-31
**Related Logs:** DL-052 (handle unmatched email senders), DL-203 (WF05 → Workers migration)

## 1. Context & Problem

The inbound email pipeline (`api/src/lib/inbound/processor.ts`) processes every email arriving in the office inbox via MS Graph subscription. When the system sends outbound emails from `reports@moshe-atsits.co.il` (reminders, batch status, doc requests), copies of those emails can appear in the inbox (sent items sync, replies, delivery receipts). The pipeline processes these and `summarizeAndSaveNote()` adds them as client messages — polluting the client notes timeline with the office's own automated emails.

## 2. User Requirements

1. **Q:** Filter ALL @moshe-atsits.co.il or only reports@?
   **A:** Only `reports@moshe-atsits.co.il` — office staff forwarding client docs must still be processed.

2. **Q:** Skip entire pipeline or only skip client notes?
   **A:** Skip entire pipeline — no attachments, no classification, no notes. These are system-generated emails with no useful inbound content.

3. **Q:** Where should the filter go?
   **A:** After metadata extraction (step 3), alongside auto-reply detection. Minimal code change.

4. **Q:** Any other automated senders to filter?
   **A:** Only `reports@moshe-atsits.co.il`.

## 3. Research

### Domain
Email Loop Prevention, Automated Email Processing Safety

### Sources Consulted
1. **RFC 3834 — Automatic Responses to Electronic Mail** — Automated systems MUST check `Auto-Submitted` header before processing. Filter before any side effects.
2. **Microsoft Exchange / Graph API docs** — Loop prevention via transport rules and header stamps. Sender address filtering is primary defense for owned mailboxes.
3. **SendGrid Inbound Parse Best Practices** — Maintain explicit blocklist of own sending addresses. Always check actual email address, never display name.

### Key Principles Extracted
- **Filter before side effects** — block at the earliest point after knowing the sender, before any Airtable writes, OneDrive uploads, or LLM calls.
- **Explicit sender blocklist** — hardcode known system sender addresses rather than pattern-matching, to avoid false positives on legitimate office forwards.
- **Constant, not config** — for a single known address, a code constant is simpler and more reliable than a config/env var.

### Anti-Patterns to Avoid
- **Filtering on subject prefix** (e.g., "Re:") — unreliable, auto-generated emails don't always have consistent subjects.
- **Broad domain block** — would break DL-052's office-staff forwarding feature.
- **Processing then undoing** — wasteful; filter early.

### Research Verdict
Simple sender address check right after auto-reply detection. One constant, one condition, early return. No complexity needed.

## 4. Codebase Analysis

* **Existing Solutions Found:** Auto-reply detection pattern at `processor.ts:532` — exact same pattern (check metadata field → early return). Reuse this pattern.
* **`client-identifier.ts`** already defines `OFFICE_DOMAIN = '@moshe-atsits.co.il'` (line 32) — but that's for identification routing, not filtering. Our filter is more specific (exact address, not domain).
* **Reuse Decision:** Follow the existing auto-reply pattern — add a constant + condition, no new abstractions.
* **Dependencies:** None. Pure logic change in one file.

## 5. Technical Constraints & Risks

* **Security:** None — this is a filter, not an auth change.
* **Risks:** Extremely low. Only filters one specific sender. Office staff forwarding from other `@moshe-atsits.co.il` addresses is unaffected.
* **Breaking Changes:** None. Pipeline behavior for all other emails is unchanged.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Emails from `reports@moshe-atsits.co.il` are silently skipped by the inbound pipeline — no client notes, no classifications, no email events created.

### Logic Flow
1. After `extractMetadata()` (step 2), check if `metadata.senderEmail === 'reports@moshe-atsits.co.il'`
2. If match → log a console message, return early (same pattern as auto-reply at line 532)
3. No email event upserted (no audit trail needed for own emails)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/processor.ts` | Modify | Add `SYSTEM_SENDER` constant + early return check after auto-reply filter |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] Send a test email FROM `reports@moshe-atsits.co.il` to the office inbox → verify pipeline skips it (check Worker logs for skip message)
* [ ] Send a test email FROM a real client → verify pipeline processes it normally (client note created, attachments classified)
* [ ] Send a test email FROM another `@moshe-atsits.co.il` address (e.g., natan@) → verify it's still processed (office staff forwarding path)
* [ ] Verify no regression: trigger a reminder email → check that the reminder itself works, and the inbox copy is skipped

## 8. Implementation Notes (Post-Code)
* Added `SYSTEM_SENDER` constant at line 67 and early return at line 539-543 in `processor.ts`
* Follows exact same pattern as auto-reply filter (step 3) — no email event created for skipped emails
* Research principle applied: "Filter before side effects" — skip happens before any Airtable writes, OneDrive uploads, or LLM calls
