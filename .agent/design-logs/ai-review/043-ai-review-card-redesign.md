# Design Log 043: AI Review Card Redesign — Split Confidence & Issuer Comparison
**Status:** [APPROVED]
**Date:** 2026-02-19
**Related Logs:** 036 (AI Classification Review Interface), 039 (Searchable Doc Dropdown), 042 (Card Cleanup — superseded by this log)

## 1. Context & Problem

The AI review card in the admin dashboard conflates two independent dimensions — document **type** match and **issuer** match — into a single combined confidence number (`ai_confidence × issuer_multiplier`). This creates 3 UX failures:

1. **The 28% lie.** A 95% type confidence × 0.3 mismatch multiplier = 28%. The AI correctly identified the document type but the number makes it look incompetent.

2. **AI-extracted issuer is invisible.** The `issuer_name` field (what the AI found in the document) is returned by the API but never displayed on the card. The user can't see what the AI actually detected.

3. **No comparison for mismatches.** The card shows the required doc name + "לא תואם" badge but doesn't show what the AI found vs what's needed. For multi-issuer templates (e.g., client needs Form 106 from Y, Z, and P), the user only sees 1 of N required docs.

**Additional issue:** Card border is green (`isMatched = true`) even when issuer mismatches — contradictory with the red confidence badge.

## 2. User Requirements (The 5 Questions)

1. **Q:** Quick-assign in comparison box — assign immediately on click, or select + confirm button?
   **A:** Confirm button. With a fine dialog box.

2. **Q:** "אשר בכל זאת" (approve anyway) for mismatch — is this a real scenario?
   **A:** Yes — it happens when the AI thought it's from X but it's actually from Y (AI misread the issuer, doc is correct).

3. **Q:** Fuzzy match treatment — full comparison box or simpler single-line hint?
   **A:** Single line hint (e.g., `"Intel ≈ Intel Israel Ltd?"`).

4. **Q:** Accordion header stats — keep average combined percentage?
   **A:** Percentage is irrelevant. Use breakdown: matched / issuer-mismatch / unmatched.

5. **Q:** After quick-assign from comparison box — stay for confirmation or animate out?
   **A:** Animate out (same as approve/reject).

## 3. Technical Constraints & Risks

* **Dependencies:** `admin/js/script.js` (renderAICard, renderAICards, action functions), `admin/css/style.css`
* **Data available from API (no backend changes needed):**
  - `item.issuer_name` — AI-extracted issuer (currently unused on card)
  - `item.matched_doc_name` — required doc's display title
  - `item.matched_template_id` — template type code
  - `item.matched_template_name` — template type name (e.g., "טופס 867")
  - `item.ai_confidence` — raw type confidence (0-1)
  - `item.issuer_match_quality` — exact/single/fuzzy/mismatch
  - `item.missing_docs[]` — all required docs (can filter by template_id)
* **Risks:** None — purely frontend, no API or workflow changes needed.
* **POST API:** Already supports `reassign_doc_record_id` — quick-assign from comparison box will use existing reassign flow.

## 4. Proposed Solution (The Blueprint)

### 4 Card States

#### State A: Full Match (type ✅ + issuer exact/single)
```
┌─ GREEN border ──────────────────────────────────────────────┐
│  📄 form106_intel.pdf  🤖?  [פתח בקובץ ↗]                  │
│                                                              │
│  [95%] טופס 106 – Intel                                     │
│──────────────────────────────────────────────────────────────│
│  [✓ אשר]               [✗ דחה]              [↔ שייך מחדש]   │
└──────────────────────────────────────────────────────────────┘
```
- Green left border
- Raw AI confidence (no multiplier), green/amber/red by standard thresholds
- `matched_doc_name` as display label
- Actions: approve (primary), reject, reassign

#### State B: Issuer Mismatch (type ✅ + issuer mismatch)
```
┌─ AMBER border ──────────────────────────────────────────────┐
│  📄 document_feb.xlsx  🤖?  [פתח בקובץ ↗]                  │
│                                                              │
│  ✅ [95%] סוג מסמך: טופס 867                                │
│                                                              │
│  ⚠️ מנפיק לא נמצא ברשימה                                   │
│  ┌────────────────────────────────────────────────────┐      │
│  │  📥 התקבל מ:     בנק לאומי                         │      │
│  │                                                    │      │
│  │  📋 נדרשים (3):  ○ טופס 867 – חיסכ1               │      │
│  │                  ○ טופס 867 – פועלים              │      │
│  │                  ○ טופס 867 – דיסקונט             │      │
│  └────────────────────────────────────────────────────┘      │
│──────────────────────────────────────────────────────────────│
│  [✓ שייך] (disabled)     [✓ אשר בכל זאת]          [✗ דחה]   │
└──────────────────────────────────────────────────────────────┘
```
- **Amber** left border (`.ai-review-card.issuer-mismatch`)
- Raw type confidence with "סוג מסמך:" prefix label
- Comparison box (`.ai-issuer-comparison`):
  - Top line: "📥 התקבל מ:" + `item.issuer_name` (AI-extracted, **bold**)
  - Bottom: "📋 נדרשים (N):" + radio list of same-type required docs from `missing_docs.filter(d => d.template_id === matched_template_id)`
  - Radio buttons are clickable — selecting one enables the "שייך" button
- Actions:
  - **שייך** (primary, disabled until radio selected) → confirmation dialog → POST reassign → animate out
  - **אשר בכל זאת** (secondary/ghost) → confirmation dialog → POST approve → animate out
  - **דחה** → same as current reject flow

