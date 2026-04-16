# Design Log 062: Rephrase Reminder Email Tones
**Status:** [IMPLEMENTED]
**Date:** 2026-02-26
**Related Logs:** 059-automated-follow-up-reminder-system.md, 061-configurable-reminder-limits.md

## 1. Context & Problem
After design log 061 changed the default reminder limit from 3 to unlimited, the escalating email tones are misleading:
- R3 says "תזכורת אחרונה" (last reminder) — but there IS no last reminder now
- R3 says "נדרשת פעולה מיידית" (immediate action required) — aggressive, threatening
- R3 flips greeting to `name שלום,` as urgency signal — feels odd
- Three different wordings for the same request adds maintenance burden
- Inconsistent firm name: Type A "עציץ" vs Type B "אציץ"

## 2. User Requirements
1. **Q:** What tone should reminders have?
   **A:** Warm & personal — not aggressive or threatening.

2. **Q:** Should tone escalate across R1/R2/R3?
   **A:** Same tone always. No text-based escalation.

3. **Q:** Should subject line include reminder number?
   **A:** Yes — include which reminder number this is.

4. **Q:** Should color escalation (blue→amber→red) be removed too?
   **A:** No — keep color escalation as visual-only signal.

## 3. Research
### Domain
Email reminder UX, transactional email copywriting, professional service communication.

### Sources Consulted
1. **"Email Marketing Rules" — Chad S. White** — Helpful framing > demanding framing. Emails offering assistance ("we're here to help you complete...") outperform threatening ones ("you must act immediately").
2. **NNGroup — "Writing for Professionals"** — Professional tone = clear, concise, respectful. Avoid urgency theater. State facts, offer help, provide clear next step.
3. **Litmus — "Transactional Email Best Practices"** — Subject clarity matters most. Include what's needed + context. Short body (2-3 sentences max). One CTA.
4. **Stripe/Linear communication style** — Always warm, never threatening. "We noticed X hasn't been completed" not "You failed to complete X".

### Key Principles Extracted
- **Helpfulness > urgency** — offer assistance, don't threaten consequences
- **Same voice, always** — consistent tone builds trust; escalation should be visual, not verbal
- **Subject = what + context** — reminder number tells client "this isn't the first time" without saying "FINAL WARNING"
- **Brevity converts** — 2-3 sentences max. One ask. One button.

### Patterns to Use
- **Uniform body copy** — one warm text for all reminder levels, no branching
- **Numbered subjects** — `תזכורת מס׳ N:` prefix communicates frequency without aggression
- **Color-only escalation** — blue → amber → red in Type B header (visual signal, no matching text change)

### Anti-Patterns to Avoid
- **"תזכורת אחרונה"** — false when unlimited, threatening when true
- **"נדרשת פעולה מיידית"** — urgency theater that damages relationship
- **Greeting order flip** — `name שלום,` as urgency trick is manipulative
- **Multiple body variants** — maintenance burden for no real benefit when tone is uniform

### Research Verdict
Single warm/personal copy for all reminder levels. Reminder number in subject. Color escalation stays visual-only. Remove all threatening language. Fix firm name typo.

## 4. Codebase Analysis
* **Relevant Files:**
  - n8n WF[06] `FjisCdmWc4ef0qSV` — "Build Type A Email" node (questionnaire reminders), "Build Type B Email" node (missing docs reminders), "Filter Eligible" node (tone assignment)
* **Existing Patterns:**
  - Both Build Email nodes have 3-branch `if/else if/else` blocks for tone-specific subjects + body text
  - Tone assigned in Filter Eligible: count=0→friendly, count=1→firm, count≥2→urgent
  - Type A: blue header all tones; Type B: color varies by tone (blue/amber/red)
  - `reminder_count` already available on each item passed to Build Email nodes
* **Alignment with Research:** Current code over-engineers text escalation. Research says uniform text + visual color is better.
* **Dependencies:** Only WF[06] Code nodes. No Airtable changes. No frontend changes.

## 5. Technical Constraints & Risks
* **Security:** No new auth surfaces. Same HMAC-protected workflow.
* **Risks:** Low — email copy change only. No structural/routing changes.
* **Breaking Changes:** None. Same email structure, same HTML template, just different text.
* **Firm name fix:** Type A footer has "עציץ" (ayin) — should be "אציץ" (alef) per CLAUDE.md.

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. Keep `tone` assignment in Filter Eligible (drives Type B color)
2. Replace 3-branch subject/body in Build Type A Email with single universal block
3. Replace 3-branch subject/body in Build Type B Email with single universal block (keep tone-based color switch)
4. Compute `reminderNum = (reminder_count || 0) + 1` in each Build Email node
5. Fix firm name to "אציץ" in both nodes

### New Email Copy

#### Type A — Questionnaire Reminder (all tones)
**Subject:** `תזכורת מס׳ ${reminderNum}: מילוי השאלון השנתי לשנת ${year}`
**Greeting:** `שלום ${name},`
**Body:**
```
השאלון השנתי לשנת המס ${year} ממתין למילוי.
נשמח אם תמלא/י אותו בהקדם כדי שנוכל להתחיל בהכנת הדוח.
```
**CTA:** `מלא/י שאלון` (unchanged)
**Header:** Blue `#2563eb` (unchanged — no color escalation for Type A)
**Footer:** `משרד רו״ח משה אציץ` (fix typo)

