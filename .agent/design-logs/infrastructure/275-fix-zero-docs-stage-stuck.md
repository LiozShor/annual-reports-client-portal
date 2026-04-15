# Design Log 275: Fix Zero-Document Questionnaires Stuck at Waiting_For_Answers
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-15
**Related Logs:** DL-158 (zero docs approve-and-send, Draft), DL-267 (auto-advance zero missing docs)

## 1. Context & Problem

When a client submits the Tally questionnaire and all answers are "no" (no employment, no investments, etc.), the Document Service correctly generates 0 documents. However, the report stays stuck at `Waiting_For_Answers` because the n8n Merge node in [02] Response Processing blocks when the documents branch produces 0 items.

**Impact:** 7 unique reports across 8 Tally submissions are stuck. Clients appear to never have submitted their questionnaire, which triggers unnecessary reminders and confuses the office.

**Root cause chain:**
1. `Call Document Service` returns `{ok: true, documents: [], document_count: 0}`
2. `Success?` IF node passes (ok=true) → routes to both `Prepare for Airtable` and `Prepare Email`
3. `Prepare for Airtable` does `documents.map(...)` → returns 0 items (empty array)
4. `Upsert Documents` never fires (0 input items)
5. `Wait for Both` (Merge node, chooseBranch mode) needs signal from BOTH branches — email branch fires, documents branch never does
6. `Update Report Stage` and `Mark Processed` are both downstream of `Wait for Both` → never execute
7. Result: stage stays `Waiting_For_Answers`, Tally submission status stays empty

The email to the office (`Prepare Email → MS Graph Send Email`) DOES send, so the office got notified but Airtable state was never updated.

## 2. User Requirements

1. **Q:** When a questionnaire generates 0 documents, what stage should the report advance to?
   **A:** Review (stage 5) — skip intermediate stages since there's nothing to collect or approve.

2. **Q:** Should we retroactively fix stuck clients?
   **A:** Yes, auto-fix via Airtable API as part of this task. Include backfill in the plan.

3. **Q:** Fix approach?
   **A:** Restructure — separate stage update from document upsert so it doesn't depend on the Merge node.

## 3. Research

### Domain
n8n workflow error handling, Merge node behavior with empty branches

### Sources Consulted
1. **n8n Merge node docs** — chooseBranch mode waits for ALL connected inputs before firing, even if one produces 0 items. This is by design — the node has no way to know that a branch will never produce items.
2. **DL-158 research** — Same class of bug in approve-and-send flow. Documented `alwaysOutputData` pattern and the "positive framing" UX for zero-doc emails.
3. **n8n Community: "Merge node not firing with empty branch"** — Common pitfall. Recommended solutions: (a) always output at least 1 item, (b) restructure to avoid merge dependency, (c) use `alwaysOutputData`.

### Key Principles Extracted
- **Don't couple unrelated operations via Merge:** Stage update doesn't depend on document upsert. They should be independent paths.
- **Guard against 0-item branches:** Any code node that maps over an array can produce 0 items, silently killing downstream nodes.

### Research Verdict
Restructure: disconnect `Update Report Stage` and `Mark Processed` from the Merge node. Connect them directly from `Success?`. The stage update logic already handles 0 docs correctly (sets stage to Review).

## 4. Codebase Analysis

### Existing Solutions Found
- `Update Report Stage` already has correct conditional logic: `document_count === 0` → stage "Review", `document_count > 0` → stage "Pending_Approval". It also handles reminder fields, docs_completed_at, etc.
- No frontend changes needed — the admin panel reads stage from Airtable.

### Current Workflow Structure (WF02 - QqEIWQlRs1oZzEtNxFUcQ)
```
Webhook → Fetch Record → Format Q&A ─────────────────┐
                       → Get Report Record ───────────┤
                                                      ▼
                                          Wait For Both Branches → Extract & Map
                                                                       │
                                                                       ▼
                                                            Call Document Service
                                                                       │
                                                                       ▼
                                                                   Success?
                                                                  /        \
                                                       [TRUE]              [FALSE]
                                                      /      \               │
                                        Prepare for     Prepare Email    Log Error
                                        Airtable            │
                                            │               ▼
                                            ▼         MS Graph Send
                                     Upsert Documents       │
                                            │               │
                                            └──── Wait for Both ────┘
                                                      │
                                              ┌───────┴───────┐
                                              ▼               ▼
                                      Update Report    Mark Processed
                                         Stage
                                              │
                                              ▼
                                     Clear Reminder Date
```

### Proposed New Structure
```
                                                   Success?
                                                  /    |    \
                                       [TRUE]     |     |    [FALSE]
                                      /    |      |     |       │
                        Prepare for  Prepare  Update   Mark   Log Error
                        Airtable     Email    Report  Processed
                            │          │      Stage
                            ▼          ▼        │
                   IF has docs?   MS Graph      ▼
                     /     \      Send      Clear Reminder
                  [TRUE] [FALSE]   Email      Date
                    │
                    ▼
              Upsert Documents
```

