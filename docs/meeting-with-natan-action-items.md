# Meeting with Natan — Action Items

**Source:** `docs/Meeting With Natan.docx` (raw meeting notes, Hebrew)
**Date:** March 2026
**Participants:** Natan (Moshe Atsits CPA Firm), Lior
**System:** Annual Reports CRM (n8n + Airtable + GitHub Pages)

---

## Group 1: Quick Fixes

*Rationale: Trivial changes that can ship immediately. No dependencies, no risk. Each is a single-field or single-line fix.*

### 1.1 Rename "Ready for Review" tab to "Ready for Preparation"
- **Original:** Tab label "מוכנים לבדיקה" should be "מוכנים להכנה"
- **Why:** Current label implies QA review; "preparation" reflects the actual next step (accountant prepares the report)
- **Complexity:** Low
- **Where:** Admin panel HTML/JS — tab label text
- **Dependencies:** None

### 1.2 Fix GENERAL_DOC display in view-documents
- **Original:** On the client-facing `view-documents` page, documents of type `GENERAL_DOC` show the raw string "general_doc" instead of the actual document name
- **Why:** Clients see a meaningless technical label instead of what they uploaded
- **Complexity:** Low
- **Where:** `assets/js/view-documents.js` — rendering logic for document names; likely a missing fallback to `issuer_name` or `name_he` for general-type docs
- **Dependencies:** None

### 1.3 Add subtitle to Form 867 in document list
- **Original:** In the required documents list, Form 867 (טופס 867) should show in parentheses: "also known as tax deduction certificate" (נקרא גם אישור ניכוי מס)
- **Why:** Clients often know this form by its alternate name and don't recognize "Form 867"
- **Complexity:** Low
- **Where:** Airtable document templates table — update the display name or add a subtitle field. May need SSOT update if title is generated.
- **Dependencies:** Must follow SSOT rules — verify whether this is a title change (requires SSOT module update) or a subtitle/tooltip (simpler)

### 1.4 Reset "last sent" date when client moves from Stage 2 to Stage 3 ✅
- **Done:** DL-066/067 — reminder counter reset on stage transition + initialize reminder_next_date on stage entry.

---

## Group 2: Document Manager Bug Fixes & Enhancements ✅ DONE (sessions 96–97, DL-104/105b)

*Rationale: Three issues all on the same page (`document-manager.js` / `[04] Document Edit Handler`). Should be fixed together since they share context and testing.*

### 2.1 Fix document name editing — raw `<B>` tags visible ✅
- **Original:** When editing a document name in the Document Manager, the user sees literal `<B>` HTML tags instead of bold formatting
- **Why:** Breaks the editing experience — users see markup instead of styled text
- **Complexity:** Low
- **Where:** `assets/js/document-manager.js` — the inline edit input is populated with raw HTML. Need to strip HTML tags when populating the edit field and re-wrap with `<b>` on save.
- **Dependencies:** None

### 2.2 Fix document name editing — changes don't persist to Airtable ✅
- **Original:** When a user edits a document name in the Document Manager, the change appears locally but doesn't actually update in Airtable, so the client never sees the new name
- **Why:** Critical data integrity bug — office staff thinks they renamed a document but the change is lost
- **Complexity:** Medium
- **Where:** `assets/js/document-manager.js` (frontend save logic) + `[04] Document Edit Handler` n8n workflow (`y7n4qaAUiCS4R96W`) — verify the rename payload reaches Airtable. May be a missing field in the API call or the n8n node not processing name updates.
- **Dependencies:** Fix 2.1 first (ensure clean data goes into the save)

