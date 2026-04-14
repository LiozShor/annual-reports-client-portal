# Design Log 132: God Component Refactoring — Risk Analysis
**Status:** [DRAFT]
**Date:** 2026-03-09
**Related Logs:** DL-044 (error handling architecture), DL-037 (admin portal UX refactor)
**Type:** Risk Analysis (no implementation — decision document)

## 1. Context & Problem

The god component audit identified 3 files totaling 8,590 LOC that violate single-responsibility:

| # | File | Lines | Severity |
|---|------|-------|----------|
| 1 | `admin/js/script.js` | 5,719 | CRITICAL |
| 2 | `assets/js/document-manager.js` | 2,026 | HIGH |
| 3 | `n8n/workflow-processor-n8n.js` | 845 | MEDIUM |

This analysis evaluates refactoring risk for each, given:
- **No test coverage** (solo dev, manual QA only)
- **Production system** serving 500+ CPA firm clients
- **Active tax season** with daily development
- **Vanilla JS** (no bundler, `<script>` tag loading)
- **n8n Code nodes** contain copy-pasted logic (not loaded at runtime)

---

## 2. Risk Analysis Per Component

### Component 1: `admin/js/script.js` — 5,719 lines

#### Refactor Safety: 🔴 Dangerous

**Dependency map:**
- Loaded by: `admin/index.html` (single page)
- Depends on: `error-handler.js`, `resilient-fetch.js`, XLSX library, Lucide icons
- Depended on by: Nothing directly (but shares duplicated constants with `document-manager.js`)
- Global state: 8+ mutable globals (`clientsData`, `reviewQueueData`, `importData`, `existingEmails`, `showArchivedMode`, `currentSort`, `authToken`, `allRemindersData`)
- Function count: 191 functions, many reading/writing the same globals

**What breaks if refactor has a bug:**
- 🔴 **Admin portal goes down** — staff cannot manage clients, change stages, send questionnaires, review AI classifications, manage reminders, do bulk imports, or perform year rollover
- 🟡 Not client-facing (clients use `landing.js`, `view-documents.js`, `document-manager.js`)
- 🟡 Rollback is straightforward via `git revert` + push

**n8n-specific risks:**
- 15+ webhook endpoints hardcoded (`/admin-auth`, `/admin-dashboard`, `/admin-change-stage`, `/get-pending-classifications`, `/review-classification`, `/admin-reminders`, etc.)
- No endpoint registry — URLs scattered across functions
- Stage constants (`STAGES` object) duplicated between this file and `document-manager.js` — refactoring one without the other creates drift
- Reminder system functions interact with n8n reminder workflows — changing function signatures won't break n8n, but changing the payload shapes sent TO n8n will

**Why it's dangerous:**
1. **191 functions with shared mutable state** — splitting into modules requires defining a clean state contract. Every function that reads `clientsData` needs to access the same shared reference. With `<script>` tag loading (no ES modules, no bundler), you'd need to use `window.*` globals or a namespace object to share state across files.
2. **No module system** — Vanilla JS with `<script>` tags means you can't use `import/export`. Module splitting requires either: (a) a global namespace pattern, (b) adding a bundler (Vite/Rollup), or (c) switching to ES modules with `type="module"`. Each has its own migration cost.
3. **Active development hotspot** — This file was modified in sessions 127, 128, 129, 130, 132 (the last few days alone). Active feature work means refactoring collides with ongoing changes, increasing merge conflict risk.
4. **No tests** — With 191 functions, manual QA cannot verify that all interactions survive a split. One missed global reference = silent bug.

**Recommended action: 🚫 Leave as-is**

**Rationale:** The risk is not worth the benefit right now. The file is large but functional. Splitting it without a module system means trading one kind of complexity (large file) for another (cross-file global state management). Prerequisites before this becomes viable:
1. Add a bundler (Vite) or switch to ES modules — eliminates the global state sharing problem
2. Extract shared constants first (STAGES, status labels) into a `constants.js` — reduces coupling with `document-manager.js`
3. Wait for a natural lull in feature development

---

### Component 2: `assets/js/document-manager.js` — 2,026 lines

#### Refactor Safety: 🟡 Cautious

**Dependency map:**
- Loaded by: `document-manager.html` (single page, office use only)
- Depends on: `error-handler.js`, `resilient-fetch.js`, Lucide icons
- Depended on by: Nothing
- Global state: 12+ mutable globals (`currentGroups`, `currentDocuments`, `markedForRemoval`, `docsToAdd`, `statusChanges`, `noteChanges`, `sendEmailOnSave`, `apiTemplates`, `apiCategories`, `clientQuestions`, `REPORT_NOTES`, `CURRENT_STAGE`)
- Duplicated code: `sanitizeDocHtml()` also in `view-documents.js`, stage labels also in `script.js`

