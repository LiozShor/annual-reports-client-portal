# Design Log 338: AI Review Client Messages — Hover-Reveal Reply + 2-Line Clamp
**Status:** [COMPLETED 2026-04-23]
**Date:** 2026-04-23
**Related Logs:** DL-199 (client communication notes), DL-261 (recent messages panel), DL-263 (delete + raw text), DL-266 (reply infrastructure), DL-337 (raw text instead of summary)

## 1. Context & Problem
The "הודעות הלקוח" timeline inside the AI Review accordion showed client email notes as tight single-line rows — text hard-truncated at one line (`white-space: nowrap; max-width: 350px`), no actions. The dashboard "הודעות אחרונות מלקוחות" panel had the right pattern: 2-line clamp that expands on hover, and a hover-revealed reply button. DL-338 brings the AI Review timeline up to parity.

## 2. User Requirements
1. **Q:** Which action buttons?
   **A:** Reply / comment only.
2. **Q:** Hover/expand behavior?
   **A:** 2-line clamp, hover unclamped — identical to dashboard.
3. **Q:** Layout style?
   **A:** Keep compact inline; add action icons on hover (not full card).
4. **Q:** Scope?
   **A:** All `.ai-cn-entry` surfaces = only `renderEntry` inside `buildClientAccordionHtml`.

## 3. Research
### Domain
Admin UI — compact action-on-hover patterns (progressive disclosure in dense lists).

### Sources Consulted
1. **DL-199** — established the ai-cn-entry timeline structure and CSS rules.
2. **DL-261/263** — established `.msg-row:hover` gray-50 + `.msg-action-btn` opacity-reveal pattern. DL-338 clones that exact pattern into `.ai-cn-entry`.
3. **DL-266** — reply infrastructure: `showReplyInput(noteId, reportId)`, `sendReply`, `showPostReplyPrompt`. All reused without modification except a 1-line selector patch.

### Research Verdict
Pure reuse of existing infrastructure. No new patterns introduced. `showReplyInput` already handles the full reply lifecycle (textarea, send, cancel, post-reply prompt) — needed only a 1-line DOM selector broadening to support `.ai-cn-entry` as a container.

## 4. Codebase Analysis
### Existing Solutions Found
- `showReplyInput(noteId, reportId)` at `script.js:1155` — queries `.msg-row[data-note-id]`, appends reply zone, handles send/cancel.
- `-webkit-line-clamp: 2` + hover pattern in `.msg-summary` / `style.css` — copied exactly.
- `opacity: 0 → 1` on hover for `.msg-action-btn` — copied into `.ai-cn-action-btn`.

### Reuse Decision
All reused. The only new code: 6 lines of new CSS (`.ai-cn-action-btn` + hover), updated `.ai-cn-entry`/`.ai-cn-summary` rules, and ~8 lines added to `renderEntry`.

### Relevant Files
- `frontend/admin/js/script.js:1155` — `showReplyInput` (1-line patch)
- `frontend/admin/js/script.js:4023` — `renderEntry` (updated)
- `frontend/admin/css/style.css:2207` — `.ai-cn-entry` block (updated)

### Dependencies
- `clientItems[0].report_id` and `.year` — accessed in `buildClientAccordionHtml` scope for data attributes.
- `clientName` — first parameter of `buildClientAccordionHtml`, used as `data-client-name`.

## 5. Technical Constraints & Risks
- **`showReplyInput` DOM coupling:** It queried only `.msg-row` — patched to also match `.ai-cn-entry`. `sendReply` and `showPostReplyPrompt` take DOM refs directly, not selectors — no change needed.
- **`markMessageHandled` from AI Review context:** POST to backend succeeds; DOM fade targets `.msg-row` which won't exist here → silently skips animation → `renderMessages()` still refreshes dashboard. Acceptable.
- **Breaking changes:** None. `showReplyInput` patch is additive (OR fallback). CSS changes are scoped to `.ai-cn-*` selectors.
- **Legacy notes without `n.id`:** Handled — `nId` is `''` → no reply button, data attrs empty.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Hovering an entry in the AI Review client messages timeline reveals a reply button; clicking it opens an inline textarea; submitting sends the reply and shows a toast — identical to the dashboard panel.

### Logic Flow
1. `showReplyInput` patched to also match `.ai-cn-entry[data-note-id]` (line 1156).
2. `renderEntry` extracts `cnReportId` + `cnYear` from `clientItems[0]` before entry render; adds data attrs + reply button to each `.ai-cn-entry` div.
3. CSS: `.ai-cn-entry` gets `flex-wrap: wrap` + hover bg; `.ai-cn-summary` gets 2-line clamp + hover unclamp; `.ai-cn-action-btn` appears on hover; `.ai-cn-entry .msg-reply-zone` spans full width.

### Files Changed
| File | Action | Description |
|---|---|---|
| `frontend/admin/js/script.js` | Modify | Line 1156 selector patch + `renderEntry` update |
| `frontend/admin/css/style.css` | Modify | `.ai-cn-entry` block overhaul + new `.ai-cn-action-btn` |
| `frontend/admin/index.html` | Modify | `script.js?v=306→307`, `style.css?v=296→297` |

## 7. Validation Plan
- [ ] AI Review tab: expand a client with recent email notes → reply button invisible by default.
- [ ] Hover over a note entry → reply icon appears smoothly, hover bg activates.
- [ ] Text > 2 lines is clamped to 2 lines by default; hover unclamps to full text.
- [ ] Click reply icon → inline textarea appears below the entry (same as dashboard).
- [ ] Type text + click "שלח תגובה" → toast "תגובה נשלחה ✓", textarea closes, post-reply prompt appears.
- [ ] Notes without `n.id` (legacy) → no reply button, no JS error.
- [ ] Dashboard "הודעות אחרונות מלקוחות" panel unaffected.
- [ ] Doc-manager communication notes tab unaffected.
- [ ] Hard reload → `?v=307` / `?v=297` served.
- [ ] Mobile layout (< 768px) — accordion functional, flex-wrap doesn't break layout.

## 8. Implementation Notes
- Reused `showReplyInput` verbatim except the 1-line OR-selector patch.
- The icon template bug `` `icon-sm ${iconClass}` `` in the original `renderEntry` was preserved as-is (out of scope).
- Removed the now-superseded `.ai-cn-open .ai-cn-summary` rule (replaced by the hover/expanded rule).
- **Bug 1 fixed:** Reply button passed `this.closest('.ai-cn-entry')` as 3rd arg to `showReplyInput` — avoids null-lookup on `.msg-row`.
- **Bug 2 fixed:** `cnReportId` used `report_record_id` (not `report_id`) — classifications endpoint field name.
- **Bug 3 fixed:** Skipped `showPostReplyPrompt` for `.ai-cn-entry` context; calls `loadRecentMessages()` instead.
- **Bug 4 fixed:** `expandReplyCompose` send handler OR-selector + no early return when row is null in AI Review context.
- **Reply display added:** Built `replyMap` from `office_reply` notes (keyed by `reply_to`); nested `cn-office-reply` card below each message entry. CSS override `width: 100%; margin-right: var(--sp-6)` pushes card to its own line.
- Final cache: `script.js?v=312`, `style.css?v=298`.
