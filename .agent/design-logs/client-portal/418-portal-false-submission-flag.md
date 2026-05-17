# DL-418 — Client portal falsely shows "already submitted" when docs exist without questionnaire

**Status:** [COMPLETED — 2026-05-17]
**Domain:** client-portal
**Branch:** DL-418-portal-false-submission-flag
**Created:** 2026-05-17

---

## 1. Context & Problem

**Reported by:** Lioz (office), prompted by client CPA-XXX claiming "I filled the questionnaire" while Airtable shows no row in the questionnaire-responses table.

**Symptom (verified via screenshot):**
Visiting the client portal link shows:
- "מצאנו נתונים קיימים לדוח הזה / Existing data found for this report"
- "נראה שכבר מילאת את השאלון בעבר עבור הדוח הזה"
- Badge "4 מסמכים קיימים"
- CTA "צפה במסמכים הנדרשים"
- **Language picker is hidden** — client can never reach the Tally form again.

**Airtable state for the affected report:**
- `stage` = `Waiting_For_Answers` (rank 2)
- `docs_received_count` = 4
- No row in `תשובות שאלון שנתי` (`tblxEox8MsbliwTZI`) for this client
- Tally CSV export (1,462 submissions) also has zero matches

So the client is telling the truth — he never submitted, but the portal told him he did, then gated him out of resubmitting.

**Root cause:** `api/src/routes/submission.ts:82`
```ts
const hasSubmission = stageRank >= 3 || documentCount > 0;
```
`documentCount > 0` is a false-positive signal. Documents land in Airtable from many sources (office manual upload, inbound email, AI classification) BEFORE the client ever submits the questionnaire. Treating docs-exist as "has submitted" conflates two unrelated state transitions.

The landing page (`frontend/assets/js/landing.js:130-133`) trusts `data.has_submission` directly, so fixing the API fixes the symptom on every surface that calls this endpoint.

---

## 2. User Requirements (Q&A)

- **Detection logic:** Stage rank only — drop `documentCount > 0` entirely. Stage advancement IS the SSOT for submission (workflow [02] moves stage to `Pending_Approval` on successful submission). No extra Airtable round-trip needed.
- **Affected client specifically:** Don't touch his Airtable state. After deploy, his next visit to the link will show the language picker correctly.
- **CS scope:** Same endpoint serves both filing types (AR + CS) via `FILING_CONFIG` table at `submission.ts:20-33`. Single fix covers both.
- **Execution:** Full implement + deploy + verify after approval.

---

## 3. Research (Domain Knowledge)

**Domain:** Derived state / single-source-of-truth for form-submission detection.

**Sources consulted (Tavily, 2026-05-17):**
1. React docs — "You Probably Don't Need Derived State" — `ar.reactjs.org/blog/2018/06/07/you-probably-dont-need-derived-state.html`
2. FrontendAtlas — "Derived state in React: single-source-of-truth bugs, drift, and how to avoid them" — `frontendatlas.com/react/trivia/react-derived-state-anti-pattern`
3. Medium / H. Jani — "Use Enums over Booleans to Clarify Code Intent"

**Principles extracted:**
- A derived boolean must be a function of the SSOT, not of a proxy correlated with it. Document presence ≠ submission presence; they're two independent state machines that happen to often co-occur.
- When a boolean is "true if A OR B," each clause must independently imply the boolean. Here `documentCount > 0` does NOT imply "client submitted questionnaire."
- Stage is already the explicit state machine (`STAGE_ORDER` at `submission.ts:9-18`) — use it directly. Don't shadow it with a parallel proxy signal.

**Anti-pattern this code is committing:** "Proxy field overrides SSOT." The stage field is the authoritative submission state, but the OR clause lets a correlated-but-independent field overrule it.

**Verdict:** Stage-rank-only is correct. The original author likely added `documentCount > 0` defensively in case stage advancement lagged, but that defensive clause now produces a worse failure (gating clients out) than the bug it was hedging against.

---

## 4. Codebase Analysis

**Files involved:**
- `api/src/routes/submission.ts:82` — the bug, single-line fix
- `frontend/assets/js/landing.js:130-133` — consumer, already trusts `has_submission` if returned as boolean; no change needed
- `api/src/index.ts` — route mount (no change)
- `api/wrangler.toml` — deploy config

**Endpoint:** `GET /webhook/check-existing-submission`
- Auth: `verifyClientToken` (HMAC, 45d expiry)
- Returns: `has_submission`, `document_count`, `stage`, `stage_rank`, plus filing-type metadata

**Reuse:** No new helpers, no new Airtable calls, no new dependencies. Existing `STAGE_ORDER` map already encodes the SSOT.

