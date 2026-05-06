# Design Log 408: Doc-Manager Rental Contracts — Multi-Instance + Data Drift Fix
**Status:** [COMPLETED — 2026-05-06]
**Date:** 2026-05-06
**Related Logs:** DL-239 (filing-type filter), DL-352 (owner tabs / scope filter), DL-162 (spouse-checkbox add docs)
**Branch:** claude-session-20260506-182812

## 1. Context & Problem

For some clients (reported example redacted) the doc-manager add-doc dropdown silently omits one of the rental-contract templates. Screenshot captured by user showed category "🏠 מגורים ונדל״ן" with **only** T902 ("חוזה שכירות – דירה שכורה למגורים (הוצאה)") present; T901 ("חוזה שכירות – דירה מושכרת (הכנסה)") was missing.

User-stated rule: rental contracts must always be available — a client can own/rent multiple apartments, so the template is inherently multi-instance.

## 2. User Requirements (Q&A)

1. **Q:** Which contract is missing for the reported client?
   **A:** The income variant (T901, "הכנסה"). Confirmed via screenshot of the rendered dropdown HTML — only T902 appears.
2. **Q:** What is the reported client's relevant setup?
   **A:** Active filing type = AR (annual report).
3. **Q:** Where is the missing template — dropdown or existing-docs list?
   **A:** Add-doc combobox dropdown only.
4. **Q:** Expected behavior for this template?
   **A:** Always available for any client — never hidden.

## 3. Research

Cumulative knowledge from prior logs:

- **DL-239** added the `filing_type` filter (`document-manager.js:751`); templates with empty `filing_type` pass through. T901 has `filing_type=annual_report`, so this filter is not the cause.
- **DL-352** added scope-based person filter via `_addDocTemplateMatchesPerson` (`document-manager.js:1787`). T901 and T902 both have `scope=CLIENT`, so both pass for the default "client" tab. Not the cause.
- **DL-162** introduced the original "no user-variables ⇒ single-instance" rule that survives at `document-manager.js:769-770`.

No new external research — the bug is internal data + filter logic. Citing prior research is sufficient per the cumulative-knowledge rule.

### Verdict

The line-770 filter is correct for genuinely single-instance templates (e.g., annual income confirmations) but wrong for any template that represents a per-property/per-source artifact. Rental contracts are the canonical example. Encode "multi-instance" intent explicitly.

## 4. Codebase Analysis

### Smoking gun — `frontend/assets/js/document-manager.js:769-770` (pre-fix)

```js
const userVars = (tpl.variables || []).filter(v => v !== 'year' && v !== 'spouse_name');
if (userVars.length === 0 && existingTemplateIds.has(tpl.template_id)) continue;
```

A template with no user variables, when already on the report, is removed from the dropdown.

### Live diagnostic (Phase D, before patch)

Pulled both rental-contract rows from Airtable `documents_templates`:

| template_id | variables (Airtable) | scope | filing_type | category |
|-------------|----------------------|-------|-------------|----------|
| T901 | (empty / field absent) | CLIENT | annual_report | housing |
| T902 | `rent_expense_monthly` | CLIENT | annual_report | housing |

This pinned the root cause to **data drift on T901**: per `docs/airtable-schema.md:204`, T901 is documented as having `{rent_income_monthly}`, but the live record had no value. The empty `variables` field caused `userVars.length === 0` to be true → filter activated the moment T901 was on the report → T901 silently disappeared from the dropdown for that client. T902 never hit the filter because its variable is correctly set.

### PA Queue path — `frontend/admin/js/script.js`

The PA cockpit's add-doc popover does NOT use a "no-variables ⇒ single-instance" filter at dropdown population. Its dedup runs in `paDocIsDuplicate` (`script.js:11015-11050`) and is **issuer_key-based** (`_paComputeIssuerKey`, line 11006). Once T901 has its variable in Airtable, distinct `rent_income_monthly` values produce distinct issuer_keys, so PA naturally allows multiple T901 instances per report. **No PA code change needed.**

## 5. Constraints & Risks

