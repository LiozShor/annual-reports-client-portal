# Design Log 270: Editable Contract Period Dates on AI Review Card
**Status:** [COMPLETED]
**Date:** 2026-04-14
**Related Logs:** DL-269 (partial rental contract detection)

## 1. Context & Problem
DL-269 added AI detection of rental contract periods, but AI may misread dates. Natan needs to correct them before requesting the missing period. Also, when AI returns null dates for T901/T902, Natan should be able to manually add them.

## 6. Proposed Solution
- Inline click-to-edit month inputs on the contract period banner
- Dates persist to Airtable via `update-contract-period` action
- Banner shows for ALL T901/T902: partial (editable), full year (green info), null (empty inputs)

## 7. Validation Plan
- [x] Click on date → month input appears
- [x] Change month → banner updates, button recalculates
- [x] Reload → dates persist
- [x] T901/T902 with no dates → empty banner with placeholders
- [x] Existing approve/reject/reassign flows still work

## 8. Implementation Notes
- Used `<input type="month">` for native month picker (YYYY-MM format)
- End date normalized to last day of month before saving
- `coversFullYear` computed server-side (Jan 1 – Dec 31 check)
