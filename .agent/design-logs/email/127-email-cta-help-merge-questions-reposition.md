# Design Log 127: Email CTA+Help Merge & Questions Repositioning
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-09
**Related Logs:** DL-083 (sendDocsBox), DL-106 (email overhaul, DRAFT), DL-110 (client questions)

## 1. Context & Problem

Three layout problems in client-facing emails:

1. **CTA + Help box are separate competing sections** — The "send docs" CTA (light blue box, `sendDocsBox()`) and "need help?" contact block (`contactBlock()`) appear as two distinct visual elements. They compete for attention and create visual noise.

2. **Client questions appear below the footer** — WF[03]'s "Inject Questions" node uses fragile regex to splice the amber questions card into pre-built HTML. The regex often fails to find the right insertion point, causing questions to land after the footer — completely disconnected from the email body. Users likely won't scroll that far.

3. **Inconsistency across emails** — Each workflow builds emails differently. The CTA/help/questions layout varies.

## 2. User Requirements

1. **Q:** Which email shows this layout?
   **A:** WF[03] client email. Fix ALL client-facing emails.

2. **Q:** How should the merged CTA+Help look?
   **A:** Single box — email CTA prominent on top, help contacts smaller below it.

3. **Q:** Where should client questions go?
   **A:** After document list, BEFORE the CTA. Flow: Docs → Questions → CTA+Help → Footer.

4. **Q:** Separate log or extend DL-106?
   **A:** New DL-127, focused scope. DL-106 covers wording/tone (separate effort).

## 3. Research

### Domain
Email CTA design, information hierarchy in transactional emails, combined action+contact blocks.

Prior research: DL-106 (email copywriting, warm tone), DL-083 (sendDocsBox design), DL-084 (email uniformity).

### Sources Consulted (Incremental)
1. **Campaign Monitor — CTA Optimization** — Emails with single clear CTA get 371% more clicks. Secondary actions must be visually subordinate (gray text links, not buttons).
2. **Tabular.email — Transactional Email Design** — CTA should be "isolated and deliberate" with generous vertical padding. F-pattern scanning means top content gets most attention.
3. **PLANDIGI — Contact & CTA Sections** — Combined CTA+contact in single visual unit: CTA button on top with own breathing room, subtle divider, then muted contact links below.
4. **Litmus — Email CTA Best Practices** — Primary: bold, brand color, min 44x44px. Secondary: text links, muted gray, 12-14pt (vs 16pt+ for CTA).

### Key Principles
- **Single visual unit** — CTA + help in one box prevents visual competition
- **Size hierarchy** — Primary CTA at 20px bold, help contacts at 14px muted
- **Questions before CTA** — User's reasoning: questions provide context for what to respond, CTA below becomes "here's how to send it all"
- **Placeholder > regex** — Reliable marker-based injection instead of fragile HTML parsing

### Patterns to Use
- **Marker-based injection:** Document Service outputs `<!-- CLIENT_QUESTIONS -->` placeholder; downstream nodes do simple `string.replace()`
- **Combined CTA block:** Single function with visual hierarchy (prominent email → subtle divider → muted contacts)

### Anti-Patterns to Avoid
- **Regex HTML splicing** — Current approach is fragile; any HTML structure change breaks it
- **Multiple competing visual blocks** — CTA and help as separate boxes confuse the eye
- **Content below footer** — Anything after the footer is invisible to most users

### Research Verdict
Merge CTA+help into one function. Use placeholder for questions injection. Apply uniformly across all client emails.

## 4. Codebase Analysis

### Existing Solutions Found
- `sendDocsBox(dir, lang)` — Line 170 of `generate-html` node. Light blue box with email CTA.
- `contactBlock(dir)` — Line 186 of `generate-html` node. Gray box with phone/WhatsApp/Natan email.
- Both are already well-structured table-based email HTML.

### Current Email Layout (HE-only client email, lines 557-568)
```
Greeting → Intro → heDocs → sendDocsBox('rtl') → contactBlock('rtl') → divider → footer
```

### Current Email Layout (Bilingual, lines 507-551)
```
EN card: greeting → intro → enDocs → sendDocsBox('ltr') → contactBlock('ltr')
HE card: greeting → intro → heDocs → sendDocsBox('rtl') [NO contactBlock]
Footer
```

### Questions Injection (WF[03] "Inject Questions" node)
- Reads `client_questions` from Airtable record
- Builds amber HTML card
- Tries 3 regex strategies to splice into pre-built HTML — all fragile
- Often lands after footer or at wrong position