**Confirmation dialog text:**
- For שייך: `"לשייך את הקובץ ל: טופס 867 – חיסכ1?"`
- For אשר בכל זאת: `"לאשר את הסיווג למרות שהמנפיק לא תואם?"`

**Edge case — no same-type docs in missing_docs:**
If `missing_docs.filter(...)` returns empty (all same-type docs already received), show the full reassign combobox instead of the radio list.

#### State C: Fuzzy Match (type ✅ + issuer fuzzy)
```
┌─ GREEN border ──────────────────────────────────────────────┐
│  📄 form867_leumi.pdf  🤖?  [פתח בקובץ ↗]                  │
│                                                              │
│  [95%] טופס 867 – בנק לאומי                                 │
│  💡 Intel ≈ Intel Israel Ltd                                 │
│──────────────────────────────────────────────────────────────│
│  [✓ אשר]               [✗ דחה]              [↔ שייך מחדש]   │
└──────────────────────────────────────────────────────────────┘
```
- Green border (fuzzy is close enough to treat as likely-correct)
- Raw confidence, normal badge
- Single-line hint: `"💡 {ai_issuer} ≈ {doc_issuer}"` (subtle, gray text)
- Actions: same as full match (approve is primary)

#### State D: Unmatched (type ❌)
```
┌─ AMBER border ──────────────────────────────────────────────┐
│  📄 random_file.docx  🤖?  [פתח בקובץ ↗]                   │
│                                                              │
│  [--] לא זוהה                                               │
│──────────────────────────────────────────────────────────────│
│  שייך ל: [🔍 combobox]       [✓ שייך]              [✗ דחה]   │
└──────────────────────────────────────────────────────────────┘
```
- Unchanged from current design.

### Accordion Header Stats

**Before:** `⌀ 28%` (misleading average)

**After:** Breakdown badges:
```
[משה כהן]  ✅ 2 זוהו  |  ⚠️ 1 מנפיק שונה  |  ❌ 1 לא זוהו
```

Count logic:
- `✅ זוהו` = matched + issuer exact/single/fuzzy
- `⚠️ מנפיק שונה` = matched + issuer mismatch
- `❌ לא זוהו` = unmatched

### Card Border Color Logic

| State | `isMatched` | `issuer_match_quality` | Border color |
|-------|-------------|----------------------|--------------|
| Full match | true | exact / single | Green (success-500) |
| Fuzzy | true | fuzzy | Green (success-500) |
| Issuer mismatch | true | mismatch | Amber (warning-500) |
| Unmatched | false | null | Amber (warning-500) |

CSS class: remove `.matched` / `.unmatched` binary → use `.match-full`, `.match-fuzzy`, `.match-issuer-mismatch`, `.match-unmatched`.

### Confidence Display Logic

**Remove combined confidence formula entirely.** Always show raw `ai_confidence`:
- `>= 0.85` → green (ai-confidence-high)
- `>= 0.50` → amber (ai-confidence-medium)
- `< 0.50` → red (ai-confidence-low)

### Modified Files

| File | Changes |
|------|---------|
| `admin/js/script.js` | `renderAICard()` — 4 card states, comparison box, radio quick-assign; `renderAICards()` — accordion stats breakdown; new `quickAssignFromComparison()` function; remove `getQualityBadgeHtml()` (replaced by comparison box) |
| `admin/css/style.css` | `.match-full`, `.match-fuzzy`, `.match-issuer-mismatch`, `.match-unmatched` borders; `.ai-issuer-comparison` box; `.ai-comparison-radio` styles; `.ai-fuzzy-hint` single-line style; updated accordion stat badges |

### Quick-Assign Flow (State B)

```
User clicks radio "טופס 867 – חיסכ1"
  → "שייך" button enables
  → User clicks "שייך"
  → showConfirmDialog("לשייך את הקובץ ל: טופס 867 – חיסכ1?")
  → User confirms
  → POST /webhook/review-classification {
      action: "reassign",
      record_id: item.id,
      reassign_doc_record_id: selected_doc.doc_record_id
    }
  → Card animates out
```

## 5. Validation Plan

- [ ] **State A (full match):** Green border, raw confidence (95%), doc name, approve/reject/reassign buttons
- [ ] **State B (issuer mismatch, single required):** Amber border, type confidence with label, comparison box with 1 radio option, שייך disabled until selected, confirm dialog on assign
- [ ] **State B (issuer mismatch, multi required):** Same but with 3 radio options showing all same-type docs
- [ ] **State B (no same-type in missing):** Falls back to full reassign combobox
- [ ] **State B "אשר בכל זאת":** Confirm dialog, approve action, animate out
- [ ] **State C (fuzzy):** Green border, normal display, single-line hint "X ≈ Y"
- [ ] **State D (unmatched):** Unchanged from current
- [ ] **Accordion stats:** Shows "✅ N זוהו | ⚠️ N מנפיק שונה | ❌ N לא זוהו" (no percentage)
- [ ] **Card border colors:** Green for full/fuzzy, amber for mismatch/unmatched
- [ ] **No combined confidence anywhere** — raw AI confidence only
- [ ] **RTL layout:** Comparison box, radios, buttons all render correctly in RTL
- [ ] **Mobile responsive:** Comparison box stacks properly on small screens

## 6. Implementation Notes (Post-Code)
*To be filled during implementation.*
