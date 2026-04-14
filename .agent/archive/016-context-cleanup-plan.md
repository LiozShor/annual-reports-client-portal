# 016 - Context Cleanup Plan (Instruction Files)

## Date: 2026-01-26

## Problem: Instruction File Confusion

**User Question:** "Did we clean the context? Maybe there are several agents.md or confusing instructions."

**Answer:** YES, there IS confusion. Multiple instruction files with overlapping content.

---

## Current Instruction Files

### 1. `CLAUDE.md` (root)
- **Purpose:** Master operating manual for Claude Code
- **Content:** Project-specific + n8n-MCP instructions + architecture + memories
- **Size:** 830 lines
- **Status:** MASTER (but bloated)
- **Issues:**
  - Contains duplicate n8n-MCP instructions
  - Mixed generic + project-specific content
  - Hard to navigate (too long)

### 2. `AGENTS.md` (root)
- **Purpose:** Generic n8n-MCP instructions (for Cursor AI?)
- **Content:** n8n workflow best practices + MCP tool usage
- **Size:** 100 lines
- **Status:** REDUNDANT
- **Issues:**
  - 80% overlap with CLAUDE.md Operating Mode section
  - Generic content (not project-specific)
  - Confusing to have both

### 3. `GEMINI.md` (root)
- **Purpose:** Originally for Gemini/Antigravity, marked as "MASTER" in CLAUDE.md
- **Content:** n8n-MCP instructions + some project-specific notes
- **Size:** 150 lines
- **Status:** REDUNDANT
- **Issues:**
  - Duplicate of content in CLAUDE.md
  - Marked as "MASTER" but CLAUDE.md is the actual master
  - Adds confusion

### 4. `github/annual-reports-client-portal/agents.md`
- **Purpose:** Frontend repo documentation
- **Content:** Project architecture, endpoints, Airtable schema, client flow
- **Size:** 336 lines
- **Status:** KEEP (this is good!)
- **Issues:** None - this is frontend-specific documentation

### 5. `github/annual-reports-client-portal/README.md`
- **Purpose:** Standard GitHub README
- **Content:** (not read yet)
- **Status:** KEEP (standard repo file)

---

## Cleanup Decision

### DELETE:
1. ✅ `AGENTS.md` (root) - Redundant generic n8n instructions
2. ✅ `GEMINI.md` (root) - Redundant project instructions

### KEEP:
1. ✅ `CLAUDE.md` (root) - SINGLE SOURCE OF TRUTH
2. ✅ `github/annual-reports-client-portal/agents.md` - Frontend documentation
3. ✅ `github/annual-reports-client-portal/README.md` - Standard repo file

---

## CLAUDE.md Simplification Plan

**Problem:** CLAUDE.md is 830 lines and hard to navigate.

**Solution:** Split into logical sections but keep in ONE file (for Claude Code to read).

### Proposed Structure:

```markdown
# Annual Reports CRM - Operating Manual

## Table of Contents
1. Role & Operating Mode
2. Critical Rules (SSOT, Design Logs, Language)
3. Project Architecture
4. Airtable Schema (reference airtable.json)
5. API Endpoints
6. Workflows (brief overview)
7. Session Memories (recent changes)
8. Critical Unfinished Work (current priorities)

## 1. Role & Operating Mode
[Keep current content - essential]

## 2. Critical Rules
[Consolidate all MUST-DO rules here]
- Design logs before starting work
- Language: user writes Hebrew, agent responds English
- SSOT: document-types.js, questionnaire-mapping.js, display-library.js
- Never edit workflow JSON directly (use n8n-MCP)

## 3. Project Architecture
[High-level only - details in other files]
- Tech stack
- Document types SSOT (link to file)
- Display library SSOT (link to file)
- Questionnaire mapping SSOT (link to file)

## 4. Airtable Schema
[Brief overview, reference airtable.json]

## 5. API Endpoints
[Keep list of endpoints]

## 6. Workflows
[Brief list of main workflows - NOT full documentation]

## 7. Session Memories
[Keep last 3 sessions only, move old ones to archive]

## 8. Critical Unfinished Work
[Current priorities - keep updated]
```

**Benefits:**
- Still ONE file (Claude Code can read it)
- Clear sections with TOC
- Easier to update specific sections
- Old memories archived (not deleted)

---

## Cleanup Actions

### Immediate (This Session):
1. ✅ Update airtable.json with `person` field (DONE)
2. ✅ Delete `AGENTS.md` (root)
3. ✅ Delete `GEMINI.md` (root)
4. ⏳ Update CLAUDE.md line 67 (remove GEMINI.md reference)

### Next Session:
1. ⏳ Simplify CLAUDE.md structure (add TOC, consolidate sections)
2. ⏳ Move old session memories to archive file
3. ⏳ Update "Critical Unfinished Work" section after workflow simplification

---

## Design Logs Cleanup

**From audit 014:** Delete these old logs:
- 001-admin-document-types-viewer.md (old TODO)
- 003-admin-ui-improvements.md (old)
- 004-repo-folder-reorganization.md (old)
- 005-simplify-mapping-editor-ux.md (old)
- 006-admin-document-manager-integration.md (old)
- 008-fix-placeholder-substitution.md (superseded by 010)

**Keep these important logs:**
- 000-core-rules-design-logs.md (rules)
- 002-dynamic-questionnaire-mapping.md (SSOT doc)
- 007-questionnaire-mapping-ssot-refactor.md (SSOT doc)
- 009-workflow-2-complete-rebuild.md (recent)
- 010-placeholder-bug-FIXED.md (recent fix)
- 011-mapping-duplicate-documents-FIXED.md (recent fix)
- 012-centralized-display-library.md (**CRITICAL** - SSOT library)
- 013-workflow-simplified-with-display-library.md (**CRITICAL** - integration)
- 014-architecture-audit-and-cleanup-plan.md (this audit)
- 015-workflow-simplification-plan.md (current work)
- 016-context-cleanup-plan.md (this file)

---

## Result: Cleaner Context

**Before:**
- 3 overlapping instruction files (CLAUDE.md, AGENTS.md, GEMINI.md)
- 14 design logs (8 obsolete)
- Confusing "GEMINI.md is MASTER" note in CLAUDE.md

**After:**
- 1 instruction file (CLAUDE.md - TRUE MASTER)
- 1 frontend doc (github/agents.md)
- 10 relevant design logs
- Clear, navigable structure

---

## Status

✅ **Airtable schema updated** (person field added)
⏳ **Ready to delete redundant files** (waiting for user confirmation)
⏳ **CLAUDE.md simplification** (next session after workflow simplification)
