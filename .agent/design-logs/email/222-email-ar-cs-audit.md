# Design Log 222: Email AR/CS Dual-Filing Audit
**Status:** [IMPLEMENTED]
**Date:** 2026-03-29
**Related Logs:** DL-220 (CS questionnaire email), DL-182 (CS Tally questionnaire), DL-164 (filing type layer), DL-084 (email uniformity audit)

## 1. Context & Problem
The system sends 9 distinct email types. With Capital Statements (CS) now a supported filing type alongside Annual Reports (AR), every client-facing email must correctly reference the filing type — not hardcode "דוח שנתי" (annual report). This audit catalogs every email type and identifies which ones are AR-hardcoded vs. dual-ready.

## 2. User Requirements
1. **Q:** Audit only or audit + fix plan?
   **A:** Audit + Fix Plan — document all findings AND propose fixes for each AR-hardcoded email.

2. **Q:** Extract WF[04] Edit Notification and WF[07] Digest from n8n?
   **A:** Yes — extract both to complete the audit.

3. **Q:** Which approve-and-send path is active (n8n vs Workers)?
   **A:** Not sure → Traced: Workers `approve-and-send.ts` regenerates email fresh. n8n Document Service pre-generates but the client email is NOT sent from n8n.

## 3. Research
### Domain
Transactional email, multi-product filing type routing

### Sources Consulted
Reusing research from DL-220 (modular email architecture, RTL email design). No additional research needed — this is a gap analysis, not new design.

### Research Verdict
Pattern already established in DL-220: `FILING_LABELS` map + content branching by `filingType`. Apply the same pattern to the remaining AR-hardcoded emails.

## 4. Complete Email Audit

### Summary Matrix

| # | Email Type | Location | Sends To | AR | CS | Status |
|---|-----------|----------|----------|----|----|--------|
| 1 | **Questionnaire Send** | Workers `send-questionnaires.ts` + `email-html.ts` | Client | ✅ | ✅ | **DUAL** (DL-220) |
| 2 | **Office Notification** | n8n Doc Service `generate-html` (hf7DRQ9fLmQqHv3u) | Office | ✅ | ❌ | **AR-ONLY** |
| 3 | **Client Doc Request** | Workers `approve-and-send.ts` + `email-html.ts` | Client | ✅ | ❌ | **AR-ONLY** |
| 4 | **Batch Status** | n8n `code-build-email` (QREwCScDZvhF9njF) | Client | ✅ | ✅ | **GENERIC** (no filing type mention) |
| 5 | **Type A Reminder** | n8n WF[06] `build_type_a_email` (FjisCdmWc4ef0qSV) | Client | ✅ | ✅ | **DUAL** (FILING_LABELS) |
| 6 | **Type B Reminder** | n8n WF[06] `build_type_b_email` (FjisCdmWc4ef0qSV) | Client | ✅ | ✅ | **DUAL** (FILING_LABELS) |
| 7 | **Edit Notification** | n8n WF[04] `Build Edit Email` (y7n4qaAUiCS4R96W:530d5cb5) | Office | ✅ | ✅ | **GENERIC** ("עדכון רשימת מסמכים") |
| 8 | **Daily Digest** | n8n WF[07] `Build Digest Email` (0o6pXPeewCRxEEhd:build_email) | Office | ✅ | ✅ | **GENERIC** ("סיכום יומי") |
| 9 | **Feedback** | Workers `feedback.ts` | Admin | N/A | N/A | Not filing-type related |

### Detailed Findings

#### ✅ Already Dual (4 emails)
- **Questionnaire Send:** DL-220 added `arQuestionnaireContent()` / `csQuestionnaireContent()` helpers. Subject uses dynamic `FILING_LABELS`. Fully working.
- **Type A Reminder:** Uses `FILING_LABELS` map (`annual_report` → "דוח שנתי", `capital_statement` → "הצהרת הון"). Subject and body are dynamic.
- **Type B Reminder:** Same `FILING_LABELS` pattern. Subject and body are dynamic.

