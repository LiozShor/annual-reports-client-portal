# Design Log 102: Stage Redesign & Missing Column Fix
**Status:** [DRAFT]
**Date:** 2026-03-05
**Related Logs:** DL-065 (Year Rollover), DL-066 (Stage-Aware Reminders)

## 1. Context & Problem

Two issues:
1. **"חסרים" column shows "✓" for stages 1-2** — when `docsTotal = 0` and `docsReceived = 0`, `missingCount = 0` → displays checkmark. Misleading — no documents have been generated yet.
2. **Stage names don't reflect actual workflow** — current 5 stages (`ממתין לשליחה → ממתין לתשובה → אוסף מסמכים → בבדיקה → הושלם`) lack the CPA preparation, Moshe's review, and client signing phases.

## 2. User Requirements

1. **Q:** What should stages 1-2 show in חסרים column?
   **A:** "—" (em dash)
2. **Q:** Merge stages 1+2 or keep separate?
   **A:** Keep separate (7 total stages)
3. **Q:** How does "מוכן להכנה" transition work?
   **A:** Same as current 4-Review — auto when all docs received. "מוכן לבדיקה של משה" is NEW after it.
4. **Q:** Change internal keys or display names only?
   **A:** Display names only for existing stages. New keys for new stages.
5. **Q:** Stage 1 rename?
   **A:** Keep "ממתין לשליחה"
6. **Q:** New stage transitions automatic or manual?
   **A:** Manual for now

## 3. Research

### Domain
CRM Pipeline Design, Status Indicator UX, Dashboard Layout

### Sources Consulted
1. **Sparkle.io — CRM Stages** — Stage names should answer "what is true right now about this client" — outcome-focused, not vague.
2. **NN/G — Empty States** — "Not yet applicable" must be visually distinct from "complete" or "missing". Em dash + muted color preferred over blank or misleading icons.
3. **Pencil & Paper — Filter UX** — Horizontal stat bars limited to ~5-6 items; beyond that, use `flex-wrap` or tiered layout.

### Key Principles
- Each stage name = clear state descriptor ("מוכן להכנה" not "שלב 4")
- "N/A" states use low-prominence treatment distinct from success/error
- 8 stat cards: rely on `auto-fit` grid wrapping (already in place: `repeat(auto-fit, minmax(160px, 1fr))`)

## 4. Codebase Analysis

### Stage Value Map (7 stages)

| Position | Internal Key (Airtable) | Hebrew Label | Change Type |
|----------|------------------------|--------------|-------------|
| 1 | `1-Send_Questionnaire` | ממתין לשליחה | **Unchanged** |
| 2 | `2-Waiting_For_Answers` | טרם מילא שאלון | **Label rename** |
| 3 | `3-Collecting_Docs` | מילא שאלון וחסרים מסמכים | **Label rename** |
| 4 | `4-Review` | מוכן להכנה | **Label rename** |
| 5 | `6-Moshe_Review` (**NEW**) | מוכן לבדיקה של משה | **New stage** |
| 6 | `7-Before_Signing` (**NEW**) | לפני חתימה של הלקוח | **New stage** |
| 7 | `5-Completed` | הוגש | **Label rename** |

**Why `6-` and `7-` prefixes for new keys:** Avoids collision with existing `5-Completed`. The numeric prefix in keys is NOT used for ordering — the `num` property in the STAGES object controls display order.

### Files to Change

**Frontend (GitHub Pages):**
- `admin/js/script.js` — STAGES constant, recalculateStats, missing-count rendering
- `admin/index.html` — stat cards HTML, stage filter dropdown
- `admin/css/style.css` — 2 new stage color classes (stage-5 → teal, stage-6 → orange, stage-7 → green)
- `assets/js/landing.js` — STAGE_ORDER object (add 2 new keys)
- `assets/js/view-documents.js` — no change needed (uses `startsWith('1-')` / `startsWith('2-')`)
- `assets/js/document-manager.js` — no change needed (uses `startsWith('1')` / `startsWith('2')`)

**n8n:**
- `[Admin] Change Stage` (`3fjQJAwX1ZGj93vL`) — check if it validates allowed stage values; if so, add new keys
- NO other n8n workflow changes needed (all reference existing keys which remain unchanged)

**Airtable:**
- Add 2 new singleSelect options to `stage` field: `6-Moshe_Review`, `7-Before_Signing`
- Reorder options in Airtable UI
- Rename display labels in Airtable (optional — labels are for Airtable UI only, system uses keys)

**Documentation:**
- `docs/airtable-schema.md` — update stage values

### Existing Patterns Reused
- `openStageDropdown()` auto-generates from `Object.entries(STAGES)` — no change needed
- `STAGE_NUM_TO_KEY` auto-maps from STAGES — no change needed
- `toggleStageFilter()` uses `cards[parseInt(select.value)]` — works if HTML cards match num order
- `.stats-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) }` — handles 8 cards via wrapping

## 5. Technical Constraints & Risks

* **Risk: Stage badge width** — longer Hebrew labels (e.g., "מילא שאלון וחסרים מסמכים") may push table columns. Current `min-width: 130px` + `white-space: nowrap`. Monitor and adjust if needed.
* **Risk: n8n Change Stage validation** — if workflow validates against allowed stage list, new keys rejected. Must check during implementation.
* **Risk: Airtable select options** — adding via API may fail if field is in a protected view. Manual addition via UI is the fallback.
* **No breaking changes to existing n8n workflows** — all existing keys preserved.

