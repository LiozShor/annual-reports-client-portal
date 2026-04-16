# Design Log 084: Email Uniformity Audit & Standardization
**Status:** [IMPLEMENTED]
**Date:** 2026-03-03
**Related Logs:** DL-030, DL-071, DL-073, DL-076, DL-083

## 1. Context & Problem

The system sends 8 distinct email types across 5 code files. These grew organically over months, resulting in significant visual inconsistencies. The user noticed WF[03] "דרישת מסמכים" looks less polished than reminders. A full audit reveals the problem is systemic — headers, footers, fonts, and layout patterns differ across every email.

## 2. User Requirements

1. **Q:** Header bars for all Hebrew-only emails?
   **A:** Yes — all emails get a header bar. Type A keeps solid blue; others get light-bg pattern.
2. **Q:** Batch Status EN header bar?
   **A:** Yes — add blue header bar.
3. **Q:** Audit WF[01] and WF[04] too?
   **A:** Yes — audit everything.
4. **Q:** DL-083 (highlight box CTA)?
   **A:** Already live — build on top.
5. **Q:** WF[01] design direction?
   **A:** User loves WF[01] design. Only change font (Arial → Calibri). Leave all else as-is.

## 3. Research

### Domain
Transactional Email Design Systems, Email Template Architecture

### Sources Consulted
1. **Litmus — "6 Steps to a Powerful Email Design System"** — Email design system needs reusable components + documented standards. Without standards layer, components drift within months.
2. **NNGroup — "Transactional Email UX"** — Poor design reduces trust by 2pts/7. Inconsistent emails from same sender = phishing perception risk.
3. **Stripe Email Design System** — Enforces consistency via structural constraints: frozen header + footer across all types. Hard constraints > guidelines.
4. **Blocksedit — Email Template Architecture** — Three-tier hierarchy. Define tokens at component level so brand changes propagate. "Paradox of choice" — multiple similar variants = random selection.

### Key Principles
- **Freeze the wrapper** — one header + footer pattern, highest immediate consistency gain
- **Design tokens** — same constant names (C.brand, BG.outer) across all Code nodes
- **Trust through consistency** — CPA firm clients must trust emails to upload financial docs

### Research Verdict
Standardize header bar + footer + wrapper across all emails (except WF[01] which user likes as-is). Document exact HTML in email-design-rules.md.

## 4. Codebase Analysis

### Full Audit Matrix

| Dimension | WF[01] | WF[02] Office | WF[03] HE | WF[03] EN | Type A | Type B | Batch |
|-----------|--------|---------------|-----------|-----------|--------|--------|-------|
| Layout | `<div>` | `<table>` ✅ | `<table>` ✅ | `<table>` ✅ | `<table>` ✅ | `<table>` ✅ | `<table>` ✅ |
| Font | **Arial** ❌ | Calibri ✅ | Calibri ✅ | Calibri ✅ | Calibri ✅ | Calibri ✅ | Calibri ✅ |
| Header bar | Centered ✅ | **None** ❌ | **None** ❌ | Blue bar ✅ | Solid blue ✅ | Tone bar ✅ | **None** ❌ |
| Footer | Own style ✅ | Airtable only ❌ | No email ❌ | Bilingual ✅ | 12px+bg ❌ | OK ≈ | OK ✅ |
| font-weight | — | bold ✅ | bold ✅ | bold ✅ | 700 ≈ | — | bold ✅ |
| margin use | ✅ (div) | ✅ padding | ✅ padding | ✅ padding | ❌ margin | ❌ margin | ≈ |
| CSS short | ✅ (div) | ✅ long | ✅ long | ✅ long | ≈ | ❌ short | ❌ short |
| Greeting | 16px | — | **16px** ❌ | **16px** ❌ | 15px ✅ | 15px ✅ | 15px ✅ |
| WF[04] font | — | — | — | — | — | — | — |

**WF[04] specific:** Font stack missing Calibri, uses `font-weight:600` instead of `bold`.

