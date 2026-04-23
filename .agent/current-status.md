# Annual Reports CRM - Current Status

**Last Updated:** 2026-04-23 (DL-334 AI Review cockpit v2 — PLAN DRAFTED, awaiting implementation approval)
**Last Updated:** 2026-04-23 (DL-336 template picker UI in also-match + reassign modals — COMPLETED)
**Last Updated:** 2026-04-23 (DL-331 edit-documents batch 422 fix — IMPLEMENTED, deploy pending)

## DL-334 AI Review Cockpit v2 — PLAN DRAFTED (awaiting approval)

Branch `DL-334-ai-review-cockpit-middle-actions`. Rewrites DL-330's pane 2 fat-card accordion into thin scannable rows + moves all AI reasoning and per-doc actions into a new right-side state-aware actions panel. Flat-minimal visual style locked by a prescriptive spec + mockup (28-30px rows, 0.5px borders, sentence case, weight 400/500, existing tokens only). Full on_hold (DL-335) integration across stripe / row category / panel lozenge / body / actions — DL-334 does NOT modify `dismissAndSendQuestions` / `dismissClientReview` / `renderReviewedCard` (owned by DL-335); it only renders their output. Bundles DL-053 silent-refresh merge-by-id fix. Mobile <768px untouched.

**Supersedes:** the earlier DL-334 attempt (commit `1ef907f`) reverted from main via `f643a79` — over-engineered panel, missing on_hold, abandoned.

**Status:** plan file written, no code. Implementation serial (C → A → B → D) per the subagent-driven-development skill's shared-file serialization rule. Estimated cache-bust: `style.css?v=296→297`, `script.js?v=304→305` (pending verification of current live values before coding).

**Plan file (read before implementing):** `.agent/design-logs/ai-review/334-cockpit-middle-and-actions.md`

Sections inside the plan file worth skimming next session:
- §4 — non-modification contract with DL-335
- §7 — full visual spec (reference for implementation)
- §8 — workstream split (C pane 3 DOM + CSS → A pane 2 rows → B panel renderer → D merge-by-id + housekeeping)
- §9 — 80+ Section 7 validation items including dedicated on_hold block

---


## DL-331 edit-documents batch 422 fix — IMPLEMENTED — NEED TESTING

Branch `DL-331-edit-documents-422-fix`. Pure sanitizer `api/src/lib/batch-sanitize.mjs` wired into `POST /webhook/edit-documents` before the 10-record Airtable PATCH loop. Drops entries with non-`recXXXXXXXXXXXXXX` id or all-undefined fields; logs via `logError({category: 'VALIDATION'})`. 7 `node --test` cases pass. Root cause of 2026-04-22 alert: Tally payload can produce `status_changes: [{id, new_status: undefined}]` → JSON.stringify strips undefined → Airtable rejects whole 10-record chunk with 422.

**Files:** `api/src/lib/batch-sanitize.mjs` (new), `api/src/routes/edit-documents.ts` (wired sanitizer), `api/test/edit-documents-sanitize.test.mjs` (new), `api/package.json` (test script).

### Active TODOs — Test DL-331: edit-documents 422 sanitizer
- [ ] `cd api && npm test` — 7 cases pass.
- [ ] `wrangler deploy` from `api/` — deploy succeeds.
- [ ] Craft POST to `/webhook/edit-documents` with `extensions.status_changes: [{id: 'recXXXXXXXXXXXXXX', new_status: undefined}]` + one valid waive. Expect `200 ok:true`; waive lands; dropped entry logged.
- [ ] Regression: admin doc-manager waive + add still works on a live client (Network tab PATCH 200).
- [ ] `wrangler tail` 10 min after deploy — no new 422s from `/webhook/edit-documents`.
- [ ] Follow-up DL: fix arg-order in `api/src/lib/error-logger.ts:40` (`new AirtableClient(PAT, BASE_ID)` → `(BASE_ID, PAT)`) — blocks VALIDATION logs from reaching `security_logs`.

Design log: `.agent/design-logs/documents/331-edit-documents-batch-422-fix.md`
**Last Updated:** 2026-04-23 (DL-337 AI Review tab shows raw client email text — IMPLEMENTED — NEED TESTING)
**Last Updated:** 2026-04-23 (DL-338 AI Review client messages hover-reveal reply + 2-line clamp — IMPLEMENTED — NEED TESTING)
**Last Updated:** 2026-04-23 (DL-338 fully implemented + reply display fixed — NEED TESTING)