### 2.3 Add Approve & Send button to Document Manager ✅
- **Original:** After editing, adding, or deleting documents in the Document Manager, the updated list should NOT auto-send to the office. Instead, add an "Approve & Send" button (same as WF[03]) at the bottom of the page. Must verify the list actually updated before allowing send.
- **Why:** Gives office staff explicit control over when to notify the client. Prevents accidental sends during mid-edit sessions.
- **Complexity:** Medium
- **Where:** `assets/js/document-manager.js` (new button + validation), possibly triggers `[03] Approve & Send` workflow or a dedicated endpoint
- **Dependencies:** Items 2.1 and 2.2 should be fixed first so the approved list is accurate
- **DL-105b enhancement (session 97):** Approve & Send now sends inline via `fetch()` (no new tab/confirm page). WF[03] returns JSON when `respond=json`. Added `showToast()` for visible feedback. Fixed office notes save bar + auto-expand saved notes.
- **DL-113 (session 108):** Post-save UX redesigned — page stays after save with toast + list reload (dead-end full-screen view removed). Save bar hides after save. After send, button is disabled with tooltip "המייל כבר נשלח ללקוח" to prevent accidental re-sends.

---

## Group 3: Email Content & Wording Overhaul ✅ DONE (sessions 100–101, DL-107/108)

*Rationale: All items modify email templates and client-facing text. Batch together for consistent tone, avoid merge conflicts, and test all email types in one pass.*

### 3.1 Friendlier wording in document emails ✅
- **Original:** Consider friendlier phrasing when sending document lists to clients. Example suggestion: "to send the documents right now" (לשליחת המסמכים כבר עכשיו). Applies to all email types: approve & send, batch update, and reminders.
- **Why:** Current wording may feel bureaucratic. Warmer tone improves client response rates.
- **Complexity:** Low
- **Where:** n8n email-building code nodes in WF[03], WF[06], and Batch Status workflow. All share the Document Service for doc lists, but CTA/body text is per-workflow.
- **Dependencies:** Should be done alongside 3.2 and 3.3 for tone consistency
- **Done:** DL-107 (session 100) — WhatsApp icon, friendlier sendDocsBox text, contact block with phone/email/WhatsApp across all email types

### 3.2 Batch Update email — show only missing documents ✅
- **Original:** Change Batch Update email wording to something like: "We received the documents you sent, but the following are still needed." Only list what's missing — no need to detail what was already received.
- **Why:** Clients don't need to re-read what they already sent. Shorter, clearer emails improve action rates.
- **Complexity:** Medium
- **Where:** `[API] Send Batch Status` (`QREwCScDZvhF9njF`) — `Build Email` code node. Currently shows full doc list; needs to filter to missing/fix-required only.
- **Dependencies:** None (batch status email is self-contained)
- **Done:** DL-108 (session 101) — removed bilingual two-card layout, single-language per client (EN or HE). Conditional "עדיין נדרשים X לתיקון" only when rejections exist. CTA button fully clickable.

### 3.3 Questionnaire & reminder email content rewrite + Natan's contact info
- **Original:** Update the content sent when sending the questionnaire AND when sending reminders. The new content should appear in both the email body and the Tally form introduction. New text provided (translated):

  > Hello,
  >
  > Attached is a questionnaire for your annual report for the year 2024.
  >
  > Please fill out the questionnaire immediately so we can start working on the reports as soon as possible.
  >
  > After completing the questionnaire, the details will be sent to us and we will send you an email with a list of required documents for preparing your annual report.
  >
  > We remind you that each question refers to all members of the household (including spouse — if defined as married at the Interior Ministry — and children up to age 18).
  >
  > Please give each question the full attention it deserves, as each question has implications for your tax liability in 2024.
  >
  > If anything is unclear, contact us by phone: **03-6390820**

  Additionally add:
  - **Natan's phone:** 077-9928421
  - **WhatsApp button** linking to Natan's WhatsApp
  - **Natan's email:** natan@moshe-atsits.co.il

- **Why:** Current intro text is outdated/missing key info. Adding direct contact options reduces client friction.
- **Complexity:** High
- **Where:**
  - Email: `[01] Send Questionnaires` (`9rGj2qWyvGWVf9jXhv7cy`) + `[06] Reminder Scheduler` (`FjisCdmWc4ef0qSV`) — Type A email template
  - Tally form: via Tally MCP — update the form introduction text
  - [CLARIFICATION NEEDED] Are WF[01] and WF[06] Type A using the same email template? Need to verify to avoid duplication.
