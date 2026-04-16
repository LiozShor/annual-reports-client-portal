# Annual Reports CRM - Current Status

**Last Updated:** 2026-04-15 (Session 13f — DL-279 fix forwarded note sender email)

---

## Session Summary (2026-04-15 — Part 13f)

### DL-279: Fix Forwarded Note Sender Email [COMPLETED]
- **Problem:** When office member (Natan) forwards a client email to the inbox, the client note showed Natan's email instead of the client's email. Also, spouse (Tal/bigeltal@gmail.com) sent the email but note should show primary client email (Shlomit/bigelmanit@gmail.com).
- **Fix 1 — processor.ts:** `summarizeAndSaveNote()` now receives `reportClientEmail` (from report's `client_email` lookup field) instead of `metadata.senderEmail`. Falls back to `clientMatch.email` if lookup is empty.
- **Fix 2 — frontend:** Added `replace(/[\n\r\t]/g, ...)` pre-sanitization before `JSON.parse(client_notes)` in both `document-manager.js` and `admin/js/script.js`. Airtable long text fields can convert `\n` escapes into literal newlines, breaking JSON parse.
- **Backfill:** Fixed CPA-XXX's note data in Airtable (re-serialized with proper JSON escaping + corrected sender_email). Added `/webhook/backfill-note-sender` temp endpoint.
- All changes merged to main.

---

## Session Summary (2026-04-15 — Part 13e)

### DL-278: AI Review Client List — Viewport-Locked Layout [IMPLEMENTED — NEED TESTING]
- **Problem:** AI review master panel (client accordion list) grew unbounded, extending far below the sticky preview panel.
- **Fix:** Viewport-locked grid (`height: calc(100vh - 200px)`) with independent scrolling on master panel. Removed `position: sticky` from detail panel (now fills grid height). Accordion content `max-height` changed from `60vh` to `calc(100vh - 350px)` to auto-fit preview height. Mobile breakpoint unsets height lock.
- CSS-only change in `frontend/admin/css/style.css`.
- Design log: `.agent/design-logs/ai-review/278-ai-review-client-list-layout.md`

**Test checklist:**
- [ ] Both panels visible side-by-side without page scroll
- [ ] Master panel scrolls internally through all client accordions
- [ ] Opening an accordion shows cards within the panel
- [ ] Preview panel displays document when clicking preview button
- [ ] Pagination controls visible at bottom of master scroll
- [ ] Mobile layout (<768px) still works — single column, no height lock
- [ ] No regression on other tabs

---

## Session Summary (2026-04-15 — Part 13d)

### DL-277: Fix Reminder Progress Bar Math & Classification 429 Retry [IMPLEMENTED — NEED TESTING]
- **Bug A — Progress bar:** Type B reminder email showed "חסרים: 10" when total=11, received=0. Root cause: `_docs_missing` counted only `Required_Missing` docs, but `_docs_total` (Airtable COUNT) included Waived. Fix: `displayTotal = received + missing` — waived excluded from both.
- **Bug B — Classification 429:** 19 PDFs from CPA-XXX email, 14 failed with Anthropic 429 rate limit. No retry logic existed. Fix: Added `fetchWithRetry()` with 3 retries + exponential backoff in `document-classifier.ts`, plus 1s inter-batch delay in `processor.ts`.
- **New endpoint:** `re-classify` action on `/webhook/review-classification` — re-downloads PDF from OneDrive, re-runs AI classification, updates Airtable.
- **CPA-XXX records:** All 15 rate-limited records re-classified successfully. 14 matched templates, 1 unmatched.
- Workers deployed: version 02329de2
- Design log: `.agent/design-logs/email/277-fix-reminder-progress-bar-and-429-retry.md`

**Test checklist:**
- [ ] Trigger Type B reminder for a report with waived docs — verify progress bar excludes waived from both total and missing
- [ ] Send email with 10+ attachments — verify no 429 errors (retry logic works)
- [ ] Admin AI review: CPA-XXX's 15 records show proper classifications

---

## Session Summary (2026-04-15 — Part 13c)

### DL-276: Smooth Admin Auth Flow [IMPLEMENTED — NEED TESTING]
- **Problem:** Navigating to `/admin` showed "tack tack tack" — login screen flash → app appears → dashboard populates.
- **Fix:** Auth splash screen (logo + bouncing dots) visible by default. Both login and app hidden until JS decides. Splash fades out (200ms). Parallel dashboard prefetch on token verify. Login button uses inline bouncing dots instead of full-screen overlay.
- **Also fixed:** `.github/workflows/deploy-pages.yml` was accidentally gitignored (commit `ae5f66f`), breaking all deploys after that point. Restored workflow + fixed `.gitignore` to exclude `.github/*` but include `.github/workflows/`.
- Design log: `.agent/design-logs/admin-ui/276-smooth-admin-auth-flow.md`

**Test checklist:**
- [ ] Navigate to `/admin` with valid session (same tab) — splash → app, no login flash
- [ ] Open `/admin` in new tab with valid localStorage token — splash → app
- [ ] Open `/admin` with no token — splash → login screen
- [ ] Open `/admin` with expired/invalid token — splash → login screen
- [ ] Login from login screen — inline dots on button, no full-screen overlay
- [ ] Logout → login screen appears correctly
- [ ] Dashboard data populated when app appears (parallel prefetch)
- [ ] Mobile: same behavior on small screens

---

## Session Summary (2026-04-15 — Part 13b)

### DL-275: Fix Zero-Document Questionnaires Stuck at Waiting_For_Answers [COMPLETED]
- **Root cause:** WF02 Merge node (`Wait for Both`) blocked when Document Service returned 0 documents — `Prepare for Airtable` returned 0 items, so `Upsert Documents` never fired, merge never completed, `Update Report Stage` and `Mark Processed` never executed.
- **Fix:** Removed `Wait for Both` merge node. Connected `Update Report Stage` and `Mark Processed` directly from `Success?` TRUE branch. All 4 downstream operations now fire independently.
- **Backfill:** Updated 6 reports to stage=Review (CPA-XXX, CPA-XXX, CPA-XXX, CPA-XXX, CPA-XXX, CPA-XXX). Cleared reminder_next_date to prevent Type A reminders. Marked 8 Tally submissions as התקבל.
- Design log: `.agent/design-logs/infrastructure/275-fix-zero-docs-stage-stuck.md`

**All tests passed:**
- [x] Submit test questionnaire with all "no" answers → stage advances to Review (CPA-XXX, execution 11848)
- [x] Verify 6 backfilled reports show stage=Review in admin panel
- [x] Verify reminder_next_date is null on all 7 reports (6 backfilled + 1 new)
- [x] Verify 8 backfilled Tally submissions show סטטוס=התקבל
- [x] Verify Update Report Stage node fires directly from Success? branch

---

## Session Summary (2026-04-15 — Part 13)

### DL-272: Dashboard Messages — Load More + Same-Day Sort Fix [COMPLETED]
- Client-side pagination: API returns all messages (no slice cap), frontend shows 10 at a time with "הצג עוד..." link
- Sort fix: inbound processor now stores full ISO timestamps; tiebreaker sort using note ID for existing date-only notes
- Delete/hide synced with in-memory `_allMessages` array

### DL-274: Dashboard Messages — Search Bar [COMPLETED]
- Search input in panel header with X clear button, debounced 300ms
- Fetch-once pattern: first search loads ALL messages across all years (cached 30 min in KV), subsequent keystrokes filter instantly client-side
- Spinner + "מחפש..." shown during initial fetch
- Variable name bug fix: `filterFormula` → `filterByFormula` (caused 500 on first deploy)
- Badge count removed from panel header per user feedback
- Workers deployed 3x this session

---

## Session Summary (2026-04-15 — Part 12)

### DL-273: Replace KV+Cron Queue with MS Graph Deferred Send [IMPLEMENTED — NEED TESTING]
- **Problem:** Off-hours email queue used KV + daily cron (05:00 UTC). Cron fired at 07:00 Israel in winter (DST). Extra infrastructure for simple "send later".
- **Solution:** MS Graph `PidTagDeferredSendTime` — Exchange holds email in Outbox until 08:00 Israel. Eliminates cron entirely.
- **New methods:** `sendMailDeferred()` and `replyToMessageDeferred()` on MSGraphClient (draft→send with extended property)
- **Key change:** Airtable stage transitions happen immediately on off-hours approval (no longer delayed until cron)
- **Removed:** `email-queue.ts` (121 lines), `scheduled` handler, cron trigger from wrangler.toml
- **Files changed:** `ms-graph.ts`, `israel-time.ts`, `approve-and-send.ts`, `dashboard.ts`, `index.ts`, `wrangler.toml`
- Worker deployed: `a00a4e21-3db8-4ba2-9a09-df00bbef5b53`
- Design log: `.agent/design-logs/email/273-outlook-deferred-send.md`

### Cleanup: Remove Debug console.log [COMPLETED]
- Removed 3 debug `console.log` lines from `approve-and-send.ts` (added during DL-272)

**Test DL-273** — test plan in design log Section 7:
- [ ] Off-hours approve-and-send: email arrives at ~08:00 Israel
- [ ] Off-hours comment reply (threaded): arrives at ~08:00 in correct thread
- [ ] Off-hours comment reply (non-threaded): arrives at ~08:00
- [ ] Business-hours flows: unchanged (immediate send)
- [ ] UI toast + button show queued state on off-hours approval
- [ ] Airtable stage advances immediately on off-hours approval
- [ ] No cron errors in Worker logs

**Follow-up items:**
1. Consider clearing `queued_send_at` on next dashboard load after 08:00 passes (low priority — cosmetic)
2. Dashboard queued count on stage 3 card still works but shows count even after client moves to Collecting_Docs

---

## Session Summary (2026-04-15 — Part 11)

### DL-272: Dashboard Messages — Load More + Same-Day Sort Fix [IMPLEMENTED — NEED DEPLOY]
- **Load more:** Client-side pagination — API now returns all messages (no `slice(0, 10)` cap), frontend shows 10 at a time with "הצג עוד..." link
- **Sort fix:** Inbound processor (`processor.ts:349`) was stripping time from dates (`.split('T')[0]`), causing same-day messages to appear in random order. Now stores full ISO timestamp. Added tiebreaker sort using note ID timestamp for existing date-only notes.
- **State sync:** Delete/hide now removes from in-memory `_allMessages` array and re-renders (not just DOM manipulation)
- **Files changed:** `api/src/lib/inbound/processor.ts`, `api/src/routes/dashboard.ts`, `frontend/admin/js/script.js`, `frontend/admin/css/style.css`
- **Blocked:** Workers deploy failed due to network issue — need to run `npx wrangler deploy` from `api/` directory
- Design log: `.agent/design-logs/admin-ui/272-dashboard-messages-load-more.md`

**Test TODO (DL-272):**
- [ ] Deploy Workers: `cd api && npx wrangler deploy`
- [ ] Dashboard shows first 10 messages, "הצג עוד..." link visible
- [ ] Click load more → 10 more messages appear, link updates count
- [ ] Link disappears when all messages shown
- [ ] Badge shows total count
- [ ] Same-day messages sorted newest-first
- [ ] Delete/hide still works after load more
- [ ] Reply still works after load more
- [ ] Mobile layout not broken

---

## Session Summary (2026-04-15 — Part 11b)

### Fix Negative/Wrong Days in מוכנים להכנה Tab [COMPLETED]
- **Bug 1:** `(-1) ימים` showed when `docs_completed_at` was slightly ahead of browser time (timezone offset)
- **Fix 1:** `Math.max(0, ...)` clamp on `diffDays`
- **Bug 2:** Yesterday's date showed "היום" instead of "יום אחד" — timestamp diff < 24h but different calendar day
- **Fix 2:** Compare midnight-to-midnight dates instead of raw timestamps (both desktop table + mobile cards)
- File changed: `frontend/admin/js/script.js` (lines 2587-2589, 2634-2636)

### Skill & Memory Updates
- `/design-log` Phase 0: added stale worktree cleanup step (`git worktree list`)
- Memory: `feedback_worktree_cleanup.md` — ExitWorktree won't work for CLI `--worktree`

---

## Session Summary (2026-04-14 — Part 10)

### WF07 Daily Digest — IF Node Type Validation Fix [COMPLETED]
- **Bug:** "IF Has Client Emails" node in WF07 (`0o6pXPeewCRxEEhd`) failed with "Wrong type: '' is a string but was expecting a boolean" at 20:00 cron run
- **Root cause:** `typeValidation: "strict"` on the IF node rejected empty string when `$json._hasClients` was undefined/falsy
- **Fix:** Changed `typeValidation` from `"strict"` to `"loose"` via n8n REST API — matches the "Skip Weekend" IF node pattern in the same workflow
- No local file changes — fix applied directly to n8n

---

## Session Summary (2026-04-14 — Part 9)

### DL-272: Port DL-266 Send-Comment Endpoint + Fix Approve-and-Send [IMPLEMENTED — NEED TESTING]
- Ported full DL-266 API implementation from old repo (`annual-reports-old` branch `DL-266-reply-to-client-messages`)
- **New endpoint:** `POST /webhook/admin-send-comment` in `dashboard.ts` — reply to client messages with branded email, off-hours queue, Outlook threading
- **New email builder:** `buildCommentEmailHtml()` + `buildCommentEmailSubject()` in `email-html.ts`
- **New MS Graph method:** `replyToMessage()` — two-step createReply+send for Outlook thread continuity
- **New cron handler:** `processQueuedComments()` in `email-queue.ts` — processes `queued_comment:*` KV keys
- **Reply map:** GET `/admin-recent-messages` now returns `reply` field per message for threaded display
- **Bug fix:** `showAIToast` → `showToast` in doc-manager queued handler — this was the actual cause of the off-hours approve-and-send error since DL-264
- **Bug fix:** `queued_send_at` Airtable update wrapped in try/catch (non-critical)
- **Persistent button lock:** Doc-manager shows "⏰ ישלח ב-08:00" (disabled) on page load when `queued_send_at` is set
- **Hook removed:** `banned-frontend-patterns.js` — was blocking debug and not useful enough to keep
- Design log: `.agent/design-logs/admin-ui/266-reply-to-client-messages.md` (ported from old repo)
- Worker deployed 4x, all changes merged to main

~~**Test DL-272**~~ — NOT TESTED (test plan: `.agent/test-plan-2026-04-15.md` Suite 1)

**Follow-up items (next session):**
1. **Dashboard queued-client visibility** — queued clients in Pending_Approval should show ⏰ badge + grayed row in dashboard table so other users don't double-approve. Remove ugly "(X בתור לשליחה)" from stat card.
2. **Queued reply timestamp** — dashboard messages panel shows the note's save time (e.g. "20:34") for queued replies, but the email won't send until 08:00. Should show "יישלח ב-08:00 ⏰" instead of the save timestamp. Also fix all "ישלח" → "יישלח" and move ⏰ emoji to left side (RTL) across doc-manager button text.
3. **Verify morning cron** — check at 08:00 Israel time (05:00 UTC) that both queued approve-and-send emails AND queued comment replies actually fire.
4. **Outlook deferred send** — replace KV+cron queue with MS Graph `PidTagDeferredSendTime` (scheduled send). Simpler architecture, Outlook handles delivery timing. Eliminates `processQueuedEmails`/`processQueuedComments` cron entirely.
5. **Remove debug console.log** — 3 temporary `console.log` lines in doc-manager approve-and-send handler.

---

## Session Summary (2026-04-14 — Part 8)

### DL-268: AI Review Pagination by Client + FIFO Sort [IMPLEMENTED — NEED TESTING]
- Pagination now counts **client groups** (25/page) instead of documents (was 50 docs/page)
- FIFO sort: oldest-waiting client appears first (by earliest `received_at` ascending)
- Summary bar shows total doc/client counts across ALL pages, not just current page
- File changed: `frontend/admin/js/script.js`
- Design log: `.agent/design-logs/ai-review/268-ai-review-pagination.md`
- Commits: `4f08176`, `90c0c6e` (sync to frontend/ path)

### Root-Level Frontend Duplicates Removed [COMPLETED]
- Deleted 40 root-level files (admin/, assets/, shared/, n8n/, *.html) — 29,725 lines
- `frontend/` is now the sole canonical location for all frontend files
- GitHub Pages deploys from `frontend/**` only (`.github/workflows/deploy-pages.yml`)
- Commit: `63d283e`

### Design-Log Skill Updated
- Phase D Step 7: auto-merge to main after push (no "merge to main?" question)
- Merge IS the deploy for testing on GitHub Pages

~~**Test DL-268**~~ — NOT TESTED (test plan: `.agent/test-plan-2026-04-15.md` Suite 2)

---

## Session Summary (2026-04-14 — Part 7)

### n8n Workflow URL Migration [COMPLETED]
- Migrated all 6 active n8n workflows from `liozshor.github.io/annual-reports-client-portal` to `docs.moshe-atsits.com`
- 19 total occurrences replaced (URLs in Code nodes + CORS headers)
- Workflows updated: [SUB] Document Service (4), [06] Reminder Scheduler (4), [API] Send Batch Status (6), [04] Document Edit Handler (2), [MONITOR] Security Alerts (1), [07] Daily Natan Digest (2)
- CORS: Edit Handler webhook keeps both origins for backward compat; Batch Status respond nodes switched to new domain
- Also committed `.dev.vars*` gitignore entries
- Commit: `78a2b59` on main

**TODO (carried forward):**
- [x] ~~Update n8n workflow URLs to use custom domain~~ (done this session)
- [ ] Verify `docs.moshe-atsits.com` admin login works (CORS resolved)
- [ ] Delete root-level duplicate frontend files (separate PR after stability confirmed)

---

## Session Summary (2026-04-14 — Part 6)

### Session Start Enforcement Hooks [IMPLEMENTED]
- **`session-start-check.sh`** (SessionStart hook) — warns on main/master branch + uncommitted changes + worktree detection
- **`branch-guard.sh`** (PreToolUse hook) — blocks Edit/Write on main/master (exit 2), runs before all other Edit|Write hooks
- Both wired in `.claude/settings.json`, tested live (branch-guard blocked a write mid-session)
- Design log: `.agent/design-logs/infrastructure/DL-SESSION-START-ENFORCEMENT.md`
- Branch: `feat/session-start-enforcement` (pushed, not yet merged to main)

### Design-Log Skill Updated (Global)
- Phase A step 0: worktree-aware branch setup — detects parallel sessions, offers `git worktree add`
- Phase D step 7: worktree cleanup after merge — `git worktree remove` prompt
- File: `~/.claude/skills/design-log/SKILL.md` (global, not git-tracked)

### Custom Domain CNAME + CORS Fix [DEPLOYED]
- Created `frontend/CNAME` → `docs.moshe-atsits.com` (committed to main, `88cfeda`)
- CORS middleware updated to accept comma-separated origins (Hono `string[]`)
- `wrangler.toml` `ALLOWED_ORIGIN` now includes: `liozshor.github.io`, `docs.moshe-atsits.com` (https + http)
- Worker deployed (`f24e08a1`)

**TODO:**
- [ ] Merge `feat/session-start-enforcement` to main (2 commits: hooks + CORS fix)
- [ ] Verify `docs.moshe-atsits.com` admin login works (CORS resolved)
- [ ] Set up HTTPS for custom domain (currently included http:// as fallback)
- [ ] Update `FRONTEND_BASE` constants in Workers code to use custom domain (email links still point to github.io)

---

## Session Summary (2026-04-14 — Part 5)

### DL-MONOREPO: Git Monorepo Migration [IMPLEMENTED — MONITORING]
- **What:** Merged outer local-only repo into GitHub repo (`LiozShor/annual-reports-client-portal`). Single repo, single remote, worktrees work natively.
- **Structure:** `frontend/` = GitHub Pages (deployed via GitHub Actions), `api/` = Cloudflare Workers, `docs/`, `.claude/`, `.agent/` = project tooling
- **Root frontend files kept** for backward compat — delete in separate PR after 1-2 days stability
- **Secrets protected:** `.env`, `.mcp.json`, `.claude/settings.local.json`, `archive/keys.txt`, `docs/wf05-backup-*.json` all gitignored. Airtable PAT in design log 112 redacted.
- **Hooks updated:** 3 hooks had hardcoded `github/annual-reports-client-portal/` → changed to `frontend/`
- **Path refs updated:** CLAUDE.md, airtable-safety.md, SSOT docs, architecture.md, project-overview.md, cs-hardcoded-audit.md, ssot-verify skill, n8n comment URLs

**TODO:**
- [ ] Rename local directories after closing this Claude Code session: `mv annual-reports annual-reports-OLD && mv annual-reports-monorepo annual-reports`
- [ ] Delete root-level duplicate frontend files (separate PR after 1-2 days of stability)
- [ ] Delete `annual-reports-OLD` after confirming everything works for a week
- [ ] Test full worktree workflow with a real ticket
- [ ] Update memory files that reference `github/annual-reports-client-portal/`

---

## Session Summary (2026-04-14 — Part 4)

### DL-267: Auto-Advance to Review When Zero Docs Remaining [VERIFIED ✓]
- **Feature:** Reports with `docs_missing_count === 0` in `Pending_Approval` or `Collecting_Docs` auto-advance to `Review`. No manual office action needed.
- **Manually tested 2026-04-14:** CPA-XXX reduced to 2 docs, both waived → auto-advanced to Review. All validation items passed.

**TODO:** Remove backfill endpoint after confirming no more stuck reports.

---

## Session Summary (2026-04-14 — Part 3)

### DL-265: Entity Tab Switch Loading Indicator + UX Polish [IMPLEMENTED — NEED TESTING]
- **Loading indicator:** Bouncing dots loader with Hebrew text ("טוען לוח בקרה…", etc.) on entity tab switch (AR↔CS). White frosted overlay + backdrop-blur, fade-in animation.
- **Mobile auto-scroll:** Tapping a stat card filter on mobile now smooth-scrolls to the client table.
- **New tab navigation:** Clicking client name in dashboard table opens doc-manager in a new tab (desktop only; mobile stays same-tab).
- **Multi-tab safety rules:** Added global + project rules to prevent parallel Claude Code sessions from clobbering each other's uncommitted changes. Updated skills: git-ship (pre-ship validation), debug, qa-test, silent-failure-hunt, ssot-verify.
- **Files changed:** `admin/css/style.css`, `admin/js/script.js`, `admin/index.html`, `~/.claude/CLAUDE.md`, `CLAUDE.md`, 5 skill files

**Test DL-265:**
- [ ] Switch AR→CS on dashboard → bouncing dots + "טוען לוח בקרה…" overlay appears, disappears on load
- [ ] Same on Send/Questionnaires/Reminders tabs → correct Hebrew label per tab
- [ ] Mobile: stat card tap → page scrolls to table
- [ ] Mobile: bouncing dots appear with padding-top:80px (smaller gap)
- [ ] Desktop: click client name → doc-manager opens in new tab
- [ ] Mobile: tap client name → doc-manager opens in same tab

---

## Session Summary (2026-04-14 — Part 2)

### DL-264: Off-Hours Email Queue [IMPLEMENTED — NEED TESTING]
- **Feature:** Approve-and-send during 8PM-8AM (Israel time) queues emails in KV, delivered at ~8AM by Worker cron trigger. Sub-status on Pending_Approval stage (not a new pipeline stage).
- **Backend:** New `israel-time.ts` (DST-safe via `Intl.DateTimeFormat`), `email-queue.ts` (morning batch processor). Modified `approve-and-send.ts` to fork on `isOffHours()`. Added `scheduled` handler to `index.ts`. Cron `0 5 * * *` in `wrangler.toml`.
- **Frontend:** `document-manager.js` shows "⏰ ישלח ב-08:00" + toast on queued approval. `approve-confirm.html` has queued success state. Dashboard stage 3 card shows "(N בתור לשליחה)" subtitle.
- **Airtable:** New `queued_send_at` field (dateTime, `fld18iNopKSFdbXxX`).
- **Files:** `api/src/lib/israel-time.ts`, `api/src/lib/email-queue.ts`, `api/src/routes/approve-and-send.ts`, `api/src/index.ts`, `api/wrangler.toml`, `api/src/routes/dashboard.ts`, `document-manager.js`, `approve-confirm.html`, `admin/js/script.js`

**Test DL-264:**
- [ ] Approve client after 20:00 Israel → response says queued, KV key created, Airtable has queued_send_at
- [ ] Approve client 08:00-20:00 Israel → sends immediately (unchanged behavior)
- [ ] Dashboard shows queued count on stage 3 card
- [ ] Document manager shows "⏰ ישלח ב-08:00" badge after off-hours approval
- [ ] approve-confirm.html shows queued success page with clock icon
- [ ] Trigger cron manually → queued emails send, stage → Collecting_Docs, KV keys deleted
- [ ] Duplicate off-hours approval → KV key overwrites (idempotent)
- [ ] No regression: daytime approve-and-send works identically

---

## Session Summary (2026-04-14)

### DL-263: Dashboard Messages — Delete/Hide + Raw Text Only [IMPLEMENTED — NEED TESTING]
- **Feature:** Replaced AI summaries with raw email text in dashboard messages panel. Added delete/hide option with inline action buttons.
- **API:** New `delete-client-note` action in `client.ts` (permanent delete or hide-from-dashboard with `hidden_from_dashboard` flag). Added `note.id` to recent-messages response. Filters hidden notes server-side. KV cache invalidation on mutation.
- **Frontend:** Raw snippet shown inline (2-line clamp), hover expands full text on desktop, tap-to-expand on mobile. Two always-visible action buttons per row: folder-open (opens doc-manager in new tab) + trash (inline delete/hide actions). Inline action panel replaces row content (no modal).
- **Files:** `api/src/routes/dashboard.ts`, `api/src/routes/client.ts`, `admin/js/script.js`, `admin/css/style.css`, `admin/index.html` (cache bust v=263b)

**Test DL-263:**
- [ ] Messages show raw email text in quotes (not AI summary)
- [ ] Hover on desktop expands full text (removes 2-line clamp)
- [ ] Tap on mobile toggles expanded/collapsed
- [ ] Folder-open icon opens doc-manager in new tab
- [ ] Trash icon shows inline actions: "מחק לצמיתות" / "הסתר מהדשבורד" / "ביטול"
- [ ] "מחק לצמיתות" permanently removes note from Airtable + dashboard
- [ ] "הסתר מהדשבורד" hides from dashboard but note remains in doc-manager
- [ ] "ביטול" restores original row content
- [ ] After delete/hide, row fades out, badge count updates
- [ ] Refresh page: deleted/hidden messages stay gone
- [ ] No regression: clients table still works

---

## Session Summary (2026-04-13 — Part 4)

### DL-261: Dashboard Recent Client Messages Panel [IMPLEMENTED — NEED TESTING]
- **Feature:** Sticky side panel on dashboard showing 10 most recent client emails
- **API:** New `GET /admin-recent-messages` endpoint with 5-min KV cache
- **Frontend:** 2-column grid layout, hover shows raw snippet as blockquote, click navigates to doc-manager
- **Files:** `api/src/routes/dashboard.ts`, `admin/index.html`, `admin/css/style.css`, `admin/js/script.js`, `shared/endpoints.js`

### DL-262: WF05 Email Note Quality [IMPLEMENTED — NEED TESTING]
- **Problem:** Raw snippets had quoted replies, signatures, `&quot;` entities; summaries described our own outbound template
- **Fix:** Added `stripQuotedContent()` pre-strip, switched Haiku to `tool_use` structured extraction, fixed entity decoding
- **Backfill:** 10 records re-processed with clean summaries and snippets
- **Files:** `api/src/lib/inbound/processor.ts`, `api/src/routes/dashboard.ts`

**Test DL-261:**
- [ ] Panel loads with messages next to clients table
- [x] Click navigates to correct client doc-manager (now opens in new tab via DL-263)
- [x] Hover shows raw snippet inline (DL-263: raw text is now primary, hover expands)
- [ ] Mobile (<900px): panel stacks above table
- [ ] Clients table still works (filters, pagination)

**Test DL-262:**
- [ ] New inbound email → summary describes only client's new content
- [ ] Raw snippet has no signatures or quoted chains
- [ ] No `&quot;` entities in stored data
- [ ] Backfilled records show clean data in dashboard

---

## Session Summary (2026-04-13 — Part 3)

### DL-259: Capture Client Notes & Attachments at All Stages [IMPLEMENTED — NEED TESTING]
- **Problem:** Inbound email processor only looked for reports at Collecting_Docs/Review. Emails from earlier/later stages silently dropped (NeedsHuman).
- **Fix:** Added `getAllReports` (no stage filter). Two-tier flow: always save note + raw upload, only classify at Collecting_Docs/Review.
- **Files:** `api/src/lib/inbound/processor.ts`
- **Worker version:** `aa1964f1`

**Test DL-259:**
- [ ] Trigger inbound email for CPA-XXX (Waiting_For_Answers) → client_notes populated
- [ ] Email event marked Completed
- [ ] Collecting_Docs client: full classification still works
- [ ] Truly unknown client: still NeedsHuman
- [ ] Doc-manager shows note via DL-258 secondary zone

---

## Session Summary (2026-04-13 — Part 2)

### DL-258: Client Messages on Low-Stage Doc Manager [DONE]
- **Problem:** Stage 1 doc manager early-returns before showing secondary zone (notes, client messages, rejected uploads). Clients may email before filling questionnaire — office can't see those messages.
- **Fix:** Extracted `.secondary-zone` HTML from `#content` into standalone `#secondaryZone` sibling. JS shows it at all stages independently.
- **Files:** `document-manager.html`, `assets/js/document-manager.js`
- **Commit:** `798e06e` (submodule)

---

## Session Summary (2026-04-13 — Part 1)

### DL-257: Mobile Bottom Nav Auth Gate [IMPLEMENTED — NEED TESTING]
- **Problem:** Bottom nav visible on login screen before auth (bfcache + FOUC)
- **Fix:** `style="display:none"` on `#bottomNav`, replace CSS sibling selector with `.bottom-nav.visible`, add JS `.visible` at 3 auth points, add `pageshow` bfcache guard
- **Files:** `admin/index.html`, `admin/css/style.css`, `admin/js/script.js`
- **Commit:** `0ab131d`

**Test DL-257 nav gate:**
- [ ] Fresh load on mobile (no session) — login screen shows, bottom nav hidden
- [ ] Login on mobile — bottom nav appears after auth
- [ ] Refresh page (with session) — bottom nav reappears
- [ ] Slow 3G DevTools — no FOUC flash
- [ ] Desktop — bottom nav stays hidden (no regression)

---

## Session Summary (2026-04-12 — Part 7)

### DL-257: Reminder Select-All Bug Fix & Bulk Cap [IMPLEMENTED — NEED TESTING]
- **Problem:** "Select all" in reminders tab shows 100 selected (not 50). Root cause: each item renders 2 `.reminder-checkbox` elements (desktop table + mobile card) sharing same value. Also no bulk cap like questionnaires tab.
- **Fix:** Dedup all checkbox queries via `Set`, added `MAX_BULK_SEND=50` cap to `toggleSectionSelectAll` and `toggleReminderSelectAll`, disable unchecked boxes at limit
- **Files:** `admin/js/script.js`

**Test DL-257:**
- [ ] Click section "select all" → count shows 50 (not 100)
- [ ] Unchecked checkboxes disabled at limit
- [ ] Uncheck one → re-enables unchecked boxes
- [ ] Bulk send → 50 unique report IDs sent
- [ ] Mobile view: same behavior
- [ ] Navigate to page 2 → can select another batch
- [ ] Muted client warning still works
- [ ] Cancel selection → all checkboxes cleared and re-enabled

---

## Session Summary (2026-04-12 — Part 6)

### DL-256: Table Pagination — 50 Rows Per Page [IMPLEMENTED — NEED TESTING]
- **Problem:** 579 clients → 1.5-2.5s icon creation, 852-2484ms click handler violations
- **Fix:** Shared `renderPagination()` utility with Hebrew RTL pagination bar (« הקודם | 1 2 3 ... | הבא »)
- **All 4 tables paginated:** Dashboard clients, questionnaires, reminders, AI review cards
- **Reminders fix:** Per-section pagination (Type A / Type B each get independent pagination inside accordion)
- **DL-255 hide/show logic replaced** — pagination renders only 50 rows, eliminating DOM bottleneck
- **Scoped `safeCreateIcons(root)`** — icon creation scoped to container element (no full-document scan)
- **Files:** `admin/js/script.js`, `admin/css/style.css`, `admin/index.html`

**Test DL-256:**
- [ ] Login → dashboard shows 50 rows, pagination bar at bottom
- [ ] Click page 2 → next 50 rows shown
- [ ] Stage filter → resets to page 1, correct total
- [ ] Search → resets to page 1
- [ ] "מציג 1-50 מתוך N" label correct
- [ ] Stat cards still show full totals
- [ ] Questionnaires, reminders, AI review paginated
- [ ] No timeout errors on dashboard load

---

## Session Summary (2026-04-12 — Part 5)

### Bug Fix: Infinite Reload Loop [PUSHED]
- **Problem:** Fresh visit (no token) → `DOMContentLoaded→switchEntityTab→loadDashboard` with empty auth → API returns unauthorized → `logout()→location.reload()` → infinite loop
- **Fix:** Added `if (!authToken) return;` guard to all 5 data-loading functions
- **Files:** `admin/js/script.js`

### DL-254: Dashboard Load Performance [IMPLEMENTED — NEED TESTING]
- **Problem:** 10 API calls on returning user (dashboard x2, classifications x3, pending x2, reminders x2). 579 clients.
- **Fixes:**
  - Fix double-load: `loadedAt > 0` guards in `switchEntityTab` prevent duplicate loads on init
  - Dedup `loadAIReviewCount` via `deduplicatedFetch` (was `fetchWithTimeout`)
  - Fix timeout mismatch: `loadAIReviewCount` uses `FETCH_TIMEOUTS.slow` to match shared dedup request
  - Stagger prefetches in `requestIdleCallback` — dashboard renders first
  - Bump AI review + reminders timeout 10s → 20s
  - **API:** KV-cache `available_years` (1hr TTL), invalidate on rollover
  - **API:** KV-cache `documents_non_waived` (5min TTL), invalidate on approve/review
  - **API:** Parallelize sequential batch report fetches in classifications endpoint
- **Results:** Returning user: 10 → 5 API calls (50% reduction). Worker deployed.
- Design log: `.agent/design-logs/admin-ui/254-dashboard-load-performance.md`

**Test DL-254:**
- [ ] Returning user reload → exactly 1 `admin-dashboard`, 1 `get-pending-classifications` in Network tab
- [ ] Fresh login → dashboard renders, prefetches fire after
- [ ] AI Review tab loads without error
- [ ] Reminders tab loads without error

### DL-255: Table Rendering Performance [IMPLEMENTED — NEED TESTING]
- **Problem:** Every filter keystroke triggers full innerHTML rebuild of 578 rows + 2300 Lucide icon re-creations
- **Fixes:**
  - Hide/show pattern for dashboard clients table: render ALL entity-filtered rows once, toggle `display:none` for search/stage/year
  - 150ms debounce on all 4 search inputs
  - CSS `content-visibility: auto` for off-screen table rows
- **Results:** Stage filter: 21ms, search: 13ms, back-to-all: 20ms (all <25ms, was 6700ms+)
- Design log: `.agent/design-logs/admin-ui/255-table-rendering-performance.md`

**Test DL-255:**
- [ ] Type in search — no jank, results filter smoothly
- [ ] Click stage stat card — rows hide/show instantly
- [ ] Sort by column — full rebuild, correct order
- [ ] Entity tab switch (AR→CS) — data reloads correctly
- [ ] Mobile cards also filter correctly
- [ ] Bulk selection works on visible rows

---

## Session Summary (2026-04-12 — Part 4)

### DL-251: View Documents — Filing Type Badge [IMPLEMENTED — NEED TESTING]
- **Problem:** Dual AR+CS clients couldn't tell which filing type they were viewing on the view-documents page. Tabs existed (DL-218) but were too subtle.
- **Fix:** Added a color-coded pill badge in the header area (blue for AR, purple for CS). Reuses admin panel badge pattern. Only shows for dual-filing clients. Updates on tab switch and language change.
- **Files:** `view-documents.css`, `view-documents.html`, `view-documents.js`
- Design log: `.agent/design-logs/client-portal/251-view-documents-filing-type-badge.md`

**Test DL-251:**
- [ ] Single-filing AR client: no badge visible
- [ ] Dual AR+CS client: badge visible in header
- [ ] Switch tabs: badge updates (text + color)
- [ ] Switch language: badge text updates (HE/EN)
- [ ] Mobile: badge doesn't break header layout

---

## Session Summary (2026-04-12 — Part 3)

### DL-250: Entity Tab Switch Fix [COMPLETED]
- **Problem:** Switching AR↔CS entity tabs on the dashboard didn't reload data; on the import tab, content stayed faded at 50% opacity.
- **Root causes:** (1) `switchEntityTab()` set `dashboardLoaded=false` then checked `if(dashboardLoaded)` (dead code), and the reload section had no `dashboard` case. (2) `.tab-refreshing` class applied to ALL tabs but only removed for tabs with load functions — import tab stuck at 50% opacity.
- **Fixes:** Added dashboard case to reload section, removed dead code block, restructured `.tab-refreshing` to only apply to tabs that actually fetch data.
- **Bonus:** Added filing type badge to import tab header for visual feedback.
- **Files:** `admin/js/script.js`, `admin/index.html`
- Design log: `.agent/design-logs/admin-ui/250-entity-tab-switch-dashboard-reload.md`

---

## Session Summary (2026-04-12 — Part 2)

### DL-243: CS Help Text Import [IMPLEMENTED — NEED TESTING]
- **Context:** Natan returned filled Excel with Hebrew help text for CS document templates (view-documents `?` icons).
- **Imported:** 16/22 CS templates with `help_he` (6 intentionally empty — self-explanatory docs).
- **English:** Generated and imported `help_en` translations for all 16 templates.
- **Fixes:** Hardcoded "31.12.2025" → "31.12.{year}" in CS-T010 and CS-T018.
- **Cache:** KV `cache:templates` purged — changes are live.
- **No code changes** — existing pipeline serves CS help text identically to AR.
- Design log: `.agent/design-logs/capital-statements/243-cs-help-text-content.md`

**Test DL-243:**
- [ ] Open a CS client's view-documents page — `?` icons appear next to documents
- [ ] Click `?` → accordion expands with Hebrew help text
- [ ] Toggle language → English help text shows
- [ ] Documents with `{year}` placeholder show correct year (not "2025")
- [ ] Empty templates (CS-T004, T006, T007, T012, T019, T020) show no `?` icon
- [ ] AR view-documents still works unchanged (regression)

---

## Session Summary (2026-04-12)

### DL-248: Fix Upload Document Endpoint [IMPLEMENTED — NEED TESTING]
- **Problem:** Admin upload in doc-manager.html returned 400: "Report has no OneDrive root folder configured"
- **Root causes:** (1) `upload-document.ts` read `onedrive_root_folder_id` from report record (doesn't exist — field is on clients table). (2) Used `display_name`/`name` fields (don't exist on documents table) — every file saved as "document.pdf".
- **Fix:** Replaced with `resolveOneDriveRoot()` + `uploadToOneDrive()` from attachment-utils. Changed filename source to `issuer_name` field.
- **Also:** Refreshed 31 stale `file_url` values via temp endpoint. Renamed 7 old `דוחות שנתיים` folders to `דוח שנתי`. Cleared 1 broken item (אלביט — deleted from OneDrive).
- **Files:** `api/src/routes/upload-document.ts`

**Test DL-248:**
- [x] Upload file via doc-manager — no 400 error
- [ ] Verify uploaded file appears in OneDrive with correct Hebrew document name
- [ ] Verify Airtable doc record updated: file_url, onedrive_item_id, status=Received

### DL-249: Auto-Create Client OneDrive Folders [IMPLEMENTED — NEED TESTING]
- **Problem:** OneDrive folders only created on-demand during first upload. New clients had no folder structure.
- **Solution:** `createClientFolderStructure()` helper creates full `clientName/year/filingType/` hierarchy. Wired into bulk import + year rollover. Backfill ran: 40/40 existing combos, 0 errors.
- **Files:** `api/src/lib/inbound/attachment-utils.ts`, `api/src/routes/import.ts`, `api/src/routes/rollover.ts`

**Test DL-249:**
- [ ] Bulk import with new test client — verify folder appears in OneDrive
- [ ] Year rollover — verify new year folder created
- [ ] Verify existing upload/inbound flows still work (no regression)

---

## Session Summary (2026-04-09 — Part 2)

### DL-247: Tab Switching Performance & Smart Loading [IMPLEMENTED — NEED TESTING]
- **Problem:** Full-screen blocking overlay ("טוען סיווגים...") shown on every tab switch, even when data is cached. AI review never prefetched.
- **Solution:** Stale-while-revalidate pattern — show cached data instantly, refresh silently in background. Full-screen overlay reserved for mutations only.
- **Key changes:**
  - Removed `showLoading`/`hideLoading` from all 5 tab load functions
  - Added `*LoadedAt` timestamps + `STALE_AFTER_MS = 30s` staleness check
  - `switchTab()` always passes `silent=true` (was passing `*Loaded` flag)
  - AI review added to dashboard prefetch list
  - `deduplicatedFetch` (existing but unused) wired into 3 GET-based loaders (pending, AI review, questionnaires)
  - Fixed `deduplicatedFetch` to clone responses (Response body can only be read once)
  - `switchEntityTab()` uses opacity fade instead of full-screen overlay
  - First-ever tab load shows inline CSS spinner (`.tab-loading-inline`)
- **Files:** `admin/js/script.js`, `admin/css/style.css`, `assets/js/resilient-fetch.js`
- Design log: `.agent/design-logs/admin-ui/247-tab-switching-performance.md`

**Test DL-247:**
- [ ] Switch to AI Review tab on first visit — no full-screen overlay, inline spinner or instant load
- [ ] Switch back to Dashboard after visiting AI Review — instant, no loading indicator
- [ ] Switch filing type (AR → CS) — no full-screen overlay, brief opacity fade
- [ ] Rapid tab switching — no duplicate API calls (check Network tab)
- [ ] After 30+ seconds, switch tab — silent background refresh fires
- [ ] Mutations (bulk send, save settings, mark complete) still show full-screen overlay
- [ ] Auto-refresh (5-min interval) still works silently
- [ ] Page visibility return still refreshes silently
- [ ] AI Review tab loads instantly after dashboard (prefetched)

---

## Session Summary (2026-04-09)

### DL-246: Split Modal Page Preview & Zoom [IMPLEMENTED — NEED TESTING]
- **Problem:** PDF split modal thumbnails (scale 0.2, ~120px) too small to read page content. Admins can't decide how to group pages.
- **Solution:** Lightbox-style page preview overlay with zoom/pan controls.
- **Features:** Hover magnify icon on thumbnails, lightbox with full-size page render (pdf.js scale 1.5), left/right arrow navigation, zoom controls (+/- buttons, scroll wheel, double-click toggle), drag-to-pan when zoomed, full keyboard support (arrows/Escape/+/-).
- **Files touched:** `github/.../admin/index.html`, `github/.../admin/css/style.css`, `github/.../admin/js/script.js`.
- **Code review fixes:** Canvas backing store release, `closeSplitModal` → `closePagePreview` chain, render race guard, `||` → `??` falsy-zero fix.
- Design log: `.agent/design-logs/admin-ui/246-split-modal-page-preview-zoom.md`

---

## Session Summary (2026-04-07 — Part 3)

### DL-244: Rejected Uploads Visibility [IMPLEMENTED — NEED TESTING]
- **Problem:** When admin rejects an AI classification, the source upload (filename + date + reason) is lost. Client never learns we received a file we couldn't use; same docs keep being requested in approve-and-send + reminders.
- **Critical constraint:** Doc records must stay `Required_Missing` (NOT `Requires_Fix`) — the reject acts on the AI's *guess at a template slot*, not the client's actual document. Marking template slots would lie to the client about what they sent.
- **Solution:** New `rejected_uploads_log` JSON field on Reports table. Reject flow appends `{filename, received_at, reason_code, reason_text, notes, ...}` per rejection. Auto-clears when stage advances past Collecting_Docs.
- **Surfaces:** Amber callout titled "מסמכים שקיבלנו ממך בעבר" rendered above missing-docs list in:
  - approve-and-send email (Workers `email-html.ts` shared helper)
  - Type B reminder email (n8n WF06, both HE and EN branches)
  - Client portal view-documents.html
  - Admin doc-manager (with delete-only action under הודעות הלקוח)
- **Files touched:** `api/src/routes/{classifications,client,client-reports,stage,approve-and-send}.ts`, `api/src/lib/email-html.ts`, `github/.../assets/js/{view-documents,document-manager}.js`, `github/.../document-manager.html`, `github/.../admin/css/style.css`, `github/.../view-documents.html`, n8n workflow `FjisCdmWc4ef0qSV` (Search Due Reminders + Prepare Type B Input + Build Type B Email), `docs/airtable-schema.md`, design log `documents/244-rejected-uploads-visibility.md`.
- **Build:** `cd api && npx tsc --noEmit` clean.
- **Not yet deployed/tested:** Worker deploy + manual end-to-end test plan in current-status TODO #0 + design log Section 7.

---

## Session Summary (2026-04-07 — Part 2)

### CS Questionnaire Labels — Strip `cs_` Prefix [COMPLETED]
- Bug: CS questionnaire columns in Airtable are prefixed with `cs_` (DL-182, to disambiguate from AR in shared submissions table). Prefix was leaking into the WF02 "full questionnaire" email, the admin questionnaires tab (view + print), and the doc-manager questionnaire panel (view + print). In RTL, `cs_חשבון בנק עסקי` rendered as `חשבון בנק עסקי_cs`.
- Investigated alternatives: renaming Airtable columns would require updating Tally→Airtable mapping, n8n WF02, `workflow-processor-n8n.js`, `question_mappings` rows, and `format-questionnaire.ts` hidden-field lists in lockstep. Rejected as too risky.
- **Fix:** One-line strip in `api/src/lib/format-questionnaire.ts:127` — `key.replace(/^cs_/, '')` before pushing to `answerEntries`. All four surfaces read `answers[].label` from this single formatter, so the server-side strip covers everything.
- **Deployed:** Worker version `13f18aca-d92a-4fb1-9828-a4de04b42b35`. Commit `2405e9b` (local outer repo only — no remote).
- Works for existing CS submissions immediately on next page load.

---

## Session Summary (2026-04-07)

### DL-242: Questionnaires-Tab Print — Notes & Client Questions [COMPLETED]
- Bug: printing from admin → questionnaires tab (single + bulk) omitted "שאלות הלקוח" and "הערות משרד" sections that DO appear when printing the same client from doc-manager.
- Root cause: `api/src/routes/questionnaires.ts` never returned `notes` per item; print fell back to a fragile `clientsData.find(...)` cross-reference. Client-questions parser also silently swallowed parse failures.
- **Worker fix:** API now fetches and returns `notes` + `filing_type` per item alongside the existing `client_questions`.
- **Frontend fix:** `generateQuestionnairePrintHTML` now reads `item.notes` / `item.filing_type` directly. Client-questions parser hardened to warn on bad JSON.
- **Deployed:** Worker `ecda4169-3084-4667-a87e-f52e9fce0e95`, submodule `4a687cd`. **Verified working in production.**

---

## Session Summary (2026-04-06 — Part 2)

### DL-238: Unified AI Review Tab (Both AR & CS)
- AI Review tab now loads all classifications regardless of entity tab (`filing_type=all`)
- Each card shows a filing type badge (`.ai-filing-type-badge` — blue for AR, purple for CS)
- Tab badge count is combined across filing types
- `switchEntityTab()` no longer invalidates AI Review cache (data unchanged)
- API: `classifications.ts` accepts `filing_type=all` and adds `filing_type` to response items
- **Status:** IMPLEMENTED — NEED TESTING

### DL-239: Cross-Filing-Type Reassign
- Reassign combobox now supports cross-type — toggle buttons inside dropdown switch between AR/CS doc lists
- Toggle appears at the top of the dropdown only when client has BOTH active reports
- API: `clientToReports` map built from Airtable reports query (covers clients without pending classifications in sibling type)
- API: `target_report_id` param accepted in POST reassign for "create new doc" cross-type path
- Combobox dropdown re-anchors on window scroll/resize (was drifting away from input)
- Click input again while open closes dropdown (toggle behavior)
- **Status:** IMPLEMENTED — NEED TESTING

### DL-241: CS Template short_name_he Issuer Placeholders
- Discovered CS docs in reassign combobox showed generic template names ("אישור מס – פנסיה") instead of per-issuer names
- Root cause: CS templates' `short_name_he` field in Airtable lacked `{varName}` placeholders that AR templates have
- Pure data fix — updated 17 CS template records via pyairtable
- Cleared `cache:templates` KV key in Workers
- **Status:** IMPLEMENTED — NEED TESTING

### Test DL-238/239/241
  - [ ] AI Review tab shows both AR and CS classifications regardless of entity tab
  - [ ] Each card shows filing type badge (דוח שנתי / הצהרת הון)
  - [ ] Tab badge count is combined
  - [ ] Approve/reject/reassign still work
  - [ ] Reassign combobox shows toggle for clients with both AR+CS
  - [ ] Toggle switches the doc list to other filing type
  - [ ] Cross-type reassign succeeds (verify in Airtable)
  - [ ] Combobox dropdown stays anchored when scrolling page
  - [ ] Clicking input again while open closes the dropdown
  - [ ] CS docs in combobox show issuer names (e.g., "אישור מס – פנסיה – פנסיה1")
  Design logs: `.agent/design-logs/ai-review/238-unified-ai-review-both-filing-types.md`, `239-cross-filing-type-reassign.md`, `capital-statements/241-cs-template-short-names.md`

### UI Design System Update
- Added `.ai-filing-type-badge` and `.doc-combobox-ft-toggle` patterns to `docs/ui-design-system-full.md`
- Documented combobox scroll/click behaviors

---

## Session Summary (2026-04-06)
- **DL-240:** Remove OneDrive subfolders (זוהו / ממתינים לזיהוי / מסמכים שזוהו)
  - Removed `folder` param from `uploadToOneDrive()` in `attachment-utils.ts`
  - Removed subfolder logic from `processor.ts` (both inbound paths)
  - Removed `/מסמכים שזוהו` from admin upload path in `upload-document.ts`
  - Removed `moveToZohu` from `classifications.ts`, simplified archive to 2-level traversal
  - All docs now land directly in filing type root: `{year}/דוח שנתי/filename.pdf`
  - **Deployed:** Build passes, pending deploy + manual testing

### Test DL-240: Remove OneDrive Subfolders
  - [x] Build passes (`npx tsc --noEmit`)
  - [ ] Inbound email → attachment uploads to `{year}/דוח שנתי/filename.pdf` (no subfolder)
  - [ ] Admin upload → file goes to `{year}/דוח שנתי/filename.pdf`
  - [ ] AI Review reject → file moves to `{year}/ארכיון/`
  - [ ] AI Review approve → file renamed in place
  - [ ] AI Review reassign → file renamed in place (no move)
  - [ ] Existing files in old subfolders still accessible
  Design log: `.agent/design-logs/documents/240-remove-onedrive-subfolders.md`

---

## Session Summary (2026-04-05)
- **DL-237:** PDF split & re-classify from AI review
  - Created `api/src/lib/pdf-split.ts` — `splitPdf()` and `getPdfPageCount()` using pdf-lib
  - Added page count capture in `processor.ts` during inbound email processing
  - Added 3 Airtable fields: `page_count`, `split_from`, `page_range` to CLASSIFICATIONS table
  - Added `action=split` handler to `POST /webhook/review-classification` in `classifications.ts`
  - Added `/webhook/download-file` proxy endpoint for CSP-safe PDF download
  - Frontend: split banner on AI review cards when `page_count >= 2`, split modal with pdf.js thumbnails
  - Two split modes: "Split All" (one page per doc) and "Manual Ranges" (e.g., "1-2, 3, 4-5")
  - pdf.js v3.11.174 loaded lazily via CDN on first use
  - Fixed: CSP `blob:` for pdf.js worker, `.show` class for modal visibility, progressive thumbnail rendering
  - **Deployed:** API deployed, submodule pushed. Verified modal opens with 15-page PDF thumbnails.

### Test DL-237: PDF Split & Re-Classify
  - [x] Multi-page PDF (3+ pages) shows split banner on review card
  - [ ] Single-page PDF does NOT show split button
  - [x] Split modal opens with correct page thumbnails rendered via pdf.js (verified with 15-page PDF)
  - [ ] "Split All" mode creates one classification per page
  - [ ] "Manual Ranges" mode correctly parses "1-2, 3, 4-5" into groups
  - [ ] Invalid range input (e.g., "0, 99") shows validation error
  - [ ] Split PDFs are uploaded to OneDrive with `_part1`, `_part2` suffixes
  - [ ] Each split segment is classified independently (different template matches possible)
  - [ ] Original classification hidden after split (review_status = 'split')
  - [ ] New classification cards appear on refresh with correct client/report context
  - [ ] `split_from` field links children to parent in Airtable
  - [ ] `page_range` field shows correct ranges on child records
  - [ ] Verify no regression: approve/reject/reassign still work normally
  - [ ] Mobile: split modal is usable on small screens
  - [ ] New inbound multi-page PDF auto-populates `page_count` field
  Design log: `.agent/design-logs/ai-review/237-pdf-split-reclassify.md`

---

## Session Summary (2026-03-31)
- **DL-235:** OneDrive folder routing restructure
  - Renamed filing type folders: `דוחות שנתיים` → `דוח שנתי`, `הצהרות הון` → `הצהרת הון` (singular)
  - Moved `ארכיון` from inside filing type folders to year level (sibling of filing types)
  - Fixed `moveFileToArchive()`: 3-level parent traversal instead of 2
  - Fixed main review handler: split archive (3 levels up) vs זוהו (2 levels up, stays inside filing type)
  - 2 files changed: `attachment-utils.ts`, `classifications.ts`
  - **Needs deploy:** `wrangler deploy` to activate

### Test DL-235: OneDrive Folder Routing Restructure
  - [ ] Reject a classification → file moves to `{year}/ארכיון/` (NOT inside filing type folder)
  - [ ] Approve with override → old file moves to `{year}/ארכיון/`
  - [ ] Reassign unmatched doc → file moves to `{year}/דוח שנתי/זוהו/` (still inside filing type)
  - [ ] Inbound email attachment → uploads to `{year}/דוח שנתי/זוהו/` or `ממתינים לזיהוי/` (singular folder name)
  - [ ] Admin upload from doc manager → goes to `{year}/דוח שנתי/מסמכים שזוהו/` (singular)
  - [ ] CS document → uploads to `{year}/הצהרת הון/` (singular, not plural)
  - [ ] Existing files in old plural folders still accessible (no migration, old URLs unchanged)
  - [ ] Regression: approve standard (no conflict) → file renamed in place, no folder move
  - [ ] Regression: reassign matched doc → file renamed, stays in current folder
  - [ ] Regression: keep_both → new doc created, no archive move
  Design log: `.agent/design-logs/documents/235-onedrive-folder-routing-restructure.md`

Previous (same day):
- **DL-222 (addendum):** Fixed client switcher in document-manager — was navigating with `report_id` instead of `client_id`, causing "Not Started" screen. 10 edits in switcher section, no backend changes. Tested & confirmed working.

- **DL-234:** Skip own outbound emails in inbound pipeline
  - Added `SYSTEM_SENDER` filter in `processor.ts` to skip emails from `reports@moshe-atsits.co.il`
  - Prevents system-generated emails from being added as client messages/notes
  - 4-line change, follows existing auto-reply filter pattern
  - Cleaned up 7 system-generated notes from Client Name test account
  - **Needs deploy:** `wrangler deploy` to activate the filter

### Test DL-234: Skip Own Outbound Emails
  - [ ] Send test email FROM reports@moshe-atsits.co.il → verify pipeline skips (Worker logs)
  - [ ] Send test email FROM real client → verify normal processing
  - [ ] Send test from another @moshe-atsits.co.il address → verify office forwarding still works
  - [ ] Trigger a reminder → verify reminder works AND inbox copy is skipped
  Design log: `.agent/design-logs/infrastructure/234-skip-own-outbound-emails.md`

- **DL-232:** Complete email & print filing type audit + fix
  - Audited all 9 email types + questionnaire print for AR/CS differentiation
  - Fixed Client Doc Request "has docs" case: subject + body now include filing type (Workers `email-html.ts`)
  - Fixed Type A reminder: header + 3 body paragraphs now dynamic (n8n WF[06])
  - Fixed Type B reminder: EN + HE body text now dynamic (n8n WF[06])
  - Fixed WhatsApp pre-filled text: generic across all emails (`email-styles.ts` + n8n nodes)
  - Fixed questionnaire print: title now "Name — Filing Type Year", meta shows "שאלון הוגש"
  - Applied print fixes to both admin `script.js` and `document-manager.js`
  - Fixed duplicate `reportClient` variable crash in print function
  - Corrected DL-222's assessment that Type A/B reminders were "DUAL" (only subjects were)
  - Deployed Workers + updated n8n WF[06] + pushed GitHub Pages

Previous session (same day):
- **DL-231:** Fix keep_both classification paths missing `document_key`, `document_uid`, `issuer_key`

Previous session (2026-03-30):

## Session Summary (2026-03-30)
- **DL-228:** Smart add second filing type — 4 features:
  1. Email blur auto-detect: typing an existing client's email shows inline banner with pre-fill option
  2. Row menu shortcut: "הוסף הצהרת הון/דוח שנתי" in dashboard table "..." menu (desktop, mobile, right-click)
  3. Doc manager button: "Add other type" next to filing tabs, calls import endpoint + page reload
  4. Tab linking: `viewClientDocs()` passes `&tab=filing_type` → doc manager opens correct tab
  - API: `client-reports.ts` now returns `client_email`/`cc_email` in office mode
  - CSS: `.existing-client-banner` (slide-down), `.field-prefilled` (yellow tint), `.add-filing-type-btn` (dashed blue)

Previous session:
- **DL-226:** Dual-filing classification + OneDrive folder architecture

---

## Priority Queue

_(empty — no P1 items)_

~~**P1 — Rotate Airtable PAT (secret leaked in design log)**~~ — ✅ RESOLVED 2026-04-16
- Leaked token `patvXzYxSlSUEKx9i.25f38a9e...` found in `.agent/design-logs/ai-review/112-webhook-dedup-and-issuer-display.md:94` (hardcoded in a DL-112 n8n Code node snippet captured in the design log).
- **Rotated:** User regenerated the token in Airtable. `.env` uses a separate token (`pat2XQGRyzPdycQWr`) — untouched.
- **n8n updated:** Only one *active* workflow (`QqEIWQlRs1oZzEtNxFUcQ` [02] Questionnaire Response Processing, node `code-clear-reminder`) had the old token hardcoded. Updated via MCP. Send Batch Status (`QREwCScDZvhF9njF`) is disabled, skipped. 3 archived workflows with the old token skipped (dormant + old token now dead anyway).
- **Redacted:** DL-112 line 94 → `'<redacted — see .env AIRTABLE_API_KEY / n8n credential>'`.
- **Committed:** `2a9ff3f` (bundled with `.agent/` tracking reorg).

~~**Bug: AI Review reassign dropdown shows already-approved/assigned docs**~~ — Fixed in DL-224

---

## Active TODOs

~~**Test DL-244: Rejected Uploads Visibility**~~ — NOT TESTED (test plan: `.agent/test-plan-2026-04-15.md` Suite 3)
~~**Test DL-232: Email & Print Filing Type Audit**~~ — NOT TESTED (test plan: Suite 4)
~~**Test DL-228: Smart Add Second Filing Type**~~ — NOT TESTED (test plan: Suite 5)
~~**Test DL-225: CS Hardcoded AR Remediation**~~ — NOT TESTED (test plan: Suite 6)
~~**Test DL-226: Dual-Filing Classification + OneDrive Folders**~~ — NOT TESTED (test plan: Suite 3)
~~**Test DL-231: Keep-Both Missing Document Keys**~~ — NOT TESTED (test plan: Suite 8)

**DL-182: Capital Statements Tally Forms** — BLOCKED on user conditionals + EN form
- Phases 1-4 done, **Phase 3 + FILING_CONFIG now complete** (2026-03-28):
  - ✅ 22 CS document templates in Airtable (`documents_templates`)
  - ✅ 22 CS question mappings in Airtable (`question_mappings`) with HE tally keys
  - ✅ `FILING_CONFIG` updated: `form_id_he: '7Roovz'`, `form_id_en: ''`
  - 8 new CS categories auto-created via typecast
- Remaining:
  1. User: Add 22 conditional rules to HE form `7Roovz` + delete 2 broken blocks
  2. User: Duplicate HE form to create EN form (old `XxEEYV` deleted)
  3. Agent: Populate `tally_key_en` + `label_en` in question_mappings after EN form exists
  4. Agent: Update CS_KEY_MAP in `workflow-processor-n8n.js` after EN form exists
  5. Agent: Update `form_id_en` in FILING_CONFIG after EN form exists
  6. Both: Publish forms → end-to-end test

~~**Test DL-222: Email AR/CS Dual-Filing**~~ — NOT TESTED (test plan: `.agent/test-plan-2026-04-15.md` Suite 7)

~~**Test DL-222c: Multi-PDF Approve Conflict**~~ — ✅ ALL PASSED (2026-03-29)
Design log: `.agent/design-logs/ai-review/222-multi-pdf-approve-conflict.md`

~~**Test DL-224: Doc Lookup Fix + Dropdown Dedup + Reassign Conflict**~~ — ✅ ALL PASSED (2026-03-29)
Design log: `.agent/design-logs/ai-review/224-issuer-aware-doc-lookup.md`

~~**Test DL-222b: Document Manager report_id → client_id Links**~~ — ✅ ALL PASSED (2026-03-29)
Design log: `.agent/design-logs/admin-ui/222-fix-document-manager-report-id-links.md`

~~**Test DL-223: Backfill filing_type**~~ — ✅ ALL PASSED (2026-03-29)
Design log: `.agent/design-logs/infrastructure/223-backfill-filing-type-empty-records.md`

**DL-166/216: Admin Portal Filing Type Tabs (AR/CS)** — ✅ COMPLETE
- DL-166: Entity tabs on Dashboard (client-side filtering) — done
- DL-216: Filing type scoping across ALL tabs (backend + frontend) — done 2026-03-29
  - Backend: 4 routes (pending, reminders, questionnaires, classifications) accept `filing_type`
  - Frontend: all API calls pass `filing_type`, cache invalidation on tab switch, review queue filtered
  - Mobile: navbar entity toggle (שנתיים/הון) visible on all tabs

~~**Azure AD client secret**~~ — ✅ Renewed 2026-03-29 (new expiry: 2028-03-28)
- Updated in: Cloudflare Workers, secure_keys.txt, .env
- n8n credential: update manually in UI + re-authenticate OAuth

~~**Test DL-214: Mobile Table → Card Layout**~~ — ✅ PASSED (2026-03-28)

**E2E Tests for DL-185..205** — 10 tests covering 16 design logs (see E2E Feature Validation section below)

---

## Recently Completed (Last 5 Sessions)

| Session | Date | Summary |
|---------|------|---------|
| 224 | 2026-03-29 | DL-224: Doc lookup fix (prefer Required_Missing), all-docs dropdown with received badge, 3-option reassign conflict dialog (merge/keep-both/override), archive-on-override. Tested DL-222/222b/222c/223/224 — all passed. |
| 223 | 2026-03-29 | DL-223: Backfilled 33 legacy report records with `filing_type: 'annual_report'`. Fixed reminders + pending tabs only showing 3 of 36 eligible clients. |
| — | 2026-03-29 | CS questionnaire intro paragraph (Tally MCP): added intro text + privacy notice to form 7Roovz matching AR design. Created `/tally` skill at `~/.claude/skills/tally/`. |
| 216 | 2026-03-29 | DL-216: Filing type scoping across all admin tabs — backend filtering (4 routes), cache invalidation, review queue filter, mobile navbar entity toggle. |
| 206 | 2026-03-26 | DL-206: Classification prompt parity — full 670-line classifier with DOC_TYPE_REFERENCE, strict tool schema, NII routing, confusing-pairs, size-based routing, dual-field issuer matching. Already implemented. |
| 214 | 2026-03-28 | DL-214: Mobile table→card layout for all 5 admin tables (clients, pending, review, reminders, questionnaires) + collapsible filter bar on mobile. |
| 212 | 2026-03-28 | DL-212: Mobile bottom nav bar (5 items) + AI review full-screen preview modal with nav arrows + card overflow fixes. |
| 209 | 2026-03-27 | WF05 pipeline bugfixes: stale file_hash dedup, single-candidate match, empty note skip. 12/12 uploads verified. |
| 208 | 2026-03-27 | DL-208: Document manager client switcher (year select + searchable combobox). COMPLETE. |
| 207 | 2026-03-27 | AI review client notes UX: removed raw email body, in-place toggle for notes. COMPLETE. |
| 206 | 2026-03-26 | DL-210: 4 classification review bugfixes from CPA-XXX testing. COMPLETE. |
| 205 | 2026-03-26 | DL-205: Clear file fields on doc status revert to Missing. COMPLETE. |

---

## Deferred / Blocked

| Item | Trigger Condition |
|------|-------------------|
| DL-166 Filing Type Tabs | CS Tally forms + templates populated |
| DL-182 CS Tally completion | Moshe provides content decisions |
| Custom domain migration | Business decision to purchase domain (audit ready: `docs/custom-domain-migration-audit.md`) |
| WF05 `convertOfficeToPdf()` | Needs MSGraphClient binary GET method — low priority, PDFs work fine |

---

## E2E Test Suite (Post-Migration Validation)

**Last full run: Session 186 (2026-03-25) — All 14 tests PASSED**

### Full Client Lifecycle (Tests 1-5)
1. Fresh Client → Questionnaire → Documents Generated
2. Office Review → Approve & Send → Client View
3. Client Uploads → AI Classification → Admin Review
4. Reminder Pipeline (cron → email → suppress/unsuppress)
5. Complete Lifecycle — All Docs Received → Mark Complete

### Edge Cases & Boundary Tests (Tests 6-12)
6. Bilingual Client Full Flow
7. Concurrent Admin Actions (Race Conditions)
8. Token Expiry & Security
9. Zero-State & Empty Data
10. KV Cache Consistency
11. MS Graph Token Refresh
12. Hybrid Worker→n8n Async Reliability

### Cross-Surface SSOT Verification (Tests 13-14)
13. Document Title Uniformity (office API, client API, email HTML)
14. Stage Pipeline Consistency (all 8 stages across all surfaces)

### Cleanup After Tests
- Delete all test clients/reports from Airtable
- Delete test documents from OneDrive
- Verify no test data leaks into production views

---

## E2E Feature Validation (DL-185..205)

**9/10 passed on 2026-03-28. 1 skipped (digest email).**

### Passed (2026-03-28)
- ✅ Test 1: Inbound Email → AI Classification (DL-195, 196, 203)
- ✅ Test 2: AI Review — Cards, Preview, Actions (DL-188, 197, 201)
- ✅ Test 3: AI Review — Batch Status Removed (DL-194)
- ✅ Test 4: Client Communication Notes (DL-199)
- ✅ Test 5: Document Manager UX (DL-200, 205)
- ✅ Test 7: Email Logo & Phone (DL-186, 189)
- ✅ Test 8: Questionnaire Toggle (DL-190)
- ✅ Test 9: T501 Short Names & Template Audit (DL-197)
- ✅ Test 10: Cross-Surface Smoke Test (DL-212)

### Skipped
- ⏭️ Test 6: Daily Digest Email (DL-185, 202, 204) — needs cron trigger

### Fixes applied during testing
- Preview spinner stays until iframe loads (no white flash)
- Date format DD-MM-YYYY in client notes
- Quotes around טקסט מקורי
- Renamed "הערות לדוח" → "הערות פנימיות לדוח"
- Last-sent date shown in floating sticky bar
- Unsaved changes warning on page leave
- Friendly "קובץ PDF פגום" instead of raw API errors