### Standard Header Bar Pattern (to replicate)
Light-bg header bar already used by: WF[03] EN, Type B (bilingual + HE). Pattern:
```
<tr><td padding:24px 32px (longhand), bg:#eff6ff, border-bottom:3px solid #2563eb, border-radius:8px 8px 0 0>
  <table><tr><td font-size:22px bold color:#2563eb>{TITLE}</td></tr></table>
</td></tr>
```

### Standard Footer (to replicate)
HE-only: `משרד רו"ח Client Name | reports@moshe-atsits.co.il` (13px, #9ca3af, centered, border-top)
Bilingual: `Moshe Atsits CPA Firm / משרד רו"ח Client Name | reports@moshe-atsits.co.il`
Office: Same footer + Airtable link row above.

## 5. Technical Constraints & Risks

* **n8n Constraint:** Each Code node is independent — must replicate shared patterns.
* **WF[01] exempt** from design system changes (user likes it). Only font fix.
* **Risks:** Touching 6 n8n nodes across 5 workflows. Per-email regression testing needed.
* **Breaking Changes:** None — visual only.

## 6. Proposed Solution (The Blueprint)

### Per-File Changes

#### 1. WF[01] Initial Questionnaire (FONT FIX ONLY)
**Workflow:** YfuRYpWdGGFpGYJG, Node: HTTP Request (0927673d)
- Change `font-family: Arial, sans-serif` → `font-family: Calibri, -apple-system, 'Segoe UI', Arial, sans-serif`
- All other design elements remain as-is

#### 2. generate-html.js — Document Service (hf7DRQ9fLmQqHv3u)

**A) WF[03] HE-only email (lines ~424-439):**
- Add blue header bar: "דרישת מסמכים לשנת {year} - {name}"
- Restructure: replace `wrapEmail(heInner, 'rtl')` with header bar + content + footer wrapper
- Change greeting: 16px → 15px
- Fix footer: add email address

**B) WF[03] EN bilingual (lines ~380-423):**
- Change greeting: 16px → 15px (lines 400, 413)
- Everything else already matches standard

**C) WF[02] Office email (lines ~348-372):**
- Add blue header bar: "שאלון שנתי התקבל - {name} - {year}"
- Replace `wrapEmail(officeInner, 'rtl')` with header + content + footer wrapper
- Add standard footer (firm name + email) above existing Airtable link

**D) Add `wrapWithHeader()` helper** for emails needing header bar

#### 3. WF[04] Build Edit Email (y7n4qaAUiCS4R96W, node 530d5cb5)
- Fix FONT: add `Calibri,` as first in stack
- Fix font-weight: all `600` → `bold`
- Add blue header bar: "עדכון רשימת מסמכים - {name} - {year}"
- Add standard footer (firm name + email, above Airtable link)
- Replace `wrapEmail(inner)` with header + content + footer wrapper

#### 4. build_type_a_email.js (FjisCdmWc4ef0qSV)
- Fix footer: 12px → 13px
- Fix footer: remove bg color (#f9fafb), add border-top pattern
- Fix footer: update "משרד Client Name" → "משרד רו״ח Client Name" (missing רו"ח)
- Fix CTA: replace `margin-top/margin-bottom` → spacer rows with padding
- No header bar change (solid blue stays as-is per user preference)

#### 5. build_type_b_email.js (FjisCdmWc4ef0qSV)
- Fix margin: replace `<p style="margin:...">` → `<table><tr><td style="padding:...">`
- Fix CSS shorthand: `padding:24px 32px` → longhand throughout
- Fix `<h1>` tags → `<table><tr><td>` with inline styles
- HE-only footer: ensure matches standard (firm name + email, 13px)

#### 6. batch-build-email.js (QREwCScDZvhF9njF)

**A) HE-only path (lines ~145-173):**
- Add blue header bar: "עדכון סטטוס מסמכים"
- Restructure content area with separate padding
- Standardize footer

**B) EN bilingual path (lines ~89-144):**
- Add blue header bar: "Document Status Update — {name}"
- Move title from inside card to header bar above cards
- Fix CSS shorthand throughout

#### 7. email-design-rules.md
- Add "Standard Shared Components" section with frozen header/footer HTML
- Update Section 7 email structures to show header bars on all types
- Add explicit header bar variants table

