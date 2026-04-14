# 014 - Architecture Audit and Cleanup Plan

## Date: 2026-01-26

## Executive Summary

**Current State:** The system has good SSOT foundations (document-types.js, questionnaire-mapping.js, document-display.js) BUT they are not fully adopted across all 4 consumption points. This creates a **ticking time bomb** where bugs will resurface.

**The Problem:** Workflow [02] has **68 nodes** and uses the display library, but workflows [03] and web pages (view-documents.html, document-manager.html) DO NOT use it yet. If we fix the display logic, it only fixes 1 of 4 places.

---

## The 4 Consumption Points (Where Document Lists Appear)

### ✅ Point 1: Office Email (Workflow [02] - Questionnaire Processing)
- **Status:** USING display library
- **File:** EMFcb8RlVI0mge6W-_02_.json
- **Node:** "Code - Add Docs to Email" + "HTTP - Get Display Library"
- **Problem:** Workflow has **68 nodes** (target was 8-19)

### ❌ Point 2: Office Edit Page (document-manager.html)
- **Status:** NOT using display library
- **File:** github/annual-reports-client-portal/document-manager.html
- **JavaScript:** assets/js/document-manager.js
- **Current logic:** Custom grouping by category (lines 101-150)
- **Problem:** Has its own formatting/grouping code

### ❌ Point 3: Client Final Email (Workflow [03] - Approve & Send)
- **Status:** NOT using display library
- **File:** cNxUgCHLPZrrqLLa-_3_Approve_Send.json
- **Node:** "HTML Generator"
- **Problem:** Generates HTML without display library

### ❌ Point 4: Client View Page (view-documents.html)
- **Status:** NOT using display library
- **File:** github/annual-reports-client-portal/view-documents.html
- **JavaScript:** assets/js/view-documents.js
- **Current logic:** Custom formatting (line 135: `formatDocumentName()`)
- **Problem:** Has its own formatting code

---

## Files That Should Be Deleted (Cleanup List)

### Priority 1: Redundant/Obsolete Files

#### Design Logs (Keep Recent, Delete Old)
**DELETE:**
- `001-admin-document-types-viewer.md` - Old TODO, not critical
- `003-admin-ui-improvements.md` - Old, superseded
- `004-repo-folder-reorganization.md` - Old
- `005-simplify-mapping-editor-ux.md` - Old
- `006-admin-document-manager-integration.md` - Old
- `008-fix-placeholder-substitution.md` - Superseded by 010

**KEEP:**
- `000-core-rules-design-logs.md` - Rules
- `002-dynamic-questionnaire-mapping.md` - Core SSOT doc
- `007-questionnaire-mapping-ssot-refactor.md` - Core SSOT doc
- `009-workflow-2-complete-rebuild.md` - Recent rebuild plan
- `010-placeholder-bug-FIXED.md` - Fixed bug
- `011-mapping-duplicate-documents-FIXED.md` - Fixed bug
- `012-centralized-display-library.md` - **CRITICAL - SSOT library**
- `013-workflow-simplified-with-display-library.md` - **CRITICAL - Integration guide**

