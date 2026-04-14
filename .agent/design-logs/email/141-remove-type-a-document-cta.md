# Design Log 141: Remove "Send Documents" CTA from Type A Reminder
**Status:** [DONE]
**Date:** 2026-03-10
**Related Logs:** DL-073 (Type A single CTA), DL-127 (CTA+Help merge), DL-062 (unified tones)

## 1. Context & Problem
Type A reminders are sent to stage 2 clients who haven't filled the questionnaire yet. The email currently contains a `ctaBlock` with:
1. **"לשליחת המסמכים כבר עכשיו 😊"** CTA text + `reports@moshe-atsits.co.il` email link
2. **"צריכים עזרה? פנו אלינו"** help section with phone/WhatsApp

The "send documents" CTA is irrelevant for Type A — these clients haven't even filled the questionnaire yet, so they don't have a document list. This CTA belongs in Type B (stage 3, collecting docs), not Type A.

## 2. User Requirements
1. **Q:** What should happen to the contact/help block?
   **A:** Keep help section only — remove the CTA text + email, keep "צריכים עזרה?" with phone/WhatsApp.
2. **Q:** Should this apply to Type B as well?
   **A:** Type A only. Type B keeps the "send documents" CTA since it's relevant there.

## 3. Research

### Domain
Email CTA Design, Transactional Email Patterns

### Sources Consulted
1. **Tarvent — Single CTA vs. Multiple CTAs** — Emails with single focused CTA see up to 371% more clicks. Multiple competing CTAs cause analysis paralysis.
2. **Nielsen Norman Group — "Get Started" Stops Users** — "A link is a promise." Irrelevant CTAs break trust and reduce engagement. CTA must match email purpose exactly.
3. **Moosend — Transactional Email Best Practices** — Transactional emails must answer ONE question: "What happened and what do I do next?" Help/contact should be visually secondary.
4. **DL-073 (prior research)** — Established single CTA pattern for Type A. Campaign Monitor data: 371% more clicks with single CTA.
5. **DL-127 (prior research)** — Merged `sendDocsBox()` + `contactBlock()` into unified `ctaBlock()`. Established visual hierarchy: CTA 20px bold, help 13px muted.

### Key Principles Extracted
- **One email = one purpose = one CTA.** Type A's purpose is "fill questionnaire" — the button CTA already handles this. The "send documents" secondary CTA is off-topic.
- **Irrelevant CTAs are a trust breach** (NNGroup) — suggesting document submission when the client hasn't even started the questionnaire creates confusion.
- **Help/contact should be supportive, not competing** — small text links below the primary action.

### Patterns to Use
- **Help-only contact block:** Blue container with just the help section (phone, WhatsApp, email). No CTA text, no document submission prompt.

### Anti-Patterns to Avoid
- **"Send documents" in a questionnaire email** — misleading, off-topic, splits attention from the real action (fill questionnaire).

### Research Verdict
Remove the "לשליחת המסמכים כבר עכשיו" CTA + email from the `ctaBlock` in Type A only. Keep the help/contact section in its blue container. The dashed separator between CTA and help becomes unnecessary — remove it too.

## 4. Codebase Analysis
* **Existing Solutions Found:** `ctaBlock(dir, lang)` function defined inside "Build Type A Email" node (WF[06] `FjisCdmWc4ef0qSV`, node `build_type_a_email`). Separate instance exists in Type B and Document Service — those are NOT affected.
* **Reuse Decision:** Modify the existing `ctaBlock` function in-place. No new code needed.
* **Relevant Files:** Only the "Build Type A Email" Code node in WF[06].
* **Existing Patterns:** `ctaBlock` renders a blue box (#eff6ff) with CTA + help. After this change, it becomes a help-only block.
* **Dependencies:** None — Type B and Document Service have their own `ctaBlock` instances.

## 5. Technical Constraints & Risks
* **Security:** None — no auth/PII changes.
* **Risks:** Minimal — purely visual change in one email template.
* **Breaking Changes:** None — help section structure unchanged.

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. In `ctaBlock` function inside "Build Type A Email" node:
   - Remove `ctaText` variable and its `<p>` tag
   - Remove `emailAddr` variable and its `<a>` tag
   - Remove dashed separator `<div style="border-top:1px dashed #bfdbfe;...">` wrapper
   - Keep help section table directly inside the blue container

### Before (ctaBlock renders):
```
┌─────────────────────────────────┐
│ לשליחת המסמכים כבר עכשיו 😊    │  ← REMOVE
│ reports@moshe-atsits.co.il      │  ← REMOVE
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  ← REMOVE
│ ► צריכים עזרה? פנו אלינו       │  ← KEEP
│ ☎ 03-6390820 | 077-9928421     │  ← KEEP
│ ✉ natan@... 🟢 WhatsApp        │  ← KEEP
└─────────────────────────────────┘
```

### After:
```
┌─────────────────────────────────┐
│ ► צריכים עזרה? פנו אלינו       │
│ ☎ 03-6390820 | 077-9928421     │
│ ✉ natan@... 🟢 WhatsApp        │
└─────────────────────────────────┘
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| WF[06] node `build_type_a_email` | Modify | Remove CTA text+email from `ctaBlock`, keep help section |

### Final Step (Always)
* **Housekeeping:** Update design log status, copy unchecked tests to `current-status.md`

## 7. Validation Plan
* [ ] Type A reminder email renders with help-only block (no "לשליחת המסמכים")
* [ ] Type B reminder email still shows full ctaBlock with document CTA
* [ ] Help section phone/WhatsApp/email links work correctly
* [ ] Email renders properly in RTL layout

## 8. Implementation Notes (Post-Code)
* Updated `Build Type A Email` node in WF[06] via `n8n_update_partial_workflow`
* Added comment: `// DL-141: Removed "Send Documents" CTA — irrelevant for stage-2 clients`
* Removed 3 elements from `ctaBlock`: `ctaText` variable + `<p>`, `emailAddr` variable + `<a>`, dashed separator `<div>`
* Help section table now sits directly inside the blue container (no wrapper div)
* Workflow validation passed with no errors
* Type B `Build Type B Email` node was NOT modified — retains full CTA+help block
