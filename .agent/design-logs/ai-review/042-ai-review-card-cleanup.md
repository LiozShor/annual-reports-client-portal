# Design Log 042: AI Review Card Cleanup
**Status:** [COMPLETED]
**Date:** 2026-02-19
**Related Logs:** 036 (AI Classification Review Interface), 041 (Issuer-Level Document Matching)

## 1. Context & Problem

The AI review card in the admin panel is cluttered. Every field is shown at full size, creating visual noise that slows down the reviewer. The card currently has 6 visual sections stacked vertically:

1. File bar (icon + name + size + open link)
2. Sender info (email + date)
3. Classification line (confidence % + doc name + quality badge)
4. Evidence paragraph (Claude's full reasoning — often 2-3 lines)
5. Issuer line (building icon + extracted issuer name)
6. Action buttons

**Additional issue:** The confidence badge (95%) shows green even when issuer matching fails ("לא תואם"). A 95% type match with a mismatched issuer is NOT a 95% reliable match — the green badge is misleading.

## 2. User Requirements (The 5 Questions)

1. **Q:** Evidence text — hide, truncate, or remove?
   **A:** Hide behind hover. Show an AI agent icon with question mark so user knows to hover.

2. **Q:** Issuer line redundancy — drop the separate line since issuer is now in the doc title?
   **A:** The bigger issue is that 95% confidence + "לא תואם" is misleading. The confidence display should reflect the issuer match quality, not just the type match. Drop the separate issuer line (it's in the title now).

3. **Q:** Sender email + date — useful or noise?
   **A:** Collapse into a tooltip.

4. **Q:** File size in top bar — useful?
   **A:** No, remove it. Keep filename + open link only.

5. **Q:** Card density goal?
   **A:** Current density is fine, just reduce clutter.

## 3. Technical Constraints & Risks

* **Dependencies:** `admin/js/script.js` (renderAICard), `admin/css/style.css`
* **Risks:** None significant — purely frontend, no API changes

## 4. Proposed Solution (The Blueprint)

### Card Layout: Before → After

```
BEFORE (6 sections):
┌──────────────────────────────────────────────┐
│ 📄 document_feb.xlsx    6KB    [פתח בקובץ]  │  ← file bar
│────────────────────────────────────────────── │
│ ✉ liozshor1@gmail.com  📅 19.02.2026 17:00  │  ← sender row
│                                              │
│ [95%] טופס 867 לשנת 2025 – חיסכו  [לא תואם] │  ← classification
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ המסמך הוא "דוח פירוט ניירות ערך...      │ │  ← evidence (2-3 lines!)
│ │ ...כולל רשימה מפורטת של ניירות...        │ │
│ └──────────────────────────────────────────┘ │
│ 🏢 בנק לאומי לישראל בע"מ                    │  ← issuer (redundant)
│────────────────────────────────────────────── │
│         [שייך מחדש]  [דחה]  [אשר]           │  ← actions
└──────────────────────────────────────────────┘

AFTER (3 sections):
┌──────────────────────────────────────────────┐
│ 📄 document_feb.xlsx  [🤖❓]  [פתח בקובץ ↗] │  ← file bar (+ AI icon for evidence hover)
│                                              │
│ [95%] טופס 867 לשנת 2025 – חיסכו  [לא תואם] │  ← classification (confidence color reflects issuer match)
│────────────────────────────────────────────── │
│         [שייך מחדש]  [דחה]  [אשר]           │  ← actions
└──────────────────────────────────────────────┘
  └─ hover on 🤖❓ shows tooltip: evidence text
  └─ hover on filename shows tooltip: sender + date
```

### Specific Changes

**1. Remove file size** — drop `fileMeta` from file bar.

**2. Sender info → tooltip on filename** — move email + date into a `title` attribute on the filename span.

**3. Evidence → hover tooltip on AI icon** — replace the evidence block with a small `🤖` icon with `?` in the file bar. Hover shows the full `ai_reason` text in a CSS tooltip positioned below the icon.

**4. Drop separate issuer line** — the issuer is already in the doc title (from 041). Remove the `ai-issuer-info` div entirely.

**5. Combined confidence score** — the displayed confidence is adjusted by issuer match quality, because a correct type with the wrong issuer is NOT a reliable classification:

```javascript
function getEffectiveConfidence(aiConfidence, issuerMatchQuality) {
    const multipliers = { exact: 1.0, single: 1.0, fuzzy: 0.7, mismatch: 0.3 };
    const multiplier = multipliers[issuerMatchQuality] ?? 1.0;
    return aiConfidence * multiplier;
}
```

| issuer_match_quality | Multiplier | Example (AI=95%) | Badge color |
|---------------------|-----------|------------------|-------------|
| `exact` | ×1.0 | 95% | green |
| `single` | ×1.0 | 95% | green |
| `fuzzy` | ×0.7 | 67% | amber |
| `mismatch` | ×0.3 | 29% | red |
| null/empty | ×1.0 | 95% | by % |

This way, a 95% type match with `mismatch` issuer displays as **29%** in red — the number itself tells the reviewer "this match is unreliable."

### Modified Files
* `admin/js/script.js` — `renderAICard()` function
* `admin/css/style.css` — tooltip styles for evidence + sender

## 5. Validation Plan

- [ ] Matched card with `exact` issuer: 95% green, no evidence visible, hover shows tooltip
- [ ] Matched card with `mismatch` issuer: 29% red badge, quality badge visible
- [ ] Unmatched card: unchanged behavior
- [ ] Hover on AI icon: evidence text appears in tooltip
- [ ] Hover on filename: sender email + date appear
- [ ] No separate issuer line visible
- [ ] No file size visible
- [ ] Card is visually compact (~3 rows instead of ~6)

## 6. Implementation Notes (Post-Code)

All 5 changes implemented as planned. Details:

- **File size removed:** Dropped `fileMeta` variable and `.ai-file-meta` span from card HTML. Removed `formatAIFileMeta()` function and `.ai-file-meta` CSS class.
- **Sender → tooltip:** Email + date combined into a `title` attribute on the filename span. Removed `.ai-sender-info` and `.ai-sender-detail` CSS.
- **Evidence → AI icon tooltip:** Replaced evidence `<div>` with `<span class="ai-evidence-trigger" data-tooltip="...">` using a CSS `::after` pseudo-element tooltip (dark bg, 300px wide, positioned below icon). Icon is lucide `bot` + `?` text.
- **Issuer line dropped:** Removed the `ai-issuer-info` div from card HTML. CSS kept (no harm).
- **Combined confidence:** `confidence = rawConfidence * issuerMultiplier` where `{exact: 1.0, single: 1.0, fuzzy: 0.7, mismatch: 0.3}`. Applied both in `renderAICard()` and in accordion header average. The color class naturally follows from the adjusted number.
