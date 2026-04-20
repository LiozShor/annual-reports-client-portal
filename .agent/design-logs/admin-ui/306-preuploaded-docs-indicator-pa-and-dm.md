# Design Log 306: Pre-Uploaded Docs Indicator on PA Card + Doc Manager
**Status:** [COMPLETED (live 2026-04-20)]
**Date:** 2026-04-20
**Related Logs:** DL-290 (pending_review count alignment), DL-292/294/295/298 (PA queue redesign — stacked cards), DL-244 (rejected-uploads callout pattern), DL-238 (AI Review unified tab)

## 1. Context & Problem

Audit run 2026-04-20 found 2 clients (CPA-AAA [name redacted], CPA-BBB [name redacted]) in stage `Pending_Approval` with unreviewed `pending_classifications` — i.e., the client proactively sent documents via email (caught by WF05 → Worker inbound pipeline) **before** the office approved & sent the required-docs list.

When the office now approves & sends from the PA queue, the client receives "here's the list of docs you need to send" — and rightly thinks *"but I already sent these?"* — eroding trust.

The required-docs email itself is still correct (the client may still be missing items), but surfacing the existing prior submissions before the office hits the approve-and-send button lets the office either (a) review + classify first in AI Review, or (b) at least know about it when replying to the client.

## 2. User Requirements
1. **Q:** What counts as "client already sent docs"?
   **A:** `pending_classifications` with `review_status='pending'` (cleanest signal — matches DL-290 AI Review badge; excludes already-reviewed).
2. **Q:** Which surfaces should show the indicator?
   **A:** (1) PA queue card, (2) Document Manager page header.
3. **Q:** What visual + behavior?
   **A:** Info banner + "Go to AI Review" button. Non-blocking (no confirm dialog, no hard block).
4. **Q:** "Go to AI Review" target + stage scope?
   **A:** Opens AI Review in a new tab (`?client=CPA-XXX`). Only checked for reports in `Pending_Approval` stage.

## 3. Research

### Domain
Admin CRM notification UX · information scent · cross-reference navigation · preventing duplicate/redundant work.

### Sources Consulted
1. **Carbon Design System — Notification Patterns** — Distinguishes *action-required* from *passive/informational*; passive notifications don't interrupt user flow. (`carbondesignsystem.com/patterns/notification-pattern`)
2. **Material Design 3 — Badges & Alerts** — Badges show counts + status on components; passive alerts display brief non-blocking messages. (`m3.material.io/components/badges/guidelines`)
3. **NN/G — Cards & Information Scent** — Cards group related info and serve as entry points to deeper content without overload. (`nngroup.com/articles/cards-component`)
4. **Clickable Card Patterns — Deep Linking** — "Stretched Link Pattern": make the primary action semantically linked with large hit area; do NOT make the whole card clickable if the card has multiple actions. (`dev.to/micmath/clickable-card-patterns`)

### Key Principles Extracted
- **Passive, not blocking.** The office may still legitimately want to send the doc list (missing items remain). A banner informs; it does not gate the primary action. (Carbon)
- **Information scent > enforcement.** A single "Go to AI Review" button inside the banner gives a short scent trail to where the prior work lives; it does not replicate the AI Review UI inside the PA card. (NN/G)
- **Badge + passive alert pair.** Use the count (e.g., "2 unclassified documents") inside the banner text rather than as a separate floating chip — one combined signal in the PA card, not two. (Material)
- **Don't absorb the whole card into one link.** PA card already has approve-and-send, chevron, doc-manager link, per-doc menus. Keep the "Go to AI Review" button a distinct action, not a card-wide click target. (DEV)

### Patterns to Use
- **Info callout:** same visual family as DL-244's rejected-uploads callout (info-tinted strip at top of card body, neutral icon, left-border accent). Keeps PA card visual language consistent.
- **New-tab deep link:** `frontend/admin/index.html?tab=ai-review&client={CPA-ID}` — AI Review tab reads `URLSearchParams` on load, sets filter/scroll state to that client's accordion, auto-opens it.

### Anti-Patterns to Avoid
- **Hard block on send** — even if pre-sent docs exist, the client may be missing others. Blocking creates false friction.
- **Modal confirm dialog** — breaks approval momentum; the user explicitly asked for non-blocking.
- **Duplicating AI Review rows inline in the PA card** — overloads the card, creates divergence when the underlying data changes.

### Research Verdict
Passive info banner matching DL-244's visual pattern, with a single "open in AI Review" button (Hebrew label in UI) that opens in a new tab so the office keeps their PA queue context. No hard block. No confirm dialog. Count (e.g., "2 unclassified documents") lives inside the banner text.

## 4. Codebase Analysis