### Implementation Order
1. `email-design-rules.md` — document standard first
2. `generate-html.js` — WF[03] HE + WF[02] (highest user visibility)
3. `batch-build-email.js` — header bars
4. `build_type_b_email.js` — margin/shorthand cleanup
5. `build_type_a_email.js` — footer + firm name fix
6. WF[04] Build Edit Email — font + header bar
7. WF[01] — font fix only (simplest, lowest risk)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `docs/email-design-rules.md` | Modify | Add standard components, update structures |
| n8n `generate-html` (hf7DRQ9fLmQqHv3u) | Modify | Header bars + footer + greeting for WF[02], WF[03] HE |
| n8n `code-build-email` (QREwCScDZvhF9njF) | Modify | Header bars for HE + EN, CSS fix |
| n8n `build_type_b_email` (FjisCdmWc4ef0qSV) | Modify | margin→padding, shorthand, `<h1>`→`<td>` |
| n8n `build_type_a_email` (FjisCdmWc4ef0qSV) | Modify | Footer fix, firm name |
| n8n `Build Edit Email` (y7n4qaAUiCS4R96W:530d5cb5) | Modify | Font, weight, header bar, footer |
| n8n HTTP Request (YfuRYpWdGGFpGYJG:0927673d) | Modify | Font fix only |

## 7. Validation Plan
- [ ] WF[01]: Font changed to Calibri stack, all else identical
- [ ] WF[02]: Header bar visible, footer with firm name + Airtable link
- [ ] WF[03] HE: Header bar, footer with email, greeting 15px
- [ ] WF[03] EN: Greeting 15px
- [ ] WF[04]: Calibri font, bold weight, header bar, footer + Airtable link
- [ ] Type A: Footer 13px no bg, no margin on CTA, firm name has רו"ח
- [ ] Type B: No `<p>` margin, no CSS shorthand, `<h1>` → `<td>`, footer standard
- [ ] Batch HE: Header bar, CSS fixed
- [ ] Batch EN: Header bar above cards, CSS fixed
- [ ] All (except WF[01]): Same Calibri font, same color palette, same footer format
- [ ] Regression: Same subjects, same doc lists, same logic

## 8. Implementation Notes

### Deployed — 2026-03-03

All 7 files updated and deployed:

1. **`docs/email-design-rules.md`** — Added Section 12 "Standard Shared Components (FROZEN)" with exact HTML for header bars (HE + bilingual) and footers (HE + bilingual), plus exceptions table.

2. **Document Service `generate-html`** (hf7DRQ9fLmQqHv3u) — Added `wrapWithHeader()` helper. WF[03] HE: blue header bar + footer with email. WF[03] EN: greeting 16→15px. WF[02] Office: blue header bar + standard footer above Airtable link.

3. **Batch Status `code-build-email`** (QREwCScDZvhF9njF) — HE: added header bar, restructured wrapper, standardized footer. EN: added header bar above cards, moved title from card to header, language tags from `<p>` to `<table><td>`. Fixed CSS shorthand.

4. **Type B `build_type_b_email`** (FjisCdmWc4ef0qSV) — All `<p style="margin:...">` → `<table><tr><td style="padding:...">`. CSS shorthand → longhand. `<h1>` → `<td>`. Footer standardized.

5. **Type A `build_type_a_email`** (FjisCdmWc4ef0qSV) — Footer: 12px→13px, removed bg color, added border-top. CTA: removed margin, added spacer rows. All `<p>` → `<table><td>`. `<h1>` → `<td>`. Firm name already had רו"ח.

6. **WF[04] `Build Edit Email`** (y7n4qaAUiCS4R96W:530d5cb5) — Font: Calibri first. `font-weight:600` → `bold` (all occurrences). Added blue header bar. Added standard footer above Airtable link. Replaced `wrapEmail()` with inline header+content structure.

7. **WF[01] HTTP Request** (YfuRYpWdGGFpGYJG:0927673d) — Font already updated to Calibri stack (was done in a prior session). Verified current state matches target.

### Testing Notes
- All JS syntax validated via `node -c` before deploy
- All n8n deploys confirmed via MCP response (operationsApplied: 1)
- WF[01] verified via direct REST API GET
