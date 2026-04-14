# Design Log 073: Type A Reminder — Single CTA, Mirror WF[01] Layout
**Status:** [IMPLEMENTED]
**Date:** 2026-03-01
**Related Logs:** 064-fix-type-a-questionnaire-link.md, 071-bilingual-doc-list-all-emails.md

## 1. Context & Problem

WF[06] Type A reminder email (questionnaire not filled, stage 2 clients) currently has **two CTA buttons** — one per language section — both linking to the same questionnaire URL. This is redundant and cluttered.

Additionally, the `isEnglishFirst` branch is unnecessary: at stage 2 the client hasn't filled the questionnaire yet, so we don't know their language. The EN-first path should be removed entirely.

The user wants Type A to mirror WF[01] Send Questionnaire's layout: Hebrew-first body, single bilingual CTA, brief English note below a divider.

## 2. User Requirements

1. **Q:** Should Type A follow WF[01]'s exact layout or keep the separator pattern with merged CTAs?
   **A:** Mirror WF[01] layout — HE body → single CTA → bilingual note → brief EN below divider.

2. **Q:** Subject line — Hebrew-only or bilingual for EN clients?
   **A:** Hebrew-only (keep as-is). Consistent with WF[01].

3. **Q:** Keep reminder counter and/or add color escalation?
   **A:** Keep counter in subject (`תזכורת מס"ד X`), no color escalation — body stays blue.

4. **Q:** Flip layout for EN-first clients?
   **A:** No — at stage 2 we don't know the language. Always Hebrew-first. Remove the `isEnglishFirst` branch.

## 3. Research

### Domain
Transactional email CTA design, bilingual reminder emails, email UX.
Prior research: DL-030 (bilingual email structure), DL-071 (bilingual doc lists).

### Sources Consulted
1. **Campaign Monitor — CTA Best Practices** — Single CTA emails get 371% more clicks. Build entire email around one action.
2. **Moosend — Email CTA 2026** — Button copy should be 2-4 action words, surrounded by generous whitespace.
3. **Salesforge — Gentle Reminder Email** — Neutral framing ("awaiting completion") rather than highlighting failure. Acknowledge busy schedule.
4. **SendLayer — Multi-Language Transactional Emails** — When language preference unknown, primary language first, secondary subordinate (smaller, lighter, separated by divider).

### Key Principles Extracted
- **Single CTA = higher engagement**: Removing the duplicate button eliminates decision paralysis and focuses the email on one action.
- **Secondary language subordinate**: Brief EN paragraph below divider, no second CTA — "using the button above" references the single CTA.
- **Bilingual button text**: `📋 מלא/י שאלון / Fill Questionnaire` on one button is acceptable when language is unknown (WF[01] already does this).
- **Reminder tone**: Keep current neutral wording ("ממתין למילוי... נשמח אם תמלא/י בהקדם").

### Anti-Patterns to Avoid
- **Duplicate CTA per section**: Tempting for "completeness" but research shows it hurts CTR.
- **EN-first branch for stage 2**: Language unknown → always Hebrew-first. Don't over-engineer.

### Research Verdict
Mirror WF[01]'s proven layout. Single bilingual CTA, Hebrew-first, brief English note. Remove dead code (EN-first branch).

## 4. Codebase Analysis

### WF[01] Send Questionnaire (YfuRYpWdGGFpGYJG)
- Email HTML inline in HTTP Request node (not Code node)
- Layout: `<div dir="rtl">` wrapper → header → HE body → single CTA → bilingual note → divider → brief EN → sign-off → footer
- CTA: `📋 מלא שאלון / Fill Questionnaire` (blue `#0056b3`)
- Uses older `<div>` layout (not `<table>`) — WF[06] should keep its `<table>` layout per email design rules

### WF[06] "Build Type A Email" (FjisCdmWc4ef0qSV)
- Code node with `ctaButton()` helper (blue `#2563eb`, Outlook-safe `<table>` button)
- Two branches: `isEnglishFirst` (EN body → CTA → separator → HE body → CTA) and default (HE body → CTA → separator → EN body → CTA)
- Output: `{ _report_id, _email, _subject, _html, _count }`
- **Footer typo:** `עצית` should be `עציץ`

### Alignment with Research
WF[01] already follows the single-CTA principle. WF[06] Type A diverges with duplicate CTAs — this log fixes that.

## 5. Technical Constraints & Risks

* **Security:** No new data exposure.
* **Risks:** None — single node change, no downstream consumers affected (output shape unchanged).
* **Breaking Changes:** None. Removing `isEnglishFirst` branch is safe since language is unknown at stage 2.

## 6. Proposed Solution (The Blueprint)

### Rewrite "Build Type A Email" Code node

**Keep unchanged:**
- Data extraction logic (name, email, year, count, clientId, questionnaireUrl)
- `ctaButton()` helper function
- Output shape: `{ _report_id, _email, _subject, _html, _count }`
- Subject: `תזכורת מס"ד ${reminderNum}: מילוי השאלון השנתי לשנת ${year}`

**Remove:**
- `isEnglishFirst` variable and `lang` extraction
- Entire EN-first HTML branch

**New single HTML layout (mirroring WF[01]):**
```
[HEADER: blue #2563eb, dir=rtl, "תזכורת — שאלון שנתי {year}"]

[BODY dir=rtl]
שלום {name},
השאלון השנתי לשנת המס {year} ממתין למילוי.
נשמח אם תמלא/י אותו בהקדם כדי שנוכל להתחיל בהכנת הדוח.

[📋 מלא/י שאלון / Fill Questionnaire]  ← single bilingual CTA

[center] השאלון זמין בעברית ובאנגלית | Questionnaire available in Hebrew and English

──────── English Version ────────

[dir=ltr]
For the preparation of the {year} annual tax report,
please fill out the questionnaire using the button above.

[dir=rtl]
בברכה,
משרד רו"ח Client Name

[FOOTER: Moshe Atsits CPA Firm / משרד רו"ח Client Name | reports@moshe-atsits.co.il]
```

### Files to Change

| File / Node | Action | Description |
|-------------|--------|-------------|
| WF[06] → "Build Type A Email" | Rewrite | Single CTA, remove EN-first branch, fix footer typo |

## 7. Validation Plan

* [ ] Validate WF[06] after deploy (0 new errors)
* [ ] Visual: generated HTML has single CTA button, not two
* [ ] Visual: EN section has NO button, just text referencing "button above"
* [ ] Visual: bilingual note appears below CTA
* [ ] Visual: footer reads `עציץ` not `עצית`
* [ ] Manual test: trigger for a stage-2 client → verify email layout
* [ ] Regression: Type B email unchanged (separate node)

## 8. Implementation Notes (Post-Code)

*To be filled after implementation.*
