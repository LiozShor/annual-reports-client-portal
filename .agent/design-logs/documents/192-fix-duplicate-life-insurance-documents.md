# DL-192: Fix Duplicate Life Insurance Documents

**Status:** Done
**Created:** 2026-03-26
**Domain:** Documents

## Problem

Client סהר לולו has two identical "ביטוח חיים במגדל" documents. Root cause: two Tally questions (`deposits_life_insurance_companies` and `insurance_mortgage_company`) both feed T501 with the same company name and same deposit type (ביטוח חיים). The existing dedup uses `mapping_id` in the comboKey (FIX #17), so different mappings producing identical deposit documents aren't caught.

## Solution

Added a T501-specific dedup set (similar to `seen867Institutions` for Form 867) keyed by `(deposit_type, normalized_company_name, person)`. The check runs after T501 vars are fully computed, inside the existing `if (templateId === 'T501')` block.

## Changes

- **n8n workflow** `[SUB] Document Service` (hf7DRQ9fLmQqHv3u), node `Generate Documents`:
  1. Added `const seenT501Deposits = new Set()` alongside other dedup sets
  2. Added dedup check after T501 vars computed: key = `${deposit_type}_${normalizeKey(company_name)}_${person}`
  3. Added bug fix #19 to header comment

## Why This Works

- `deposits_life_insurance_companies` mapping sets `deposit_type = ביטוח חיים`
- `insurance_mortgage_company` mapping also sets `deposit_type = ביטוח חיים`
- When both have the same company (e.g., מגדל), the dedup key is identical → second one skipped
- Different deposit types (pension, hishtalmut, work disability) use different `deposit_type` values → unaffected

## Risk

None — purely additive. Only T501 documents with identical (deposit_type, company_name, person) tuples are deduplicated. All other templates and deposit types unaffected.
