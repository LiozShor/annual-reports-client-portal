# Design Log 358: Remove `שלום {clientName}` Greeting from Comment Email
**Status:** [COMPLETED]
**Date:** 2026-04-27
**Related Logs:** [DL-289](../admin-ui/289-recent-messages-checkmark-thread.md) (live preview SSOT), [DL-199](../admin-ui/199-client-communication-notes.md) (comment send flow), [DL-076](076-wf03-client-email-card-layout.md) (Hebrew email layout)

## 1. Context & Problem
The comment email (`buildCommentEmailHtml` in `api/src/lib/email-html.ts:679`) opened with `שלום ${clientName},` followed by the bookkeeper's typed comment. User wants the greeting dropped — the comment should land directly under the blue header bar, more like a chat reply than a formal letter.

## 2. User Requirements (Phase A)
1. **Q:** How to remove the greeting? **A:** Drop the row entirely — body opens with comment text.
2. **Q:** Apply to other email templates (questionnaire, batch-status)? **A:** No — comment email only.
3. **Q:** Keep the closing `בברכה, צוות משרד רו"ח Client Name`? **A:** Keep it.
4. **Q:** Backfill DL-289 testing checklist? **A:** Yes, edit inline.

## 3. Research
Skipped — single-line edit to an established email template. Cumulative knowledge from DL-076 (Hebrew RTL bilingual card pattern) and DL-289 (live-preview SSOT contract) covers the relevant constraints; no new research needed.

## 4. Codebase Analysis
- **Single source of truth:** `buildCommentEmailHtml` is reused by both the send path (`api/src/routes/dashboard.ts:309`) AND the live preview endpoint (`POST /admin-comment-preview`, `dashboard.ts:442`). One edit propagates everywhere — no JS-side preview to keep in sync (DL-289 design).
- **Other `שלום ${clientName}` hits in `email-html.ts`:** lines 470, 493, 647, 761 — questionnaire reminders, batch-status, generic. All intentionally untouched (Phase A scope decision).
- **`clientName` parameter:** kept in the `CommentEmailParams` interface (callers still pass it) but removed from the function-body destructuring with a `// DL-358` marker so future devs see the intent.

## 5. Technical Constraints & Risks
- None significant. The `<tr>` row removal preserves the surrounding table structure.
- **Risk:** the live preview UI (DL-289) caches `buildCommentEmailHtml` output; first preview call after deploy might briefly show the old greeting if the user has an open admin tab and a cached response. Mitigation: `POST /admin-comment-preview` already runs server-side per-keystroke debounce (no caching layer), so a hard-refresh isn't required.

## 6. Proposed Solution
### Logic Flow
- Delete the greeting `<tr>` from `buildCommentEmailHtml`.
- Drop `clientName` from the destructured params (no longer used) but leave the interface field intact for caller compatibility.
- Update DL-289 Section 7 testing checklist to reflect new layout.

### Files Changed
| File | Action | Description |
|---|---|---|
| `api/src/lib/email-html.ts` | Modify | Remove greeting row + drop unused `clientName` from destructure (DL-358 marker comments). |
| `.agent/design-logs/admin-ui/289-recent-messages-checkmark-thread.md` | Modify | Test bullet line 111: drop "שלום {name}" mention, note "greeting row removed in DL-358". |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-358 row. |
| `.agent/current-status.md` | Modify | Add Test DL-358 entry. |

## 7. Validation Plan
* [x] TS build passes: `./node_modules/.bin/tsc --noEmit` (no new errors beyond pre-existing 3).
* [x] `wrangler deploy` (version `ba1e99f0-4633-4a4b-95df-3829bc09e195`).
* [x] Live preview: Recent Messages → expand reply modal → type "test" → preview shows logo, blue header bar, "test" as body, contact block, signature. NO greeting line above the comment body.
* [x] Send a real test comment to a test client → received email matches preview layout.
* [x] Other Hebrew emails (questionnaire reminder, batch status) STILL contain `שלום {name},` — regression check.
* [x] No broken layout: comment text correctly padded under blue header (no awkward whitespace where greeting used to be).

## 8. Implementation Notes (Post-Code)
- **Edit location:** `api/src/lib/email-html.ts:702` — single `<tr>` row deleted (greeting + closing tags), the rest of the body table preserved.
- **`clientName` retained in interface:** callers in `dashboard.ts` still pass it; dropping from interface would force two unrelated edit sites for a presentational change. Idiomatic TS unused-param suppression via destructure-omission + `DL-358` comment marker.
- **DL-289 backfill:** `289-recent-messages-checkmark-thread.md:111` updated to reflect the new live-preview structure.
- **No JS preview to sync:** DL-289's contract is "build preview server-side using the same `buildCommentEmailHtml`" — a single backend edit covers both surfaces.
