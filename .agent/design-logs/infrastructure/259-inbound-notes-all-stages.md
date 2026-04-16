# Design Log 259: Capture Client Notes & Attachments at All Stages
**Status:** IMPLEMENTED — NEED TESTING
**Date:** 2026-04-13
**Related Logs:** DL-203 (WF05 → Workers migration), DL-199 (client communication notes timeline), DL-258 (secondary zone on low stages)

## 1. Context & Problem
The inbound email processor (`api/src/lib/inbound/processor.ts`) only looked for reports at `Collecting_Docs` or `Review` stages. When a client at any other stage sent an email, the processor found no "active" reports → marked the email as `NeedsHuman` → returned without saving the note or uploading attachments.

**Real case:** Client CPA-XXX (Client Name) at `Waiting_For_Answers` sent an email on 2026-04-12 saying they cancelled their engagement. The email was silently dropped.

## 2. User Requirements
1. **Q:** Which stages should capture client notes?
   **A:** All stages including Completed.

2. **Q:** What should happen with attachments on early-stage emails?
   **A:** Save note + store attachments in OneDrive (raw, no classification).

3. **Q:** Should NeedsHuman status still apply for note-only saves?
   **A:** No — mark as Completed.

## 3. Research
### Domain
Inbound email processing, CRM activity capture

### Research Verdict
Straightforward extension of DL-203 pipeline. No new patterns needed — reuses existing `uploadToOneDrive` (which auto-creates folders via Graph API PUT path) and `summarizeAndSaveNote`. Prior research from DL-203 covers the inbound pipeline domain.

## 4. Codebase Analysis
### Existing Solutions Found
- `getAllReports` pattern: same as `getActiveReports` but without stage filter
- `uploadToOneDrive` already handles folder auto-creation (Graph API PUT with conflict=rename)
- `summarizeAndSaveNote` is stage-agnostic — works with any `ActiveReport`

### Reuse Decision
100% reuse. Only structural change to pipeline flow.

### Relevant Files
| File | Purpose |
|------|---------|
| `api/src/lib/inbound/processor.ts:161-178` | `getActiveReports` — existing stage-filtered lookup |
| `api/src/lib/inbound/processor.ts:601-609` | No-active-reports → NeedsHuman early return (the problem) |
| `api/src/lib/inbound/processor.ts:637-644` | Note save + OneDrive resolve (moved earlier in flow) |
| `api/src/lib/inbound/attachment-utils.ts:97-115` | `uploadToOneDrive` — used for raw uploads |

## 5. Technical Constraints & Risks
* **OneDrive folders:** `uploadToOneDrive` uses Graph API PUT which auto-creates intermediate folders. No pre-creation needed even for early-stage clients.
* **Anthropic API:** Note summarization calls Claude Haiku. Works at any stage — no dependency on doc templates.
* **NeedsHuman only for truly no-report clients:** When `getAllReports` returns empty (client record exists but no report record at all).
* **Breaking Changes:** None — full classification path unchanged for Collecting_Docs/Review.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Emails from clients at any stage are captured as client notes and attachments stored in OneDrive.

### Logic Flow
1. `getAllReports` — find any report for the client (all stages)
2. If none → `NeedsHuman` (truly no report)
3. Primary report = highest year
4. Filter to `activeReports` (Collecting_Docs/Review) for classification
5. Start note save (always, any stage)
6. If `activeReports.length > 0`: full classification path (unchanged)
7. Else if attachments: raw upload to OneDrive (new)
8. Wait for note, mark Completed

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/processor.ts` | Modify | Add `getAllReports`, two-tier pipeline flow |

## 7. Validation Plan
* [ ] Deploy Worker — verify no build errors
* [ ] CPA-XXX: trigger inbound email processing for the 2026-04-12 email → client_notes populated
* [ ] Verify email event marked Completed (not NeedsHuman)
* [ ] Client at Collecting_Docs stage: full classification still works (no regression)
* [ ] Client at Completed stage: note saved, attachments uploaded raw
* [ ] Truly unknown client (no report): still marked NeedsHuman
* [ ] Open doc-manager for CPA-XXX → secondary zone shows the note (DL-258)

## 8. Implementation Notes (Post-Code)
* Added `getAllReports` function — identical to `getActiveReports` but without stage filter (line 180)
* Refactored pipeline: `allReports` lookup first, then filter to `activeReports` for classification
* Note save + OneDrive resolve moved before the active/non-active branch
* Raw upload path uses same `uploadToOneDrive` with primaryReport's clientName/year/filingType
* Inner code in `if (activeReports.length > 0)` block has cosmetically shallow indentation but compiles correctly
* Deployed as Worker version `aa1964f1-9653-414f-9872-5b3d7fde1ed0`