### Reuse Decision
- **Reuse:** `contactBlock()` HTML structure (already good), amber questions card styling
- **Replace:** `sendDocsBox()` + `contactBlock()` → new merged `ctaBlock()`
- **Replace:** Regex injection → placeholder approach

### Workflows Affected
| Workflow | Node | Has CTA? | Has Help? | Has Questions? |
|----------|------|----------|-----------|----------------|
| Doc Service | `generate-html` | sendDocsBox() | contactBlock() | No (injected by WF[03]) |
| WF[03] | `Inject Questions` | N/A | N/A | Yes (fragile regex) |
| WF[06] | `build_type_a_email` | sendDocsBox() | Likely | No |
| WF[06] | `build_type_b_email` | sendDocsBox() | Likely | No |
| Batch Status | `code-build-email` | sendDocsBox() | Likely | No |

## 5. Technical Constraints & Risks

* **generate-html is ~593 lines** — careful editing, test after changes
* **WF[06] and Batch Status have their own copies of sendDocsBox** — need to update each independently
* **Bilingual layout quirk:** EN card currently has contactBlock, HE card doesn't — merge fixes this
* **Questions only in WF[03]** — other emails don't have questions; placeholder is ignored if no injection happens
* **No schema changes** — pure HTML layout restructuring

## 6. Proposed Solution (The Blueprint)

### A. New `ctaBlock(dir, lang)` function (replaces sendDocsBox + contactBlock)

```
┌─────────────────────────────────────────┐
│  Light blue bg (#eff6ff)                │
│                                         │
│  לשליחת המסמכים כבר עכשיו 😊            │  ← 16px bold #1e40af
│  reports@moshe-atsits.co.il             │  ← 20px bold #2563eb (mailto link)
│                                         │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │  ← subtle 1px #bfdbfe divider
│                                         │
│  ► צריכים עזרה? פנו אלינו              │  ← 13px bold #6b7280
│  ☎ 03-6390820 | 077-9928421            │  ← 13px #6b7280
│  ✉ natan@moshe-atsits.co.il  WhatsApp  │  ← 13px #6b7280
└─────────────────────────────────────────┘
```

Design choices:
- **Single light blue container** — CTA section gets the existing #eff6ff bg, border #bfdbfe
- **Internal divider** — subtle 1px dashed border in #bfdbfe separates CTA from help
- **Help section font** — smaller (13px vs 16/20px), muted color (#6b7280) → clearly secondary
- **Same function works for HE and EN** via `dir` and `lang` params

### B. Questions placeholder in Document Service

Add `<!-- CLIENT_QUESTIONS -->` marker in the email layout:
```
docs → <!-- CLIENT_QUESTIONS --> → ctaBlock → footer
```

For HE-only emails:
```javascript
heContentRows = greeting + intro + heDocs +
  '<!-- CLIENT_QUESTIONS -->' +  // ← new placeholder
  ctaBlock('rtl', 'he') +       // ← merged function
  dividerRow() + footer;
```

For bilingual emails:
```javascript
// EN card: enDocs + <!-- CLIENT_QUESTIONS --> + ctaBlock('ltr','en')
// HE card: heDocs + <!-- CLIENT_QUESTIONS --> + ctaBlock('rtl','he')
```

### C. Simplified WF[03] "Inject Questions" node

Replace 56 lines of fragile regex with simple string replacement:
```javascript
html = html.replace('<!-- CLIENT_QUESTIONS -->', questionsHtml);
// If bilingual, replace both occurrences
```

If no questions exist, leave placeholder (invisible in HTML).

### D. Apply to other workflows

WF[06] Type A/B and Batch Status:
- Replace their `sendDocsBox()` calls with `ctaBlock()`
- No questions placeholder needed (questions are WF[03]-only)

### Logic Flow
1. Update `generate-html` node: remove `sendDocsBox()` + `contactBlock()`, add `ctaBlock()`
2. Add `<!-- CLIENT_QUESTIONS -->` placeholder in email assembly
3. Update WF[03] "Inject Questions" to use placeholder replacement
4. Update WF[06] Type A email: replace sendDocsBox with ctaBlock
5. Update WF[06] Type B email: replace sendDocsBox with ctaBlock
6. Update Batch Status email: replace sendDocsBox with ctaBlock

### Files to Change
| Location | Node / File | Action | Description |
|----------|-------------|--------|-------------|
| Doc Service `hf7DRQ9fLmQqHv3u` | `generate-html` | Modify | Replace sendDocsBox+contactBlock with ctaBlock, add questions placeholder |
| WF[03] `cNxUgCHLPZrrqLLa` | `Inject Questions` | Modify | Replace regex injection with placeholder replacement |
| WF[06] `FjisCdmWc4ef0qSV` | `build_type_a_email` | Modify | Replace sendDocsBox with ctaBlock |
| WF[06] `FjisCdmWc4ef0qSV` | `build_type_b_email` | Modify | Replace sendDocsBox with ctaBlock |
| Batch Status `QREwCScDZvhF9njF` | `code-build-email` | Modify | Replace sendDocsBox with ctaBlock |
| `docs/email-design-rules.md` | Section 12 | Modify | Add ctaBlock as frozen component |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] WF[03] HE email: questions appear after docs, before CTA
* [ ] WF[03] HE email: CTA+help is single merged box
* [ ] WF[03] HE email: no questions → placeholder invisible, layout clean
* [ ] WF[03] bilingual email: both EN/HE cards have merged ctaBlock
* [ ] WF[03] bilingual email: questions appear in both cards (if applicable)
* [ ] WF[06] Type A reminder: merged ctaBlock, no questions
* [ ] WF[06] Type B reminder: merged ctaBlock, no questions
* [ ] Batch status email: merged ctaBlock
* [ ] All emails: footer still at bottom, not displaced
* [ ] Email renders correctly in Gmail (web), Outlook (desktop)