**What breaks if refactor has a bug:**
- 🟡 **Office document editor breaks** — staff can't review/edit/approve documents for clients
- 🟢 Not client-facing (clients see `view-documents.js` for read-only view)
- 🟡 Rollback is straightforward via `git revert` + push
- 🟡 Data loss possible if `confirmSubmit()` or `approveAndSendToClient()` break — sends incorrect data to Airtable

**n8n-specific risks:**
- 4 webhook endpoints: `/get-client-documents`, `/admin-update-client`, `/edit-documents`, `/admin-send-questionnaires`
- Payloads sent to `/edit-documents` contain complex nested data (doc additions, removals, status changes, notes) — any structural change here breaks the n8n workflow that processes it
- Less risky than script.js because this is a single-page editor with a clearer data flow (load → edit → save)

**Why cautious, not safe:**
1. **Same `<script>` tag limitation** — no module system means same global state sharing problem
2. **`confirmSubmit()` is a critical path** — this function assembles the payload that writes to Airtable. A bug here could corrupt client data.
3. **UI state management** — the `markedForRemoval`, `docsToAdd`, `statusChanges`, `noteChanges` sets/maps form a local state machine. Splitting these across files without careful coordination could break the "save all changes at once" pattern.

**Recommended action: ⏳ Refactor with guardrails — but only AFTER extracting shared constants (see Execution Plan below)**

**Safety plan:**
1. Start with extracting **only the duplicated code** — `sanitizeDocHtml()` and stage/status constants into a shared `constants.js`
2. Do NOT split the file into 7 modules as the audit suggests — this is too aggressive without a bundler
3. Instead, internally reorganize: group functions by concern with clear section comments, move utility functions to the top
4. If/when a bundler is added, THEN split into modules

---

### Component 3: `n8n/workflow-processor-n8n.js` — 845 lines

#### Refactor Safety: 🔴 Dangerous

**Dependency map:**
- This is a **reference file** — the actual running code is **copy-pasted into n8n Code nodes** in the `[SUB] Document Service` workflow (hf7DRQ9fLmQqHv3u)
- Not loaded by any HTML page
- Contains 98+ Tally field mappings (KEY_MAP), special-case business rules for 7+ document types
- Exports: `extractSystemFields`, `processAllMappings`, `prepareAirtablePayload`, `buildAnswersTableHtml`, `generateApprovalUrl`

**What breaks if refactor has a bug:**
- 🔴 **Questionnaire processing pipeline breaks** — Tally submissions don't generate correct documents
- 🔴 **Client data corruption** — wrong documents created in Airtable, wrong special-case rules applied
- 🔴 **Hard to detect** — bugs in document generation may produce subtly wrong output (missing pension docs, wrong foreign income rules) that aren't caught until a CPA reviews the case
- 🔴 **Client-facing** — generated documents appear in client portal and client emails

**n8n-specific risks:**
- 🔴 **Dual-update requirement** — refactoring this file means ALSO updating the n8n Code node. The CLAUDE.md explicitly warns: "When fixing doc-generation bugs: Always update BOTH if the fix involves generation logic."
- 🔴 **No version control on n8n side** — if the Code node update goes wrong, rollback requires manually restoring the previous Code node content
- 🔴 **Blast radius** — this code runs on every single Tally submission. A bug affects ALL new clients.
- 🟡 **Special-case business rules (lines 397-768)** are the hardest to verify — pension, foreign income, gambling, crypto, deposits, NII, Form 867 each have unique logic that requires domain knowledge to validate

**Why it's dangerous despite being the smallest file:**
1. **Every refactor requires two simultaneous updates** (GitHub file + n8n Code node) — this doubles the failure surface
2. **No automated testing** — the only way to verify is to submit a test Tally form and check the resulting Airtable records
3. **Business rules are implicit** — the special-case handlers encode CPA-specific tax rules that aren't documented outside the code. Breaking them means broken tax filings.
4. **Rollback is manual** — restoring a Code node in n8n requires finding the previous version and pasting it back

**Recommended action: 🚫 Leave as-is**

**Rationale:** This file has the highest consequence-per-line of any file in the project. Every line directly affects client-facing tax document generation. The audit suggests splitting into 5 modules, but with n8n Code nodes, you can't import modules — all logic must be in one code block. The only viable refactor would be internal reorganization (grouping functions, adding comments), which provides minimal value for the risk.

