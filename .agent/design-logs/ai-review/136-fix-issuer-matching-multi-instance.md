# DL-136: Fix Issuer Matching for Multi-Instance Documents

**Date:** 2026-03-09
**Status:** Implemented
**Workflow:** [05] Inbound Document Processing (`cIa23K8v1PrbDJqY`)
**Node:** Process and Prepare Upload (`630031f2-6e40-46ce-be9b-9a617dd290c3`)

## Problem

When a client has two T601 documents (e.g., "867 – בנק לאומי" and "867 – בנק הפועלים"), the AI classifier correctly identifies `issuer_name: "בנק לאומי"`, but the issuer matcher picks the wrong bank because:

1. **Substring check** returned 'fuzzy' (not 'exact') for correct matches
2. **Token overlap** counted shared entity prefixes ("בנק") as meaningful overlap → both banks got 'fuzzy'
3. **First-match-wins** picked whichever bank appeared first in the array

## Solution (3 changes)

### Change 1: Entity stop words
Added `ENTITY_STOP` set: `['בנק', 'קרן', 'חברה', 'חברת', 'ביטוח', 'קופת', 'בית']` — entity-type prefixes filtered from token overlap.

### Change 2: Rewritten `compareIssuers()`
- Substring containment → 'exact' (was 'fuzzy'), with `length >= 3` guard
- Token overlap filters out `ENTITY_STOP` words and pure digits
- Threshold = 1.0 for short entities (≤2 distinctive tokens) — ALL must match

### Change 3: Score-aware `findBestDocMatch()`
- Uses `QUALITY_RANK` map instead of first-match-wins
- Still short-circuits on 'exact' for performance
- Among fuzzy matches, picks highest-ranked (not first)

## Downstream Impact
- `issuer_match_quality` values unchanged: 'exact', 'single', 'fuzzy', 'mismatch'
- Substring matches promoted to 'exact' → `issuerConfirmed = true` → issuer included in OneDrive filename (correct behavior)
- No Airtable field changes, no API response shape changes

## Test Cases
- [ ] Client with T601 for both בנק לאומי and בנק הפועלים → AI says "בנק לאומי" → matches correct bank
- [ ] Client with single T601 → still gets matchQuality: 'single'
- [ ] AI issuer "מגדל" matches doc "מגדל חברה לביטוח" → 'exact' via substring
- [ ] AI issuer null → matchQuality: 'mismatch'
- [ ] No false positives from shared entity prefixes
- [ ] issuer_match_quality correctly stored in Airtable
- [ ] OneDrive filename includes issuer for exact matches

## Local Backup
`C:/tmp/process-prepare-upload.js`