## 8. Implementation Notes (Post-Code)

### Changes Made (Session 130, 2026-03-09)

**Step 1: Document Service `generate-html` node** (`hf7DRQ9fLmQqHv3u`)
- Deleted `sendDocsBox()` function (was lines 170-181)
- Deleted `contactBlock()` function + `WA_URL_CONTACT`/`WA_ICON` constants (was lines 183-197)
- Added new `ctaBlock(dir, lang)` function — single merged block:
  - Light blue container (#eff6ff bg, #bfdbfe border)
  - Top: CTA text (16px bold #1e40af) + email (20px bold #2563eb mailto)
  - 1px dashed #bfdbfe divider
  - Bottom: help text (13px #6b7280) + phones + Natan email + WhatsApp (all on fewer lines)
- Added `<!-- CLIENT_QUESTIONS -->` placeholder in all 3 email assembly paths:
  - HE-only client email: after heDocs, before ctaBlock
  - Bilingual EN card: after enDocs, before ctaBlock
  - Bilingual HE card: after heDocs, before ctaBlock

**Step 2: WF[03] Inject Questions** (`cNxUgCHLPZrrqLLa`, node `c36a5165-...`)
- Replaced 3 fragile regex strategies with `html.replaceAll('<!-- CLIENT_QUESTIONS -->', questionsHtml)`
- When no questions: removes placeholder with `replaceAll('<!-- CLIENT_QUESTIONS -->', '')`
- Kept amber card styling (#FEF3C7 bg, #F59E0B border, #92400E text)

**Step 3: WF[06] Type A email** (`FjisCdmWc4ef0qSV`, node `build_type_a_email`)
- Replaced `contactBlock()` function with `ctaBlock(dir, lang)` (same merged pattern)
- Updated call: `contactBlock()` → `ctaBlock('rtl', 'he')`

**Step 4: WF[06] Type B email** (`FjisCdmWc4ef0qSV`, node `build_type_b_email`)
- Replaced `sendDocsBox()` + `contactBlock()` functions with `ctaBlock(dir, lang)`
- Updated 3 call sites (EN bilingual, HE bilingual, HE-only)

**Step 5: Batch Status email** (`QREwCScDZvhF9njF`, node `code-build-email`)
- Replaced `sendDocsBox()` + `contactBlock()` functions with `ctaBlock(dir, lang)`
- Batch status variant uses "Send corrected documents here :)" CTA text
- Removed conditional `rejected.length > 0` for sendDocsBox — ctaBlock always shows (help is always relevant)
- Updated EN and HE paths

**Step 6: email-design-rules.md**
- Added `ctaBlock` as frozen component in Section 12 with HTML template
- Added `Client Questions Block` documentation
- Updated Section 7 client email structure diagrams

### Verification Notes
- All 5 n8n node updates confirmed via API response validation
- Each node verified: `ctaBlock: true`, `sendDocsBox: false`, `contactBlock: false`