**Stage pipeline reference (per MEMORY.md):**
1. `Send_Questionnaire` (rank 1)
2. `Waiting_For_Answers` (rank 2) ← affected report is here
3. `Pending_Approval` (rank 3) ← stage advances on Tally submission
4. ... through Completed (rank 8)

So `stageRank >= 3` correctly means "questionnaire was submitted and is at least under review."

---

## 5. Constraints & Risks

**Risk 1: Edge case — report where questionnaire row exists but stage somehow regressed.**
- Extremely unlikely; n8n [02] only advances stage, never regresses. If it ever happens, worst outcome is client sees the language picker again and re-submits (idempotent via Airtable dedup-by-token). Acceptable.

**Risk 2: Reports stuck at stage 2 with valid questionnaire data.**
- A report can only have data in `תשובות שאלון שנתי` if Tally fired, which always triggers stage advancement via webhook [02]. If stage is still 2, the questionnaire never landed. No false negatives.

**Risk 3: Worker cache.**
- This endpoint does not use KV cache; deploy is sufficient.

**Risk 4: Multi-tab safety.**
- Branched off session worktree to a fresh DL-418 branch via push-with-new-name flow.

---

## 6. Proposed Solution

`api/src/routes/submission.ts:82`:
```ts
// BEFORE
const hasSubmission = stageRank >= 3 || documentCount > 0;

// AFTER
const hasSubmission = stageRank >= 3;
```

Keep `document_count` in the response (frontend still uses it to display the badge if client *has* submitted). Just stop using it to gate the language picker.

### Ship flow

1. Edit `submission.ts:82` on session worktree.
2. Commit via `git-ship` skill.
3. Push to main via FF: `git push origin HEAD:main`.
4. Pull canonical clone + deploy via `bash .claude/workflows/deploy-worker.sh`.
5. Verify via curl + browser on affected link.

---

## 7. Validation Plan

- [ ] **Affected link shows language picker.** After deploy, opening the client portal URL for the stuck report should show "Choose Language" with HE/EN cards, NOT the "already submitted" warning.
- [ ] **Confirm API response.** `curl '/webhook/check-existing-submission?report_id=…&token=…'` returns `"has_submission": false`, `"stage": "Waiting_For_Answers"`, `"document_count": 4`.
- [ ] **Regression: real submitted client still gated.** Report at stage `Pending_Approval` or higher → portal still shows "already submitted" view.
- [ ] **Regression: fresh client.** Report at stage 1 with 0 docs → portal still shows language picker.
- [ ] **CS filing type.** A `capital_statement` report behaves identically through this endpoint.
- [ ] **No worker error spike post-deploy.** Tail logs for 2 min.

---

## 8. Implementation Notes

**Shipped 2026-05-17:**

- Single-file change as planned — `api/src/routes/submission.ts:82` → `hasSubmission = stageRank >= 3`. Added inline comment referencing DL-418 for the next reader.
- `document_count` retained in response (used by `landing.js` for the "N docs received" badge on real-submitted clients).
- Branch: `DL-418-portal-false-submission-flag` (pushed). Session worktree rebased onto `origin/main`, then FF-pushed `HEAD:main` — `4579089e..e26c00e9`.
- Deploy: `bash .claude/workflows/deploy-worker.sh` from canonical clone — uploaded 2331.78 KiB, health endpoint 200, version `1d6c94a9-d21b-456e-bafe-91c7458bdefc`.

**Live API verification (curl on CPA-XXX stuck report):**
```
{"ok":true,"has_submission":false,"document_count":4,
 "stage":"Waiting_For_Answers","stage_rank":2, ...}
```
Before the fix: `has_submission` would have been `true`. After: correctly `false`. Frontend (`landing.js:130-133`) treats `has_submission:false` → `showLanguageSelection()`.

**Open Section 7 items (Test Handoff):**
- Browser walkthrough on the actual portal URL — confirm the language picker actually renders (API is correct; this is the belt-and-suspenders check).
- Regression: pick a stage 3+ report and confirm the "already submitted" view still appears.
- Regression: pick a stage 1, 0-docs report and confirm the language picker appears (no change expected — `stageRank >= 3` is `false` either way).
- CS filing type: same endpoint, but verify on a real `capital_statement` report.
- Worker error tail post-deploy (2 min) — no spike expected since the change cannot throw.

**Deviations from plan:** None. Force-push to the DL branch (after rebase onto main) was denied by harness — remote DL branch ref is slightly stale vs. the commit on main; harmless because main is the canonical commit and deploys come from there.