### Existing Solutions Found
- **`api/src/routes/admin-pending-approval.ts`** — already resolves `pending_classifications` link field on the reports table (visible via linked-record traversal). Currently doesn't return pending-classification data in the response.
- **`api/src/routes/reminders.ts:107`** — precedent: `pending_count: Array.isArray(f.pending_classifications) ? (f.pending_classifications as string[]).length : 0`. Reads the link-field array length. **But** this counts *any* linked classification regardless of `review_status`. For this log we need `review_status='pending'` only → must fetch the pending_classifications table directly to get the status.
- **`api/src/routes/reminders.ts:276-293`** — precedent for pending-classification warnings before `approveAndSend` (already checked for recent-send warnings). Different flow (Type B reminders), but confirms the pattern of surfacing pending-classification state before office action.
- **PA card render:** `frontend/admin/js/script.js:5873-5938` (`buildPaCard`). Header at 5901, body at 5917. **Banner should go at the top of the body** (`pa-card__body`), above `buildPaPreviewBody(item)` — visible only when expanded, which is fine because approve-and-send button lives in the expanded body too.
- **Doc Manager:** `frontend/document-manager.html:40` — `<header class="page-header">` with `.page-header-top` container. Banner goes just below the header.
- **AI Review accordion:** `frontend/admin/js/script.js:3873` — `.ai-accordion[data-client="{clientName}"]`. No current URL-param deep-link handling. `toggleAIAccordion(header)` opens one accordion at a time. Need to add param read in AI Review init → find accordion by `data-client` match, scroll into view, call open.
- **Rejected-uploads callout pattern:** `frontend/assets/js/view-documents.js:332` renders a callout container; `.rejected-uploads-list` styling at `frontend/admin/css/style.css:7274`. Reuse the visual family.

### Reuse Decision
- **Reuse:** CSS family from DL-244 rejected-uploads callout (info variant — neutral/blue tint instead of the red/warning tint). Reuse the link-field count pattern from `reminders.ts:107`, but filter by `review_status='pending'`.
- **Build new:** (a) `pending_reviews_count` field in `/admin-pending-approval` response (fetch pending_classifications scoped to stage-3 report ids, filter by `review_status='pending'`); (b) `GET_CLIENT_REPORTS` enrichment (same field per report, for doc-manager); (c) URL-param deep-link handler in AI Review init.

### Relevant Files
| File | Why |
|------|-----|
| `api/src/routes/admin-pending-approval.ts` | Add `pending_reviews_count` per report |
| `api/src/routes/client-reports.ts` (or wherever `GET_CLIENT_REPORTS` lives) | Add same field for doc-manager consumption |
| `frontend/admin/js/script.js` (`buildPaCard`, ~5873) | Render banner in PA card body |
| `frontend/admin/js/script.js` (AI Review init) | URL-param deep-link handler |
| `frontend/assets/js/document-manager.js` | Render banner below page-header |
| `frontend/document-manager.html` | Add banner container |
| `frontend/admin/css/style.css` | Reuse callout family, add info variant |

### Dependencies
- Airtable `pending_classifications` table (`tbloiSDN3rwRcl1ii`) — `report` link, `review_status`, `attachment_name`, `received_at`
- AI Review tab currently filters by year/filing_type — CPA-ID filter needs matching attribute on accordion element (already has `data-client="{clientName}"` — switch to `data-client-id` for precise match, or keep name match if unique in-view).

### Alignment with Research
Codebase already has the DL-244 callout pattern + the `reminders.ts` precedent for reading `pending_classifications` — both line up with the "passive alert + information scent" approach. Divergence: current `pending_count` in reminders doesn't filter by `review_status`. For a user-facing indicator we need the tighter filter so already-reviewed items don't cause false banners.

## 5. Technical Constraints & Risks

### Security
- No new PII exposure — `pending_reviews_count` is just an integer per report the office already has access to.

### Risks
- **Stale data:** if office approves a pending classification in AI Review, the PA card banner won't auto-refresh until PA data reloads. Mitigation: PA already reloads on tab switch; accept staleness until next load. No websocket needed.
- **Count mismatch with AI Review badge (DL-290):** DL-290 counts unique `client_id` across stages; this log counts raw pending rows per report. These will rarely differ for stage-3 clients but could be off-by-one if a client has both AR + CS filings. Acceptable — DL-290 lives in reminders sidebar, this lives on the PA card itself.
- **New-tab popup blockers:** Opening via `<a target="_blank">` with explicit click = no blocker issue.

### Breaking Changes
- `admin-pending-approval` response shape adds `pending_reviews_count` (additive — safe).
- `GET_CLIENT_REPORTS` adds same (additive).

## 6. Proposed Solution (The Blueprint)

### Success Criteria
PA card + doc-manager header show an info banner when `pending_reviews_count > 0`, with a "פתח ב־AI Review" button that opens AI Review in a new tab filtered to that client's accordion (auto-scrolled + expanded).

