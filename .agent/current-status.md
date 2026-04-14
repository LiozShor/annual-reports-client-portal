# Annual Reports CRM - Current Status

**Last Updated:** 2026-04-14 (DL-MONOREPO)

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

### DL-267: Auto-Advance to Review When Zero Docs Remaining [IMPLEMENTED — DEPLOYED]
- **Feature:** Reports with `docs_missing_count === 0` in `Pending_Approval` or `Collecting_Docs` auto-advance to `Review`. No manual office action needed.
- **Shared helper:** `api/src/lib/auto-advance.ts` — `checkAutoAdvanceToReview()` replaces duplicated inline logic in classifications.ts and edit-documents.ts.
- **approve-and-send + email-queue:** 0 docs → Review instead of Collecting_Docs. `docsCount` added to queue payload.
- **Backfill endpoint:** `POST /webhook/backfill-zero-docs` (temporary, admin-token protected). Fixed to not exclude `docs_total=0` cases.
- **Manual backfill done:** Advanced 2 stuck clients — דין שקד (CPA-XXX, Collecting_Docs→Review) and דניאל לחיאני (CPA-XXX, Pending_Approval→Review).
- **Files changed:** `api/src/lib/auto-advance.ts` (new), `api/src/routes/backfill.ts` (new), `api/src/routes/classifications.ts`, `api/src/routes/edit-documents.ts`, `api/src/routes/approve-and-send.ts`, `api/src/lib/email-queue.ts`, `api/src/index.ts`

**Test DL-267:**
- [ ] Approve-and-send with 0 missing docs → report goes to Review (not Collecting_Docs)
- [ ] Approve classification that completes all docs → auto-advance to Review
- [ ] Batch waive all remaining docs → auto-advance to Review
- [ ] Off-hours queued email with 0 docs → advances to Review on morning send
- [ ] Reports already at Review or beyond are NOT affected

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

~~**Bug: AI Review reassign dropdown shows already-approved/assigned docs**~~ — Fixed in DL-224

---

## Active TODOs

0. **Test DL-244: Rejected Uploads Visibility** — verify "מסמכים שקיבלנו ממך בעבר" callout appears wherever rejected uploads are listed
   - [ ] Schema: Field `rejected_uploads_log` exists on Reports table (verified during impl)
   - [ ] Reject flow: Reject a classification → entry appears in report's `rejected_uploads_log` JSON via Airtable, with correct filename + date + reason
   - [ ] Reject flow (no reason): Reject without picking a reason → entry has empty `reason_code` but still records filename + date
   - [ ] approve-and-send (HE-only): Hebrew client with 1 rejected upload → email shows amber callout above missing docs with title + filename + date + reason
   - [ ] approve-and-send (bilingual): English client → both HE and EN cards show the callout
   - [ ] approve-and-send (empty): Client with 0 rejected uploads → no callout, no extra spacing
   - [ ] Type B reminder: Reminder for client in `Collecting_Docs` with rejected uploads → email contains the callout (both HE-only and bilingual paths)
   - [ ] Client portal: Open view-documents.html as client with rejected uploads → callout appears above doc list, language toggle works
   - [ ] Doc manager view: Open document-manager → "ארכיון מסמכים לא רלוונטיים" appears under הודעות הלקוח, lists entries with filename/date/reason
   - [ ] Doc manager delete: Click trash icon → custom confirm dialog (NOT native) → entry removed from UI + Airtable PATCH succeeds + persists on reload
   - [ ] Stage transition clear: Move report Collecting_Docs → Review via admin-change-stage → field is cleared in Airtable
   - [ ] Stage transition no-clear: Move from Send_Questionnaire → Waiting_For_Answers → field unchanged
   - [ ] Idempotency: Reject same classification twice → no duplicate entry (dedup by cls_id)
   - [ ] Regression DL-081: Doc records still go to `Required_Missing` after reject (not Requires_Fix)
   - [ ] Hebrew encoding: No garbled characters in any rendered output
   Design log: `.agent/design-logs/documents/244-rejected-uploads-visibility.md`

1. **Test DL-232: Email & Print Filing Type Audit** — verify all emails show correct filing type for CS clients
   - [ ] CS approve-and-send (has docs) → subject "דרישת מסמכים — הצהרת הון YYYY", body "הצהרת ההון"
   - [ ] AR approve-and-send (has docs) → unchanged regression check
   - [ ] CS Type A reminder → header "שאלון הצהרת הון", body "הצהרת ההון"
   - [ ] CS Type B reminder (HE) → body "הצהרת ההון"
   - [ ] CS Type B reminder (EN bilingual) → HE card "הצהרת ההון", EN "capital statement"
   - [ ] WhatsApp link in any email → generic "שלום, אני צריך/ה עזרה"
   - [ ] Print CS questionnaire → meta "שנת מס YYYY | הצהרת הון"
   - [ ] Print AR questionnaire → meta "שנת מס YYYY | דוח שנתי"
   Design log: `.agent/design-logs/email/232-email-print-filing-type-complete-audit.md`

