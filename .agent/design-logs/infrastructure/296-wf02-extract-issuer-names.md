# Design Log 296: WF02 — Extract Issuer Names from Questionnaire Free-Text Context
**Status:** [IMPLEMENTED — NEED TESTING] (✨ accept chip disabled pending UX rework — see 2026-04-17 update)
**Date:** 2026-04-17

> **2026-04-17 update (DL-300 follow-up):** the frontend ✨ accept chip shipped by this log is **disabled on both surfaces** (PA card + doc-manager) in commit `ca3e7d5`. Accept overwrote `issuer_name` with the bare short form (e.g. "לאומי"), which then rendered as the entire doc-row label — the template prefix ("טופס 867 (אישור ניכוי מס) לשנת 2025 …") was lost because `doc-builder.ts:293` resolves the label as `issuer_name ?? template.name_he`. The backend (`/webhook/extract-issuer-names`, this log's WF02 wiring) still runs and writes `issuer_name_suggested` for opted-in templates (DL-300 gate); only the UI chip is hidden. Re-enabling = replace the `suggestion = ''` stubs in `frontend/admin/js/script.js` + `frontend/assets/js/document-manager.js` with the original reads, *after* the accept path is reworked to re-compose via `buildShortName(templateId, issuer)` or equivalent.
**Related Logs:** DL-112 (webhook dedup + issuer display), DL-129 (dynamic short names), DL-136/144 (issuer matching fixes), DL-224 (issuer-aware doc lookup), DL-275 (WF02 zero-docs fix), DL-292 (Review & Approve queue tab), DL-294/295 (PA queue doc_chips schema)

**Numbering note:** Built on branch `DL-293-wf02-extract-issuer-names` when DL-293 was unassigned. Renumbered to DL-296 at merge time after `admin-ui/293-doc-manager-edit-client.md` landed on main in parallel. In-flight artifacts (n8n node IDs `dl293-build-payload`/`dl293-call-extract`, commit messages, code comments) keep the DL-293 label for traceability — they map to this log.

## 1. Context & Problem

WF02 (`[02] Response Processing`) runs when a Tally questionnaire is submitted. It calls the Document Service sub-workflow, which synthesises a list of required documents from the client's free-text answers and writes them back to Airtable (table `tblcwptR63skeODPn`). For documents tied to an employer, broker, bank, or similar entity, **the Document Service currently stuffs the client's raw sentence into the `issuer_name` field** — no entity extraction.

**Symptom seen in the client email** (Request Documents email, Hebrew):
```
📝 טופס 867 (אישור ניכוי מס) לשנת 2025 – אני משקיע במניות בחברת אינטראקטיב ואני עובד שם
   עם חברה שמנקה לי מס על כל רווח במנייה
💼 טופס 106 לשנת 2025 – עבדתי כשכיר בבר בתל אביב שנקרא ג'ויה חודשיים
```
The text after the em-dash is the entire free-text answer. The **actual issuer** (`אינטראקטיב`, `ג'ויה`) is buried inside.

**Downstream consequences:**
- Client-facing `view-documents` page and Request-Docs / reminder emails render full sentences instead of compact issuer labels — noisy, hard to scan.
- Admin Review & Approve queue (DL-292) `pa-card`s show truncated sentences as doc chips — DL-292 already applies `cleanDocName()` to strip `{...}` placeholders, but can't strip prose.
- AI Review card names and combobox short-names (DL-129/135) degrade for the same reason.
- Issuer-aware classification matching (DL-136/144/224) can't lean on `issuer_key`/`issuer_name` because both hold prose — so AI has less signal when binding an inbound attachment to the right required-doc slot.

## 2. User Requirements

1. **Q:** At what point should extraction + issuer suggestion happen?
   **A:** **WF02 at stage entry (pre-compute)** — extract during WF02 before writing to Airtable, so `issuer_name` lands clean everywhere downstream (emails, admin UI, AI Review, classification matching).

2. **Q:** How should the issuer name be extracted?
   **A:** **Claude API (LLM prompt)** — handles Hebrew variety (`בחברת X`, `שנקרא X`, `בבנק X`, `אצל X`, `עבור X`) without brittle regex. Use Haiku 4.5 with tool use for structured output (same pattern as `document-classifier.ts`).

3. **Q:** What should be updated when an issuer is extracted?
   **A (revised):** Two-stage write.
   - **At extraction time (WF02 / Worker):** store the extracted short name in a new field `issuer_name_suggested`; **preserve the original raw context by appending it to `bookkeepers_notes`** (the existing per-doc note field — DL-builder.ts:29) so nothing is lost even if admin never accepts. `issuer_name` itself is NOT mutated yet.
   - **At admin 1-click accept (Review & Approve card):** `issuer_name ← issuer_name_suggested`, then clear `issuer_name_suggested`. `bookkeepers_notes` already holds the original context from extraction.
   - **No click → no change to `issuer_name`.** Email / `view-documents` render as today. `issuer_key` regen and OneDrive rename remain out of scope for v1.

4. **Q:** Scope?
   **A:** **Annual Reports templates only** — the screenshot pain-point (T867, T106, T601, T501, T806, T301, T901/902, …). CS is excluded for v1 (DL-241 already uses issuer placeholders in short_name; revisit later).

## 3. Research

### Domain
LLM-based structured information extraction (NER-adjacent) on Hebrew free-text, with tool-use–forced schemas; ingestion-time enrichment (compute once, store result) vs query-time extraction.

### Sources Consulted
1. **Anthropic tool use / structured output docs** — `tool_choice: {type: "tool", name: "..."}` forces the model to return exactly the declared JSON schema, eliminating the fragile "parse JSON from free-form text" step. Already used repo-wide in `document-classifier.ts:696` (`tool_choice: { type: 'tool', name: 'recover_template' }`).
2. **Anthropic "prompt engineering for Hebrew / RTL content"** — Haiku 4.5 handles Hebrew entity extraction well when the system prompt: (a) pins the task ("extract the single most salient organisation/employer/broker/bank name"), (b) enumerates negative examples ("do NOT return job titles, cities, or generic nouns"), (c) allows a `null` return for "no identifiable issuer".
3. **DDIA ch. 10 (Martin Kleppmann) — "Batch processing and materialised views"** — store the derived value once at ingestion time rather than recomputing on every read. Matches the user's chosen trigger: do it in WF02, persist to Airtable, every downstream read stays zero-cost.
4. **Repo precedents:** `api/src/lib/inbound/document-classifier.ts` (classification + recovery agent patterns), `api/src/lib/inbound/client-identifier.ts` (Haiku-based Hebrew entity matching against a candidate list), `api/src/routes/chat.ts` (Claude API fetch with retry).

### Key Principles Extracted
- **Force the output shape via `tool_choice`.** Never parse JSON out of free-form Claude text for a system-critical field — use tools. (Applied: single tool `extract_issuer_name`, `required: ['issuer_name', 'confidence']`.)
- **Allow `null` and enforce confidence floor.** Many `T106` context strings will describe the employment relationship without naming the employer ("עבדתי חצי שנה במפעל"). Return `null` + low confidence → we fall back to template name, avoiding garbage in `issuer_name`. Mirrors `document-classifier.ts:729` (`confidence < 0.5 → return null`).
- **Batch per report, not per doc.** One Claude call per report with all its enrichable doc contexts is dramatically cheaper than N calls — and gives the model cross-doc context (a client who mentions "אינטראקטיב" in one doc likely means the same broker if another doc references "הברוקר שלי").
- **Compute at write time (WF02), not at read time.** The user's chosen trigger — consistent with DDIA materialised-view principle. Every email, every admin render, every classification match benefits without added latency.

### Patterns to Use
- **Tool-use structured extraction** (Haiku 4.5 + forced tool) — same infrastructure as `document-classifier.ts`. Reuse `ANTHROPIC_API_KEY`, retry-with-backoff on 429.
- **Batch request / batch response by `doc_record_id`** — WF02 posts once with `{report_record_id, docs: [{doc_record_id, template_id, context_text, person}, ...]}`, endpoint returns `{results: [{doc_record_id, issuer_name|null, confidence}, ...]}`.
- **Server-side Airtable write from the Worker.** WF02's next node just inspects `ok`; no n8n Code-node branching needed (which is error-prone per `feedback_n8n_code_node_mode`).

### Anti-Patterns to Avoid
- **Per-doc HTTP fan-out from WF02** — 5–15 Claude calls per submission, 5–15 Airtable PATCHes, fragile. Batch instead.
- **Regex-only extraction** — Hebrew phrasings are too varied (`בחברת`, `שנקרא`, `בבנק`, `אצל`, `עבור`, possessive suffixes, nicknames). Rule-based misses are silent — admin won't notice `אינטראקטיב` lost, and the email still goes out ugly.
- **Writing extracted value to a NEW field and reading both everywhere** — doubles the render surface and every email template needs to change. The simpler migration: overwrite `issuer_name` at WF02 time. Clean text wins.
- **Mutating existing records retroactively without guardrail** — leave stage-advanced reports alone; only new submissions go through the new path. Optional one-shot backfill script documented in Section 7, not auto-run.

### Research Verdict
Add a new Worker endpoint `POST /webhook/extract-issuer-names` that accepts a batch (all enrichable docs for one report), calls Claude Haiku 4.5 with a forced tool-use schema, and writes extracted values to a **new `issuer_name_suggested`** Airtable field (NOT `issuer_name`). WF02 calls this after `Upsert Documents` succeeds. The Review & Approve queue card (DL-292, stage 3 = Pending_Approval — exactly when the admin is already inspecting every doc) renders the suggestion as a bold inline chip with a single ✓ click that promotes the suggestion to `issuer_name` and clears `issuer_name_suggested`. No click → field stays as-is, Request-Docs email / reminders render raw context (status quo). This keeps every decision reversible and puts the admin in control of what the client eventually sees in the email and `view-documents` page after approve-and-send.

## 4. Codebase Analysis

### Existing Solutions Found
- `api/src/lib/inbound/document-classifier.ts:682-736` — **exact pattern we want**: Haiku 4.5 + `tool_choice: {type:'tool', name:'recover_template'}` + 429 retry + confidence floor + `null` on low-confidence. Copy-adapt for issuer extraction.
- `api/src/lib/inbound/client-identifier.ts:33-34` — Haiku 4.5 identifier constants (`ANTHROPIC_API_URL`, `ANTHROPIC_MODEL`) reusable.
- `api/src/lib/airtable.ts` — `AirtableClient` with batch PATCH support; see `classifications.ts` / `edit-documents.ts` for update idioms.
- `api/src/lib/error-logger.ts` — `logError(ctx, env, {endpoint, error, category})` standardised error path (DL-180).
- `api/src/routes/admin-pending-approval.ts:41` — `cleanDocName()` regex (stripping placeholders) is downstream. After DL-293 ships, most doc chips will already be clean prose; cleanDocName stays as defense-in-depth.
- `api/src/routes/_template.ts` — Hono route skeleton to copy.

### Reuse Decision
- **Reuse:** Haiku-4.5 + tool-use pattern from `document-classifier.ts`; `AirtableClient`; `logError`; `_template.ts` route skeleton; the `verifyToken` auth helper used by all `/webhook/*` endpoints.
- **Build new:** the route `api/src/routes/extract-issuer-names.ts` (thin), the prompt + tool schema, the batch-response type, WF02 n8n node(s).

### Relevant Files
| File | Why |
|------|-----|
| `api/src/routes/extract-issuer-names.ts` | **NEW** — the endpoint itself |
| `api/src/index.ts` | Register route |
| `api/src/lib/types.ts` | Already has `ANTHROPIC_API_KEY` in `Env` |
| n8n WF02 (`QqEIWQlRs1oZzEtNxFUcQ`) | Insert HTTP Request node after `Upsert Documents` |
| *(no frontend changes)* | Admin UI reads `issuer_name` directly — already handles clean + prose strings via `cleanDocName()` |

### Existing Patterns
- Worker endpoints that WF02 calls: `/webhook/admin-pending-approval` (DL-292), `/webhook/admin-pending`, `/webhook/classifications`. All use `Bearer` header token + `verifyToken` — DL-293 follows suit.
- Claude calls are synchronous from inside Worker request handlers (see `document-classifier.ts`, `chat.ts`). CPU budget: a single Haiku call is ≈1–3 s; batching 10 docs in one call stays well under the 30 s Worker CPU limit. Not CPU-heavy enough to warrant Cloudflare Queues (cf. DL-287).

### Alignment with Research
- DDIA materialised-view principle → WF02 pre-compute matches.
- Force-tool-use → exactly the existing repo idiom.
- Batch-per-report → mirrors `document-classifier.ts` processing of all attachments together.

### Dependencies
- Airtable table `tblcwptR63skeODPn` (Documents) — PATCH `issuer_name` on existing records.
- `ANTHROPIC_API_KEY` (already bound).
- `SECRET_KEY` for `verifyToken`.
- n8n WF02 — one HTTP Request node + existing `Upsert Documents` output pins.

## 5. Technical Constraints & Risks
* **Security:** No PII leaves the system that isn't already leaving it (questionnaire text already goes to Tally, Airtable, MS Graph email). Auth via `verifyToken`, same bar as sibling endpoints. Do **not** log raw context text to the error-logger; log doc counts + template_ids only.
* **Risks:**
  - **Wrong entity extracted** (e.g. picks "תל אביב" instead of "ג'ויה"): mitigated by negative examples in the system prompt + confidence floor of 0.5; fall back to template name on low confidence (current behaviour — no regression).
  - **Haiku outage / 429s**: retry with exponential backoff (already in `document-classifier.ts` — copy). On terminal failure: skip extraction, leave `issuer_name` as raw text (current state — graceful degradation, not a new failure mode).
  - **Latency bump on WF02**: +1–3 s for Haiku call. WF02 is a background pipeline, not user-facing — acceptable. Admin email still lands within seconds.
  - **Budget**: Haiku 4.5 at ~10 docs/report and ~300 input tokens per batch ≈ $0.0002/report. Negligible relative to WF05 classifier spend.
* **Breaking changes:** None. Downstream renderers already handle any string in `issuer_name` (they fall through to template name if empty, and render raw if populated). No schema changes.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
After DL-293 ships, a new annual-report questionnaire submission triggers Haiku-based issuer extraction. The admin, reviewing the report on the Review & Approve queue (DL-292), sees a **bold ✨ suggestion chip** next to each enrichable doc (e.g. `✨ אינטראקטיב`, `✨ ג'ויה`). A **single click** promotes the suggestion to `issuer_name`, after which the doc chip, downstream emails, and `view-documents` render the compact label. The client's original free-text context is preserved in `bookkeepers_notes` and visible in the admin doc preview. No click → nothing changes — full admin control, fully reversible.

### Logic Flow

**A. Extraction (WF02 background, once per submission)**
1. WF02 `Upsert Documents` succeeds → insert new `Call Extract Issuer Names` HTTP Request node on the success pin **in parallel** to the existing email + stage-update branches (non-blocking — the email the client receives keeps using the raw context as today; extraction is only to populate the admin-side suggestion).
2. Worker `POST /webhook/extract-issuer-names`:
   - `verifyToken` gate.
   - Short-circuit: `docs.length === 0` → `{ok: true, suggested: 0}`.
   - One Claude Haiku 4.5 call with forced `tool_choice: {type:'tool', name:'extract_issuer_names'}`.
   - For each `result.confidence >= 0.5 && result.issuer_name !== null`: batch-PATCH Airtable Documents with:
     - `issuer_name_suggested = <extracted short name>`
     - `bookkeepers_notes = appendContextNote(existing, raw_context)` — prepends `"[תשובה מהשאלון] <raw_context>"` if not already present.
   - **Never** mutates `issuer_name`. Never logs raw context.
   - Returns `{ok: true, suggested: N, skipped: M, results: [...]}`.
3. If endpoint errors / times out: WF02 continues (Continue-on-Fail); no suggestions populated → status quo preserved, email still sends with raw context.

**B. Admin 1-click accept (DL-292 Review & Approve card, stage Pending_Approval)**
4. DL-292 endpoint `admin-pending-approval.ts` is extended to return `issuer_name_suggested` per doc chip (currently only returns `short_name_he`).
5. Frontend: when a doc chip has a non-empty `issuer_name_suggested`, render an inline **bold** sparkle chip next to the existing short-name chip:
   `<doc chip>  ✨ <b>אינטראקטיב</b>  ✓`
   The whole sparkle chip is a button — 1 click = accept.
6. Click handler calls **existing** `EDIT_DOCUMENTS` endpoint (`api/src/routes/edit-documents.ts`) with:
   `{doc_id, issuer_name: <suggestion>, issuer_name_suggested: ""}` — server writes both fields atomically, Airtable PATCH.
7. Optimistic UI: sparkle chip slides out, primary doc chip updates its label to the accepted short name. `showAIToast("שם הגורם המנפיק עודכן", "success")`.
8. **Optional affordance (v1 ship):** a small "✨ אשר הכל" (Accept all) link at the bottom of the card's doc section if there are 2+ suggestions — single click PATCHes every suggested doc in one batch (still 1-click UX for admins with many suggestions).
9. Reject / dismiss (non-goal for v1): if the suggestion is wrong, admin simply doesn't click. The chip stays until they either accept it or manually edit `issuer_name` via the existing inline-rename flow (DL-080). On manual edit, we clear `issuer_name_suggested` server-side so the chip disappears.

### Data Structures / Schema Changes
**ONE new Airtable field** on Documents table (`tblcwptR63skeODPn`):
- `issuer_name_suggested` — Single line text. Written by the extraction endpoint. Cleared when admin accepts. Never read by email templates / client-facing renderers — admin-only.
- Optional: `issuer_name_suggested_confidence` (number) if we want to colour-code low-confidence suggestions (defer; start without).

**Reuses** existing `bookkeepers_notes` field — extraction endpoint appends `"[questionnaire context]\n<raw_context>"` to it (joined with `\n\n` if already populated) so the client's full sentence is preserved even if the admin never accepts. Admin-only field; already rendered in doc-manager / Review & Approve preview.

No change to existing `issuer_name` semantics. Existing renderers unaffected until admin accepts.

**Request shape:**
```json
{
  "report_record_id": "recXXXX",
  "year": 2025,
  "docs": [
    { "doc_record_id": "recA1", "template_id": "T867",
      "raw_context": "אני משקיע במניות בחברת אינטראקטיב ואני עובד שם עם חברה שמנקה לי מס",
      "person": "client" },
    { "doc_record_id": "recA2", "template_id": "T106",
      "raw_context": "עבדתי כשכיר בבר בתל אביב שנקרא ג'ויה חודשיים",
      "person": "client" }
  ]
}
```

**Response shape:**
```json
{ "ok": true, "updated": 2, "skipped": 0,
  "results": [
    { "doc_record_id": "recA1", "issuer_name": "אינטראקטיב", "confidence": 0.92 },
    { "doc_record_id": "recA2", "issuer_name": "ג'ויה", "confidence": 0.88 }
  ]
}
```

**Tool schema (Claude):**
```json
{
  "name": "extract_issuer_names",
  "description": "Return the extracted issuer name for each requested doc. Use null when no organisation name is identifiable.",
  "input_schema": {
    "type": "object",
    "properties": {
      "results": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "doc_record_id": {"type": "string"},
            "issuer_name": {"type": ["string", "null"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1}
          },
          "required": ["doc_record_id", "issuer_name", "confidence"]
        }
      }
    },
    "required": ["results"]
  }
}
```

### System Prompt (draft)
```
You extract the single most salient ORGANISATION name (employer, broker, bank, insurance
company, pension fund, tax authority, or similar entity) from a Hebrew free-text
context describing the client's relationship with that entity.

For each doc below, return {doc_record_id, issuer_name, confidence}.

Rules:
- Return ONLY the organisation name, stripped of prefixes like "חברת", "בבנק", "אצל",
  "בחברת", "שנקרא", "של", and possessive suffixes. Example: "בחברת אינטראקטיב" → "אינטראקטיב".
- Do NOT return: job titles, cities ("בתל אביב"), generic nouns ("בר", "חברה", "בנק"),
  date ranges, or amounts.
- If no organisation is identifiable, return issuer_name: null.
- Confidence ≥ 0.8 only if the entity is explicitly named in the context.
- For banks/insurers, prefer the common short form (e.g. "בנק לאומי", "מגדל", "הפניקס").

Template hints (informs which entity type is expected):
- T106: employer (מעסיק)       - T867: broker / investment company
- T806: employer (מעסיק)       - T601: bank
- T501: insurance / pension    - T901/T902: landlord / tenant
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| Airtable Documents table | Schema | Add field `issuer_name_suggested` (single-line text) |
| `api/src/routes/extract-issuer-names.ts` | Create | The extraction endpoint — auth, batch Claude call, PATCH `issuer_name_suggested` + append to `bookkeepers_notes` |
| `api/src/index.ts` | Modify | Register route |
| `api/src/lib/doc-builder.ts` | Modify | Add `issuer_name_suggested?: string` to `DocFields` interface; **do NOT** add it to `CLIENT_SAFE_FIELDS` (admin-only) |
| `api/src/routes/admin-pending-approval.ts` | Modify | Include `issuer_name_suggested` in each doc chip payload |
| `api/src/routes/edit-documents.ts` | Verify | Confirm it already accepts `issuer_name` + `issuer_name_suggested` updates; if not, whitelist |
| `frontend/admin/js/script.js` | Modify | DL-292 pa-card: render bold ✨-suggestion chip when `issuer_name_suggested` present; click handler → `EDIT_DOCUMENTS` PATCH `{issuer_name, issuer_name_suggested: ""}`; optimistic UI; optional "accept all" link |
| `frontend/admin/css/style.css` | Modify | `.pa-suggestion-chip` styling — bold, subtle sparkle background, hover state |
| n8n WF02 (`QqEIWQlRs1oZzEtNxFUcQ`) | Modify | After `Upsert Documents` success: add Code "Filter AR Enrichable Docs" + HTTP Request "Call Extract Issuer Names" (Continue-on-Fail, `contentType: raw`, pre-stringified body per memory `n8n HTTP Request — HTML in JSON Body`). Parallel to — not blocking — the existing email branch. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-293 row |

### Final Step (Always)
* **Housekeeping:** Update DL-293 status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `current-status.md`, commit. **Pause before push/merge** (per `feedback_ask_before_merge_push`).

## 7. Validation Plan
* [ ] **Extraction:** Submit a test Tally questionnaire with known contexts (`אינטראקטיב`, `ג'ויה`, `בנק לאומי`, plus one deliberately unnamed: "עבדתי 3 חודשים במפעל"). Verify Airtable: `issuer_name_suggested` = `אינטראקטיב` / `ג'ויה` / `בנק לאומי` / empty (for the unnamed); `issuer_name` unchanged; `bookkeepers_notes` has `[תשובה מהשאלון] <raw>` appended on the 3 confident docs.
* [ ] **Admin UI — suggestion chip:** Open Review & Approve queue (DL-292) for the test report. Each suggested doc shows a bold ✨ chip with the short name. Non-suggested docs (template default or unnamed) show no chip.
* [ ] **Admin UI — 1-click accept:** Click the ✨ chip on one doc. Optimistic UI removes the chip; primary doc chip re-renders with the short name. Toast appears. Airtable: `issuer_name` updated, `issuer_name_suggested` cleared, `bookkeepers_notes` still holds the raw context.
* [ ] **Admin UI — accept all:** On a card with 2+ suggestions, the "✨ אשר הכל" link appears. Click → all docs updated in one batch; chips all disappear.
* [ ] **Email downstream:** After admin clicks ✓ on a suggestion and later runs Approve & Send, the Request-Docs email for that doc shows the compact issuer label instead of the long sentence.
* [ ] **No-click path:** Don't click any suggestion. Run Approve & Send anyway — email renders as today with raw context. No regression.
* [ ] **Manual edit clears suggestion:** Use the existing inline rename (DL-080) to set `issuer_name` manually → server also clears `issuer_name_suggested` → chip disappears.
* [ ] **Extraction endpoint empty path:** `{ok: true, suggested: 0}` for a report with zero enrichable docs (all "no" answers / non-issuer templates).
* [ ] **Extraction endpoint failure path:** Anthropic unreachable → `{ok: false}` + `logError`; WF02 Continue-on-Fail keeps the flow alive; email sends as today.
* [ ] **Auth:** Unauthorised Bearer → `{ok: false, error: 'unauthorized'}`, no Claude call.
* [ ] **No regression on legacy reports:** A pre-DL-293 `Pending_Approval` report (no `issuer_name_suggested` populated) renders the queue card exactly as before — no chip, no crash.
* [ ] **Budget:** Watch Haiku token usage in Anthropic console over 10 submissions; confirm ≤ 500 input tokens/batch on typical loads.
* [ ] **Backfill (deferred):** One-shot script that iterates existing `Pending_Approval` reports with long `issuer_name` values and calls the endpoint — documented for a follow-up DL so admins can approve historical suggestions.

## 8. Implementation Notes (Post-Code)
*Append deviations, research principles applied, and ordering notes during implementation.*

**Ordering resolved by revised design:** Extraction runs **after** `Upsert Documents`, parallel to email branch. Non-blocking.

**No-op rule corrected mid-build:** initial impl normalised Hebrew prefixes when deciding whether a suggestion was redundant; user flagged that "בלאומי"→"לאומי" IS a useful improvement. Rule changed to suppress only when suggestion is LITERALLY equal to existing `issuer_name` after HTML+whitespace strip. Any real text change (including prefix cleanup) surfaces as a chip.

**Auth:** reused existing `N8N_INTERNAL_KEY` (same secret used in inbound-email + outbound Worker→n8n calls). Worker accepts either that bearer OR an HMAC admin token — one-secret-two-directions pattern matches repo convention.

**Scope expansion — doc-manager chip (post-ship refinement):**
User asked why the ✨ chip wasn't visible on the doc-manager page. DL-296 originally only wired the chip onto the DL-292 Review & Approve queue card. Added a second rendering surface on `frontend/assets/js/document-manager.js`:
- Placement: indented row **below** `.document-item` (inside `.document-wrapper`), gated on `issuer_name_suggested` non-empty AND `effectiveStatus === 'Required_Missing'` AND `!isWaived` AND `!isNameChanged` (no double-chip once a manual rename is queued).
- Accept handler `acceptDocManagerIssuerSuggestion()` uses doc-manager's existing queued-edit pattern (`nameChanges.set(docId, suggestion)`) rather than an immediate PATCH — consistent with the rest of doc-manager's "edit, then save all" UX. Server-side, `edit-documents.ts`'s `name_updates` branch already clears `issuer_name_suggested` (wired in the original DL-296 implementation).
- CSS: `.dm-suggestion-row` + `.dm-suggest-chip` added to `frontend/assets/css/document-manager.css`, visually parallel to `.pa-suggest-chip` from DL-292 but distinct class names (doc-manager doesn't load admin's style.css).
- User ruled out other admin surfaces for now: doc-manager + Review & Approve queue only.

**Production steps applied in this session:**
- Airtable field `issuer_name_suggested` created via Meta API (`flduGQ8NvmTVEN8Ik`).
- Worker deployed: `annual-reports-api` version `292e9c32-c882-48d6-b124-a963998cb793`.
- WF02 (`QqEIWQlRs1oZzEtNxFUcQ`) patched via n8n public REST API (`scripts/dl293-patch-wf02.py`) — added 2 nodes + 1 connection chain after Upsert Documents, workflow remained active throughout. Side-effect: `availableInMCP` reset to False (public-API PUT whitelist doesn't include it); re-enable in n8n UI if needed for MCP reads.
- Smoke test: `/webhook/extract-issuer-names` returns 401 without bearer, 200 `{ok:true, suggested:0, skipped:0, results:[]}` with the internal key and an empty batch.
