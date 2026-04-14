# Design Log 244: Rejected Uploads Visibility (Client + Admin)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-07
**Related Logs:** DL-081 (rejection stale fields fix), DL-194 (remove batch status), DL-199 (client communication notes — pattern source), DL-060 (reminder SSOT doc display), DL-047 (document status visual indicators)

## 1. Context & Problem
When the AI mis-classifies an inbound attachment and admin clicks **reject** in the AI Review tab, the rejection only clears the AI's guess — but the client never learns that they sent a file we couldn't use. So when approve-and-send re-mails the doc list (or a Type B reminder fires), the client sees the same "missing" docs and wonders why their submission isn't reflected. The "batch status" feature that partially addressed this was removed in DL-194 with no replacement.

**Critical constraint:** The doc record being rejected is the AI's *guess at a template slot*, NOT the client's actual document. We cannot mark template "Form 106" as `Requires_Fix` because the AI guessed wrong — the client never sent a 106. Rejection state belongs to the **source upload**, not the template slot. Doc records must stay `Required_Missing` (unchanged behavior).

## 2. User Requirements
1. **Q:** What status should a rejected doc carry?
   **A:** Don't touch the template's status. Doc records stay `Required_Missing`. Rejection is logged on the **report** record, not the doc record.

2. **Q:** Where should rejected uploads be stored?
   **A:** JSON in a new `rejected_uploads_log` multilineText field on the Reports table.

3. **Q:** When should the log be cleared?
   **A:** Persist until the report leaves `Collecting_Docs` (auto-clear when stage transitions to Review or beyond, stage rank ≥ 5).

4. **Q:** Where should the rejected uploads be visible?
   **A:** Approve-and-send doc list email • Type B reminder email • Client portal `view-documents.html` • Admin `document-manager.html` (under הודעות הלקוח, with delete button).

5. **Q:** Where in the email and what tone?
   **A:** Amber callout **above** the missing docs list. Title: **"מסמכים שקיבלנו ממך בעבר"** (per user — softer than "couldn't use").

6. **Q:** Are rejection reasons text-only or operational?
   **A:** Text-only. No new docs created, no template slots changed, no reassignment side effects.

7. **Q:** What does each entry show?
   **A:** Filename + date + reason text (always — every entry).

## 3. Research
### Domain
CRM activity logging, transactional email content design, source-vs-template state separation.

### Sources Consulted
1. **DL-199 (Client Communication Notes)** — Existing JSON-on-multilineText pattern with read-modify-write + dedup. Reused as template, no new research needed.
2. **DL-081 (Rejection Stale Fields Fix)** — Established the inline PATCH null-clearing pattern for the reject action in `classifications.ts`.
3. **DL-194 (Remove Batch Status)** — Confirms why this isn't a regression to a removed feature: batch status was admin-side ("send a summary email"); this is client-state ("show what we received").

### Key Principles Extracted
- **State separation:** Don't pollute domain entities (template slots) with state that belongs to source events (uploads).
- **Mirror existing patterns:** The `client_notes` flow already proved JSON-on-multilineText works for ~10 entries per report. Same shape, same endpoint pattern, same UI treatment.
- **Soft language to clients:** "מסמכים שקיבלנו ממך בעבר" frames as informational, not accusatory.

### Patterns to Use
- **JSON-on-multilineText:** Single field, parsed on read, atomic updates per request.
- **Read-modify-write append with try/catch fail-soft:** Never block reject action on log-write failure.
- **Stage-transition cleanup:** Auto-clear on advance (no manual upkeep, naturally bounded).

### Anti-Patterns Avoided
- **Setting `Requires_Fix` on the doc record** — would lie about template state.
- **Creating new "Rejected Uploads" Airtable table** — schema sprawl, more API calls, no benefit at this scale.
- **Manual clear button only** — admin would forget, log would grow stale.

### Research Verdict
Reuse the DL-199 pattern verbatim. Single new Airtable field. Append on reject in the existing `classifications.ts` reject branch. Render via shared helper in `email-html.ts` (Workers) and inline copy in WF06 (n8n Code node). Auto-clear on stage transition.

## 4. Codebase Analysis

