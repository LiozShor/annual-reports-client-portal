---
name: DL-316 — AI Review Tab React Port (Scoping)
description: Cost/risk scoping and decision trigger for porting the AI Review tab from vanilla script.js to a React island. Not an implementation plan — a reference for when to pull the trigger.
type: design-log
---

# Design Log 316: AI Review Tab — React Port Scoping

**Status:** [DRAFT]
**Date:** 2026-04-21
**Related Logs:** DL-306 (React + Vite + TS first slice, client detail modal — precedent), DL-132 (script.js god-component risk), DL-133 (shared constants extraction), DL-238/268/278 (recent structural AI-review work), DL-237/252 (PDF split orchestration), DL-222/224 (conflict dialogs), DL-270 (contract period editing)
**Branch:** `DL-316-ai-review-react-port-scoping`

---

## 1. Context & Problem

The AI Review tab is the heaviest remaining surface in `frontend/admin/js/script.js` (11,512 LOC monolith). DL-306 successfully introduced a Vite + React 18 + TS strict + TanStack Query + Vitest island with the client detail modal slice. The natural question: **is the AI Review tab worth porting next, and at what cost?**

This log is a **decision artifact**, not an implementation plan. It captures the inventory, the cost/risk analysis, and the conditions under which pulling the trigger makes sense. No code is written against this log — a follow-up log (DL-NNN) will carry the actual implementation once the trigger fires.

## 2. User Requirements

| # | Q | A |
|---|---|---|
| 1 | Goal of this log? | **Scoping doc only** — no implementation this session |
| 2 | Scope if ported? | **Full tab** (master list + cards + preview + split modal + reassign + badges + pagination + all inline actions) |
| 3 | Trigger to execute? | **Next real AI review feature request** — Strangler Fig, don't rewrite working code without a forcing function |
| 4 | Test coverage? | **Match DL-306** (2–3 Vitest tests on core flow) |

Implicit: coexistence strategy defaults to "freeze + escape hatch" (no parallel vanilla edits to AI-review during the port unless urgent, in which case the vanilla fix also lands in the React branch in the same PR).

## 3. Research

### Domain
Frontend modernization / Strangler Fig pattern / React island architecture / port-cost estimation for mid-size vanilla-JS surfaces inside a monolith.

### Prior research (cumulative)
DL-306 §3 already covered React Islands, Strangler Fig, Vite library mode, and TanStack Query v5 patterns. Those findings carry forward verbatim — the bridge contract, QueryClient singleton, and server-vs-client state rules apply identically here.

### Incremental sources (this log)
1. **Qonto — AI-Driven Refactoring in Large-Scale Migrations** — 8.6k LOC vanilla→React port in 2 weeks with AI assistance; hand-migration baseline ~50 LOC/day for data-heavy surfaces with mutations and modal orchestration.
2. **Xebia — Migrating to React Step-by-Step** — incremental island-by-island migration; freeze vs. rebase trade-off for parallel vanilla work.
3. **AWS Prescriptive Guidance — Strangler Fig Pattern** — bounded context + rollback path per slice; don't migrate until a forcing function exists.
4. **Martin Fowler — Modularizing React Apps** — component library extraction from a monolith; shared-helper ownership (who owns `createDocCombobox`?).
5. **LogRocket — Server Components vs Islands Architecture** — hydration jank + shared-state coordination as the dominant admin-UI risk (not rendering perf).

### Key principles extracted (incremental)
- **Port cost rule of thumb:** ~50 LOC/day hand-migration for data-heavy surfaces with mutations + modals; multiply 2–5× over "lines translated" for hidden costs (cache invalidation, optimistic updates, bridge events, test harness).
- **Forcing function gate.** Don't port working code without a forcing function (new feature, recurring bug, perf cliff). Pure rewrites are churn — they cost weeks and break user trust when regressions land on a PII-heavy surface.
- **Modal ownership is the cliff.** Tabs with 3+ inline modals (we have split, reassign, preview, reject-notes panel, conflict-resolution dialog) 2–3× the port cost unless the modals move together.
- **Event bus > shared globals.** React island mutates → dispatch `CustomEvent` → vanilla parent refreshes sibling state (`updateClientDocState`, pending-approval badges). Don't try to share `aiClassificationsData` across the boundary.
- **Coexistence freeze beats rebase.** Multi-week ports rebased against active vanilla churn lose days to merge conflicts.