- **Dependencies:** None, but should coordinate with 3.1 for tone consistency
- **Done:** DL-107 (session 100) — WF[01] rewritten with Natan's approved text, WF[06] Type A updated with reminder framing, Tally form intros added to both HE+EN forms, WhatsApp + contact info across all emails

---

## Group 4: AI Review UX Polish ✅ DONE & TESTED (sessions 102–104, DL-109/110)

*Rationale: Both items relate to the AI document classification review interface in the admin panel. Same page, same component.*

### 4.1 AI Review — lighten selection option UI ✅
- **Original:** When the AI presents multiple-choice options ("Is it one of the following?"), the current UI is too visually heavy. Ensure it uses `<b>` bold formatting like emails do. Consider shortening long document names.
- **Why:** Visually overwhelming options slow down the reviewer. Bold highlights + shorter names make scanning faster.
- **Complexity:** Low
- **Where:** `admin/js/script.js` — AI review card rendering. Adjust the comparison radio buttons / option labels.
- **Dependencies:** None
- **Done:** DL-109 (session 102) — Removed card borders/padding, lightweight list with subtle separators, color-only hover/selected. Added `renderDocLabel()` to preserve `<b>` tags in SSOT doc names. DL-110 (session 104) — Short names via `short_name_he` in Airtable templates; `name_short` in API response; radio labels use short name + bold issuer. Added `🤖 AI חושב שזה:` prefix to all card states for consistency. DL-112 (session 107) — States A/C now show issuer name when `matched_doc_name` is empty (e.g., "טופס 867 (אישור ניכוי מס) – מיטב טריד").

### 4.2 AI Review RE-ASSIGN — update OneDrive filename + Airtable ✅
- **Original:** When doing a RE-ASSIGN and adding a new document, the file name in OneDrive must change to match the new document assignment. Example: if the LLM initially identified a file as "Form 106" and renamed it in OneDrive, but then the user reassigns it to a completely different document — the OneDrive filename must update to the new assignment. The last assignment is authoritative. Airtable must also reflect the change.
- **Why:** Without this, OneDrive has misleading filenames that don't match the actual document classification. Creates confusion when accountants browse files.
- **Complexity:** Medium
- **Where:** `[API] Review Classification` (`c1d7zPAmHfHM71nV`) — the reassign path needs to trigger a file rename via MS Graph API. Currently, the `Prepare File Move` node may only handle the initial classification.
- **Dependencies:** None, but test carefully — file rename via MS Graph can fail silently
- **Done:** DL-109 (session 102) — Added 3-tier fallback for `targetHeTitle`: HE_TITLE map → `pa.new_doc_name` (custom docs) → Find Target Doc record's `issuer_name`. Rename infrastructure was already complete; only the title lookup had gaps.

---

## Group 5: Reminder System Enhancements ✅ DONE (DL-109, session 103)

*Rationale: All three items enhance the reminder subsystem. The timing logic (5.1) is the most impactful and should ship first; the history UI (5.2) is a natural companion; WhatsApp (5.3) is a separate integration layer.*

### 5.1 Monthly reminder timing logic — 15th-of-month cutoff rule ✅
- **Original:** New rule for when monthly reminders fire:
  - If any update (new client, questionnaire sent, documents sent) happens **before the 15th** of the month → reminder fires on the **1st of the following month**
  - If the update happens **on or after the 16th** → reminder fires on the **1st of the month after next**
  - Goal: A client who gets a questionnaire on March 30 shouldn't get a reminder on April 1 (too soon). But a client who got one on March 1 and hasn't responded by April 1 should get reminded.