Key changes:
- `Update Report Stage` connects directly from `Success?` (no merge dependency)
- `Mark Processed` connects directly from `Success?` (no merge dependency)
- `Prepare for Airtable` gets an IF guard: only upsert when document_count > 0
- `Wait for Both` merge node is removed (no longer needed)

### Dependencies
- n8n workflow QqEIWQlRs1oZzEtNxFUcQ ([02] Response Processing)
- Airtable Reports table (tbls7m3hmHC4hhQVy)
- Airtable Tally submissions table (tblxEox8MsbliwTZI)

## 5. Technical Constraints & Risks

* **Security:** No auth changes needed.
* **Risks:**
  - The workflow is actively processing submissions (~10-20/day). Changes must be atomic via `n8n_update_partial_workflow`.
  - `Update Report Stage` references `$('Call Document Service').first().json.document_count` — this expression still works when connected directly from `Success?` since Call Document Service is upstream.
  - `Mark Processed` references `$('Fetch Record').first().json._airtable_record_id` — still accessible from Success? path.
* **Breaking Changes:** None for the >0 docs path. Email still sends, documents still upsert, stage still updates.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Questionnaires generating 0 documents advance the report to "Review" stage, mark the Tally submission as processed, and clear reminder dates — same as >0 docs path but with appropriate 0-doc stage.

### Logic Flow

**Task 1: Restructure WF02 connections**
1. Remove connections: `Upsert Documents → Wait for Both`, `MS Graph Send Email → Wait for Both`, `Wait for Both → Update Report Stage`, `Wait for Both → Mark Processed`
2. Add connections: `Success? [TRUE] → Update Report Stage`, `Success? [TRUE] → Mark Processed`
3. Add IF node before Upsert Documents to skip when document_count = 0
4. Remove `Wait for Both` merge node (now orphaned)
5. Validate workflow

**Task 2: Backfill stuck reports**
Update 6 unique report records (exclude CPA-XXX which is already at Review):
- Set `stage` = "Review"
- Set `docs_completed_at` = current ISO timestamp
- Clear `reminder_count`, `reminder_suppress`, `reminder_next_date`
- Set `last_progress_check_at` = current ISO timestamp

Report IDs to update:
| Record ID | Client | 
|-----------|--------|
| reczM5RwBxhKilf9w | CPA-XXX Client Name |
| recdxFpjUwGTSQBIo | CPA-XXX Client Name |
| recCIJ9Wpp3pmuMFY | CPA-XXX Client Name |
| recTicEcFWyqKxc2D | CPA-XXX Client Name |
| rec3pc3d5Vir299eE | CPA-XXX Client Name |
| recoDoVHbmXMw0ODS | CPA-XXX Client Name |

**Task 3: Backfill Tally submission statuses**
Mark 8 submissions as processed:
| Submission ID | Client |
|---------------|--------|
| recjdw51M0PyT541l | CPA-XXX (Apr 12) |
| reckud6T1f2gkqv3S | CPA-XXX (Apr 15) |
| recrVqvC2eK6QK1Ay | CPA-XXX |
| rec2VJzzn5VAkQ6dO | CPA-XXX |
| recPMBgg5cidkLkaq | CPA-XXX |
| recIGA2godEsTFWZ3 | CPA-XXX |
| recNz70lodrXpmAwi | CPA-XXX |
| recZgm1wlYW10tdmk | CPA-XXX |

Set `סטטוס` = "התקבל" on each.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| WF02 (n8n) | Modify | Restructure connections, add IF guard, remove merge node |
| Airtable Reports | Modify (API) | Backfill 6 report records to stage Review |
| Airtable Submissions | Modify (API) | Backfill 8 submissions to status התקבל |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md, commit & push, merge to main

## 7. Validation Plan
* [ ] Submit test questionnaire with all "no" answers → verify stage advances to Review
* [ ] Submit test questionnaire with >0 docs → verify normal flow still works (stage → Pending_Approval, docs upserted)
* [ ] Verify the 6 backfilled reports show stage=Review in admin panel
* [ ] Verify the 8 backfilled submissions show סטטוס=התקבל
* [ ] Check that no duplicate emails were sent during backfill (backfill is Airtable-only, no email)
* [ ] Verify Update Report Stage node can still access $('Call Document Service') expression after restructure

## 8. Implementation Notes (Post-Code)
* Restructured WF02 via n8n REST API (PUT). Removed `Wait for Both` merge node and rewired `Success?` TRUE branch to directly connect to `Update Report Stage`, `Mark Processed`, `Prepare for Airtable`, and `Prepare Email`.
* Backfilled 6 reports to stage=Review with cleared reminder fields (reminder_next_date=null).
* Backfilled 8 Tally submissions to סטטוס=התקבל.
* Skipped CPA-XXX (Client Name) for report backfill — already at Review. But did backfill its Tally submission status.
* Did NOT modify `Prepare for Airtable` code node — the existing `documents.map(...)` returning 0 items is fine now because `Upsert Documents` not firing no longer blocks anything.
