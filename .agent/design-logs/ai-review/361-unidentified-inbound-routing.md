# Design Log 361: Unidentified Inbound → AI Review Routing + Forwarded-Sender-Name Tier
**Status:** [BEING IMPLEMENTED — DL-361]
**Date:** 2026-04-27
**Related Logs:** DL-052 (3-tier identification), DL-282 (forward-on-behalf branch), DL-330 / DL-339 / DL-341 (AI Review pane structure), DL-318 (KV cache invalidation), DL-355 (resolveOneDriveFilename), DL-336 (template picker)

## 1. Context & Problem

Two production events on 2026-04-27 (Natan forwarding `forwarded@example.com` to office, body referencing client `<client-name>` / CPA-XXX) ended up in the OneDrive `לקוח לא מזוהה/2026/` folder and silently disappeared from any admin surface.

Three root causes:

1. **Forwarded-sender-name match is missing.** `client-identifier.ts` Tier 2 only tries to match the *email* extracted from the `From:` forward header. When the forwarded email isn't in Airtable (clients commonly have multiple addresses), we fall straight through to the AI tier. Tier 3 (sender-name) is intentionally skipped in the forward-on-behalf branch (would otherwise match the forwarder's name). The display name in `From: <short-name> <forwarded@example.com>` is currently unused.
2. **AI tier uses strict equality.** When Haiku returns `client_name: "<short-name>"` (the short form from the email subject), the strict `cName === aiClientName` check at `client-identifier.ts:343` fails to match the active client `<client-name>`. Confidence may also fall below 0.5.
3. **Unidentified emails are invisible.** `processor.ts:777-797` early-returns on `unidentified` — files upload to `לקוח לא מזוהה/{year}/` and `email_event` is marked `NeedsHuman`, but **no `pending_classifications` row is created**, so the admin AI Review tab doesn't show anything.

## 2. User Requirements

1. **Q:** How should unidentified emails appear to the office?
   **A:** AI Review tab — virtual `לקוח לא מזוהה` accordion at the top of pane 1.
2. **Q:** What action should the office take on an unidentified item?
   **A:** Pick client → re-run full pipeline (classify, move OneDrive files, populate pending_classifications).
3. **Q:** Add forwarded-sender-NAME matching tier?
   **A:** Yes — fuzzy substring/token name match (Tier 2.5).
4. **Q:** What's the failure budget when office assigns an unidentified item to a client?
   **A:** Re-run classification only (use existing classifyAttachment).
5. **Q:** Granularity of the assign action?
   **A:** Per email (one click assigns all attachments).
6. **Q:** Allow office to dismiss as junk?
   **A:** Yes — "discard" button alongside "assign to client".
7. **Q:** Multiple unidentified emails — separate accordions?
   **A:** N separate accordions, one per email_event.
8. **Q:** Backfill the live CPA-XXX case?
   **A:** Yes — included in scope.

## 3. Research

### Domain
Email Entity Resolution, Hebrew Name Matching, Inbound Triage UX

### Sources Consulted
1. **DL-052 (prior design log)** — already established 3-tier identification with regex + AI; DL-361 extends with Tier 2.5 (forwarded display name) and loosens Tier 4 (AI) name matching.
2. **`email-forward-parser` patterns** (referenced in DL-052) — `From:` and `מאת:` headers with display name + `<email>` syntax remain the most common forward formats; display name is reliably present.
3. **Token-overlap matching for Hebrew names** — Hebrew given/middle/family names are space-separated; substring containment per-token catches `<short-name>` ⊂ `<client-name>` without the false-positives of single-token equality.

### Key Principles
- **Reuse before refactor** — DL-052 built the tier infrastructure; DL-361 adds one more tier inline rather than reworking.
- **Confidence-gated routing** — Tier 2.5 returns 0.85 (between exact email match 1.0 and AI 0.5+). Office still reviews via the normal AI Review approve/reject flow, so a wrong match is reversible at no cost.
- **Manual fallback must be discoverable** — silent OneDrive bucket = lost work. The accordion is the discoverability fix.
- **One accordion per email** — preserves the office's mental model ("this email needs a home"); multiple unidentified emails from the same real client appear separately, but that's a minor annoyance vs. the safety of not falsely grouping.

