# Design Log 337: Show Raw Client Email Text Instead of AI Summary (AI Review Tab)
**Status:** [BEING IMPLEMENTED — DL-337]
**Date:** 2026-04-23
**Related Logs:** DL-199 (client communication notes), DL-259 (notes at all stages), DL-262 (inbound note quality), DL-204 (digest summarization)

## 1. Context & Problem
The AI-generated Hebrew summary of inbound client emails is unreliable enough that we no longer want to rely on it in the admin UI.

Representative failure pattern observed on a real inbound email (2026-04-23): client wrote ~300 chars of Hebrew covering three substantive points — (1) attached docs + per-file passwords, (2) action request ("tell me if anything is missing or if the insurance docs look wrong"), (3) business-state reminder about still holding a company with no dividends/salaries drawn. The one-sentence AI summary collapsed this to a sentence about "attached docs + passwords for form 106", dropping the action request and business-state entirely, and associating the password with the wrong form of the two mentioned.

The raw email text is already persisted to Airtable (`client_notes[].raw_snippet`, up to 1000 chars) and the Dashboard Recent Messages panel + Pending-Approval modal already prefer `raw_snippet` over `summary`. The **AI Review tab's client-notes timeline is the one remaining admin surface that still renders `summary` only** — that's the sole fix.

Doc-Manager stays as-is (explicit carve-out requested by user; its "סיכום AI:" label remains for office deep-dive).

## 2. User Requirements
1. **Q:** What is the specific failure mode?
   **A:** Summary garbles facts + misses action items. Fix direction narrowed to: replace the AI summary with the raw message text on every surface where it's shown, **except doc-manager.html**.
2. **Q:** Preferred fix direction?
   **A:** Originally "raise length + improve prompt", refined to "just display the raw text — the summarizer is unreliable, raw is already persisted".
3. **Q:** Scope?
   **A:** Inbound email notes only. No digest change.
4. **Q:** Other examples to check first?
   **A:** Airtable sample pulled (see Section 3). Confirms summary can drop/garble substantive content.

## 3. Research
### Domain
UX — error surfaces and trust when an AI-generated artifact is unreliable. Closest tier: "show the source, hide the estimate".

### Sources Consulted
Reused prior research — no fresh external sources needed:
1. **DL-199** — established the client-notes timeline pattern in AI Review tab.
2. **DL-261 / DL-263** — established `raw_snippet || summary` fallback in Dashboard Recent Messages + delete-and-raw-text affordance.
3. **DL-262** — prior effort to improve summary quality at the LLM level. Conclusion then: raise quality. Conclusion now: even with higher quality, the user can't verify the summary at a glance and prefers the source text. One-shot raw-text display is both cheaper and more trustworthy.

### Sample from Airtable (Client_Notes JSON in Reports table)
15 recent inbound items inspected. Majority are accurate on document-level facts (amounts, org IDs, template identification) but conversational client emails — the ones the AI Review tab timeline surfaces — routinely drop context the office worker needs: action requests, payment terms, password-to-file bindings, business-status mentions. The raw_snippet (≤1000 chars) already covers the typical client email in full.

### Key Principles Applied
- **Show the source when the estimate is cheap to verify and the source is short.** Raw emails here are usually < 1000 chars → no reason to summarize in the UI.
- **Uniformity across admin surfaces.** DL-337 brings the AI Review tab in line with Dashboard + Pending-Approval modal.
- **Do not delete the summarizer.** Doc-Manager still uses it; the digest still uses it; keep the write path intact.

### Patterns Reused
- **Fallback render pattern:** `raw_snippet || summary || ''` — copied verbatim from `script.js:1083` and `:7521`.

### Anti-Patterns Avoided
- Removing the summarizer altogether (would also break doc-manager and daily digest).
- Adding a new Airtable field (raw_snippet already stored).
- Backfilling historical rows (fallback handles it).

### Research Verdict
Single-line render change + cache-bump. No backend, no schema, no model tuning. Keeps the summarizer for the exempt surfaces (doc-manager, digest).