### Anti-patterns to avoid
- **Ceremonial migration:** porting to "be in React" without a feature justifying the risk. Explicitly vetoed by the trigger choice above.
- **Half-port:** migrating the card list but leaving reassign/split as vanilla modals long-term. Fine as a PR boundary during the port; toxic as a permanent state (two languages for one tab = worst of both).
- **Shared mutable state across the bridge:** any approach where vanilla and React both hold references to `aiClassificationsData`. Pick one owner per slice.

### Research verdict
Port is justifiable **once a forcing function exists** (next non-trivial AI Review feature, or a recurring bug). Absent that, leave it alone. When the trigger fires, estimate **4–6 weeks of focused work** (one developer) for the full-tab port — larger than DL-306's single-modal slice, matched by proportionally larger payoff (removes ~3,500 LOC from the monolith, unblocks DL-132 script.js split, establishes the second island for pattern reuse).

## 4. Codebase Analysis

### Surface inventory (from Explore subagent, 2026-04-21)

| Category | LOC | Location |
|---|---|---|
| JS (AI Review logic) | **~3,500** | `frontend/admin/js/script.js` — non-contiguous, see groups below |
| CSS (`.ai-*` selectors, 211 total) | **500–700** | `frontend/admin/css/style.css` lines ~1576–2086 + split/mobile sections |
| HTML host | ~50 | `frontend/admin/index.html` lines 973–1410 (`#tab-ai-review`, `#aiCardsContainer`, `#aiReviewDetail`, nav buttons at 382 + 1407) |
| Backend handler (unchanged by port) | ~800 | `api/src/routes/classifications.ts` — `GET /get-pending-classifications`, `POST /review-classification` (approve/reassign/reject/split/update-contract-period/request-remaining-contract), `GET /get-preview-url` |
| Existing React scaffold | ~100 | `frontend/admin/react/` — Vite lib mode, one island (`client-detail.tsx`), TanStack Query + Vitest already wired |

### JS groups inside script.js (file:line anchors)

- **Module state:** `aiReviewLoaded/aiReviewLoadedAt` (3569–3570), `aiClassificationsData` (3567), `_filteredAI` (3770), `_aiPage` / `AI_PAGE_SIZE` (55, 57), `activePreviewItemId` (3571), `aiCurrentReassignId` / `aiReassignSelectedReportId` (5101, 5110), `splitState` (10843–10850), `REJECTION_REASONS` (3573–3581).
- **Master list + pagination (~500 LOC):** `loadAIClassifications(silent)` 3694–3764, `applyAIFilters` 3771–3835, `goToAIPage` 3837–3841, badge sync 537–557 + 2452–2490.
- **Card rendering (~800 LOC):** `renderAICards` 3897–4200, `renderAICard` 4192–4483, `renderReviewedCard` 4485–4583, `getCardState` 3856–3862, `toggleAIAccordion` 4657–4670, `friendlyAIReason` 3850–3854.
- **Inline actions (~1,300 LOC):** `approveAIClassification` 4736–4783, `resubmitApprove` 4938–4972, `rejectAIClassification`/`showRejectNotesPanel`/`executeReject` 5020–5098, reassign flow 5100–5260 (`showAIReassignModal`, `confirmAIReassign`, `submitAIReassign`, `resubmitReassign`, `assignAIUnmatched`).
- **PDF preview (~250 LOC):** `loadDocPreview` 3612–3692, `getDocPreviewUrl` 3585–3593, `resetPreviewPanel` 3595–3610, `loadMobileDocPreview`/`buildMobilePreviewFooter` 562–710.
- **Split modal (~900 LOC, DL-237/252):** `openSplitModal` 10857–10903, `renderSplitThumbnails` 10919–10984, `setSplitMode` 10986–11007, `parseSplitRanges` 11009–11097, `updateThumbnailHighlights` 11099–11123, `confirmSplit` 11145–11280+.
- **Contract period editing (DL-270):** inline click-to-edit fields on T901/T902 cards; state mutations via `/review-classification` action=update-contract-period.
- **Silent-refresh fingerprinting (DL-247/053):** lines 3719–3731, prevents accordion collapse mid-review.

### Shared helpers (reused — must remain callable across the bridge)

