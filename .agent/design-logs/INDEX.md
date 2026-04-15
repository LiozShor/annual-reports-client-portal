# Design Log Index

Active and pending logs. For completed history, see [ARCHIVE-INDEX.md](ARCHIVE-INDEX.md).

**Total logs:** 184 | **Active:** 86 | **Archived:** 98

## Folder Structure

- `admin-ui/` — Admin UI (29)
- `ai-review/` — AI Review & Classification (31)
- `capital-statements/` — Capital Statements (4)
- `client-portal/` — Client Portal & Questionnaires (13)
- `documents/` — Documents & OneDrive (20)
- `email/` — Email System (19)
- `infrastructure/` — Infrastructure & Workflows (18)
- `reminders/` — Reminder System (17)
- `research/` — Research & Feasibility (7)
- `security/` — Security & Auth (7)

## Active Logs

| # | File | Status | Summary |
|---|------|--------|---------|
| 277 | [277-fix-reminder-progress-bar-and-429-retry.md](email/277-fix-reminder-progress-bar-and-429-retry.md) | IMPLEMENTED — NEED TESTING | Fix reminder progress bar math (waived excluded) + 429 retry with backoff + re-classify endpoint |
| 276 | [276-smooth-admin-auth-flow.md](admin-ui/276-smooth-admin-auth-flow.md) | IMPLEMENTED — NEED TESTING | Smooth admin auth: splash screen + parallel prefetch eliminates login screen flash |
| 275 | [275-fix-zero-docs-stage-stuck.md](infrastructure/275-fix-zero-docs-stage-stuck.md) | COMPLETED | Fix 0-doc questionnaires stuck at Waiting_For_Answers — restructure WF02 merge node + backfill 6 reports |
| 274 | [274-dashboard-messages-search.md](admin-ui/274-dashboard-messages-search.md) | COMPLETED | Dashboard messages: search bar across all years with fetch-once client-side filtering |
| 273 | [273-outlook-deferred-send.md](email/273-outlook-deferred-send.md) | IMPLEMENTED — NEED TESTING | Replace KV+cron email queue with MS Graph PidTagDeferredSendTime deferred delivery |
| 271 | [271-reminder-06am-and-pending-filter-bug.md](reminders/271-reminder-06am-and-pending-filter-bug.md) | IMPLEMENTED — NEED TESTING | Fix reminder 06 AM timing (cron→08:00), pending classification filter bypass, monthly reset credential |
| 272 | [272-dashboard-messages-load-more.md](admin-ui/272-dashboard-messages-load-more.md) | COMPLETED | Dashboard messages: "load more" client-side pagination + same-day sort fix |
| 270 | [270-editable-contract-period-dates.md](ai-review/270-editable-contract-period-dates.md) | COMPLETED | Editable contract period dates on AI review card for T901/T902 (DL-269 refinement) |
| 266 | [266-reply-to-client-messages.md](admin-ui/266-reply-to-client-messages.md) | IMPLEMENTED — NEED TESTING | Reply to client messages from dashboard panel — branded email + off-hours queue |
| 269 | [269-partial-rental-contract-detection.md](ai-review/269-partial-rental-contract-detection.md) | COMPLETED | AI detects partial rental contracts (T901/T902), banner on review card to request missing period |
| 268 | [268-ai-review-pagination.md](ai-review/268-ai-review-pagination.md) | IMPLEMENTED — NEED TESTING | AI review: paginate by client groups (25/page) + FIFO sort (oldest-waiting first) |
| 267 | [267-auto-advance-zero-docs-to-review.md](admin-ui/267-auto-advance-zero-docs-to-review.md) | IMPLEMENTED — NEED TESTING | Auto-advance to Review when docs_missing_count reaches 0 (Pending_Approval or Collecting_Docs) |
| 265 | [265-entity-tab-switch-loading.md](admin-ui/265-entity-tab-switch-loading.md) | IMPLEMENTED — NEED TESTING | Entity tab switch: inline spinner + opacity fade for all data tabs including dashboard |
| 264 | [264-off-hours-email-queue.md](email/264-off-hours-email-queue.md) | IMPLEMENTED — NEED TESTING | Off-hours (8PM-8AM) approve-and-send emails queued for 8AM morning delivery |
| 263 | [263-dashboard-messages-delete-and-raw-text.md](admin-ui/263-dashboard-messages-delete-and-raw-text.md) | IMPLEMENTED — NEED TESTING | Dashboard messages: delete/hide option + raw text instead of AI summary |
| 260 | [260-archive-extraction-inbound-email.md](documents/260-archive-extraction-inbound-email.md) | IMPLEMENTED — NEEDS TESTING | Auto-extract ZIP/RAR/7z archives in inbound email pipeline |
| 259 | [259-inbound-notes-all-stages.md](infrastructure/259-inbound-notes-all-stages.md) | IMPLEMENTED — NEED TESTING | Capture client notes & raw attachments at all stages, not just Collecting_Docs/Review |
| 258 | [258-client-messages-low-stages.md](admin-ui/258-client-messages-low-stages.md) | DONE | Show notes & client messages on low-stage (≤1) doc manager by extracting secondary zone from #content |
| 257 | [257-reminder-select-all-bug-and-cap.md](reminders/257-reminder-select-all-bug-and-cap.md) | IMPLEMENTED — NEED TESTING | Fix reminder select-all double-counting (table+mobile duplicate checkboxes) + add MAX_BULK_SEND=50 cap |
| 256 | [256-table-pagination.md](admin-ui/256-table-pagination.md) | IMPLEMENTED — NEED TESTING | Table pagination: 50 rows/page across all tabs, shared renderPagination utility, scoped safeCreateIcons |
| 255 | [255-table-rendering-performance.md](admin-ui/255-table-rendering-performance.md) | SUPERSEDED by DL-256 | Table rendering: hide/show filtering, 150ms debounce, CSS content-visibility |
| 254 | [254-dashboard-load-performance.md](admin-ui/254-dashboard-load-performance.md) | IMPLEMENTED — NEED TESTING | Dashboard load: fix double-load, stagger prefetches, KV cache years+docs, parallel batches |
| 253 | [253-rejected-uploads-group-by-reason.md](email/253-rejected-uploads-group-by-reason.md) | COMPLETED | Group rejected uploads by reason in email callout (DL-244 refinement) |
| 251 | [251-view-documents-filing-type-badge.md](client-portal/251-view-documents-filing-type-badge.md) | COMPLETED | View Documents — filing type badge in header for dual AR+CS clients |
| 250 | [250-entity-tab-switch-dashboard-reload.md](admin-ui/250-entity-tab-switch-dashboard-reload.md) | COMPLETED | Fix: entity tab switch (AR/CS) — dashboard reload, import opacity fade, filing type badge |
| 252 | [252-frontend-orchestrated-split.md](ai-review/252-frontend-orchestrated-split.md) | IMPLEMENTED — NEED TESTING | Frontend-orchestrated split with live progress UI, per-segment classification, OneDrive rename |
| 249 | [249-safe-split-rollback.md](ai-review/249-safe-split-rollback.md) | SUPERSEDED by DL-252 | Safe split: status transition + rollback on failure instead of delete-before-process |
| 248 | [248-reassign-clears-unrelated-approval.md](ai-review/248-reassign-clears-unrelated-approval.md) | IMPLEMENTED — NEED TESTING | Fix: reassign blind-clear undoes unrelated approval on same source doc |
| 247 | [247-tab-switching-performance.md](admin-ui/247-tab-switching-performance.md) | IMPLEMENTED — NEED TESTING | Tab switching SWR: remove full-screen overlay from tab navigation, prefetch AI review, deduplicatedFetch, staleness-based refresh |
| 246 | [246-split-modal-page-preview-zoom.md](admin-ui/246-split-modal-page-preview-zoom.md) | COMPLETED | PDF split modal page preview lightbox with zoom/pan, keyboard nav, hover magnify icon |
| 245 | [245-agentic-classification-workflows.md](ai-review/245-agentic-classification-workflows.md) | DRAFT — RESEARCH PROPOSAL | Multi-agent workflows for WF05: PDF Splitter (Haiku), Critic (Sonnet evaluator-optimizer), Financial Extractor — gated by cheap pre-checks, runs in ctx.waitUntil() |
| 244 | [244-rejected-uploads-visibility.md](documents/244-rejected-uploads-visibility.md) | IMPLEMENTED — NEED TESTING | Rejected uploads visibility — log on report record, callout in approve-and-send + Type B reminder + portal + admin doc-manager (delete only). Reject flow logs filename+date+reason; auto-clears past Collecting_Docs |
| 243 | [243-cs-help-text-content.md](capital-statements/243-cs-help-text-content.md) | IMPLEMENTED — NEED TESTING | CS view-documents `?` help text — 16/22 templates populated (help_he + help_en), KV cache purged |
| 242 | [242-questionnaires-tab-print-notes-questions.md](admin-ui/242-questionnaires-tab-print-notes-questions.md) | COMPLETED | Fix questionnaires-tab print: client questions + office notes missing (API now returns notes per item) |
| 241 | [241-cs-template-short-names.md](capital-statements/241-cs-template-short-names.md) | IMPLEMENTED — NEED TESTING | CS template short_name_he — add issuer placeholders so reassign combobox shows per-issuer names |
| 240 | [240-remove-onedrive-subfolders.md](documents/240-remove-onedrive-subfolders.md) | IMPLEMENTED — NEED TESTING | Remove זוהו/ממתינים subfolders — all docs go to filing type root |
| 239 | [239-cross-filing-type-reassign.md](ai-review/239-cross-filing-type-reassign.md) | IMPLEMENTED — NEED TESTING | Cross-filing-type reassign — toggle between AR/CS doc lists in reassign modal |
| 235 | [235-onedrive-folder-routing-restructure.md](documents/235-onedrive-folder-routing-restructure.md) | IMPLEMENTED — NEED TESTING | OneDrive folder restructure: singular names, ארכיון at year level |
| 234 | [234-skip-own-outbound-emails.md](infrastructure/234-skip-own-outbound-emails.md) | IMPLEMENTED — NEED TESTING | Skip emails from reports@ in inbound pipeline to prevent self-loop client notes |
| 233 | [233-cs-template-fixes.md](capital-statements/233-cs-template-fixes.md) | IMPLEMENTED — NEED TESTING | CS doc fixes: strip ** from year, compute year_plus_1, questionnaire for CS type |
| 238 | [238-unified-ai-review-both-filing-types.md](ai-review/238-unified-ai-review-both-filing-types.md) | IMPLEMENTED — NEED TESTING | Unified AI Review tab — show both AR & CS classifications with filing type badges |
| 237 | [237-pdf-split-reclassify.md](ai-review/237-pdf-split-reclassify.md) | IMPLEMENTED — NEED TESTING | PDF split & re-classify from AI review — split multi-page PDFs, reclassify each segment |
| 236 | [236-bulk-send-cap-50.md](admin-ui/236-bulk-send-cap-50.md) | IMPLEMENTED — NEED TESTING | Cap bulk questionnaire sending to 50 per batch |
| 232 | [232-email-print-filing-type-complete-audit.md](email/232-email-print-filing-type-complete-audit.md) | IMPLEMENTED — NEED TESTING | Complete email + print filing type audit: fix reminders, doc request, print, WhatsApp |
| 231 | [231-keep-both-missing-document-keys.md](ai-review/231-keep-both-missing-document-keys.md) | IMPLEMENTED — NEED TESTING | Fix keep_both missing document_key, document_uid, issuer_key |
| 230 | [230-duplicate-classification-missing-file-info.md](infrastructure/230-duplicate-classification-missing-file-info.md) | IMPLEMENTED — NEED TESTING | Fix duplicate classifications missing file_url and onedrive_item_id |
| 229 | [229-ecc-library-analysis.md](infrastructure/229-ecc-library-analysis.md) | COMPLETED | ECC library analysis — hooks, skills, agents, contexts patterns for our setup |
| 228 | [228-smart-add-second-filing-type.md](admin-ui/228-smart-add-second-filing-type.md) | IMPLEMENTED — NEED TESTING | Smart add second filing type: email blur pre-fill, row menu shortcut, doc manager button, tab linking |
| 227 | [227-inline-waive-receive-doc-tags.md](ai-review/227-inline-waive-receive-doc-tags.md) | IMPLEMENTED — NEED TESTING | Inline waive/receive on AI Review doc tags — click to toggle, hover for receive |
| 226 | [226-dual-filing-classification-onedrive.md](infrastructure/226-dual-filing-classification-onedrive.md) | IMPLEMENTED — NEED TESTING | Dual-filing classification + OneDrive folder architecture (דוחות שנתיים/הצהרות הון) |
| 225 | [225-cs-hardcoded-ar-remediation.md](capital-statements/225-cs-hardcoded-ar-remediation.md) | COMPLETED | CS hardcoded AR remediation — dynamic filing type labels across n8n, frontend, API |
| 222c | [222-multi-pdf-approve-conflict.md](ai-review/222-multi-pdf-approve-conflict.md) | IMPLEMENTED — NEED TESTING | Multi-PDF approve conflict: merge / keep both / override |
| 222b | [222-fix-document-manager-report-id-links.md](admin-ui/222-fix-document-manager-report-id-links.md) | IMPLEMENTED — NEED TESTING | Fix document-manager links: report_id → client_id |
| 223 | [223-backfill-filing-type-empty-records.md](infrastructure/223-backfill-filing-type-empty-records.md) | COMPLETED | Backfill empty filing_type on 33 legacy report records |
| 216 | [216-filing-type-scoping-all-tabs.md](admin-ui/216-filing-type-scoping-all-tabs.md) | COMPLETED | Filing type scoping across all admin tabs + mobile navbar entity toggle |
| 214 | [214-mobile-table-card-layout.md](admin-ui/214-mobile-table-card-layout.md) | COMPLETED | Mobile table → card layout for all 5 admin tables + collapsible filter bar |
| 212 | [212-mobile-bottom-nav-ai-review.md](admin-ui/212-mobile-bottom-nav-ai-review.md) | COMPLETED | Mobile bottom nav bar + AI review full-screen preview modal |
| 211 | [context-audit.md](infrastructure/context-audit.md) | AUDIT COMPLETE | Context efficiency audit — files to delete/update, CLAUDE.md cleanup, token budget analysis |
| 210 | [210-classification-review-test-bugfixes.md](ai-review/210-classification-review-test-bugfixes.md) | COMPLETE | Fix 4 classification review bugs + "סיום בדיקה" dismiss UI |
| 207 | [207-wf05-worker-full-gap-audit.md](infrastructure/207-wf05-worker-full-gap-audit.md) | AUDIT COMPLETE | **DEFINITIVE** — Full WF05 Worker gap audit: 17 gaps, 29 verified ✅, 6 improvements |
| 206 | [206-wf05-worker-classification-parity.md](infrastructure/206-wf05-worker-classification-parity.md) | SUPERSEDED by DL-207 | WF05 Worker classification prompt parity (partial audit) |
| 205 | [205-clear-file-fields-on-status-revert.md](documents/205-clear-file-fields-on-status-revert.md) | COMPLETED | Clear file fields when doc status reverts to Missing |
| 204 | [204-digest-claude-ai-summarization.md](email/204-digest-claude-ai-summarization.md) | COMPLETED | Daily digest — Claude AI inbox summarization + weekend skip |
| 203 | [203-wf05-worker-migration.md](infrastructure/203-wf05-worker-migration.md) | COMPLETED | WF05 inbound email processing — migrated from 56-node n8n to Worker endpoint |
| 202 | [202-daily-digest-incoming-emails-section.md](email/202-daily-digest-incoming-emails-section.md) | COMPLETED | Daily digest communication feed — MS Graph inbox query, sender + body preview |
| 201 | [201-fix-review-classification-422-email-validation.md](ai-review/201-fix-review-classification-422-email-validation.md) | COMPLETED | Fix review-classification 422 — sanitize email/null fields before Airtable PATCH |
| 199 | [199-client-communication-notes.md](admin-ui/199-client-communication-notes.md) | COMPLETED | Client communication notes — AI review tab, document manager timeline, WF05 auto-append |
| 197 | [197-fix-t501-short-name-audit-templates.md](ai-review/197-fix-t501-short-name-audit-templates.md) | COMPLETED | Fix T501 short name missing deposit type + audit 6 templates with literal bold pollution |
| 196 | [196-fix-empty-binary-upload-field-mismatch.md](ai-review/196-fix-empty-binary-upload-field-mismatch.md) | COMPLETED | Fix 0-byte uploads — field name mismatch in Process and Prepare Upload |
| 195 | [195-fix-tool-use-response-parsing.md](ai-review/195-fix-tool-use-response-parsing.md) | COMPLETED | Fix tool_use response parsing in WF05 classifier — all docs failing since DL-131 |
| 194 | [194-remove-batch-status-feature.md](ai-review/194-remove-batch-status-feature.md) | COMPLETED | Remove batch status feature — UI, API endpoint, n8n workflow |
| 192 | [192-fix-duplicate-life-insurance-documents.md](documents/192-fix-duplicate-life-insurance-documents.md) | Done | Fix duplicate T501 life insurance docs when multiple Tally questions produce same deposit |
| 191 | [191-remove-delete-start-over-button.md](client-portal/191-remove-delete-start-over-button.md) | Done | Remove "Delete & Start Over" button from client portal landing page |
| 190 | [190-questionnaire-toggle-hide-no-answers.md](client-portal/190-questionnaire-toggle-hide-no-answers.md) | COMPLETED | Toggle to hide "No" answers in questionnaire on-screen view |
| 189 | [189-add-phone-to-office-email-header.md](email/189-add-phone-to-office-email-header.md) | COMPLETED | Add phone number to office email summary box |
| 188 | [188-stop-email-move-show-body.md](ai-review/188-stop-email-move-show-body.md) | COMPLETED | Stop email folder move + show email body in AI review |
| 186 | [186-add-logo-all-emails.md](email/186-add-logo-all-emails.md) | COMPLETED | Add Moshe Atsits logo to all 7 email types |
| 45 | [045-document-manager-status-overview-file-actions.md](documents/045-document-manager-status-overview-file-actions.md) | Draft | Document Manager — Status Overview Panel + File View/Download |
| 48 | [048-onedrive-rename-dedup-improvements.md](documents/048-onedrive-rename-dedup-improvements.md) | Draft | OneDrive 3-Folder System, Rename at Upload, Duplicate Detection, Archive Moves |
| 50 | [050-inline-confirmation-ai-review-cards.md](ai-review/050-inline-confirmation-ai-review-cards.md) | Draft | Inline Confirmation on AI Review Cards |
| 51 | [051-onedrive-persistent-file-links.md](documents/051-onedrive-persistent-file-links.md) | Unapproved | OneDrive Persistent File Links via Item ID Resolution |
| 66 | [066-reminder-counter-reset-on-stage-transition.md](reminders/066-reminder-counter-reset-on-stage-transition.md) | Draft | Reminder Counter Reset on Stage Transition |
| 67 | [067-initialize-reminder-next-date-on-stage-entry.md](reminders/067-initialize-reminder-next-date-on-stage-entry.md) | Draft | Initialize `reminder_next_date` on Stage Entry |
| 68 | [068-document-list-visual-hierarchy.md](documents/068-document-list-visual-hierarchy.md) | Draft | Document List Visual Hierarchy Refactor |
| 78 | [078-reminder-tab-clickable-cards-and-fixes.md](reminders/078-reminder-tab-clickable-cards-and-fixes.md) | Draft | Reminder Tab — Clickable Stat Cards + Mute/Max Fixes |
| 82 | [082-clickable-ui-audit.md](admin-ui/082-clickable-ui-audit.md) | Draft | Clickable UI Audit — Admin Panel |
| 87 | [087-responsive-floating-elements.md](admin-ui/087-responsive-floating-elements.md) | In Progress | Responsive Floating Elements — Viewport-Aware Popovers & Dropdowns |
| 91 | [091-deactivate-client-soft-delete.md](admin-ui/091-deactivate-client-soft-delete.md) | Draft | Deactivate Client (Soft Delete) |
| 95 | [095-bulk-send-questionnaires-fix.md](admin-ui/095-bulk-send-questionnaires-fix.md) | Draft | Fix Bulk Send Questionnaires (Only First Client Processed) |
| 96 | [096-view-documents-stage-aware-empty-state.md](admin-ui/096-view-documents-stage-aware-empty-state.md) | Draft | View Documents — Stage-Aware Empty State |
| 97 | [097-floating-bulk-action-bars.md](admin-ui/097-floating-bulk-action-bars.md) | Draft | Floating Bulk Action Bars |
| 101 | [101-reminder-tab-ux-polish.md](reminders/101-reminder-tab-ux-polish.md) | Draft | Reminder Tab UI/UX Polish Pass |
| 102 | [102-stage-redesign-and-missing-column-fix.md](admin-ui/102-stage-redesign-and-missing-column-fix.md) | Draft | Stage Redesign & Missing Column Fix |
| 102 | [102-table-scroll-containers-and-archive-filter-gaps.md](admin-ui/102-table-scroll-containers-and-archive-filter-gaps.md) | Draft | Scrollable Table Containers + Archive Filter Gaps |
| 103 | [103-phase1-quick-fixes-natan-meeting.md](admin-ui/103-phase1-quick-fixes-natan-meeting.md) | Draft | Phase 1 Quick Fixes — Natan Meeting Action Items |
| 106 | [106-client-detail-modal-phone-field.md](admin-ui/106-client-detail-modal-phone-field.md) | Draft | Client Detail Modal + Phone Field |
| 106 | [106-email-content-wording-overhaul.md](email/106-email-content-wording-overhaul.md) | Draft | Email Content & Wording Overhaul (Natan Meeting Group 3) |
| 107 | [107-doc-manager-email-phone-inline-edit.md](admin-ui/107-doc-manager-email-phone-inline-edit.md) | Draft | Document Manager Email + Phone Inline Edit |
| 199 | [199-wf05-code-node-http-blocked.md](ai-review/199-wf05-code-node-http-blocked.md) | BLOCKED — NEEDS RESEARCH | WF05 Code node HTTP calls ($helpers.httpRequest + fetch) silently fail on n8n Cloud |
| 112 | [112-webhook-dedup-and-issuer-display.md](ai-review/112-webhook-dedup-and-issuer-display.md) | Draft | Webhook Duplicate Prevention + Issuer Name Display |
| 113 | [113-doc-manager-save-stay-on-page.md](documents/113-doc-manager-save-stay-on-page.md) | Done | Document Manager — Stay on Page After Save |
| 115 | [115-pdf-conversion-before-onedrive-upload.md](documents/115-pdf-conversion-before-onedrive-upload.md) | Done | PDF Conversion Before OneDrive Upload |
| 117 | [117-help-icons-view-documents.md](client-portal/117-help-icons-view-documents.md) | Done | Help Icons on view-documents |
| 120 | [120-questionnaires-tab-improvements.md](client-portal/120-questionnaires-tab-improvements.md) | Done | Questionnaires Tab — UX Improvements |
| 121 | [121-questionnaire-email-ordering-floating-bar.md](client-portal/121-questionnaire-email-ordering-floating-bar.md) | Done | Questionnaire Email Ordering + Floating Bar + Client Questions |
| 122 | [122-qa-display-patterns-research.md](research/122-qa-display-patterns-research.md) | Research | Q&A Display Patterns Research — Admin Panel + Print |
| 125 | [125-questionnaires-actions-column-fix.md](admin-ui/125-questionnaires-actions-column-fix.md) | Draft | Questionnaires Tab — Actions Column Background & Sticky Fix |
| 126 | [126-annual-report-notes.md](admin-ui/126-annual-report-notes.md) | Draft | Annual Report Notes |
| 127 | [127-email-cta-help-merge-questions-reposition.md](email/127-email-cta-help-merge-questions-reposition.md) | Done | Email CTA+Help Merge & Questions Repositioning |
| 129 | [129-dynamic-short-names-ai-review.md](ai-review/129-dynamic-short-names-ai-review.md) | Done | Dynamic Short Names for AI Review Cards |
| 130 | [130-dashboard-reminder-warnings.md](reminders/130-dashboard-reminder-warnings.md) | Draft | Dashboard Reminder Warnings + Sent Count History Click |
| 131 | [131-fix-nii-classification-enum-enforcement.md](ai-review/131-fix-nii-classification-enum-enforcement.md) | Done | Fix NII Classification & Enum Enforcement |
| 132 | [132-god-component-refactoring-risk-analysis.md](admin-ui/132-god-component-refactoring-risk-analysis.md) | Draft | God Component Refactoring — Risk Analysis |
| 134 | [134-fix-classification-field-ordering-full-enum.md](ai-review/134-fix-classification-field-ordering-full-enum.md) | Done | Fix Classification Field Ordering & Full Enum |
| 135 | [135-combobox-short-names.md](ai-review/135-combobox-short-names.md) | Draft | Short Names in Document Combobox |
| 137 | [137-fix-onedrive-rename-extension-and-title.md](documents/137-fix-onedrive-rename-extension-and-title.md) | Done | Fix OneDrive Rename — Extension Reverts to Original + Wrong Title on Reassign |
| 140 | [140-fix-approval-token-exposure.md](security/140-fix-approval-token-exposure.md) | Done | Fix Approval Token Secret Exposure (C-1) |
| 143 | [143-classification-test-bugfixes.md](ai-review/143-classification-test-bugfixes.md) | Done | Classification Test Bugfixes — OneDrive Collision, NII Issuer, Large PDF Threshold |
| 147 | [147-amendment-13-phase1-quick-wins.md](security/147-amendment-13-phase1-quick-wins.md) | Done | Amendment 13 Compliance — Phase 1 Quick Wins |
| 200 | [200-document-manager-ux-improvements.md](admin-ui/200-document-manager-ux-improvements.md) | COMPLETED | Document Manager UX — 9 improvements across 3 phases |
| 150 | [150-collapsible-card-redesign.md](admin-ui/150-collapsible-card-redesign.md) | DEPRECATED | Collapsible Card Section Redesign — superseded by DL-200 |
| 152 | [152-move-view-as-client-to-row-menu.md](admin-ui/152-move-view-as-client-to-row-menu.md) | Draft | Move "צפייה כלקוח" from Inline Icon to Row Menu |
| 154 | [154-fix-reminder-idempotency-calendar-date.md](reminders/154-fix-reminder-idempotency-calendar-date.md) | Draft | Fix Reminder Idempotency — Calendar Date Check |
| 155 | [155-twice-monthly-reminders.md](reminders/155-twice-monthly-reminders.md) | Done | Twice-Monthly Reminders (1st & 15th) |
| 156 | [156-print-questionnaire-skip-no-answers.md](client-portal/156-print-questionnaire-skip-no-answers.md) | Draft | Print Questionnaire — Skip "No" Answers |
| 157 | [157-insurance-company-links-in-help-text.md](client-portal/157-insurance-company-links-in-help-text.md) | Done | Insurance Company Links in Help Text |
| 157 | [157-phone-number-tally-questionnaire.md](client-portal/157-phone-number-tally-questionnaire.md) | Done | Move Phone Number Collection to Tally Questionnaire |
| 158 | [158-zero-docs-approve-and-send.md](documents/158-zero-docs-approve-and-send.md) | Draft | Fix Approve-and-Send for Zero Documents |
| 162 | [162-spouse-checkbox-add-documents.md](documents/162-spouse-checkbox-add-documents.md) | Draft | Spouse Checkbox for Document Addition |
| 166 | [166-admin-portal-filing-type-tabs.md](admin-ui/166-admin-portal-filing-type-tabs.md) | Design Only | Admin Portal Filing Type Tabs (AR / CS) |
| 172 | [172-cloudflare-workers-ms-graph-phase4a.md](infrastructure/172-cloudflare-workers-ms-graph-phase4a.md) | Done | Cloudflare Workers — MS Graph Endpoints Phase 4a |
| 173 | [173-cloudflare-workers-ms-graph-phase4b.md](infrastructure/173-cloudflare-workers-ms-graph-phase4b.md) | Done | Cloudflare Workers — MS Graph Phase 4b (Classifications) |
| 175 | [175-phase6-cleanup-optimization.md](infrastructure/175-phase6-cleanup-optimization.md) | Done | Phase 6 — Cleanup & Optimization |
| 177 | [177-migrate-last-2-endpoints-workers.md](infrastructure/177-migrate-last-2-endpoints-workers.md) | Done | Migrate Last 2 n8n Endpoints to Workers |
| 180 | [180-phase6-monitoring-alerting.md](infrastructure/180-phase6-monitoring-alerting.md) | Done | Phase 6 — Monitoring & Alerting |
| 182 | [182-capital-statements-tally-questionnaire.md](capital-statements/182-capital-statements-tally-questionnaire.md) | In Progress | Capital Statements Tally Questionnaire |
| 183 | [183-cc-spouse-email-questionnaire.md](email/183-cc-spouse-email-questionnaire.md) | Done | CC Spouse Email on Questionnaire Send |
| 185 | [185-daily-natan-digest-email.md](email/185-daily-natan-digest-email.md) | Done | Daily Natan Digest Email |
| 187 | [187-stage3-attention-bounce.md](admin-ui/187-stage3-attention-bounce.md) | Done | Stage 3 Attention Bounce Animation |

---
*Last reorganized: 2026-03-25 — 157 logs across 10 domain folders*