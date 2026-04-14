# Design Log 268: Partial Rental Contract Detection & Missing Period Request
**Status:** [BEING IMPLEMENTED — DL-268]
**Date:** 2026-04-14
**Related Logs:** DL-252 (frontend-orchestrated split), DL-248 (reassign conflicts)

## 1. Context & Problem

Natan reported that clients sometimes send rental contracts (חוזה שכירות, T901/T902) covering only part of the tax year — e.g., a contract from January to August. In these cases, the office needs to request the remaining period's contract (September–December). Currently:

- The AI classifier identifies T901/T902 but does **not** extract contract dates
- There's no mechanism to flag partial-year coverage
- Natan must manually notice the gap and manually create a new document requirement
- This is error-prone and easy to miss during busy season

## 2. User Requirements

1. **Q:** How should the partial contract be detected?
   **A:** Both — AI detects contract period automatically, Natan confirms before acting.

2. **Q:** What should happen after flagging?
   **A:** Add a new document record with status `Required_Missing` so it shows in the client's doc list and next reminder email.

3. **Q:** Which template types?
   **A:** Both T901 (rental income, client is landlord) and T902 (rental expense, client is tenant).

4. **Q:** Where in the UI flow?
   **A:** Directly on the AI review card — Natan sees detected dates and can request the missing period right there.

## 3. Research

### Domain
Document AI field extraction, human-in-the-loop verification, tax document completeness checking.

### Sources Consulted
1. **AI Document Analysis best practices (V7 Labs, 2025)** — Human-in-the-loop (HITL) boosts accuracy from ~80% to 95%+.
2. **Tax document collection tools (Credfino comparison, 2026)** — Auto-detect missing docs, one-click reminders.
3. **Hyland AI Document Extraction** — AI uses context to extract dates reliably from contracts.

### Key Principles Extracted
- **HITL for contract dates**: AI extracts, human confirms before creating new requirements
- **Non-blocking UI**: Partial detection should inform but not block approval
- **Existing workflow integration**: Missing period doc enters standard pipeline

### Research Verdict
AI extracts, human confirms, new doc created on demand. Fits existing HITL review card pattern.

## 4. Codebase Analysis

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/document-classifier.ts` | Modify | Add `contract_period` to tool schema + system prompt |
| `api/src/routes/classifications.ts` | Modify | Pass `contract_period` in list response; add `request-remaining-contract` action |
| `frontend/admin/js/script.js` | Modify | Add contract period banner to `renderAICard` for T901/T902 |
| `frontend/admin/css/ai-review.css` | Modify | Add `.ai-contract-period-banner` styles |

## 5. Technical Constraints & Risks
- AI date extraction accuracy varies — Natan always confirms
- Multi-year contracts need tax-year-specific logic
- No breaking changes — `contract_period` is optional (null for non-rental)

## 6. Proposed Solution
See plan file for full details.

## 7. Validation Plan
- [ ] Upload a partial-year rental contract → verify AI extracts contract_period
- [ ] Verify AI review card shows amber banner with correct period
- [ ] Click request button → verify new Required_Missing doc created
- [ ] Upload full-year contract → verify NO banner
- [ ] Upload non-rental doc → verify NO banner
- [ ] Approve T901 with partial period → verify approval works independently
- [ ] Test multi-year contract edge case
- [ ] Verify no regression in existing approve/reject/reassign flows

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