- `createDocCombobox()` line 3295 — doc template picker with new-doc creation + cross-filing-type toggle (DL-239). **Also used by pending-approval queue (DL-292).** Port must preserve this signature or both callers break.
- `showConfirmDialog`, `showAIToast`, `showModal` — global modals (error-handler.js).
- `icon(name, sizeClass)` — DL-314 SVG sprite helper.
- `escapeHtml`, `escapeAttr`, `escapeOnclick` — XSS helpers.
- `updateClientDocState()` — mutation side-effect into doc-manager state. **Port must dispatch an event that triggers this** (or invoke it directly via bridge).
- `renderPagination()` line 60 — shared paginator (safe, pure).
- `window.mountClientDetail` — existing React island, can be invoked from new AI Review island without dual-mount.

### Alignment with research
Codebase patterns match the Strangler Fig prerequisites set in DL-306 (bridge contract, Vite lib mode, QueryClient singleton ready). The main divergence is **modal ownership**: AI Review's modals are tightly coupled to its state (reassign uses `aiCurrentReassignId`, split uses `splitState`), so porting the tab without the modals is not realistic — they ship together.

## 5. Technical Constraints & Risks

- **Security / PII.** AI Review surfaces client documents (Hebrew names, Teudat Zehut, financial PDFs). Every regression risks mis-routing a document or leaking one client's doc into another's folder. Tests must cover approve/reassign/reject/split against realistic fixtures before cutover.
- **Mutation coupling with doc-manager.** `approveAIClassification` and `submitAIReassign` both trigger `updateClientDocState()` which re-renders the doc-manager. Breaking this link means approved docs look stuck. Mitigation: `CustomEvent` bus, documented in the bridge contract.
- **Shared `createDocCombobox()` ownership.** If the port rewrites the combobox as a React component, pending-approval queue (DL-292) breaks. Options: (a) port both surfaces in one slice (scope creep), (b) keep vanilla `createDocCombobox` callable from inside React via bridge (recommended), (c) port both surfaces as they naturally arise (deferred decision).
- **PDF split complexity.** DL-237/252 orchestration (pdf.js thumbnails, manual-range parsing, per-segment progress) is ~900 LOC with real async edge cases. Biggest single risk inside the port. Budget 1 week alone for the split modal.
- **Silent-refresh fingerprinting.** DL-247/053 prevents accordion collapse mid-review. Must survive the port; TanStack Query's `structuralSharing` gives a native equivalent — verify behaviourally.
- **Merge churn during the port.** 4–6 week port against an active AI-review area (DL-315 just shipped, DL-217/245/278 all recent). Freeze-with-escape-hatch is the default, but user should expect to decline or defer ordinary AI-review feature requests during the port window.
- **No scope creep into WF02/WF05.** Port is frontend-only. Backend (`api/src/routes/classifications.ts`) stays unchanged — contract is the wire protocol.

### Breaking-changes risk: low if bridge contract respected
As long as `window.openAIReviewTab()` / `window.refreshAIReview()` (or equivalent bridge) preserves today's DOM callbacks (tab switching, badge updates, visibility refresh, mobile preview), downstream callers in script.js keep working. Deletion of the vanilla implementation happens in the final commit of the port, not incrementally.

## 6. Proposed Solution (The Blueprint) — *Applied when trigger fires, not now*

### Success criteria (for the eventual port)
One sentence: the AI Review tab is served entirely by a React island mounted into `#tab-ai-review`, the vanilla implementation (~3,500 LOC across `script.js`) is deleted, and every existing action (approve/reassign/reject/split/contract-period edit/request-missing/mobile preview) works end-to-end with live data, with Vitest coverage on the approve + reassign + reject flows.