## 4. Codebase Analysis
### Existing Solutions Found
- `api/src/lib/inbound/processor.ts:414` — already writes `raw_snippet: (cleanText || cleanBody).substring(0, 1000)` on every note. No backend change needed.
- `frontend/admin/js/script.js:1083` — Dashboard Recent Messages: `const displayText = m.raw_snippet || m.summary || ''`.
- `frontend/admin/js/script.js:7521` — Pending-Approval modal Notes: `(m.raw_snippet || m.summary || m.text || '').toString().trim()`.

### Reuse Decision
Copy the existing fallback pattern into `script.js:4034` (the AI Review tab's timeline render). No new helpers, no refactor.

### Relevant Files
- `frontend/admin/js/script.js` — only change site (line 4034).
- `frontend/admin/index.html` — cache-bump `?v=NNN`.
- `frontend/assets/js/document-manager.js` — **exempt**, confirmed NOT modified.

### Existing Patterns
Timeline entries (`.ai-cn-entry`) render 5 previews + expandable tail. `cnArr.filter(n => n.type !== 'office_reply')` at line 4022 already excludes office replies from this timeline, so the fallback only affects client email notes + manual office notes.

### Alignment with Research
This brings the third admin surface in line with the first two — consistent fallback everywhere outside doc-manager.

### Dependencies
- Airtable `Reports.client_notes` JSON (existing).
- No workflows touched.

## 5. Technical Constraints & Risks
- **Security:** Raw email text is already surfaced in Dashboard + PA modal for the same user population — no new PII exposure.
- **Risk — multi-line raw_snippet layout:** `raw_snippet` may contain newlines. Dashboard's `.msg-summary` handles this. AI Review's `.ai-cn-summary` may need `white-space: pre-wrap` — flagged in Section 7 for visual verification, CSS patch added only if required.
- **Risk — legacy notes without raw_snippet:** fallback to `summary` handles them; no regression.
- **Risk — manual office notes (source !== 'email'):** they have no `raw_snippet`, fall back to `summary` — unchanged.
- **Breaking changes:** none. Backend untouched, schema untouched.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
The same inbound client email, rendered across Dashboard Recent Messages, Pending-Approval modal Notes section, and AI Review tab client-notes timeline, shows identical raw client text. Doc-Manager still shows the AI summary with "סיכום AI:" label.

### Logic Flow
1. `renderEntry` in AI Review tab (around line 4025 of script.js) changes display value from `n.summary` to `n.raw_snippet || n.summary || ''`.
2. Everything else — sort, filter, icons, expand toggle — unchanged.

### Data Structures / Schema Changes
None.

### Files to Change
| File | Action | Description |
|---|---|---|
| `frontend/admin/js/script.js` | Modify | Line 4034: swap `${escapeHtml(n.summary)}` for `${escapeHtml(n.raw_snippet \|\| n.summary \|\| '')}` |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=NNN` cache-bust |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-337 entry under ai-review |
| `.agent/current-status.md` | Modify | Add DL-337 test TODO + Section 7 items |

### Final Step (Always)
- Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, INDEX updated, current-status updated, commit + push feature branch, PAUSE for merge approval.

## 7. Validation Plan
- [ ] AI Review tab for the trigger email shows the full raw Hebrew note — no AI summary.
- [ ] Side-by-side: Dashboard Recent Messages + Pending-Approval modal + AI Review tab all show identical raw text for the same note.
- [ ] Doc-Manager for CPA-XXX: AI summary with "סיכום AI:" label still visible (exempt surface untouched).
- [ ] Legacy note (pre-raw_snippet era) still renders via fallback to summary.
- [ ] Long / multi-paragraph raw_snippet renders without breaking `.ai-cn-entry` layout. If it does: add `white-space: pre-wrap` and a `max-height` with overflow scroll on `.ai-cn-summary`.
- [ ] Expand-all toggle + "Open in Doc Manager" button still work.
- [ ] Hard reload admin → new `?v=NNN` serves, DevTools confirms no stale script.
- [ ] Manual office note (no raw_snippet) still renders via `summary` fallback.

## 8. Implementation Notes (Post-Code)
- Applied fallback pattern from `script.js:1083`. Single-line change.
- No CSS change shipped in this PR. CSS adjustment gated on Section 7 visual check.
- Summarizer preserved end-to-end — doc-manager and daily digest unchanged.