- **Why:** Current timing may remind clients too soon after initial contact, which feels like spam, or too late, missing the follow-up window.
- **Complexity:** High
- **Where:** `[06] Reminder Scheduler` (`FjisCdmWc4ef0qSV`) — the date calculation logic for `next_reminder_date`. Also likely involves `[06-SUB] Monthly Reset` (`pW7WeQDi7eScEIBk`).
- **Dependencies:** None, but need to define what counts as an "update" — [CLARIFICATION NEEDED] Does "update" mean any of: new client opened, questionnaire sent, documents sent? Or only specific events? The original notes express uncertainty here.
- **Done:** DL-109 — Replaced `month + 2` with 15th cutoff formula across 5 workflows (WF[01], WF[02], Admin Change Stage, WF[06], Reminder Admin). Removed `send_day` setting entirely (admin UI field, n8n config fetch, cascade logic).

### 5.2 Reminder Tab — show send history on date click ✅
- **Original:** On the Reminder Tab, when clicking the date under "Last Sent" column, show a popup/modal with the full history of all reminders sent to that client (dates and possibly types).
- **Why:** Office staff currently can't see reminder history without digging into Airtable. Quick history view helps decide whether to send another or skip.
- **Complexity:** Medium
- **Where:** Admin panel `admin/js/script.js` (frontend click handler + modal/popover) + possibly a new API endpoint or Airtable query for reminder history records
- **Dependencies:** None
- **Done:** DL-109 — History popover (mirrors docs popover pattern). DL-111 — Migrated from separate table to inline JSON field on `annual_reports` (simpler, no extra API calls).

### 5.3 WhatsApp reminders (in addition to email) — ❌ NOT FEASIBLE
- **Original:** Check the option of sending reminders via WhatsApp in addition to email reminders, from the Reminder Tab.
- **Why:** WhatsApp has higher open/response rates than email in Israel. Could significantly improve client response times.
- **Complexity:** High
- **Where:** New integration — needs WhatsApp Business API or a service like Twilio. Requires: message templates, opt-in handling, a send mechanism in n8n, and UI controls in the Reminder Tab.
- **Feasibility report:** DL-119 (`.agent/design-logs/119-whatsapp-reminders-feasibility.md`)
- **Status:** ❌ NOT FEASIBLE — Meta Business Manager has persistent bugs preventing production WhatsApp Business Account setup. Test account works but production number registration fails with permissions errors ("Object does not exist"). Adding payment method to production WABA also failed repeatedly until business address was added, but phone registration still blocked. Meta platform issue — not solvable from our side.
- **Dependencies:** N/A — blocked by Meta platform

---

## Group 6: Tally Questionnaire Updates

*Rationale: Both items modify the Tally forms. Should be done together since Tally changes require updating both Hebrew and English versions.*

### 6.1 Add "Common-Law Partners" family status option ✅
- **Done:** DL-107 (session 100) — "Common-law partner" added to EN form. HE form confirmed done.

### 6.2 Qualifying settlement — add city list dropdown ✅
- **Done:** DL-118 (session 113) — Converted text field → searchable dropdown in both Tally forms (HE + EN), 486 qualifying settlements bulk-pasted, "Other" option enabled for free-text fallback. Airtable field converted to single select. Data stored in `data/qualifying-settlements-2026.json`.

---

## Group 7: New Features

*Rationale: Larger features that require design, new UI components, and/or new n8n workflows. Each is independent but ranked by impact.*

### 7.1 "Questions for Client" feature in Document Manager ✅ DONE (DL-110, session 105-107)
- **Original:** Add a new feature to the Document Manager where office staff can write free-text questions for a specific client. These questions:
  - Are written by office staff in the Document Manager
  - Get included at the bottom of the document list in the Approve & Send email
  - Only appear in the email when questions exist (conditional section titled "Questions from the office" or similar)
  - Need good UX/UI design for the input interface