### Existing Solutions Found (Reused)
| Piece | File | Reuse |
|---|---|---|
| `client_notes` JSON-on-multilineText pattern | `api/src/routes/client.ts:80` (`update-client-notes`) + `github/.../document-manager.js:2790` (`renderClientNotes`) | Mirror exactly for `rejected_uploads` |
| Reject flow already captures source filename + reason | `api/src/routes/classifications.ts:825-859` | Append to log here |
| `REJECTION_REASONS` Hebrew enum | `api/src/lib/classification-helpers.ts:36` | Reason text source |
| `buildClientEmailHtml` + `buildDocSection` | `api/src/lib/email-html.ts:330` / `:200-301` | Inject callout above missing list |
| Stage transition handler | `api/src/routes/stage.ts:17` | Auto-clear on stage ≥ Review |
| `document-manager.js` notes pattern | `github/.../document-manager.js:2860-2950` | Mirror for admin section |

### Reuse Decision
Mirror DL-199 verbatim. No new abstractions, no new utilities. The only novel work is the email callout HTML helper.

### Relevant Files
See "Files Touched" in the implementation plan (Section 6).

### Alignment with Research
DL-199 already validated the pattern in production for ~6 months. Same constraints apply (small N entries, single editor at a time, no race risk in practice). Following established codebase patterns per CLAUDE.md.

### Dependencies
- Airtable Reports table `tbls7m3hmHC4hhQVy` (new field)
- n8n WF06 `[06] Reminder Scheduler` (`FjisCdmWc4ef0qSV`) — Type B email build node

## 5. Technical Constraints & Risks
* **Security:** No new attack surface — log is read-only to clients, write-restricted to office reject action and admin delete (admin token gated).
* **Race on log writes:** Same risk as `client_notes`. Mitigated by read-modify-write with dedup. Reject is admin-driven, rare concurrent writes per report.
* **n8n Code node JSON body:** Type B email body uses HTML inside JSON — must follow pre-stringify pattern (memory: `feedback_n8n_html_in_json_body`).
* **Bilingual:** Hebrew is the canonical text. EN translation rendered side-by-side for English clients.
* **Hebrew encoding safety:** All Hebrew strings UTF-8 — verify no garbled chars at PR time.
* **Cross-filing-type:** When reject originates from a CS doc, log lives on CS report, not AR — `target_report_id` already isolated in `classifications.ts:889`.
* **Breaking changes:** None. New optional field; missing/empty field renders nothing.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
After admin rejects an AI classification in the AI Review tab, the next approve-and-send email, the next Type B reminder, and the client portal page all show a "מסמכים שקיבלנו ממך בעבר" callout listing the rejected file's name + date + reason; the admin sees the same in document-manager and can delete entries; the log auto-clears when the report advances past Collecting_Docs.

### Data Shape
```json
[
  {
    "id": "ru_1712491200000",
    "filename": "107_2024.pdf",
    "received_at": "2026-04-05",
    "reason_code": "image_quality",
    "reason_text": "איכות תמונה ירודה",
    "notes": "optional admin free text",
    "rejected_at": "2026-04-07T10:23:00Z",
    "rejected_by": "office"
  }
]
```
Stored as JSON string in Reports field `rejected_uploads_log` (multilineText, new). Empty/missing → `[]`.

### Logic Flow
1. Admin clicks reject in AI Review → existing reject path runs → after the doc PATCH, append entry to `rejected_uploads_log` on the report record.
2. approve-and-send / view-documents portal / document-manager fetch the field, parse JSON, render the callout above the missing docs list.
3. Type B reminder (n8n WF06) does the same in its Build Type B Email node.
4. Admin can delete entries from document-manager → POST to `admin-update-client` action `update-rejected-uploads`.
5. Stage transition out of Collecting_Docs (target rank ≥ 5) → `stage.ts` clears the field as part of the same PATCH.

