# Design Log 282: Fix Forwarded-Email Note Sender (DL-279 Recurrence)

**Status:** [DRAFT]
**Date:** 2026-04-16
**Related Logs:** DL-279 (first attempt), DL-278 (office_reply filter), DL-266 (threaded office reply), DL-234 (skip own outbound), DL-199 (client communication notes), DL-203 (WF05 Worker migration)

---

## 1. Context & Problem

When Natan or Moshe forwards a client email from **their personal mailbox** (e.g. `moshe@moshe-atsits.co.il`) to `reports@moshe-atsits.co.il`, the inbound pipeline misattributes both the note and the attachments.

**Root cause discovered mid-session** (from real data — 4 `pending_classifications` records on CPA-XXX-2025 dated 2026-04-16 05:48 UTC):

Moshe is himself a client (`CPA-XXX`). When he forwards Client Name's email + 4 PDFs, the `identifyClient()` cascade matches him at **Tier 1 (direct email match)** — his own `moshe@moshe-atsits.co.il` address hits his own client record in the Clients table — and **Tier 2 (forwarded_email parsing) never runs**. Result:
- Note's `sender_email` = Moshe's address (even though the body's `From:` header clearly has `client@example.com`).
- 4 pending_classifications created under `client_name = Client Name`, `client_id = CPA-XXX`, report = Moshe's 2025 annual report.
- OneDrive uploads land in Moshe's folder instead of Elad's.
- AI classifier explicitly flagged the mismatch in its `ai_reason` field ("המסמך מופנה ל\"Client Name\" שאינו Client Name") but had no way to override the client attribution.

DL-279's fix (read `Reports.client_email` and fall back to `clientMatch.email`) can't help here: the matched report IS Moshe's, so `reportClientEmail` is Moshe's own address too.

**Two secondary defects** compound the problem:
1. `parseForwardedEmail` regex list is bracket-only — fails for `From: Name email@domain.com` (no angle brackets).
2. `stripQuotedContent` skips the forward-header strip if it's the first line, so the header block leaks into the LLM and `raw_snippet`.

## 2. User Requirements

1. **Q:** What specifically is wrong in the admin panel for this forwarded email?
   **A:** Note sender is Moshe, not Elad.
2. **Q:** Is Client Name (client@example.com) an existing client in Airtable with an active report?
   **A:** Yes — existing client, active report.
3. **Q:** Where are the images from — Outlook or admin panel?
   **A:** User doesn't remember the source; also noted attachments should be classified correctly.

## 3. Research

### Domain
Email parsing / forwarded-email detection (Microsoft Graph → HTML → text; heuristic sender extraction).

### Sources (incremental — full research done in DL-203 for WF05 migration)
1. **`email-reply-parser` (github.com/willdurand/EmailReplyParser)** — libraries use a *list* of patterns tried in order rather than one regex.
2. **Microsoft Graph email body docs** — `body.content` is HTML; forwarded chains wrap headers as `<b>From:</b> Name &lt;<a href="mailto:x">x</a>&gt;`.
3. **django-email-reply-parser** — detect forward-block boundaries by separator lines (`----- Original Message -----`, `________________________________`, Gmail-style `---------- Forwarded message ----------`) THEN parse the header block.

### Key Principles Extracted
- **Never trust a single regex.** Forward headers appear in 5+ shapes; validate each extracted address.
- **Strip forwarded chains position-agnostically.** Outlook forwards without commentary START with the header block — a `result.length > 0` guard is the exact wrong check.
- **Separate "who sent this envelope" from "who the note belongs to".** The note's `sender_email` reflects the matched client; the envelope sender is already in `pending_classifications.sender_email` for audit.

### Patterns to Use
- **Tiered regex parser** — already in place; extend with non-angle-bracket variants.
- **Match-method-aware sender resolution** — if `matchMethod` is not `email_match`/`forwarded_email`, the forwarder address must never reach the note.

### Anti-Patterns to Avoid
- **Replacing the regex cascade with an LLM call.** Slow, costly, non-deterministic.
- **Adding a new tier before Tier 1.** Office-domain gate already handles that; a parallel tier would change behavior for non-office forwards.

### Research Verdict
Extend the existing cascade. Fix three concrete defects rather than re-architecting.

## 4. Codebase Analysis

### Existing Solutions Found
- **`parseForwardedEmail` regex cascade** (`client-identifier.ts:116-125`) — already tiered; extend with 3 patterns.
- **`stripQuotedContent` separator detection** (`processor.ts:228-244`) — already lists 5 separator shapes; fix the one guarded by `result.length > 0`.
- **Report `client_email` lookup + fallback** (`processor.ts:707-712`) — DL-279. Strengthen with a tertiary fallback via the matched Client record's `email` field.
- **Backfill endpoint** (`routes/backfill.ts`) — already implements find-and-rewrite for `natan@...`; extend to also catch `moshe@...`.

### Relevant Files
| File | Role |
|------|------|
| `api/src/lib/inbound/client-identifier.ts` | 4-tier client match; `parseForwardedEmail`; `matchByForwardedEmail` office-domain gate |
| `api/src/lib/inbound/processor.ts` | `stripQuotedContent` (222), `summarizeAndSaveNote` (254), `reportClientEmail` (707-712) |
| `api/src/routes/backfill.ts` | `/webhook/backfill-note-sender` one-off sweep |
| `frontend/assets/js/document-manager.js:3084` | Renders `entry.sender_email` on note timeline |
| `frontend/admin/js/script.js:3702, 3979` | AI review card sender tooltip |

### Alignment with Research
Codebase already uses tiered-pattern approach. Bugs are narrow defects, not architectural.

### Dependencies
Airtable `Reports.client_email`, `Clients.email`. Workers deploy: `cd api && npx wrangler deploy`.

## 5. Technical Constraints & Risks
- **Security:** None (internal pipeline logic only).
- **Risks:** New regex patterns could over-match (mitigated by anchoring to `From:/מאת:/מ:` labels + email validation).
- **Breaking changes:** None. Additive + one guard removal. No DB migrations.

## 6. Proposed Solution

### Success Criteria
When Moshe or Natan forwards a client email to reports@, the resulting note's `sender_email` equals the original client's email (from Reports.client_email lookup → matched-client.email fallback → body-extracted sender) — **never the forwarder's office address** — AND the note's `summary`/`raw_snippet` contain only the client's own text.

### Logic Flow

**Fix 1 — `stripQuotedContent` (processor.ts:238-239)**
- Remove `result.length > 0` guard on the `From:/מאת:/נשלח:` check.
- Add Outlook HR separator: `^_{5,}\s*$`.
- Add Gmail forwarded-message separator: `^-+\s*Forwarded message\s*-+\s*$`.

**Fix 2 — `parseForwardedEmail` (client-identifier.ts:116-125)**
After the existing 4 patterns, add:
- `/From:\s*[^\n]*?\s([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/i` — bare email after "From: Name"
- `/From:\s*[^\n]*?\(([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\)/i` — `From: Name (email@domain.com)`
- `/מאת:\s*[^\n]*?\s([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/` — Hebrew bare form

Keep existing `includes('@') && includes('.')` validation.

**Fix 3 — Match-method-aware sender resolver (processor.ts ~710)**
New helper `resolveNoteSenderEmail(reportClientEmail, clientMatch, airtable)`:
1. If `reportClientEmail` non-empty → return it.
2. Else if `clientMatch.matchMethod` is `email_match` or `forwarded_email` → return `clientMatch.email` (already the real client's address).
3. Else (AI / name-based match) → fetch the matched Client record's `email` field from Airtable and return that. Never return the envelope sender.

**Fix 4 — Backfill sweep extension (routes/backfill.ts)**
Replace single `OFFICE_EMAIL` constant with `@moshe-atsits.co.il` domain match; sweep catches any office address. Skip `type==='office_reply'` and `source!=='email'` entries to avoid rewriting legitimate office-origin notes. Run once after deploy.

**Fix 5 — Reorder identifier cascade for office senders (client-identifier.ts `identifyClient`)** [ROOT-CAUSE FIX]
When `metadata.senderEmail` ends with `OFFICE_DOMAIN`, try `matchByForwardedEmail` BEFORE `matchByEmail`. If a forwarded sender in the body matches a different client, use that match. Fall through to direct email match only if no forward was detected — that covers the legitimate case where Moshe/Natan sends their own personal email. For non-office senders, preserve the existing order (direct email first — forwards from external addresses are rare and should not change behavior).

### Data Structures / Schema Changes
None.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/processor.ts` | Modify | Fix 1 (stripQuotedContent) + Fix 3 (resolveNoteSenderEmail) |
| `api/src/lib/inbound/client-identifier.ts` | Modify | Fix 2 (non-bracket patterns) + Fix 5 (reorder cascade for office senders) |
| `api/src/routes/backfill.ts` | Modify | Fix 4 (domain-wide sweep) |

### Final Step (Housekeeping)
- Mark DL-282 `[IMPLEMENTED — NEED TESTING]`
- Copy Section 7 to `current-status.md`
- Deploy Workers: `cd api && npx wrangler deploy`
- Run `/webhook/backfill-note-sender`
- Update INDEX.md
- Commit → merge to main → cleanup worktree

## 7. Validation Plan

- [ ] **Unit — parseForwardedEmail:** each new regex extracts expected email from representative samples.
- [ ] **Unit — stripQuotedContent:** input starting with `From:/Sent:/To:/Subject:` strips all four lines; input with Outlook `________________________________` separator strips everything after it.
- [ ] **E2E — Moshe forwards:** forward an existing active-report client's email from Moshe's mailbox to `reports@`. Within ~2 min, target report's `client_notes` has a new entry with `sender_email` = client's address, not Moshe's.
- [ ] **E2E — Natan forwards:** same test from Natan's mailbox.
- [ ] **E2E — no-commentary forward:** body starts directly with forwarded header block → `summary`/`raw_snippet` contain only client's words.
- [ ] **E2E — forward-with-note:** Moshe adds one line at top → header block still stripped; client content still summarized correctly.
- [ ] **Attachment routing:** attachments from forwarded emails land in the correct client's OneDrive folder and `pending_classifications` records.
- [ ] **Backfill:** after sweep, `FIND('@moshe-atsits.co.il', {client_notes})` on non-office notes returns zero matches.
- [ ] **Regression — direct client email:** client sends directly to reports@ → note sender equals client's email (Tier 1 untouched).
- [ ] **Regression — office_reply threading:** DL-266 office replies still render threaded; DL-278 AI-review filter still hides them from AI review.

## 8. Implementation Notes (Post-Code)

- **Mid-implementation discovery:** User dumped 4 real `pending_classifications` rows for CPA-XXX that revealed the true root cause — Tier 1 direct-email match wins before Tier 2 (forwarded) ever gets a chance, because Moshe is himself a client. Original Fix 2/3 alone would not have caught this; Fix 5 (reordering the cascade for office senders) is the load-bearing change.
- **Applied principles:** Tiered regex cascade (Fix 2), position-agnostic separator stripping (Fix 1), match-method-aware sender resolution (Fix 3), *and* sender-domain-aware cascade ordering (Fix 5). The last one is the most important insight — office staff who are also clients need different identifier logic.
- **One-off cleanup:** 4 `pending_classifications` records on CPA-XXX-2025 (email_event `evt_TL0P290MB013175704FB37E08F185D752D6232@T_1776307728096`) need to be deleted and re-ingested under Client Name's client/report. User will move the 4 PDFs in OneDrive manually; re-ingestion path TBD with user (options: delete + forward again with a new message_id, temp endpoint to create fresh pending_classifications under Elad's report, or manual admin-panel flow).
- **Affected classification_keys to delete:**
  - `CPA-XXX-2025-PdfLoader - 2026-04-15T110153.947.pdf`
  - `CPA-XXX-2025-04cbc9b0-1e90-4bc1-b7bb-3f69f4063b4e.pdf`
  - `CPA-XXX-2025-12b91ec5-4331-4cca-a154-18e4678e6e0c.pdf`
  - `CPA-XXX-2025-a4306c40-48dd-42bf-ae85-bb4d32414d12.pdf`