- **Why:** Office staff often need to ask clients clarifying questions alongside document requests. Currently no structured way to do this — they resort to separate emails.
- **Complexity:** High
- **Where:**
  - Airtable: New field or linked table for per-report questions
  - Frontend: `assets/js/document-manager.js` — new questions input section
  - n8n: `[03] Approve & Send` + Document Service — conditional questions section in email
- **Dependencies:** Item 2.3 (Approve & Send button in Document Manager) should ship first, as questions flow through the same send mechanism

### 7.2 PDF conversion before OneDrive upload ✅
- **Original:** Add a new processing node before uploading files to OneDrive that converts all file types to PDF.
- **Why:** Standardizes file formats in OneDrive. Accountants won't need to deal with varied formats (HEIC photos, Word docs, etc.).
- **Complexity:** Medium–High
- **Where:** `[05] Inbound Doc Processing` (`cIa23K8v1PrbDJqY`) — new Code/HTTP node before the OneDrive upload node. Needs a conversion service (e.g., CloudConvert API, LibreOffice via n8n, or a self-hosted converter).
- **Done:** DL-115 (session 115) — Two-tier conversion:
  - **Tier 1 (pre-upload, Code node):** JPEG/PNG → PDF via pure Buffer ops (no external service). Only colorType 0 (gray) and 2 (RGB) supported; RGBA/palette/interlaced pass through unchanged.
  - **Tier 2 (post-upload, MS Graph):** DOCX/XLSX/PPTX/RTF/ODT → PDF via existing MS Graph nodes.
  - All unsupported formats (HEIC, BMP, WEBP, ZIP, etc.) pass through unchanged with `_img_converted=false` flag.
  - Total: 6 new nodes added to WF[05], 51 → 52 node count. Two-layer architecture handles ~95% of real-world attachments (images + Office docs) natively.
- **Dependencies:** None, implemented standalone

### 7.3 Admin portal — Questionnaires Tab with print
- **Original:** Add a new tab to the admin portal showing all submitted questionnaires. Each questionnaire should have a print option. Also support multi-select to print multiple questionnaires at once. Use a floating action button per the UI design system. Include Natan's question-answer annotations alongside the questionnaire data.
- **Why:** Office staff currently can't easily view or print questionnaire responses from the admin panel. They have to go to Tally or Airtable directly.
- **Complexity:** High
- **Where:**
  - Admin panel: New tab in `admin/index.html`, new section in `admin/js/script.js`
  - n8n: New API endpoint to fetch questionnaire response data (from Airtable `questionnaire_responses` table)
  - Print: CSS print stylesheet + `window.print()` or PDF generation
- **Dependencies:** None, but needs design work for the Q&A display format
- [CLARIFICATION NEEDED] "Natan's question-answer annotations" — does this mean the questions from item 7.1, or a separate feature where Natan annotates questionnaire responses?

### 7.4 Help icons on view-documents page
- **Original:** On the client-facing `view-documents` page, add a help/question-mark icon next to each required document. Clicking it shows instructions on how to obtain that specific document. Natan needs to prepare the instruction list. Store explanations in Airtable. **Low importance.**
- **Why:** Clients often don't know where to get specific tax documents. In-context help reduces support calls.
- **Complexity:** Medium
- **Where:**
  - Airtable: New field on document templates table for help text
  - Frontend: `assets/js/view-documents.js` — tooltip or expandable section per document
  - API: Include help text in the document list response
- **Dependencies:** Natan must prepare the help text content first
- **Priority:** Low (explicitly marked in original notes)

---

## Implementation Roadmap

### Phase 1 — Quick Fixes (ship immediately)
| Item | Description | Effort |
|------|-------------|--------|
| 1.1 | Rename tab "Ready for Review" → "Ready for Preparation" | 5 min |
| 1.2 | Fix GENERAL_DOC display | 15 min |
| 1.3 | Form 867 subtitle | 15 min |
| 1.4 | Reset "last sent" on stage 2→3 | 30 min |