2. **Test DL-228: Smart Add Second Filing Type** — verify auto-detect, pre-fill, row menu, doc manager
   - [ ] Email blur: Type email of existing AR client → banner appears with name/stage/CC
   - [ ] Email blur: Type email of client with BOTH types → no banner
   - [ ] Email blur: Type new email → no banner
   - [ ] Banner "Fill" button: Name, CC email, filing type all populated, fields get yellow tint
   - [ ] Banner "Close" button: Banner dismissed, form unchanged
   - [ ] Form submit after pre-fill: Report created, toast with "שלח שאלון"
   - [ ] Desktop "..." menu: "הוסף הצהרת הון" shows for AR-only clients, hidden for dual-type
   - [ ] Mobile card "..." menu: Same button
   - [ ] Right-click context menu: Same button
   - [ ] Menu button click: Creates report, success toast
   - [ ] Doc manager: Single-type client shows "הוסף [type]" button near tabs
   - [ ] Doc manager: Click → confirm → report created → page reloads with both tabs
   - [ ] Tab linking: Click client name from CS tab → doc manager opens with CS tab active
   - [ ] No regression: Adding brand new client still works
   Design log: `.agent/design-logs/admin-ui/228-smart-add-second-filing-type.md`

2. **Test DL-225: CS Hardcoded AR Remediation** — verify CS clients see correct text
   - [ ] View-documents page with CS report: title/h1 show "הצהרת הון" not "Annual Report"
   - [ ] Landing page with CS report: header shows "שאלון" (generic), form ID resolves correctly
   - [ ] WF06 Type A reminder for CS client: body says "הצהרת ההון" not "הדוח השנתי"
   - [ ] WF06 Type B reminder for CS client: HE body says "הצהרת ההון", WhatsApp URL dynamic
   - [ ] WF07 digest: CS clients show הצ"ה badge, footer says "מערכת דוחות"
   - [ ] Admin print footer: "מערכת ניהול דוחות" (not "דוחות שנתיים")
   - [ ] Privacy policy: mentions "הצהרות הון" alongside "דוחות שנתיים"
   - [ ] Dashboard API: `?filing_type=annual_report` returns only AR clients
   - [ ] Rollover: CS rollover not blocked by existing AR record in target year
   Design log: `.agent/design-logs/capital-statements/225-cs-hardcoded-ar-remediation.md`

3. **Test DL-226: Dual-Filing Classification + OneDrive Folders** — verify dual-match and folder structure
   - [ ] Send securities PDF for client with both AR+CS → two classification records (T601 + CS-T018)
   - [ ] Verify PDF in both `דוחות שנתיים/זוהו/` and `הצהרות הון/זוהו/`
   - [ ] Single-filing client: only one record, correct folder
   - [ ] Unidentified doc: goes to primary report's `ממתינים לזיהוי`
   - [ ] Approve/reject actions independent per report
   - [ ] Admin manual upload uses filing-type subfolder
   Design log: `.agent/design-logs/infrastructure/226-dual-filing-classification-onedrive.md`

4. **Test DL-231: Keep-Both Missing Document Keys** — verify new keep_both docs have identity fields
   - [ ] Approve keep_both: new "חלק N" doc has `document_key`, `document_uid`, `issuer_key`
   - [ ] Reassign keep_both: new "חלק N" doc has all three identity fields
   - [ ] Verify uid format: `{original_key}_partN`
   Design log: `.agent/design-logs/ai-review/231-keep-both-missing-document-keys.md`

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

**Test DL-222: Email AR/CS Dual-Filing** — regression tests for email subject/body changes
- [ ] CS approve-and-send (0 docs) → subject has "הצהרת הון" (not "דו״ח שנתי")
- [ ] AR approve-and-send (0 docs) → subject still has "דו״ח שנתי" (regression)
- [ ] CS approve-and-send (0 docs) → body says "הצהרת ההון" not "הדו״ח השנתי"
- [ ] EN CS client (0 docs) → body says "capital statement" not "annual report"
- [ ] CS approve-and-send (with docs) → subject is generic "דרישת מסמכים" (unchanged)
- [ ] AR approve-and-send (with docs) → subject unchanged (regression)
- [ ] WF[02] CS questionnaire → office subject "שאלון הצהרת הון התקבל"
- [ ] WF[02] AR questionnaire → office subject "שאלון שנתי התקבל" (regression)
Design log: `.agent/design-logs/email/222-email-ar-cs-audit.md`

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