### Files to Change
| File | Action | Description |
|---|---|---|
| Airtable Reports table | Schema | New field `rejected_uploads_log` (multilineText) |
| `api/src/routes/classifications.ts` | Modify | Append to log in reject branch (~825-859) |
| `api/src/routes/client.ts` | Modify | Add `update-rejected-uploads` action |
| `api/src/routes/client-reports.ts` | Modify | Return field in payload |
| `api/src/routes/stage.ts` | Modify | Clear field on advance to Review+ |
| `api/src/lib/email-html.ts` | Modify | New `buildRejectedUploadsCallout` helper + plumb through `ClientEmailParams` |
| `api/src/routes/approve-and-send.ts` | Modify | Pass `rejectedUploads` into params |
| `github/.../assets/js/view-documents.js` | Modify | Render callout in portal page (and surface field via portal API) |
| `github/.../assets/js/document-manager.js` | Modify | New section under הודעות הלקוח, list + delete |
| `github/.../document-manager.html` | Modify | Container div |
| `github/.../admin/css/style.css` | Modify | Mirror `.cn-entry` styles |
| n8n WF06 `[06] Reminder Scheduler` | Modify | Build Type B Email node + Search Due Reminders field list |
| `docs/airtable-schema.md` | Modify | Document new field |
| `.agent/design-logs/INDEX.md` | Modify | Add row 244 |
| `.agent/current-status.md` | Modify | Add Section 7 test items |

### Final Step (Always)
* Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to current-status.md, INDEX update, commit & push.

## 7. Validation Plan
- [ ] **Schema:** Field `rejected_uploads_log` exists on Reports table
- [ ] **Reject flow:** Reject a classification → entry appears in report's `rejected_uploads_log` JSON with correct filename + date + reason
- [ ] **Reject flow (no reason):** Reject without picking a reason → entry has empty `reason_code` but still records filename + date
- [ ] **approve-and-send (HE-only):** Hebrew client with 1 rejected upload → email shows amber callout above missing docs with title + filename + date + reason
- [ ] **approve-and-send (bilingual):** English client → both HE and EN cards show the callout
- [ ] **approve-and-send (empty):** Client with 0 rejected uploads → no callout, no extra spacing
- [ ] **Type B reminder:** Reminder for client in `Collecting_Docs` with rejected uploads → email contains the callout
- [ ] **Client portal:** view-documents.html as client with rejected uploads → callout above doc list, bilingual via lang param
- [ ] **Doc manager view:** document-manager → "ארכיון מסמכים לא רלוונטיים" appears under הודעות הלקוח, lists entries
- [ ] **Doc manager delete:** Trash icon → custom confirm dialog → entry removed from UI + Airtable + persists on reload
- [ ] **Stage transition clear:** Move report Collecting_Docs → Review → field is cleared
- [ ] **Stage transition no-clear:** Move from Send_Questionnaire → Waiting_For_Answers → field unchanged
- [ ] **Idempotency:** Reject same classification twice → no duplicate entry (dedup by classification id)
- [ ] **Token clean (regression):** Doc records still go to `Required_Missing` after reject (DL-081 still works)
- [ ] **Hebrew encoding:** No garbled characters in any rendered output

## 8. Implementation Notes (Post-Code)

Implemented via subagent-driven development across 8 tasks:

**Task 1 — Airtable schema:** Created `rejected_uploads_log` (multilineText) on Reports table `tbls7m3hmHC4hhQVy`. Field ID: `fldGjuWMeXP4TwxxA`. Documented in `docs/airtable-schema.md:93`.

**Task 2 — Reject flow append:** Added ~57 lines to `api/src/routes/classifications.ts:861-918`, immediately after the existing reject PATCH (DL-081). Append is fail-soft (try/catch wrapping the entire block including the GET). Dedup keyed by `cls_id === classification_id` to prevent double-logging on retries. Reviewer identity hardcoded to `'office'` since the reject route doesn't decode the token claim — acceptable per spec.

**Task 3 — Backend plumbing:** Three small additive changes:
- `api/src/routes/client.ts:53,81-92` — added `update-rejected-uploads` action mirroring `update-notes` (thin proxy, no JSON validation)
- `api/src/routes/client-reports.ts:134` — included `rejected_uploads_log` in the returned item (returns to BOTH office and client modes — saves a separate plumbing pass for the portal)
- `api/src/routes/stage.ts:58` — added `fields.rejected_uploads_log = ''` inside the existing `targetNum >= 5` block