### Phase 2 — Document Manager Fixes ✅ DONE (sessions 96–97, DL-104/105b)
| Item | Description | Status |
|------|-------------|--------|
| 2.1 | Fix `<B>` tags in edit mode | ✅ Done |
| 2.2 | Fix name edit Airtable persistence | ✅ Done |
| 2.3 | Add Approve & Send button + inline send (DL-105b) | ✅ Done |

### Phase 3 — Email Content Overhaul ✅ DONE (sessions 100–101, DL-107/108)
| Item | Description | Status |
|------|-------------|--------|
| 3.1 | Friendlier wording across all emails | ✅ Done (DL-107) |
| 3.2 | Batch Update — single-language per client | ✅ Done (DL-108) |
| 3.3 | Questionnaire email rewrite + Natan's contact info | ✅ Done (DL-107) |

### Phase 4 — AI Review Polish + Tally Updates (AI Review done & tested)
| Item | Description | Status |
|------|-------------|--------|
| 4.1 | Lighten AI Review selection UI + short names + AI prefix | ✅ Done & Tested (DL-109/110) |
| 4.2 | RE-ASSIGN → update OneDrive filename | ✅ Done (DL-109) |
| 6.1 | Add "Common-Law Partners" to Tally | ✅ Done |

### Phase 5 — Reminder System ✅ DONE (DL-109, session 103)
| Item | Description | Status |
|------|-------------|--------|
| 5.1 | Monthly reminder timing logic (15th cutoff) | ✅ Done (DL-109) |
| 5.2 | Reminder send history popup | ✅ Done (DL-109) |

### Phase 6 — New Features (design-first, higher effort)
| Item | Description | Status |
|------|-------------|--------|
| 7.1 | "Questions for Client" feature | ✅ Done & Tested (DL-110) |
| 7.2 | PDF conversion before OneDrive upload | ✅ Done & Verified (DL-115, session 115) |
| 7.3 | Questionnaires Tab with print | ✅ Done (DL-116 + DL-120) |
| 2.3+7.1 | *(7.1 depends on 2.3 being done)* | — |

### Phase 7 — Low Priority / Research
| Item | Description | Status |
|------|-------------|--------|
| 5.3 | WhatsApp reminders | ❌ Not feasible — Meta platform blocks production setup |
| 6.2 | Qualifying settlement city dropdown | ✅ Done (DL-118) |
| 7.4 | Help icons on view-documents | ✅ Done (DL-117) |

---

## Items Requiring Clarification

| Item | Question |
|------|----------|
| ~~5.1~~ | ~~What exactly counts as an "update"?~~ **Resolved:** Applied to all reminder_next_date computations (questionnaire send, form submission, stage changes, post-reminder next-date). |
| ~~5.3~~ | ~~Is this "research feasibility" or "implement now"?~~ **Resolved:** Research complete (DL-119). Implementation awaiting Natan's decisions. |
| ~~7.2~~ | ~~Which file types need PDF conversion? All non-PDF? Images too?~~ **Resolved:** JPEG/PNG pre-upload (Code node), DOCX/XLSX/PPTX/RTF/ODT post-upload (MS Graph). Others pass through unchanged (DL-115). |
| ~~7.3~~ | ~~"Natan's Q&A" — is this the same as item 7.1 (questions for client), or a separate annotation feature?~~ **Resolved:** Confirmed same as DL-110 "Questions for Client". Tab built in DL-116, UX polished in DL-120. |
| ~~3.3~~ | ~~Confirm the year reference should be dynamic (not hardcoded "2024")~~ **Resolved:** n8n emails use `report.year` (dynamic); Tally forms show "2025 tax year" — no hardcoded 2024 anywhere. |

---

## Items Blocked on External Input

| Item | Blocked on |
|------|------------|
| 6.2 | Need confirmed list of qualifying settlements for current tax year |
| ~~7.3~~ | ~~Need clarity on what "Natan's Q&A" means in this context~~ — **Resolved (DL-116+DL-120)** |