## DL-338 AI Review Messages — Hover Reply + 2-Line Clamp + Reply Display — IMPLEMENTED — NEED TESTING

Branch `DL-338-ai-review-messages-ui` merged to main. The "הודעות הלקוח" timeline inside the AI Review accordion now: 2-line clamp that expands on hover, hover-reveal reply button, inline textarea reply zone, office replies displayed nested below their parent message.

- **Reply button:** appears on hover (`opacity: 0 → 1`); passes `containerEl` directly to `showReplyInput` so no `.msg-row` query needed.
- **Reply send (inline):** `sendReply` works; skips `showPostReplyPrompt` in AI Review context (calls `loadRecentMessages()` instead).
- **Reply send (expanded compose):** `expandReplyCompose` OR-selector fix + no early return when `.msg-row` not found.
- **Office reply display:** `replyMap` built from `office_reply` notes keyed by `reply_to`; `cn-office-reply` card rendered nested below each message. CSS: `width: 100%; margin-right: var(--sp-6)` pushes to own line.
- **Cache:** `script.js?v=312`, `style.css?v=298`.

### Active TODOs — Test DL-338: AI Review Messages
- [ ] Hover a client message entry → reply button appears, hover bg activates.
- [ ] Text longer than 2 lines is clamped; hover unclamps to full.
- [ ] Click reply → inline textarea appears below entry; type + send → toast "תגובה נשלחה ✓".
- [ ] Sent reply appears as "תגובת המשרד" nested card below the message on next load.
- [ ] Expanded compose modal "שלח תגובה" button works from AI Review context.
- [ ] Dashboard "הודעות אחרונות מלקוחות" panel unaffected.
- [ ] Hard reload → `?v=312` / `?v=298` served.
Design log: `.agent/design-logs/ai-review/338-ai-review-messages-hover-reply.md`

---

## DL-337 AI Review Tab — Show Raw Client Email Instead of AI Summary — IMPLEMENTED — NEED TESTING

Branch `DL-337-ai-summary-fix`. The AI Review tab's per-client notes timeline (`הודעות הלקוח`) was the last admin surface still rendering the AI-generated Hebrew summary. Dashboard Recent Messages + Pending-Approval modal already prefer `raw_snippet || summary`. This change brings AI Review in line. Doc-Manager is explicitly exempt — still shows the "סיכום AI:" labeled summary for office deep-dive.

- **Frontend:** `frontend/admin/js/script.js:4034` — swapped `${escapeHtml(n.summary)}` for `${escapeHtml(n.raw_snippet || n.summary || '')}`. Matches the fallback pattern used at `:1083` (Dashboard) and `:7521` (PA modal).
- **Backend / summarizer:** unchanged. `api/src/lib/inbound/processor.ts:414` already persists `raw_snippet` (≤1000 chars of cleaned email body). Summarizer still runs for doc-manager + digest consumers.
- **Schema:** no change. Single `Reports.client_notes` JSON field holds both `summary` and `raw_snippet`.
- **Cache-bust:** `script.js?v=305→306`.
- **Trigger:** real inbound email 2026-04-23 10:24 — AI one-sentence summary dropped the client's action request + business-state context and garbled a password binding. Raw text is short and unambiguous — show it.

### Active TODOs — Test DL-337: Raw Client Text in AI Review
- [ ] AI Review tab for the trigger email shows the full raw client message — not the AI summary.
- [ ] Side-by-side: Dashboard Recent Messages + PA modal Notes + AI Review tab show identical raw text for the same note.
- [ ] Doc-Manager for the same client — still shows AI summary with "סיכום AI:" label (exempt surface untouched).
- [ ] Legacy note (saved before DL-199 raw_snippet was stored) — falls back to `summary` and still renders.
- [ ] Long / multi-paragraph raw_snippet renders without breaking `.ai-cn-entry` layout. If it does → add `white-space: pre-wrap` + max-height on `.ai-cn-summary` in `style.css`.
- [ ] Expand-all toggle (`toggleClientNotes`) + "Open in Doc Manager" button still work.
- [ ] Manual office notes (no `raw_snippet`) still render via `summary` fallback.
- [ ] Hard reload admin, confirm `?v=306` is served (no stale `v=305`).

