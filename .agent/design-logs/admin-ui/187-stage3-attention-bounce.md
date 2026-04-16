# DL-187: Stage 3 (Pending Approval) Bounce Attention Animation

**Date:** 2026-03-25
**Status:** Done
**Files changed:** `admin/css/style.css`, `admin/js/script.js`

## Problem
Stage 3 ("התקבל שאלון, טרם נשלחו מסמכים") requires office action but doesn't visually stand out in the stat grid.

## Solution
Continuous subtle bounce animation on the stage 3 stat card, only when count > 0.

### CSS
- `@keyframes stage3-bounce` — `translateY(-4px)` at 50%, 2s cycle, `ease-in-out`, infinite
- `.needs-attention` class: bounce + amber-600 bold number
- `prefers-reduced-motion`: static amber ring (`box-shadow: 0 0 0 2px #F59E0B`) instead of animation

### JS
- `recalculateStats()` toggles `.needs-attention` on `.stat-card.stage-3` based on `counts.stage3 > 0`
- Works on initial load and after any stage change

## Design Decisions
- Only `transform` animated — GPU-accelerated, no layout reflow
- 4px bounce — subtle, not jarring
- 2s cycle — gentle but noticeable
- One bouncing element per viewport (best practice)
- Reduced-motion users get static visual cue instead of nothing