## 6. Proposed Solution (The Blueprint)

### Part A: Missing Column Fix (simple)

In `admin/js/script.js` line ~305, change the missing-count rendering:

```js
// Before:
${missingCount > 0 ? missingCount : '✓'}

// After:
${(STAGES[client.stage]?.num || 0) <= 2 ? '—' : (missingCount > 0 ? missingCount : '✓')}
```

Also add `not-applicable` CSS class for stages 1-2 (muted gray, no pointer cursor).

### Part B: STAGES Constant Update

```js
const STAGES = {
    '1-Send_Questionnaire':  { num: 1, label: 'ממתין לשליחה',              icon: 'clipboard-list', class: 'stage-1' },
    '2-Waiting_For_Answers': { num: 2, label: 'טרם מילא שאלון',           icon: 'hourglass',      class: 'stage-2' },
    '3-Collecting_Docs':     { num: 3, label: 'מילא שאלון וחסרים מסמכים',  icon: 'folder-open',    class: 'stage-3' },
    '4-Review':              { num: 4, label: 'מוכן להכנה',               icon: 'clipboard-check',class: 'stage-4' },
    '6-Moshe_Review':        { num: 5, label: 'מוכן לבדיקה של משה',       icon: 'user-check',     class: 'stage-5' },
    '7-Before_Signing':      { num: 6, label: 'לפני חתימה של הלקוח',      icon: 'pen-tool',       class: 'stage-6' },
    '5-Completed':           { num: 7, label: 'הוגש',                     icon: 'circle-check',   class: 'stage-7' }
};
```

### Part C: recalculateStats Update

Extend counts object to `stage7` and add DOM updates for `stat-stage6`, `stat-stage7`.

### Part D: Stat Cards HTML (index.html)

Add 2 new stat cards after stage-4, reorder stage-5 (completed) to end:
- stage-5 card: "מוכן לבדיקה של משה" (onclick stage filter '5')
- stage-6 card: "לפני חתימה של הלקוח" (onclick stage filter '6')
- stage-7 card: "הוגש" (onclick stage filter '7')

### Part E: Stage Filter Dropdown (index.html)

Add 2 new options, update labels for renamed stages:
```html
<option value="5">מוכן לבדיקה של משה</option>
<option value="6">לפני חתימה של הלקוח</option>
<option value="7">הוגש</option>
```

### Part F: CSS — New Stage Colors

```css
/* Existing stage-4 stays purple */
.stage-badge.stage-5 { background: #CCFBF1; color: #0F766E; }  /* teal */
.stage-badge.stage-6 { background: #FFF7ED; color: #C2410C; }  /* orange */
.stage-badge.stage-7 { background: var(--success-100); color: var(--success-700); }  /* green */

.stat-card.stage-5 { border-inline-start-color: #0D9488; }  /* teal */
.stat-card.stage-6 { border-inline-start-color: #EA580C; }  /* orange */
.stat-card.stage-7 { border-inline-start-color: var(--success-500); }  /* green */

/* Missing column "not applicable" state */
.missing-count.not-applicable { color: var(--gray-400); cursor: default; }
```

### Part G: landing.js — STAGE_ORDER

```js
const STAGE_ORDER = {
    '1-Send_Questionnaire': 1,
    '2-Waiting_For_Answers': 2,
    '3-Collecting_Docs': 3,
    '4-Review': 4,
    '6-Moshe_Review': 5,
    '7-Before_Signing': 6,
    '5-Completed': 7
};
```

### Part H: Airtable — Add New Options

Add `6-Moshe_Review` and `7-Before_Signing` to `stage` singleSelect field. Can be done via Airtable field update API or manually in UI.

### Part I: n8n — Check [Admin] Change Stage Validation

Download workflow, inspect validation logic. If hardcoded, add new keys.

### Part J: Documentation

Update `docs/airtable-schema.md` with new stage values and labels.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | STAGES constant, recalculateStats, missing-count render |
| `admin/index.html` | Modify | Add 2 stat cards, update filter dropdown, update labels |
| `admin/css/style.css` | Modify | Add stage-5/6/7 colors, not-applicable class |
| `assets/js/landing.js` | Modify | Add 2 keys to STAGE_ORDER |
| `docs/airtable-schema.md` | Modify | Update stage documentation |
| n8n `[Admin] Change Stage` | Check/Modify | Validate new stage keys accepted |
| Airtable `stage` field | Modify | Add 2 new singleSelect options |

## 7. Validation Plan

* [ ] Admin dashboard loads with 7 stage stat cards in correct order
* [ ] Stat cards wrap gracefully on smaller screens
* [ ] Clicking each stat card filters the table correctly
* [ ] Stage badges show new labels with correct colors
* [ ] Stage dropdown shows all 7 stages in order
* [ ] Changing stage to new stages (6-Moshe_Review, 7-Before_Signing) works via dropdown
* [ ] Backward move detection works (e.g., 7→4 shows warning)
* [ ] "חסרים" column shows "—" for stage 1 and 2 clients
* [ ] "חסרים" column shows count for stage 3+ with missing docs
* [ ] "חסרים" column shows "✓" for stage 3+ with 0 missing docs
* [ ] Landing page stageRank works with new stages
* [ ] Reminders tab still groups correctly (Type A = stage 2, Type B = stage 3)
* [ ] No n8n workflow regressions (existing auto-transitions still work)

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