### Recommended structure (reference only — not executed this session)
- `frontend/admin/react/src/islands/ai-review.tsx` — entry, mounts `<AIReviewTab>`, exposes `window.mountAIReviewTab(el)` / `window.unmountAIReviewTab(el)` / `window.refreshAIReviewTab()`.
- `frontend/admin/react/src/ai-review/` — component tree:
  - `AIReviewTab.tsx` — top-level (filters, stats bar, pagination, master list + detail pane layout)
  - `ClientAccordion.tsx` — grouped by client, FIFO order
  - `ReviewCard.tsx` / `ReviewedCard.tsx` — pending + reviewed card variants
  - `ReassignModal.tsx` — wraps vanilla `createDocCombobox` via ref callback (bridge the combobox, don't re-port it in slice #1)
  - `SplitModal.tsx` — port the DL-237/252 orchestration (budget ~1 week alone)
  - `PreviewPanel.tsx` — desktop split-view iframe; mobile modal kept as thin shim
  - `ContractPeriodBanner.tsx` — DL-270 inline editors
  - `useClassifications.ts` — TanStack Query hook for `/get-pending-classifications` + `/review-classification` mutations with optimistic updates
  - `events.ts` — typed `CustomEvent` emitters (`ai-review:approved`, `ai-review:reassigned`, `ai-review:rejected`, `ai-review:split`) that vanilla `updateClientDocState` / badge syncs listen for
- Strict TS on payloads (`ClassificationItem`, `ReviewAction`, `SplitGroup`).
- Vitest: (1) card renders + action buttons respect `review_status`, (2) approve optimistic update + rollback on 409 conflict, (3) reject panel validation.

### Estimated effort (for the eventual port)

| Slice | Effort |
|---|---|
| Island scaffold + types + bridge + tab mount | 3 days |
| Master list + filters + pagination + silent refresh | 4 days |
| Card rendering (pending + reviewed + badges) | 4 days |
| Approve flow + conflict dialog + optimistic update | 3 days |
| Reassign flow (bridging combobox) + cross-filing-type toggle | 3 days |
| Reject + contract period banner + request-missing | 3 days |
| PDF split modal (DL-237/252 reimpl on pdf.js) | 5 days |
| Preview panels (desktop + mobile) | 2 days |
| Vitest coverage (3 tests per DL-306 pattern) | 2 days |
| Event-bus integration with vanilla doc-manager + badges | 2 days |
| QA, live testing against real PII-sanitized clients | 3 days |
| Cutover commit (delete vanilla ~3,500 LOC + CSS prune) | 1 day |
| **Total** | **~35 working days (≈ 5 weeks, 1 dev)** |

### Files to change (eventual port — reference only)

| File | Action | Description |
|---|---|---|
| `frontend/admin/react/src/islands/ai-review.tsx` | Create | Island entry + bridge |
| `frontend/admin/react/src/ai-review/*.tsx` | Create | Component tree above |
| `frontend/admin/react/src/ai-review/*.test.tsx` | Create | 2–3 Vitest tests |
| `frontend/admin/react/package.json` | Modify | Add pdf.js dep for split modal |
| `frontend/admin/react/vite.config.ts` | Modify | Add second lib entry (`ai-review`) |
| `frontend/admin/react-dist/ai-review.*` | Create (committed build) | Built output |
| `frontend/admin/index.html` | Modify | Script tag for built island; keep `#tab-ai-review` container |
| `frontend/admin/js/script.js` | Modify | Delete ~3,500 LOC of AI-review functions; replace tab-switch handler with `window.mountAIReviewTab` call; keep `updateClientDocState` as event listener |
| `frontend/admin/css/style.css` | Modify | Prune `.ai-*` selectors (or import from island CSS) |

### Final step (always)
Update design log DL-316 status → `[COMPLETED — superseded by DL-NNN]` once the forcing-function log is created and its port is live. Until then, this log stays `[DRAFT]` as a decision reference.

## 7. Validation Plan

Because this log is scoping-only, "validation" is that the decision holds up when the trigger fires.

- [ ] When the next AI Review feature request arrives, reopen this log before starting vanilla work. If the feature touches ≥2 of the 6 groups in §4, open a new DL that ports instead.
- [ ] If no feature request arrives within 6 months (review date: 2026-10-21), reassess: has the vanilla tab stabilised enough to leave alone indefinitely, or has latent pain built up?
- [ ] When the port log is opened, re-run the Phase A inventory — LOC counts and file:line anchors in §4 drift fast.

## 8. Implementation Notes (Post-Code)

N/A — no code written for this log. All implementation notes belong on the forcing-function log that eventually executes the port.

---

## Bottom-line recommendation

**Don't port the AI Review tab today.** It works, it's PII-sensitive, and a cold rewrite is 5 weeks of regression risk with no new user value. **Do port it the moment the next non-trivial AI Review feature lands** — at that point the port is the cheapest way to ship the feature, the risk is justified by the new value, and it removes ~3,500 LOC from the `script.js` monolith as a bonus. This log is the reference for that decision.