### Anti-Patterns to Avoid
- **Single-token name match** — `דן` matches too many clients; require ≥2 tokens.
- **Mega-accordion mode** — one parent "לקוח לא מזוהה" with N nested email sub-groups is more clicks and less clear than N siblings.
- **Auto-assign on AI low-confidence** — DL-052 confidence threshold (0.5) is intentional; don't lower it just to cut the unidentified queue.

## 4. Codebase Analysis

### Existing Solutions (Reuse First)
- `parseForwardedEmail` (`api/src/lib/inbound/client-identifier.ts:115`) — pattern model for new `parseForwardedSenderName`.
- `fetchActiveClients` (`client-identifier.ts:186`) — already returns the candidate list needed for Tier 2.5.
- `classifyAttachment` (`api/src/lib/inbound/document-classifier.ts`) — re-classification on assign.
- `processAttachmentWithClassification` (`processor.ts:480`) — reference for the `pending_classifications` write shape.
- `moveFileToArchive` (`api/src/routes/classifications.ts:25`) — pattern for OneDrive `parentReference` PATCH.
- `resolveOneDriveRoot`, `uploadToOneDrive` (`api/src/lib/inbound/attachment-utils.ts`) — target folder resolution.
- `resolveOneDriveFilename` (`api/src/lib/classification-helpers.ts`) — DL-355 canonical filename on rename.
- `invalidateCache` (`api/src/lib/cache.ts`) — DL-318 cache busts after writes.
- `createDocCombobox` / `_buildDocTemplatePicker` (`script.js`) — pattern for new client-picker.
- `showConfirmDialog`, `showAIToast` (`script.js`) — confirmation + feedback UI primitives.
- `buildClientListRowHtml` (`script.js:5154`), `renderAICards` (`script.js:5308`), `buildDesktopClientDocsHtml` (`script.js:4256`) — pane render hooks.

### Reuse Decision
- New code: `parseForwardedSenderName`, `tokenOverlapMatch`, `assignUnidentified` route handler, frontend `showAssignUnidentifiedModal` + `renderUnidentifiedAccordion`.
- Reused as-is: `fetchActiveClients`, `classifyAttachment`, `resolveOneDriveFilename`, `invalidateCache`, `verifyToken`, `logSecurity`.
- Reused with adaptation: `moveFileToArchive` pattern (target = client folder, not archive), `_buildDocTemplatePicker` style (over clients, not templates).

### Dependencies
- Airtable: `email_events` (singleSelect additions), `pending_classifications` (existing fields, new sentinel `client_id=''`), `clients` (lookup for assign).
- MS Graph: `parentReference` PATCH for moves, `getBinary` for re-classification re-fetch.
- Anthropic: existing classifier path (no new model calls beyond classifyAttachment).

## 5. Technical Constraints & Risks

* **Security:** New endpoint `/webhook/assign-unidentified` reuses bearer-token auth. Reading attachment bytes back from OneDrive is safe — same pattern as preview.
* **Risks:**
  - Token-overlap match could over-match for short common Hebrew names. Mitigated: require 2+ tokens, require unique single match.
  - OneDrive move can fail mid-batch (1 of 7 attachments). Mitigated: per-file try/catch, partial success returns the count of successes; office sees remaining items in unidentified accordion and can re-trigger.
  - Re-classification may take 7×~3s for the example case. Mitigated: do classification in parallel-batches (size=1 per DL-287 to avoid 429), respond with `accepted` semantics + frontend polls or refreshes after 2s.
  - `email_event_id` exposed in frontend grouping — fine, it's an Airtable record id, not sensitive.
* **Breaking Changes:** None. New `'forwarded_name'` is additive to the union; existing `'unidentified'` semantics expanded (now also creates pending_classifications) but no API consumer broken.

## 6. Proposed Solution

### Success Criteria
After deploy: (a) the live CPA-XXX emails are routed correctly; (b) sending the same forward again identifies the client without office intervention; (c) any future truly-unidentified email surfaces in AI Review pane 1 with clear assign/discard actions.