#### ✅ Generic / Not Applicable (3 emails)
- **Batch Status:** Subject is "Document Status Update" / "עדכון סטטוס מסמכים" — no filing type mention. Works for both.
- **Edit Notification:** Subject is "עדכון רשימת מסמכים - {name} - {year}" — no filing type mention. Works for both.
- **Daily Digest:** Subject is "סיכום יומי — [sections]" — internal summary, no filing type context needed. The pending approval query doesn't filter by filing_type, so CS clients appear naturally.
- **Feedback:** Admin-only, no filing type relevance.

#### ❌ AR-Hardcoded (2 emails — need fixes)

**Issue 1: Client Doc Request (Workers) — CRITICAL (client-facing)**

File: `api/src/lib/email-html.ts`

| Line | Hardcoded Text | What It Should Be |
|------|---------------|-------------------|
| 161 | "להכנת הדו״ח השנתי שלך" | Dynamic: "להכנת {הדו״ח השנתי/הצהרת ההון} שלך" |
| 162 | "for your annual report" | Dynamic: "for your {annual report/capital statement}" |
| 395 | "דו״ח שנתי ${year}" (in subject) | Dynamic: "{דו״ח שנתי/הצהרת הון} ${year}" |
| 431 | "דו״ח שנתי ${year}" (in subject fn) | Same fix |
| 34-44 | `ClientEmailParams` — no `filingType` | Add `filingType?: string` |

Root cause: `ClientEmailParams` interface doesn't include `filingType`, so `buildClientEmailHtml()` and `buildClientEmailSubject()` have no way to branch.

**Issue 2: Office Notification Subject (n8n) — MODERATE (office-facing)**

File: n8n Document Service `generate-html` code node (hf7DRQ9fLmQqHv3u:generate-html)
Also in: `tmp/generate-html-n8n.js` (local copy)

| Line | Hardcoded Text | What It Should Be |
|------|---------------|-------------------|
| 506 | "שאלון שנתי התקבל" (office subject) | Dynamic: "שאלון {שנתי/הצהרת הון} התקבל" |
| 621 | "דו״ח שנתי ${year}" (client pre-gen subject) | Dynamic: same as Workers fix |

Note: The n8n client email subject (line 621) is pre-generated but the actual sent email uses Workers `buildClientEmailSubject()`. However, this pre-gen value may appear in Airtable tracking or office previews, so it should still be correct.

## 5. Technical Constraints & Risks
- **No breaking changes** — AR emails (default path) must remain identical
- **n8n code node update** — requires `n8n_update_partial_workflow` MCP call
- **Two codebases** — Workers + n8n both need updates (per CLAUDE.md rules)
- **Risk:** Office notification gets `filing_type` from the Document Service input — need to verify the calling workflow (WF[02]) passes this field through

## 6. Proposed Solution (Fix Plan)

### Success Criteria
All 9 email types correctly reference the filing type for both AR and CS clients. No email sent to a CS client mentions "דוח שנתי".

### Fix 1: Client Doc Request (Workers) — `email-html.ts`

**Step 1:** Add `filingType` to `ClientEmailParams` interface (line 34-44)
```typescript
filingType?: string;  // 'annual_report' | 'capital_statement'
```

**Step 2:** Add FILING_LABELS constant (reuse pattern from `send-questionnaires.ts`)
```typescript
const FILING_LABELS: Record<string, { he: string; en: string }> = {
  annual_report: { he: 'דו״ח שנתי', en: 'annual report' },
  capital_statement: { he: 'הצהרת הון', en: 'capital statement' },
};
```

**Step 3:** Update `noDocsNeededBox()` (line 153-168) — accept `filingType` param, branch body text:
- HE: "להכנת {הדו״ח השנתי/הצהרת ההון} שלך"
- EN: "for your {annual report/capital statement}"

**Step 4:** Update `buildClientEmailHtml()` — read `filingType` from params, pass to `noDocsNeededBox()`, update subject at line 394-396