**Prerequisites before reconsidering:**
1. Write automated tests that submit test Tally payloads and verify output documents
2. Set up a staging n8n workflow for testing before updating production
3. Document the business rules in a separate spec so they can be verified after changes

---

## 3. What CAN Be Done Safely Now

Instead of splitting the god components, there are **low-risk, high-value extractions** that reduce coupling without restructuring:

### ✅ Extract shared constants — `shared/constants.js` (Risk: 🟢 Safe)

**What:** Move duplicated constants into a single file loaded before page-specific scripts:
- `STAGES` object (duplicated in `script.js` + `document-manager.js`)
- `STAGE_NUM_TO_KEY` mapping
- Status labels (`'Required_Missing'`, `'Received'`, `'Requires_Fix'`, `'Waived'`)
- `API_BASE` URL
- `ADMIN_TOKEN_KEY` constant

**Why safe:**
- No logic changes — just moving constants to a shared location
- Both pages already load `error-handler.js` + `resilient-fetch.js` before their main script — adding one more shared script is the same pattern
- If it breaks: constants are undefined → immediate, obvious errors → easy to catch in manual QA
- Rollback: trivial git revert

**Blast radius:** Zero n8n impact. HTML files need one additional `<script>` tag.

### ✅ Extract shared utilities — `shared/utils.js` (Risk: 🟢 Safe)

**What:** Move duplicated utility functions:
- `sanitizeDocHtml()` (duplicated in `document-manager.js` + `view-documents.js`)
- `sanitizeHelpHtml()` (if also duplicated)
- Any other pure utility functions with no state dependencies

**Why safe:** Pure functions with no side effects. Same loading pattern as constants.

### ✅ Create endpoint registry — `shared/endpoints.js` (Risk: 🟢 Safe)

**What:** Centralize all webhook URLs currently scattered across 5 files:
```javascript
const ENDPOINTS = {
  adminAuth: `${API_BASE}/admin-auth`,
  adminDashboard: `${API_BASE}/admin-dashboard`,
  // ... all 20+ endpoints
};
```

**Why safe:** Just string constants. If you miss replacing one URL, the old hardcoded URL still works — no silent failure.

---

## 4. Execution Order

| Step | Action | Risk | Depends On | Effort |
|------|--------|------|------------|--------|
| 1 | Extract `shared/constants.js` | 🟢 Safe | Nothing | 1 session |
| 2 | Extract `shared/utils.js` | 🟢 Safe | Nothing | 1 session |
| 3 | Extract `shared/endpoints.js` | 🟢 Safe | Step 1 (API_BASE) | 1 session |
| 4 | Internal reorg of `document-manager.js` | 🟡 Cautious | Steps 1-2 done | 2 sessions |
| 5 | Internal reorg of `script.js` | 🟡 Cautious | Steps 1-3 done | 3-4 sessions |
| — | Split `script.js` into modules | 🔴 Blocked | Add bundler first | Large |
| — | Refactor `workflow-processor-n8n.js` | 🔴 Blocked | Automated tests + staging workflow first | Large |

**Why this order:**
1. Steps 1-3 are safe extractions that immediately reduce duplication and coupling — the biggest "free wins"
2. Step 4 before Step 5 because `document-manager.js` is simpler (2K vs 5.7K lines) and serves as a practice run
3. Steps 1-3 are also prerequisites for Steps 4-5, because internal reorg is easier when shared constants are already extracted
4. Module splitting and n8n refactoring are blocked on infrastructure (bundler, test suite) that doesn't exist yet

---

## 5. Summary Decision Matrix

| Component | Safety | n8n Risk | Blast Radius | Action |
|-----------|--------|----------|--------------|--------|
| `script.js` (5,719 LOC) | 🔴 | Medium | Admin portal down | 🚫 Leave as-is (needs bundler first) |
| `document-manager.js` (2,026 LOC) | 🟡 | Low | Office editor broken | ⏳ Internal reorg after constants extracted |
| `workflow-processor-n8n.js` (845 LOC) | 🔴 | 🔴 Critical | Client data corruption | 🚫 Leave as-is (needs tests + staging first) |
| **Shared constants extraction** | 🟢 | None | None | ✅ Do now |
| **Shared utils extraction** | 🟢 | None | None | ✅ Do now |
| **Endpoint registry** | 🟢 | None | None | ✅ Do now |

**Bottom line:** Don't split the god components yet. Instead, extract the shared code between them (constants, utils, endpoints). This reduces coupling, eliminates duplication, and creates the foundation needed for safe splitting later — all with near-zero risk to production.