### Logic Flow
See plan file for the full step-by-step. Highlights:

1. **`client-identifier.ts`** — add `parseForwardedSenderName` + `tokenOverlapMatch` helpers; insert Tier 2.5 in `isForwardOnBehalf` branch returning `match_method: 'forwarded_name'`, confidence 0.85; loosen Tier 4 AI matching to use `tokenOverlapMatch` instead of strict equality on `client_name`.
2. **`types.ts`** — extend `MatchMethod` union with `'forwarded_name'` and `'manual_assignment'`.
3. **`processor.ts`** — replace early-return at lines 777-797 with `pending_classifications` creation per attachment (client_id='', email_event linked, file_url + onedrive_item_id populated).
4. **`classifications.ts`** — add `POST /webhook/assign-unidentified` for `action: 'assign' | 'discard'`. Assign: fetch rows, fetch client + reports, fetch attachment bytes, re-classify, move OneDrive file, PATCH classification row. Discard: PATCH rows + move to `לקוח לא מזוהה/ארכיון/`.
5. **`/get-pending-classifications`** — already returns rows with empty client_id (verified Step 1). Extend response with `email_event_id`, `email_subject`, `email_received_at` per item.
6. **`script.js`** — group items by `email_event_id` when `client_id===''`; render distinct unidentified accordions at top of pane 1; per-accordion banner with assign + discard buttons; new `showAssignUnidentifiedModal` with searchable client picker.
7. **Backfill** — Option A: call new endpoint with target_client_id = `recXXXXXXXXXXXXXX` (CPA-XXX) for both event ids.

### Schema Changes
- `email_events.processing_status` singleSelect: add `Discarded`.
- `email_events.match_method` singleSelect: add `forwarded_name` (orange), `manual_assignment` (gray).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/types.ts` | Modify | Extend `MatchMethod` union |
| `api/src/lib/inbound/client-identifier.ts` | Modify | Add Tier 2.5 + loosen AI matching |
| `api/src/lib/inbound/processor.ts` | Modify | Create pending_classifications for unidentified (replace early-return) |
| `api/src/routes/classifications.ts` | Modify | Add `/webhook/assign-unidentified` route + extend pending response |
| `frontend/admin/js/script.js` | Modify | Group by email_event_id; render unidentified accordions; assign modal |
| `frontend/admin/index.html` | Modify | Cache-bust `script.js?v=363` |
| `.agent/design-logs/INDEX.md` | Modify | Index entry |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 to `current-status.md`, deploy via wrangler, push branch.

## 7. Validation Plan
* [ ] Test 1 — Tier 2.5 forwarded-name match (regression of live incident): forward email with `From: <short-name> <forwarded@example.com>` → CPA-XXX identified, `match_method=forwarded_name`.
* [ ] Test 2 — AI tier loosened: forward where AI returns short name → tokenOverlapMatch resolves to active client.
* [ ] Test 3 — True unidentified: unknown sender + no clues → pending_classifications row created, accordion appears in AI Review.
* [ ] Test 4 — Manual assign: click "בחר לקוח לשיוך", pick CPA-XXX → toast, accordion gone, rows now under that client with classification, OneDrive files moved.
* [ ] Test 5 — Discard: click "השלך", confirm → accordion gone, files in `לקוח לא מזוהה/ארכיון/`, `processing_status=Discarded`.
* [ ] Test 6 — Concurrency: 3 unidentified emails → 3 distinct accordions.
* [ ] Test 7 — Regression: normal client email → no unidentified accordion appears.
* [ ] Test 8 — Schema: new singleSelect options visible in Airtable UI.
* [ ] Test 9 — Auth & errors: missing token → 401; bad client id → 400.
* [ ] Test 10 — Cache bust: `script.js?v=363` in network tab; new perf marks present.
* [ ] Test 11 — Backfill verification (CPA-XXX): 14 pending_classifications rows linked, OneDrive files moved + renamed via DL-355, both email_events flipped to Completed/manual_assignment, idempotent on re-run.

## 8. Implementation Notes (Post-Code)
*Log any deviations from the plan here during implementation.*