#### Duplicate/Obsolete Code Files in github/annual-reports-client-portal/
**DELETE (after verifying they're not used):**
- `email-prep.js` - Probably old version
- `email-prep-code.js` - Probably old version
- `email-prep-fixed.js` - Probably old version
- `orchestrator.js` - Probably old version
- `orchestrator-fixed.js` - Probably old version
- `workflow-processor-n8n.js` - What is this?

**INVESTIGATE BEFORE DELETING:**
- Check if any n8n workflows reference these files via HTTP fetch
- Check if they're imported anywhere

#### Root Directory Files
**DELETE:**
- `AGENTS.md` - Duplicate of CLAUDE.md/GEMINI.md?
- `GEMINI.md` - Keep only CLAUDE.md as single source
- `airtable.json` - Old schema? If so, document in CLAUDE.md and delete

**KEEP:**
- `CLAUDE.md` - Primary operating manual

### Priority 2: Duplicate Workflows (Need User Confirmation)

**Two versions of workflow [02]:**
- `EMFcb8RlVI0mge6W-_02_.json` (68 nodes)
- `bwGGDKXexSXrYvbL-_02_NEW_Questionnaire_Processing.json`
- **Question:** Which one is active? Delete the other.

**Two versions of API Get Client Documents:**
- `YAhTlZ9M5Omu90ifiBYr5-API_Get_Client_Documents.json`
- `Ym389Q4fso0UpEZq-_API_Get_Client_Documents.json`
- **Question:** Which one is active? Delete the other.

---

## The Architecture Mess (What Went Wrong)

### Problem 1: Incomplete SSOT Rollout
**What happened:** Display library was created (012, 013) but only integrated into 1 of 4 places.

**Why it's bad:** Fix spouse name bug → only fixed in office email, NOT in:
- Client final email
- Client view page
- Office edit page

### Problem 2: Workflow [02] Bloat (68 nodes!)
**What happened:** Instead of simplifying 19→8 nodes, it grew to 68 nodes.

**Current structure (from JSON):**
1. Webhook
2. Code - Format & Extract
3. HTTP - Get Document Types
4. HTTP - Get Questionnaire Mapping
5. HTTP - Get Display Library
6. Code - Transform Mapping
7. Code - DocMapping
8. Code - Add Docs to Email
9. Airtable - List Docs
10. Airtable - Upsert Documents
11. Airtable - Update Annual Report
12. HTTP Request - Send Email
13. Respond to Webhook
14. Code in JavaScript
15. Code in Python
16. Code - Orchestrator
17. Code - Email Prep
18. ... (50+ more nodes!)

**Why it's bad:**
- Impossible to debug
- Slow execution
- Unclear data flow

### Problem 3: Duplicate Logic Everywhere
**Examples found:**
- `formatDocumentName()` exists in:
  - document-display.js (SSOT)
  - view-documents.js (line 135)
  - document-manager.js (implied)

- Category grouping logic exists in:
  - document-display.js (SSOT)
  - document-manager.js (lines 101-150)
  - workflow [03] "HTML Generator" node

---

## Proposed Architecture (SSOT-First Approach)

### Option A: Client-Side Display Library (Recommended)
**Concept:** All 4 points fetch documents from API and use the SAME display library.

**For Workflows (n8n):**
```
1. Fetch document-display-n8n.js from GitHub
2. Call displayLib.generateDocumentListHTML(documents, options)
3. Embed in email
```

**For Web Pages:**
```javascript
// Import at top of HTML
import { generateDocumentListHTML } from './document-display.js';

// Fetch documents from API
const response = await fetch(`/webhook/get-client-documents?report_id=${id}`);
const data = await response.json();

// Generate HTML
const html = generateDocumentListHTML(data.documents, {
  clientName: data.report.client_name,
  spouseName: data.report.spouse_name,
  language: currentLang
});

// Inject into DOM
container.innerHTML = html;
```

**Benefits:**
- Display logic in ONE place (document-display.js)
- Fix bug once → fixed everywhere
- Simple to maintain

**Challenges:**
- Need to ensure API returns documents in consistent format
- Need `person` field in all documents

---

### Option B: Server-Side HTML Generation
**Concept:** Create new n8n API endpoint that returns pre-formatted HTML.

**New endpoint:** `GET /webhook/render-document-list`
- Params: report_id, language
- Returns: `{ html: "...", metadata: {...} }`

**How it works:**
1. Workflow fetches documents from Airtable
2. Workflow fetches display library
3. Workflow generates HTML using library
4. Returns HTML to caller

**All 4 points:**
- Workflow [02]: Call endpoint, embed HTML in email
- Workflow [03]: Call endpoint, embed HTML in email
- view-documents.html: Call endpoint, inject HTML
- document-manager.html: Call endpoint, inject HTML

**Benefits:**
- Zero client-side logic
- Guaranteed consistency
- Easy caching

**Challenges:**
- Creates dependency on n8n API availability
- Slower (extra HTTP roundtrip)

---

## Critical Questions (MUST ANSWER BEFORE REFACTOR)

### 1. Workflow Identification
**Which workflows are ACTUALLY ACTIVE?**
- Is `EMFcb8RlVI0mge6W-_02_.json` (68 nodes) the active [02]?
- Or is `bwGGDKXexSXrYvbL-_02_NEW_Questionnaire_Processing.json` active?
- Which "Get Client Documents" API is active?

**How to check:** Log into n8n UI, check which workflows are enabled.

### 2. Document Data Structure
**Does the `documents` table in Airtable have a `person` field?**
- If YES: Is it populated correctly? (client vs spouse)
- If NO: How do we determine if a document is for spouse?

**Why it matters:** Display library relies on `doc.person === 'spouse'`.

### 3. API Consistency
**Do all API endpoints return documents in the same format?**
- `/webhook/get-client-documents` returns: ?
- `/webhook/get-documents` returns: ?
- Are field names consistent? (issuer_name, category, person, status)

### 4. Spouse Name Source
**Where does spouse name come from when displaying documents?**
- From `annual_reports.spouse_name` field?
- Is it ALWAYS populated before display?
- Should we fetch it separately or include in API response?

### 5. Architecture Preference
**Which SSOT approach do you prefer?**
- **Option A:** Client-side library (ES6 import on web, HTTP fetch in n8n)
- **Option B:** Server-side HTML generation (new API endpoint)
- **Option C:** Hybrid (library for web, endpoint for workflows)

### 6. Workflow [02] Simplification Priority
**Should we simplify workflow [02] BEFORE or AFTER display library rollout?**
- **Before:** Risk breaking things during simplification
- **After:** Rollout display library first, then simplify
- **Parallel:** Do both at once (risky)

### 7. Testing Strategy
**How do we test without breaking production?**
- Should we create TEST versions of workflows?
- Should we use a test Airtable base?
- Do you have test clients we can use?

---

## Recommended Action Plan

### Phase 1: Audit & Cleanup (1 session)
1. ✅ Identify active workflows (answer Q1)
2. ✅ Delete obsolete design logs
3. ✅ Delete duplicate code files
4. ✅ Verify Airtable `person` field exists (answer Q2)
5. ✅ Document API response formats (answer Q3)

### Phase 2: SSOT Rollout (2-3 sessions)
1. ✅ Update workflow [03] to use display library
2. ✅ Update view-documents.html to use display library
3. ✅ Update document-manager.html to use display library
4. ✅ Test all 4 points with real submission
5. ✅ Visual consistency test (all 4 show identical output)

### Phase 3: Workflow Simplification (1-2 sessions)
1. ✅ Create MEGA node for workflow [02]
2. ✅ Remove redundant nodes
3. ✅ Validate simplified workflow
4. ✅ Deploy and test

### Phase 4: Final Cleanup (1 session)
1. ✅ Delete unused workflows
2. ✅ Update CLAUDE.md documentation
3. ✅ Create maintenance guide

---

## Files Overview (What Exists Now)

### ✅ GOOD - Single Source of Truth Files
These are well-designed and should be preserved:
- `document-types.js` + `document-types.json` (32 doc types)
- `questionnaire-mapping.js` + `questionnaire-mapping.json` (Q&A → docs)
- `document-display.js` + `document-display-n8n.js` (display logic)
- `generate-mapping-json.js` (build script)

### ⚠️ NEEDS MIGRATION - Files Using Old Logic
These files need to be updated to use display library:
- `view-documents.html` + `assets/js/view-documents.js`
- `document-manager.html` + `assets/js/document-manager.js`
- Workflow [03] "HTML Generator" node

### ❓ UNKNOWN - Need Investigation
These files exist but purpose unclear:
- `email-prep.js` (old version?)
- `email-prep-code.js` (old version?)
- `email-prep-fixed.js` (fixed version?)
- `orchestrator.js` (old version?)
- `orchestrator-fixed.js` (fixed version?)
- `workflow-processor-n8n.js` (what does this do?)

---

## Success Criteria

**After this refactor is complete:**

✅ **Consistency:** All 4 consumption points display documents identically
✅ **Simplicity:** Workflow [02] reduced from 68 → 15 nodes (realistic target)
✅ **SSOT:** Display logic exists in ONE place only
✅ **Testing:** Spouse name shows correctly everywhere
✅ **Testing:** Categories display consistently everywhere
✅ **Cleanup:** No obsolete files remain
✅ **Documentation:** CLAUDE.md reflects new architecture

---

## Next Steps

**STOP. DO NOT WRITE CODE YET.**

**User must answer:**
1. Which workflows are active? (check n8n UI)
2. Does Airtable have `person` field?
3. Which SSOT approach do you prefer (A, B, or C)?
4. Should we simplify workflow [02] before or after rollout?
5. Do you have test clients for safe testing?

**Only after answering these questions will I proceed with implementation.**
