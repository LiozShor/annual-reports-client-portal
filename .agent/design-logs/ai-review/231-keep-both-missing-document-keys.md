# DL-231: Keep-Both Missing document_key, document_uid, issuer_key

**Status:** IMPLEMENTED — NEED TESTING
**Area:** AI Review & Classification
**Related:** DL-222c (multi-PDF approve conflict), DL-224 (issuer-aware doc lookup)
**Triggered by:** CPA-XXX_2025_annual_report has 1 document (`rec63YooI7TEznh8U`) without `document_key`

---

## Problem

The **keep_both** code path in `api/src/routes/classifications.ts` creates new document records but omits three identity fields:
- `document_key` — used for backward compat lookups
- `document_uid` — used for upsert matching
- `issuer_key` — normalized issuer name for deduplication

Both the **approve keep_both** (line ~556) and **reassign keep_both** (line ~766) paths are affected.

The general_doc creation path (line ~680) correctly sets these fields. The keep_both paths were added in DL-222c/DL-224 but missed them.

## Evidence

```
Doc rec63YooI7TEznh8U (CPA-XXX_2025_annual_report):
  document_key: null
  document_uid: null
  issuer_key: null
  type: T501, person: client, category: insurance
  issuer_name: ...ב<b>מיטב</b> — חלק 2
  ai_reason: "Reassigned from T501: ..."
  created_at: 2026-03-31T04:54:36Z
```

Original doc `recKDhSVJhwkK74O1` has:
```
  document_key: rec6tdtriaod8kwvd_t501_client_deposits_hishtalmut_companies_מיטב
  document_uid: (same)
  issuer_key: מיטב
```

## Fix

### Code change (classifications.ts)

Add `document_uid`, `document_key`, and `issuer_key` to both keep_both `newDocFields` objects:
- `document_uid` / `document_key`: derive from the original doc's key + `_partN` suffix
- `issuer_key`: copy from target doc (same issuer, just a second file)

### Backfill

Patch `rec63YooI7TEznh8U` to set:
- `document_uid` = `rec6tdtriaod8kwvd_t501_client_deposits_hishtalmut_companies_מיטב_part2`
- `document_key` = same
- `issuer_key` = `מיטב`

## Files Changed

| File | Change |
|------|--------|
| `api/src/routes/classifications.ts` | Add 3 fields to both keep_both paths |

## Testing

- Trigger a keep_both approve → verify new doc has all 3 fields
- Trigger a keep_both reassign → verify new doc has all 3 fields
