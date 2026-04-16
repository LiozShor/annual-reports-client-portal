# Design Log 144: Fix Issuer Matching — Compare Against issuer_key
**Status:** [COMPLETED]
**Date:** 2026-03-11
**Related Logs:** [136](136-fix-issuer-matching-multi-instance.md), [143](143-classification-test-bugfixes.md)

## 1. Context & Problem

During DL-143 test validation, doc09 (ביטוח חיים from IDI) was classified correctly as T501 with `issuer_name: "איי.די.איי (IDI)"`, but matched to the wrong document (חיים1 instead of IDI).

Root cause: `findBestDocMatch` (in "Process and Prepare Upload" node) calls `compareIssuers(aiIssuer, doc.issuer_name)` — but `doc.issuer_name` is the **full document title** (e.g., "אישור שנתי למס הכנסה לשנת 2025...ב<b>IDI</b>"). The short identifier `doc.issuer_key` ("IDI") is never compared.

Traced in Python: `compareIssuers("איי.די.איי (IDI)", full_title)` → mismatch for ALL candidates. But `compareIssuers("איי.די.איי (IDI)", "IDI")` → exact match.

## 2. User Requirements

1. **Q:** Compare against both issuer_key and issuer_name, or replace?
   **A:** Both — issuer_key primary, issuer_name fallback. Covers cases where issuer_key might be empty.

2. **Q:** Full design log or lightweight?
   **A:** Lightweight — one-line fix, clear root cause.

## 3. Codebase Analysis

**Node:** Process and Prepare Upload (`630031f2-6e40-46ce-be9b-9a617dd290c3`)
**Workflow:** WF[05] `cIa23K8v1PrbDJqY`
**Prior work:** DL-136 improved `compareIssuers()` with stop-words, score-aware matching. The function itself is correct — it's just called with the wrong field.

**The fix (line 84):**
```js
// BEFORE:
const quality = compareIssuers(issuerName, doc.issuer_name);

// AFTER:
const qKey = compareIssuers(issuerName, doc.issuer_key);
const qName = compareIssuers(issuerName, doc.issuer_name);
const quality = (QUALITY_RANK[qKey] || 0) >= (QUALITY_RANK[qName] || 0) ? qKey : qName;
```

## 4. Proposed Solution

Replace the single comparison on line 84 of `findBestDocMatch` with a dual comparison against both `issuer_key` and `issuer_name`, taking the better quality result.

### Files to Change
| Node | ID | Action |
|------|-----|--------|
| Process and Prepare Upload | `630031f2-...` | Modify line 84 in `findBestDocMatch` |

## 5. Validation Plan
* [ ] doc09 (IDI): match_quality = exact (was mismatch)
* [ ] doc05 (מגדל מקפת): still exact
* [ ] doc15 (אלטשולר שחם): still exact
* [ ] No regressions in single-candidate matches

## 6. Implementation Notes (Post-Code)
- Changed line 84 in `findBestDocMatch` to compare against both `doc.issuer_key` and `doc.issuer_name`, taking the better quality result.
- Pushed via n8n REST API to "Process and Prepare Upload" node (`630031f2-6e40-46ce-be9b-9a617dd290c3`).
- `QUALITY_RANK` map (already on line 82) reused for the comparison — no new code structures needed.
