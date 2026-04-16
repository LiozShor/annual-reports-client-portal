# Design Log 292: Review & Approve Queue Tab (Pending_Approval UX)
**Status:** [DRAFT]
**Date:** 2026-04-16
**Related Logs:**
- DL-291 (mobile UX audit — identified W-1 P1 doc list ↔ questionnaire scroll friction)
- DL-268/278 (AI review split layout + FIFO pagination)
- DL-161 (stage pipeline — Pending_Approval = stage 3)
- DL-187 (stage-3 attention bounce)
- DL-092 (duplicate-send guard in approve-and-send)
- DL-110 (client_questions write path via EDIT_DOCUMENTS)
- DL-199 (client notes timeline)

## 1. Context & Problem

The office moves clients out of `Pending_Approval` (stage 3 — "התקבל שאלון, טרם נשלחו מסמכים") via a high-friction round-trip:

1. Dashboard → stage-3 filter → pick a row
2. Navigate to `document-manager.html?report_id=…`
3. Scroll the AI-generated doc list (~2679px on mobile, 3.2 viewports per DL-291 §6B)
4. Cross-reference the questionnaire (buried in `#secondaryZone` ~2900px below)
5. Click "Approve & Send"
6. Navigate back to dashboard, repeat

Per DL-291 W-1 (P1): ~46,000px scroll ≈ 55 viewport-heights per 8-doc session. There is no queue, no split view, no scannable at-a-glance, no keyboard density. Office told us the AI-Review tab (master cards + sticky preview) is "very comfortable" and wants the same feel for stage 3.

## 2. User Requirements

1. **Q:** Where does this live? **A:** New top-nav tab "סקירה ואישור" alongside AI-Review.
2. **Q:** What shows on each card at-a-glance? **A:** Questionnaire-answer chips (non-"No" only) + auto-generated doc list chips + client notes (if any) + prior-year context placeholder.
3. **Q:** "Questions for Client" visibility? **A:** Prominent outlined button on every card with counter badge; opens a lightweight admin modal that wraps the existing `client_questions` save endpoint.
4. **Q:** Approve gesture? **A:** Single green button → existing `APPROVE_AND_SEND` endpoint → card slides out → toast "נשלח ל[client]" → next card auto-focuses into preview. No undo (infeasible given immediate/Outlook-deferred send paths).
5. **Q:** Preview panel? **A:** Sticky right (start in RTL) panel; click card → shows full Q&A + full doc list + notes timeline. Same pattern as AI-Review.
6. **Q:** Sort? **A:** Oldest-first FIFO, matches AI-Review (DL-268).

## 3. Research

### Sources
- **Linear Triage** — dedicated tab per-team; keyboard shortcuts (1=accept, 3=decline, J/K=navigate) drive speed. Empty state is the signal of "done."
- **NNGroup Cards** — cards are for summaries with linked details, not comprehensive data. High-info-scent, heterogeneous chunks, secondary actions. Anti-pattern: full content duplicated on card + detail.
- **Enterprise approval case study (Medium, K. Odewole)** — abandoned manual workarounds when "no at-a-glance status"; categorized info + dashboard counts + progressive disclosure fixed it.
- **Superhuman** — speed + clarity = low mental energy. Keyboard-driven for repetitive triage.

### Applied Principles
- Card = summary, preview panel = full detail.
- One primary action per card (approve-and-send).
- Sticky preview (no navigation cost — the W-1 friction goes to zero).
- Empty state is a goal: "כל השאלונים נסקרו".

## 4. Codebase Analysis

### Reuse Matrix
| Surface | File | Reuse |
|--------|------|-------|
| Split-view CSS | `frontend/admin/css/style.css:3269` | `.ai-review-split`, `.ai-review-master`, `.ai-review-detail`, `.preview-header-bar` — variant class for new tab |
| Pagination renderer | `frontend/admin/js/script.js:43` `renderPagination()` | Call with new container id `#paPagination` |
| Tab switcher | `frontend/admin/js/script.js:295` `switchTab()` | Register new tab identical to AI-Review |
| Approve endpoint | `frontend/shared/endpoints.js:49` `APPROVE_AND_SEND` | Same URL/params as `approveAndSendToClient()` in `document-manager.js:2614` — duplicate-send guard (DL-092) preserved |
| Format-questionnaire | `api/src/lib/format-questionnaire.ts` | Called server-side to build per-report `answers_summary` |
| Doc-builder | `api/src/lib/doc-builder.ts` | `groupDocsByPerson` + `formatForOfficeMode` for full doc list in preview |
| Edit client_questions | `ENDPOINTS.EDIT_DOCUMENTS` | `client_questions` writes through this same endpoint; our new admin modal POSTs the same payload shape |
| Toast + confirm dialog | `showAIToast()`, `showConfirmDialog()` (global helpers) | Reuse verbatim |
| Stage-3 bounce | `frontend/admin/css/style.css:222` `@keyframes stage3-bounce` | Existing; becomes a clickable affordance that `switchTab('pending-approval', event)` |