### Logic Flow
1. Backend (`admin-pending-approval`): after fetching stage-3 reports, fetch `pending_classifications` filtered by `{review_status}='pending'` AND any of the stage-3 report record IDs. Group by `report[0]`. Attach `pending_reviews_count` per report item.
2. Backend (`GET_CLIENT_REPORTS` / doc-manager data endpoint): same query scoped to the single client's active reports. Attach `pending_reviews_count` on each report.
3. Frontend PA card (`buildPaCard`): if `item.pending_reviews_count > 0`, render info banner at the top of `.pa-card__body`.
4. Frontend doc-manager: if `report.pending_reviews_count > 0` AND stage is `Pending_Approval`, render banner below `.page-header`.
5. Frontend AI Review init: read `?client={CPA-ID}` from URL. After render, find accordion by CPA-ID match, `scrollIntoView({behavior:'smooth', block:'start'})`, call `toggleAIAccordion()` to open it.

### Data Structures / Schema Changes
No Airtable schema changes. API response additions:
- `admin-pending-approval` item: `pending_reviews_count: number`
- `GET_CLIENT_REPORTS` report object: `pending_reviews_count: number`

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/admin-pending-approval.ts` | Modify | Fetch + join pending_classifications (review_status=pending) for stage-3 reports; add `pending_reviews_count` per item |
| `api/src/routes/*` (GET_CLIENT_REPORTS handler) | Modify | Same join scoped to single client's reports |
| `frontend/admin/js/script.js` (`buildPaCard`) | Modify | Render info banner at top of `.pa-card__body` when count > 0 |
| `frontend/admin/js/script.js` (AI Review init / render) | Modify | Read `?client=` URL param, scroll + open matching accordion. Ensure accordion has `data-client-id` attribute for precise match |
| `frontend/assets/js/document-manager.js` | Modify | Render banner below page-header when count > 0 AND stage=Pending_Approval |
| `frontend/document-manager.html` | Modify | Add `<div id="preuploaded-docs-banner"></div>` below `.page-header` |
| `frontend/admin/css/style.css` | Modify | Add `.preuploaded-banner` (info variant of callout family) |

### Final Step (Always)
- **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Active TODOs"

## 7. Validation Plan

**End-to-end with real data (CPA-AAA, CPA-BBB):**
- [ ] Open admin panel → PA tab → expand CPA-AAA card → banner shows Hebrew "client already sent 16 unclassified documents" + open-in-AI-Review button
- [ ] Same for CPA-BBB (6 pending)
- [ ] Click button → new tab opens AI Review filtered/scrolled to CPA-AAA accordion, accordion auto-expanded
- [ ] Open doc-manager for CPA-AAA → banner visible below page-header
- [ ] Approve + send from CPA-BBB PA card (banner visible) → action completes without blocking confirm dialog (non-blocking = still works)

**Negative cases:**
- [ ] CPA without pending classifications → no banner on PA card
- [ ] CPA in stage `Collecting_Docs` (already past Pending_Approval) → no banner on doc-manager even if pending exist (scope is Pending_Approval only)
- [ ] CPA whose pending classifications were all approved/rejected → no banner (review_status filter works)

**Regression:**
- [ ] Existing PA card render: chevron, approve/questions buttons, doc-manager link still work
- [ ] Existing AI Review tab navigation (without `?client=`) still loads normally
- [ ] DL-244 rejected-uploads callout still renders correctly (CSS didn't collide)
- [ ] PA queue count badge in dashboard (stage 3) unchanged

**Data integrity:**
- [ ] `pending_reviews_count` reflects only `review_status='pending'` — spot-check against Airtable directly

## 8. Implementation Notes (Post-Code)

Implemented via subagent-driven development in 2 waves (backend → 3 parallel frontend/CSS streams) on 2026-04-20.

**Commits on `DL-306-preuploaded-docs-indicator`:**
- `1406022` feat(api): `pending_reviews_count` attached to `/admin-pending-approval` and `/get-client-reports` response items. Parallel fetch of `pending_classifications` filtered by `AND({review_status}='pending', OR(FIND…))`, grouped by `report[0]`. No caching (per plan — data changes on every AI-review action).
- `cab2da4` style(admin): `.preuploaded-banner` info callout using existing `--info-50 / --info-500 / --info-700` tokens + RTL logical properties.
- `af7208e` feat(admin): PA card banner in `buildPaCard` (inside `.pa-card__body` above `buildPaPreviewBody`). AI Review accordion now carries `data-client-id` alongside `data-client`. Deep-link handler runs once per page load from `renderAICards` end (gated by `window.__dl306DeepLinkHandled`).
- `78fa4cd` feat(doc-manager): banner rendered in `#preuploaded-docs-banner` by new `renderPreuploadedBanner()`, called after `displayDocuments()` + from `restoreFromCache`. Guarded by `CURRENT_STAGE === 'Pending_Approval' && pending_reviews_count > 0`.

**Deviations:**
- Stream C duplicated `.preuploaded-banner` CSS into `frontend/assets/css/document-manager.css` because doc-manager doesn't load admin CSS. Plan only listed admin CSS. Acceptable short-term; candidate for later extraction to a shared `common.css` if more banners need to cross the page boundary.
- AI Review accordion already had a `clientId` variable in scope at the template site (line 3863), so no extra resolver needed.

**Not deployed. Not pushed.** Awaiting explicit user approval per git-ship policy.