- **Uniformity (#1 rule):** Both surfaces (DM + PA) must allow T901/T902 multiple times. Verified: DM via the new allowlist bypass; PA via the existing issuer_key dedup once `variables` is populated.
- **Future drift:** If a new multi-instance template is added in Airtable but not added to `MULTI_INSTANCE_TEMPLATES`, the silent filter regresses. Mitigated with comment + planned schema flag (Section 8 / future work).
- **Backwards compat:** Existing T901 docs already on reports (added before this fix, with empty `issuer_key` because no variable existed) will keep their status. New T901 adds will collect `rent_income_monthly` and produce a non-empty issuer_key.

## 6. Proposed Solution

### 6a. Data fix — Airtable `documents_templates` row for T901

`PATCH` the T901 row in `documents_templates` to set `variables = "rent_income_monthly"`. **Applied during Phase D.** Record id intentionally redacted from this file per PII rule; recoverable via `curl … filterByFormula=template_id='T901'`.

### 6b. Code change — `frontend/assets/js/document-manager.js`

Define an explicit allowlist near the file's top-level constants and consult it in the dedup branch:

```js
const MULTI_INSTANCE_TEMPLATES = new Set(['T901', 'T902']);
…
const userVars = (tpl.variables || []).filter(v => v !== 'year' && v !== 'spouse_name');
const isMultiInstance = MULTI_INSTANCE_TEMPLATES.has(tpl.template_id);
if (!isMultiInstance && userVars.length === 0 && existingTemplateIds.has(tpl.template_id)) continue;
```

Defense-in-depth: even if a future Airtable edit accidentally clears T901/T902's `variables` again, the dropdown will still show them.

### 6c. Cache-bust — `frontend/document-manager.html`

Bump `document-manager.js?v=384` → `?v=408`.

### Files Changed

| File | Action | Why |
|------|--------|-----|
| Airtable `documents_templates` (T901 row) | PATCH | Set `variables = "rent_income_monthly"` to match docs/SSOT |
| `frontend/assets/js/document-manager.js` | Modify (2 spots) | Add `MULTI_INSTANCE_TEMPLATES` constant; add bypass in dedup loop |
| `frontend/document-manager.html` | Modify | Cache-bust to `?v=408` |

## 7. Validation Plan

* [ ] **Diagnostic readouts captured** (Section 4 table) — DONE during Phase D.
* [ ] Live test on the reporter's client (AR tab): open Doc Manager → Add Doc; both T901 and T902 render under the housing category.
* [ ] Add T901 once → fill `rent_income_monthly` → confirm T901 still appears in dropdown afterward (multi-instance).
* [ ] Add a second T901 with a different `rent_income_monthly` → both chips render distinctly with different per-property labels.
* [ ] Add T902 once → confirm T902 still appears (regression check; was already working).
* [ ] **Regression — single-instance templates still hidden:** open another client; add a no-variable template that is NOT in the allowlist (e.g., a no-vars T-row); after add, confirm it disappears from the dropdown (existing behavior preserved).
* [ ] **PA queue parity (same client in Pending Approval):** open the PA cockpit; add T901 twice with different `rent_income_monthly`; confirm no "duplicate" warning and both chips persist.
* [ ] **Cache-bust shipped:** `curl -sI https://docs.moshe-atsits.com/document-manager.html | grep document-manager.js` shows `?v=408`.
* [ ] **Hebrew RTL render check:** chips show distinct property identifiers; no visual collision.

## 8. Implementation Notes

- Diagnostic confirmed Branch A from the plan (data drift on T901 only).
- Code change applied in addition to data fix as defense-in-depth — the allowlist documents the multi-instance intent in code instead of relying on the Airtable variable being set forever.
- PA queue requires **no code change** — its `paDocIsDuplicate` already keys on issuer_key, which is now distinguishing once T901 has its variable populated.
- **Future work (NOT in this DL):** add a `multi_instance` boolean field to `documents_templates` in Airtable, replace the hardcoded `MULTI_INSTANCE_TEMPLATES` set with a data-driven flag, and surface it via the API mapping in `api/src/routes/documents.ts:269-284`. Deferred — current allowlist is 2 templates, schema migration is out of scope for a bug fix.
- **Open question for Natan:** are there other contract templates that should be multi-instance (e.g., bank loan agreements, business lease contracts)? If yes, append their template_ids to `MULTI_INSTANCE_TEMPLATES` in a follow-up.