### No new abstractions
All primitives (split view, cards, pagination, toast, modal overlay, approve endpoint, questions endpoint) already exist. The new tab is a composition, not new infrastructure.

## 5. Technical Constraints & Risks

- **Duplicate-send guard (DL-092):** preserved — `APPROVE_AND_SEND` endpoint is unchanged; its existing confirm-send warning still fires.
- **Prior-year context:** data pipeline is NOT in place. Placeholder only; follow-up DL owns it.
- **Stage filter drift:** stage is stored as `"Pending_Approval"` (capital case, DL-161). Filter formula must match.
- **Dual filing types (DL-216/219/228):** endpoint accepts `filing_type` query param, same pattern as `/admin-pending`.
- **Stale data after approve:** after a card is approved, the stage changes to `Collecting_Docs`. We remove from local list immediately and update badge; on next fetch the filter naturally excludes it.
- **`notes` and `client_notes` fields:** both exist on the report record (per `documents.ts:242-243`); surface both in the preview. Keep card-level summary to first 3 (reuse DL-199 display contract).

## 6. Technical Design

### 6.1 New backend endpoint (only new backend surface)

`GET /webhook/admin-pending-approval?token=<admin>&year=<yyyy>&filing_type=<annual_report|capital_statement>`

Auth: same pattern as `/admin-pending` — Bearer header OR `?token=` query param.

Filter: `AND({year}=<year>, {stage}='Pending_Approval', {client_is_active}=TRUE(), {filing_type}='<filing_type>')`

Returns stage-3 reports with everything needed in a single round-trip (AI-Review pattern):

```json
{
  "ok": true,
  "items": [
    {
      "report_id": "recXXX",
      "client_id": "CPA-XXX",
      "client_name": "...",
      "spouse_name": "...",
      "filing_type": "annual_report",
      "year": 2025,
      "submitted_at": "2026-04-12T09:00:00Z",
      "answers_summary": [ {"label": "...", "value": "..."} ],
      "docs": [ {"template_id": "T101", "short_name_he": "...", "category_emoji": "📄", "status": "Required_Missing|Received|Waived"} ],
      "notes": "…",
      "client_notes": "…",
      "client_questions": "[{...}]",
      "prior_year_placeholder": true,
      "docs_first_sent_at": null
    }
  ],
  "count": N
}
```

**Implementation outline:**
1. Airtable list call on reports with the composed filter.
2. For each report: parallel fetch questionnaire record (already filtered by `report_record_id`) + doc records (same `FIND(report_id, {report_record_id})` as `documents.ts:158`).
3. Build `answers_summary` by calling `formatQuestionnaire()` and filtering out `'No'`-shaped answers (pattern reused from frontend filter — backend pre-filter here).
4. Build `docs[]` light-weight from the doc records (id, template_id, short_name_he, category_emoji, status) — no URL resolution needed (preview panel uses a second call for details when clicked).
5. Sort by `submitted_at` ASC (FIFO).

**File:** `api/src/routes/admin-pending-approval.ts`
**Register:** `api/src/index.ts` — `app.route('/webhook', adminPendingApproval)`.

### 6.2 Frontend: new tab

**HTML** (`frontend/admin/index.html`):
- New tab button (alongside AI-Review):
  ```html
  <button class="tab-item" onclick="switchTab('pending-approval', event)">
      <i data-lucide="clipboard-check" class="icon-sm"></i> סקירה ואישור
      <span class="ai-review-tab-badge ai-badge-loading" id="pendingApprovalTabBadge">...</span>
  </button>
  ```
- New tab content div `<div id="tab-pending-approval" class="tab-content">` with `.ai-review-split` markup mirroring AI-Review (cards master + preview detail).
- Mobile bottom-nav entry behind "עוד" popover (matches `review` + `reminders` group).

**JS** (`frontend/admin/js/script.js`) — new section:
- `loadPendingApprovalQueue(silent)` — SWR pattern matching `loadAIClassifications()` (line 3539); stores `pendingApprovalData` globally + staleness timestamps.
- `renderPendingApprovalCards(items)` — renders cards in `#paCardsContainer`. Each card:
  - Header: client name + client_id + submitted-date (relative: "לפני יומיים")
  - Chips row 1: answers (non-"No") — first 4 + "+N more"
  - Chips row 2: doc list (first 6 short_name_he + "+N" overflow)
  - Notes timeline (reuse DL-199 render, max 3)
  - Prior-year row: placeholder "—" (explicit TODO comment)
  - Actions row: "📝 שאל את הלקוח" (outlined) with counter badge + "✓ אשר ושלח" (green primary)