Design log: `.agent/design-logs/ai-review/337-raw-text-instead-of-ai-summary.md`
**Last Updated:** 2026-04-23 (DL-338 COMPLETED — AI Review messages reply UI)

---

## DL-336 Template Picker UI — Also-Match & Reassign Modals — COMPLETED

Branch `DL-336-template-picker-ui`. Replaces the `createDocCombobox` free-text path in both modals with a proper template picker: search → categorized list → variable wizard → chip feedback.

- **New function:** `_buildDocTemplatePicker(container, item, opts)` in `script.js` — reuses `ensurePaTemplatesLoaded` + `pa-add-doc-*` CSS, uses container-relative selectors to avoid conflict with PA picker.
- **Also-match modal:** "הוסף מסמך נוסף" section now calls `_buildDocTemplatePicker`; `overlay._pickerTarget` replaces `overlay.dataset.combobox*`; `confirmAIAlsoMatch` updated.
- **Reassign modal:** `createDocCombobox` gets new backwards-compatible `onExpand` option; clicking "הוסף מסמך חדש" expands `#aiReassignExpandedPicker` div with full template picker; `closeAIReassignModal` clears it; `confirmAIReassign` checks `_aiReassignExpandedTarget` first.
- **CSS:** `.ai-picker-chip`, `.ai-picker-chip-label`, `.ai-picker-chip-clear` added after `.ai-also-match-label` block.
- **Cache-bust:** `script.js?v=302→303`, `style.css?v=295→296`.

Tested and passed 2026-04-23. script.js v=304.

---

## DL-335 On-Hold State for Docs Awaiting Client Reply — IMPLEMENTED — NEED TESTING

Branch `DL-335-ai-review-on-hold-docs` **merged to main** 2026-04-23. Docs with pending questions now stay in AI Review in "ממתין ללקוח" hold state instead of being dismissed after sending the batch-questions email. The outgoing email now appears in the per-client messages timeline (`הודעות הלקוח`). When the client replies, office manually resolves the held doc via the "סיים המתנה" button.

- **Backend:** `api/src/routes/send-batch-questions.ts` — replaces `pending_question: null` with `review_status: 'on_hold'`; extends `client_notes` entry with `id`, `summary`, `source`, `type: 'batch_questions_sent'`; returns `held_count`.
- **Frontend AI Review:** `frontend/admin/js/script.js` — new `renderOnHoldCard(item)` renders amber "ממתין ללקוח" badge + question text + resolve button; `renderReviewedCard()` early-returns to it for `on_hold` status; `dismissClientReview()` accepts `{ keepOnHold }` filter to conditionally delete rows; `dismissAndSendQuestions()` flips local state for held items.
- **Frontend per-client timeline:** `frontend/assets/js/document-manager.js` — new `batch_questions_sent` branch in `renderClientNotes()` renders amber outbound card with "שאלות ששלח המשרד" label + per-file bullet list.
- **CSS:** `.lozenge-on-hold`, `.reviewed-on-hold`, `.ai-held-question`, `.cn-icon--office-question`, `.cn-entry--outbound`, `.cn-bq-items` (amber theme using `--warning-*` tokens).
- **Pre-commit hook:** `.claude/hooks/agent-pii-guard.py` — added allowlist patterns for Hebrew UI labels `(הודעות הלקוח)` and `ממתינים לתשובה`.
- **Cache-bust:** `script.js?v=298→299`, design log and INDEX updated.
- **Airtable:** no schema change — `review_status` is free-text field.