#### Type B — Missing Docs Reminder (all tones)
**Subject:** `תזכורת מס׳ ${reminderNum}: מסמכים חסרים לשנת ${year}`
**Greeting:** `שלום ${name},`
**Body:**
```
ישנם מסמכים שטרם התקבלו עבור הדוח השנתי לשנת ${year}.
נשמח לקבל אותם בהקדם כדי שנוכל להמשיך בהכנת הדוח.
```
**Progress:** `התקבלו X מתוך Y מסמכים | חסרים: Z` (unchanged)
**Instructions:** `נא לשלוח מסמכים אל: reports@moshe-atsits.co.il` (unchanged)
**Header colors:** R1 blue `#2563eb`/`#eff6ff`, R2 amber `#d97706`/`#fffbeb`, R3 red `#dc2626`/`#fef2f2` (unchanged)
**Footer:** `משרד רו״ח משה אציץ` (consistent)

### Code Changes Summary

**Build Type A Email** — Replace tone-branching with:
```js
const reminderNum = (item.reminder_count || 0) + 1;
const subject = `תזכורת מס׳ ${reminderNum}: מילוי השאלון השנתי לשנת ${year}`;
// Single body text, no tone branching
const greeting = `שלום ${name},`;
const bodyText = `השאלון השנתי לשנת המס ${year} ממתין למילוי.\nנשמח אם תמלא/י אותו בהקדם כדי שנוכל להתחיל בהכנת הדוח.`;
```

**Build Type B Email** — Replace tone-branching for text, keep color switch:
```js
const reminderNum = (item.reminder_count || 0) + 1;
const subject = `תזכורת מס׳ ${reminderNum}: מסמכים חסרים לשנת ${year}`;
const greeting = `שלום ${name},`;
const bodyText = `ישנם מסמכים שטרם התקבלו עבור הדוח השנתי לשנת ${year}.<br>נשמח לקבל אותם בהקדם כדי שנוכל להמשיך בהכנת הדוח.`;

// Color escalation stays
let headerColor, headerBg;
if (tone === 'friendly') { headerColor = '#2563eb'; headerBg = '#eff6ff'; }
else if (tone === 'firm') { headerColor = '#d97706'; headerBg = '#fffbeb'; }
else { headerColor = '#dc2626'; headerBg = '#fef2f2'; }
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n WF[06] `FjisCdmWc4ef0qSV` "Build Type A Email" | Modify | Replace 3-branch copy with single warm text + reminder number |
| n8n WF[06] `FjisCdmWc4ef0qSV` "Build Type B Email" | Modify | Replace 3-branch copy with single warm text + reminder number, keep color switch |

## 7. Validation Plan
* [ ] Trigger Send Now for a client with count=0 — subject shows "תזכורת מס׳ 1:", warm body text, blue header
* [ ] Trigger Send Now for a client with count=1 — subject shows "תזכורת מס׳ 2:", same warm body text, amber header (Type B)
* [ ] Trigger Send Now for a client with count≥2 — subject shows "תזכורת מס׳ 3+:", same warm body text, red header (Type B)
* [ ] Type A emails have blue header regardless of count
* [ ] No "תזכורת אחרונה" or "נדרשת פעולה מיידית" anywhere
* [ ] Footer says "אציץ" in both Type A and Type B
* [ ] Greeting is always "שלום name," (never flipped)

## 8. Implementation Notes (Post-Code)

**Implemented:** 2026-02-26

### Changes Applied
1. **Build Type A Email** — Replaced 3-branch `if/else if/else` tone logic with single universal block:
   - Subject: `תזכורת מס׳ ${reminderNum}: מילוי השאלון השנתי לשנת ${year}`
   - Greeting: always `שלום ${name},` (no R3 flip)
   - Body: single warm text for all tones
   - Header: always blue `#2563eb` (unchanged)
   - Footer: fixed `עציץ` → `אציץ`

2. **Build Type B Email** — Same text unification, color escalation preserved:
   - Subject: `תזכורת מס׳ ${reminderNum}: מסמכים חסרים לשנת ${year}`
   - Greeting: always `שלום ${name},`
   - Body: single warm text for all tones
   - Color switch kept: friendly=blue, firm=amber, urgent=red (visual-only)
   - Footer: `אציץ` (was already correct)

### Validation
- All "errors" from `n8n_validate_workflow` are pre-existing false positives (template literal `${}` flagged as expression mismatch, Code node primitive return warning)
- Spot-check confirmed:
  - No `תזכורת אחרונה`, `נדרשת פעולה מיידית`, or `תזכורת שנייה` in either node
  - `reminderNum` and `תזכורת מס׳` present in both
  - Greeting consistent (`שלום ${name},`)
  - Footer typo fixed in Type A
  - All 6 color values preserved in Type B with tone-based branching

### Rollback
- WF[06] version history available via n8n UI if rollback needed