- `loadPaPreview(reportId)` — populates `#paPreview` with full Q&A + full doc list grouped by category + full notes. Same `.preview-active` card state as AI-Review.
- `openQuestionsForClient(reportId)` — opens `.ai-modal-overlay` modal; add/edit/delete questions; saves via `EDIT_DOCUMENTS` with `{ report_id, client_questions: [...] }` payload (same shape as `document-manager.js:2456`).
- `approveAndSendFromQueue(reportId, clientName)` — calls `APPROVE_AND_SEND?report_id=X&confirm=1&respond=json`; on `ok=true`, slide-out animation on card, `showAIToast('נשלח ל' + clientName, 'success')`, remove from local list, auto-focus next card's preview, decrement tab badge.
- Prefetch: add `if (!pendingApprovalLoaded) loadPendingApprovalQueue(true);` in the deferred block around `script.js:778`.
- Stage-3 stat card click handler: make `.stat-card.stage-3` also switch to the new tab (preserves `toggleStageFilter('3')` on the second click/dblclick).
- `switchTab()`: add `else if (tabName === 'pending-approval') loadPendingApprovalQueue(true);`.

**CSS** (`frontend/admin/css/style.css`):
- `.pa-card` variant of `.ai-review-card` with amber left border matching stage-3 (`#F59E0B`).
- `.pa-chip` for answer/doc chips.
- `.pa-card--sending` slide-out animation (transform + opacity, 300ms).
- `.stat-card.stage-3 { cursor: pointer; }` (already clickable via `toggleStageFilter` — no change needed; affordance is from bounce).
- Mobile: existing AI-Review responsive rules apply as long as class names match.

### 6.3 Questions-for-Client admin modal

Built on `.ai-modal-overlay` + `.ai-modal-panel` (CLAUDE.md rule: never use native `confirm/alert`). Renders add/delete/edit UI scoped to the queue card; posts to `ENDPOINTS.EDIT_DOCUMENTS` with payload `{ report_id, client_questions: [...] }`. On save success: refresh the card's badge counter inline.

Payload shape matches `document-manager.js:2456-2570`:
```json
{
  "report_id": "recXXX",
  "client_questions": [
    { "id": "q_abc", "text": "...", "answer": "" }
  ]
}
```

### 6.4 Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/admin-pending-approval.ts` | **Create** | New GET endpoint; reuses `formatQuestionnaire`, doc-builder helpers, Airtable client |
| `api/src/index.ts` | Modify | Register new route |
| `frontend/shared/endpoints.js` | Modify | Add `ADMIN_PENDING_APPROVAL` URL constant |
| `frontend/admin/index.html` | Modify | New tab button + `#tab-pending-approval` content + mobile bottom-nav entry under "עוד" |
| `frontend/admin/js/script.js` | Modify | Queue loader + card renderer + preview binder + approve handler + questions modal + prefetch call + tab-switch wiring |
| `frontend/admin/css/style.css` | Modify | `.pa-*` class variants + slide-out animation |
| `.agent/design-logs/admin-ui/292-pending-approval-review-queue-tab.md` | **Create** | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-292 entry |

## 7. Validation Plan (Post-Code)

End-to-end tests after deploy:

- [ ] New tab "סקירה ואישור" visible in top nav and mobile bottom nav ("עוד" popover)
- [ ] Tab badge shows count matching stage-3 stat card
- [ ] Queue lists stage-3 reports only, oldest-first
- [ ] Each card renders: header, answers chips (no "No" answers), doc list chips, notes (if any), questions button + counter, approve button
- [ ] Click card → preview panel shows full Q&A + full doc list grouped by category + full notes timeline
- [ ] Prior-year placeholder renders as "—" (no error)
- [ ] Questions modal: add → save → badge counter updates without full reload
- [ ] Approve & Send → card slide-out → toast "נשלח ל..." → stage advances to Collecting_Docs (verified in Airtable) → next card auto-focuses
- [ ] Already-sent case: existing DL-092 confirm-send warning still fires if admin re-approves after stage change
- [ ] Empty state ("כל השאלונים נסקרו") when no stage-3 reports
- [ ] Stage-3 stat card on dashboard → click → switches to the new tab
- [ ] Mobile (390px): cards stack, preview panel hides (master-only mode); modals render full-screen
- [ ] Keyboard: Tab + Enter on card opens preview; Esc closes modals (no new J/K shortcuts this round — deferred)
- [ ] RTL rendering correct (chips wrap, preview panel on start side)
- [ ] Filing-type (AR ↔ CS) filters the queue
- [ ] Year filter matches questionnaires-tab behavior
- [ ] No regression: existing AI-Review, document-manager approve-send, right-click context menu unchanged

## 8. Deferred / Out of Scope

- **Prior-year context data pipeline** — placeholder only; follow-up DL.
- **Keyboard shortcuts (J/K/1/3)** — ship as a follow-up DL once the tab is proven.
- **Undo-send** — infeasible given immediate/Outlook-deferred send paths.
- **Batch approve** — intentionally excluded; one-client-at-a-time preserves review quality.

## 9. Implementation Notes (Post-Code)

*Filled after implementation lands.*