### Active TODOs — Test DL-335: On-Hold Docs
- [ ] Ask 3 questions on 3 docs + approve 2 + reject 1 (6 total); click `סיים בדיקה ושליחת שאלות`; verify: 3 gone, 3 remain with amber "ממתין ללקוח" badge + question text visible.
- [ ] Verify `batch_questions_sent` entry renders in per-client timeline (doc-manager) as amber outbound card with per-file bullet list.
- [ ] Verify no `batch_questions_sent` entry appears in dashboard Recent Messages panel.
- [ ] Client replies by email; inbound pipeline captures it; reply shows in per-client timeline below the outbound questions entry.
- [ ] Click "סיים המתנה — טפל במסמך" on held card → standard approve/reject/reassign row appears → approve works → row deleted from `pending_classifications`.
- [ ] Refresh AI Review tab — held cards still present with `on_hold` status.
- [ ] DL-281 queue modal still renders `שאלות לאחר סקירה` rows correctly.
- [ ] DL-333 off-hours queue: deferred send still works; toast shows "נשלח לבוקר".
- [ ] Client with zero `pending_question` items — no hold state, behavior identical to before.
- [ ] Client with 100% `pending_question` items — all on_hold; accordion shows only held cards.
- [ ] `wrangler deploy` succeeds; no startup errors.

Design log: `.agent/design-logs/ai-review/335-ai-review-on-hold-docs.md`
**Last Updated:** 2026-04-23 (full testing sweep — all pending DLs verified live)

---

## Recently Completed (2026-04-20 → 2026-04-23)

| DL | Feature | Status |
|----|---------|--------|
| DL-338 | AI Review messages — hover reply + reply display | COMPLETED 2026-04-23 |
| DL-337 | AI Review show raw client email instead of AI summary | COMPLETED 2026-04-23 |
| DL-335 | On-hold state for docs awaiting client reply | COMPLETED 2026-04-23 |
| DL-333 | Batch-questions off-hours queue | COMPLETED 2026-04-23 |
| DL-332 | AI Review pane 1 density redesign | COMPLETED 2026-04-23 |
| DL-330 | AI Review 3-pane rework | COMPLETED 2026-04-23 |
| DL-329 | Preview timeout + error UX fix | COMPLETED 2026-04-22 |
| DL-328 | Follow-up questions polish | COMPLETED 2026-04-22 |
| DL-323 | AI Review perf + UX bundle | COMPLETED 2026-04-22 |
| DL-322 | Note-save silent-failure instrumentation | COMPLETED 2026-04-23 |
| DL-321 | Classifier non-document verdict | COMPLETED 2026-04-23 |
| DL-320 | "Also matches" UX + robot icon removal | COMPLETED 2026-04-23 |
| DL-319 | Approve-as-Required button | COMPLETED 2026-04-23 |
| DL-317 | Fetch-only prefetch for heavy tab loaders | COMPLETED 2026-04-23 |
| DL-315 | Classifier fallback for pre-questionnaire docs | COMPLETED 2026-04-23 |
| DL-314 | Multi-template match in AI Review + SVG sprite icons | COMPLETED 2026-04-23 |
| DL-313 | Hover tab dropdowns | COMPLETED 2026-04-20 |
| DL-311 | Admin panel slowness | COMPLETED 2026-04-20 |
| DL-310 | Remove raw-answer note append | COMPLETED 2026-04-20 |
| DL-308 | Approve & send email preview | COMPLETED 2026-04-20 |

---

## Active TODOs

### Needs browser testing
- [ ] **DL-299** — PA card issuer edit + note popover + print (`admin-ui/299`)
- [ ] **DL-298** — PA queue stacked cards (`admin-ui/298`)
- [ ] **DL-297** — Doc-manager sticky header + editable stage (`admin-ui/297`)
- [ ] **DL-293** — Doc-manager full client edit (`admin-ui/293`)
- [ ] **DL-290** — Reminder "ממתין לסיווג" count matches AI Review badge (`admin-ui/290`)
- [ ] **DL-288** — Queued-subtitle stale flash (`admin-ui/288`)
- [ ] **DL-280** — Mobile bottom nav FOUC fix (`admin-ui/280`)

### Draft / not started
- [ ] **DL-316** — AI Review React port scoping (DRAFT)

---

## Blocked / Deferred

| Item | Trigger Condition |
|------|-------------------|
| DL-182 CS Tally completion | Moshe provides content decisions |
| DL-166 Filing Type Tabs | CS Tally forms + templates populated |
| Custom domain migration | Business decision to purchase domain |
| WF05 convertOfficeToPdf() | Needs MSGraphClient binary GET — low priority |

---

## Stakeholder Backlog
See `docs/meeting-with-natan-action-items.md` for Natan's feature requests.
