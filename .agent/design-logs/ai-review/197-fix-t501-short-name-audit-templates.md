# DL-197: Fix T501 Short Name + Audit All Templates

**Status:** IMPLEMENTED — NEED TESTING
**Created:** 2026-03-26
**Domain:** ai-review

## Problem

T501 "דוח שנתי מקוצר" documents show only the company name in the short display (e.g., "דוח שנתי מקוצר – הפניקס") but should also show the deposit type (e.g., "דוח שנתי מקוצר – ביטוח חיים – AIG").

Two bugs in `buildShortName`:

1. **Classification input bug** (`classifications.ts:184-188`): Only passes `<b>${issuer_name}</b>` (1 bold segment = company name). T501's short pattern has 2 variables — only 1 gets resolved.
2. **Literal bold pollution**: The full SSOT name has literal bolds (e.g., `<b>מקוצר</b>`) that are NOT variables but get included in variable mapping, corrupting results for T303, T304, T305, T306, T1401.

## Changes

### 1. `api/src/routes/classifications.ts:184-188`
Use `matched_doc_name` (full SSOT name with all bold variables) as primary input, fall back to issuer_name only.

### 2. `api/src/lib/classification-helpers.ts:96-110`
Added Step 5b: filter literal bolds from the FULL `name_he` pattern (uses `**...**` markdown bold syntax from Airtable). Expands the `literalBolds` set before filtering `variableSegments`.

## Affected Templates

| Template | Before | After |
|----------|--------|-------|
| T501 | דוח שנתי מקוצר – הפניקס | דוח שנתי מקוצר – ביטוח חיים – AIG |
| T303 | קצבת נכות – דמי נכות – יוסי | קצבת נכות – יוסי |
| T304 | דמי לידה – דמי לידה – רחל | דמי לידה – רחל |
| T305 | קצבת שארים – קצבת שארים – פרטים | קצבת שארים – פרטים |
| T1401 | הוצאות אבל – רלוונטיים – פרטים | הוצאות אבל – פרטים |

## Verification

Deploy: `cd api && npx wrangler deploy` — DONE

Test: `GET /api/classifications?year=2025` — check `matched_short_name` for T501/T303/T304/T305/T1401 docs.