**Step 5:** Update `buildClientEmailSubject()` (line 423-436) — branch no-docs subject:
- HE: "אין צורך במסמכים - {דו״ח שנתי/הצהרת הון} ${year}"
- EN: stays generic "No Documents Needed"

**Step 6:** Update `approve-and-send.ts` — read `filing_type` from report, add to `emailParams`

### Fix 2: Office Notification Subject (n8n) — Document Service `generate-html`

**Step 1:** Read `filing_type` from input (already passed by WF[02] via `Pass Trigger Data`)

**Step 2:** Add `FILING_LABELS` constant to the code node

**Step 3:** Update office subject (line 506):
- From: "שאלון שנתי התקבל"
- To: "שאלון {שנתי/הצהרת הון} התקבל" (dynamic)

**Step 4:** Update client pre-gen subject (line 618-624):
- From: "דו״ח שנתי" hardcoded
- To: Dynamic from `FILING_LABELS`

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/email-html.ts` | Modify | Add filingType to params, FILING_LABELS, branch text |
| `api/src/routes/approve-and-send.ts` | Modify | Pass filing_type to email builder |
| n8n `generate-html` (hf7DRQ9fLmQqHv3u:generate-html) | Modify | Dynamic office subject + client pre-gen subject |

### Final Step
- **Housekeeping:** Update design log status, INDEX, current-status.md
- Git commit & push

## 7. Validation Plan
* [ ] Send CS approve-and-send with docs → subject shows "דרישת מסמכים" (generic, unchanged)
* [ ] Send CS approve-and-send with 0 docs → subject shows "אין צורך במסמכים - הצהרת הון {year}"
* [ ] Send AR approve-and-send with 0 docs → subject still shows "דו״ח שנתי" (regression check)
* [ ] Send CS approve-and-send → body text says "הצהרת ההון" not "הדו״ח השנתי"
* [ ] English CS client with 0 docs → subject "No Documents Needed" + body "capital statement"
* [ ] WF[02] receives CS questionnaire → office email subject says "שאלון הצהרת הון התקבל"
* [ ] WF[02] receives AR questionnaire → office email subject still says "שאלון שנתי התקבל" (regression)
* [ ] Verify n8n pre-gen client subject is dynamic for CS

## 8. Implementation Notes

### Fix 1: Workers (Client Doc Request) — DONE
- Added `filingType?: string` to `ClientEmailParams` interface
- Added `FILING_LABELS` constant with `he`, `he_definite`, `en` keys per filing type
- Updated `noDocsNeededBox()` — accepts `filingType`, uses `labels.he_definite` for HE body, `labels.en` for EN body
- Updated `buildClientEmailHtml()` — destructures `filingType`, passes to all `noDocsNeededBox()` calls, HE-only branch subject uses `filingLabel` variable
- Updated `buildClientEmailSubject()` — no-docs HE subject uses `labels.he` instead of hardcoded "דו״ח שנתי"
- Updated `approve-and-send.ts` — reads `filing_type` from report fields, passes in `emailParams`
- TypeScript build passes (only pre-existing unrelated errors)

### Fix 2: n8n Document Service (Office Notification) — DONE
- Added `filingType = input.filing_type || 'annual_report'` to input section
- Added `FILING_LABELS` constant with `he`, `he_definite`, `he_questionnaire`, `en` keys
- Added `filingLabels` convenience variable (resolved from map)
- Updated `noDocsNeededBox(lang, ft)` — accepts filing type param, uses dynamic `labels.he_definite` / `labels.en`
- Updated office subject: `${filingLabels.he_questionnaire} התקבל` instead of hardcoded "שאלון שנתי התקבל"
- Updated HE-only client subject (no-docs case): `${filingLabels.he}` instead of "דו״ח שנתי"
- Updated `emailSubject` output (no-docs HE case): same dynamic label
- Updated all `noDocsNeededBox()` calls to pass `filingType`
- Workflow updated via REST API PUT (active=true confirmed)
