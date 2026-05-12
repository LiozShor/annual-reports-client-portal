# Design Log 398: Add Percentage to Admin Stat Cards

**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-05-03
**Related Logs:** DL-187 (stage3-attention-bounce), DL-288 (queued-subtitle), DL-161 (stage pipeline)

## 1. Context & Problem

The admin dashboard top row shows 9 stat cards (one `סה״כ לקוחות` total + 8 stage buckets). Each card currently shows only an integer count. Office wants a small, minimal percentage next to each count so they can see at a glance what share of active clients sits in each stage.

Single writer for all 9 cards: `recalculateStats()` at `frontend/admin/js/script.js:2116-2168`. Card markup at `frontend/admin/index.html:405-442`.

## 2. User Requirements (Q&A)

1. **Q:** Denominator? **A:** % of total active clients (the `סה״כ לקוחות` card / `counts.total`).
2. **Q:** Placement? **A:** Small text next to the number, minimal — must not compete visually with the big number.
3. **Q:** Total card too? **A:** No — total stays as plain count.
4. **Q:** Format/rounding? **A:** Whole numbers, no decimals (`10%`).

## 3. Research

### Domain
KPI / stat card design (dashboard composition, primary-vs-secondary metric hierarchy).

### Sources Consulted (Bright Data SERP)
- **Tabular Editor — KPI card best practices in Power BI** — big number first; secondary metrics live as smaller, muted supporting text below/beside the headline.
- **Krish Pillai — KPI card structure (LinkedIn)** — three-part shape: Key Metric, Comparison, Label. The percentage we're adding is the "Comparison" slot.
- **Domo — KPI dashboard guide** — keep cards uncluttered; round aggressively, avoid decimals when not needed.

### Key Principles Applied
- **Primary metric stays primary.** Big number unchanged; % is rendered ~55% size and muted color.
- **Comparison adds meaning.** A bare `58` hides distribution; `% of total` lets the eye instantly judge stage shape.
- **Avoid clutter.** Whole-number rounding + a single muted span keeps the card minimal (per user's "minimal" instruction).

## 4. Codebase Analysis

- `recalculateStats()` (`script.js:2116-2168`) is the **only** writer for `#stat-stageN` and `#stat-total`. Touching it = covering all surfaces.
- HTML at `index.html:405-442` does not need changes — the `.stat-pct` span is injected via JS, matching the existing pattern at `script.js:2150-2167` where the queued-subtitle span is dynamically appended to stage-3.
- No parallel render path: `script.js` is the sole consumer of `clientsData`. No mobile/desktop split — same DOM. Client portal does not show stage stats.
- Monolith size ratchet: net diff ~10 lines in one function — comfortably below the noise floor; no module extraction needed.

## 5. Constraints & Risks

- **RTL Hebrew layout:** the % must sit visually adjacent to the number without pushing the big number off-baseline. Use `margin-inline-start` (RTL-aware).
- **Division by zero:** when `counts.total === 0`, render `0%`.
- **Stage-3 queued-subtitle:** the `(N בתור לשליחה)` span is appended to `.stat-label`, not `.stat-number` — adding a child span to `.stat-number` cannot collide.
- **Cache:** monolith JS + CSS edits require `?v=` bumps in `index.html` per global rule.

## 6. Proposed Solution

### CSS (`frontend/admin/css/style.css`)
Add a single rule:
```css
.stat-pct {
    font-size: 0.55em;
    font-weight: 500;
    color: var(--gray-500);
    margin-inline-start: 4px;
    vertical-align: middle;
}
```

### JS (`frontend/admin/js/script.js`, lines ~2128–2136)
Replace the eight `.textContent` assignments with a small loop, leaving `stat-total` as plain text:
```js
const setStat = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    const pct = counts.total > 0 ? Math.round((n / counts.total) * 100) : 0;
    el.innerHTML = `${n}<span class="stat-pct">${pct}%</span>`;
};
document.getElementById('stat-total').textContent = counts.total;
for (let i = 1; i <= 8; i++) setStat(`stat-stage${i}`, counts['stage' + i]);
```

### Cache-bust (`frontend/admin/index.html`)
Bump `script.js?v=NNN` and `style.css?v=NNN`.

## 7. Validation Plan

- [ ] Admin dashboard: stages 1–8 render `<count><small %>`. Total card shows count only.
- [ ] Sum of stage percentages ≈ 100% (rounding error ≤ 8 × 0.5%).
- [ ] Switch filing-type tab (annual_report ↔ capital_statements) — percentages recompute against the new active-tab total.
- [ ] Deactivate a client → stage card count and percentage update in place (silent refresh).
- [ ] RTL layout: % sits adjacent to the number, doesn't push the big number off-baseline.
- [ ] Mobile (≤768px): cards still readable.
- [ ] When `counts.total === 0`, no NaN — all cards show `0` with `0%`.
- [ ] Stage-3 queued-subtitle (`(N בתור לשליחה)`) still renders correctly.
- [ ] Cache-bust verified: `curl docs.moshe-atsits.com/admin/index.html | grep 'script.js?v='` shows the new version.

## 8. Implementation Notes

_(filled during/after Phase D)_