**Task 4 — Email helper + approve-and-send wire:**
- `api/src/lib/email-html.ts` — new exported `RejectedUpload` interface (lines 34-44), new `buildRejectedUploadsCallout(entries, lang)` helper (lines 225-271), plumbed `rejectedUploads` through `ClientEmailParams` and into `buildDocSection` (which now takes a 9th parameter and renders the callout above the missing list in BOTH split and non-split branches)
- `api/src/routes/approve-and-send.ts:140-147,170` — parses `report.fields.rejected_uploads_log` safely (try/catch + Array.isArray), passes into `emailParams.rejectedUploads`
- Spec review caught a `⚠️` emoji prefix on title strings — removed it (user explicitly chose "soft tone")
- Known gap: `noDocsNeeded` path (when document_count === 0) does NOT render the callout because it bypasses `buildDocSection`. In practice this case rarely coexists with rejected uploads (clients in Collecting_Docs always have missing docs). Acceptable.

**Task 5 — n8n WF06 Type B reminder:** Updated workflow `FjisCdmWc4ef0qSV` via MCP partial workflow updates:
- Added `rejected_uploads_log` to "Search Due Reminders" Airtable node field whitelist (full params object preserved per memory note about updateNode replacing parameters)
- Forwarded `_rejected_uploads_log` through "Prepare Type B Input" code node
- Inlined `buildRejectedUploadsCallout` function inside "Build Type B Email" code node — supports BOTH HE and EN branches (Type B is bilingual, contrary to my initial assumption)
- Pre-existing validation errors on other nodes are unrelated

**Task 6 — Client portal view-documents:**
- `github/.../view-documents.html:94` — added `<div id="rejected-uploads-callout"></div>` above `#documents-container`
- `github/.../assets/js/view-documents.js:277-346` — vanilla-JS port of `buildRejectedUploadsCallout` + inject point in `renderDocuments()`. Used `\u` Unicode escapes for Hebrew strings (defensive — immune to Windows encoding issues). Re-renders on language toggle since `renderDocuments` is called by `switchLanguage`.

**Task 7 — Admin doc-manager section:**
- `github/.../assets/js/document-manager.js:22,261-266,338,536-537,2965-3057` — `REJECTED_UPLOADS` global, parse-on-load mirroring `CLIENT_NOTES`, `renderRejectedUploads`/`saveRejectedUploads`/`deleteRejectedUpload` functions. Delete uses `showConfirmDialog` (not native), cache integration for tab-switching, lucide icons rendered.
- `github/.../document-manager.html:377-392` — collapsible section "ארכיון מסמכים לא רלוונטיים" placed after the client notes section
- `github/.../admin/css/style.css:6252+` — `.ru-*` rules mirroring the `.cn-*` pattern. Note: spec review caught the implementer initially adding duplicate `.cn-*` rules (they already exist in `assets/css/document-manager.css`) — removed.

**Task 8 — Housekeeping:** This file. Status updated, INDEX updated, current-status.md updated with Section 7 test items, build verified clean (`npx tsc --noEmit` → no errors).

### Research principles applied
- **State separation (DL-244 Section 3):** Doc records stay `Required_Missing`. The rejection state lives on the report record's log, not on any template slot. The user's correction during discovery (don't mark Form 106 as `Requires_Fix` when client never sent a 106) directly shaped this architecture.
- **Mirror existing patterns (CLAUDE.md + DL-199):** The entire JSON-on-multilineText storage, the read-modify-write append pattern, the document-manager UI section, and the admin endpoint extension all mirror the proven `client_notes` pattern from DL-199 verbatim.
- **Soft language to clients (user clarification):** Title text "מסמכים שקיבלנו ממך בעבר" chosen by user as softer than "couldn't use." Spec review caught and removed an unrequested ⚠️ emoji that contradicted this tone choice.
- **Fail-soft on auxiliary writes:** The reject log append is wrapped in try/catch — a log-write failure must never break the reject action itself.

### Deviations from plan
- Plan Step 3b said "office mode only" — implementer returned the field in both modes, which is harmless and saves Task 6 from needing a separate plumbing pass.
- Plan Step 7 assumed Type B was HE-only — actually bilingual; both branches were patched.
- Plan said `.ru-*` styles mirror `.cn-*` — they live in `admin/css/style.css` while the `.cn-*` source lives in `assets/css/document-manager.css`. Both files load on document-manager.html so this works, but a future refactor could colocate them.
