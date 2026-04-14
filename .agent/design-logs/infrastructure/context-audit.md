# Context Efficiency Audit

**Date:** 2026-03-28
**Scope:** All files referenced in CLAUDE.md, docs/, .agent/, .claude/, architecture diagrams, root-level docs
**Purpose:** Identify outdated, redundant, or never-read files wasting tokens

---

## Files to Delete

| Path | Size | Reason | Referenced By |
|------|------|--------|---------------|
| `docs/prefetching-research.md` | ~2,485 tokens | Speculative research on frontend prefetching/SWR patterns. Never implemented, no design log references, no corresponding code. Pure speculation. | Nothing |
| `docs/Online_Customer_DPA_(Moshe_Atsits_CPA_and_Airtable).pdf` | 382KB | Exact duplicate of `docs/DPAS/Online_Customer_DPA_(...).pdf`. Root-level copy serves no purpose. | Nothing (DPAS/ version is the one referenced in compliance report) |
| `docs/Summary.pdf` | 142KB | Exact duplicate of `docs/DPAS/Summary.pdf`. Same situation. | Nothing |
| `.agent/session-memories.md` | ~7,130 tokens | Historical session logs from Sessions 49-89 (late Feb). Superseded by `.agent/current-status.md` + design log system. Explicitly labeled "Archive" in the file itself. | Nothing in active docs |
| `.agent/archive/openai-classification-research-OUTDATED.md` | ~2,300 tokens | Self-labeled OUTDATED. OpenAI was evaluated and rejected in favor of Claude Haiku. Decision is final. | Nothing |
| `.agent/archive/fix-code-docmapping.txt` | 410 bytes | One-off debugging note from session ~10. No value. | Nothing |
| `docs/Samples/.claude/settings.local.json` | 89 bytes | Orphaned Claude settings file inside test samples directory. Serves no purpose. | Nothing |
| `docs/Samples/New` | 473 bytes | Mystery file inside Samples directory. Not a valid test document. | Nothing |
| `.playwright-mcp/console-*.log` (6 files) | Variable | Temporary Playwright MCP console logs from March 26-27. Debug artifacts. | Nothing |
| `api/src/test-airtable.ts` | 734 bytes | One-off test script, not part of any test framework. Leftover debug file. | Nothing |

---

## Files to Update

### 1. `.agent/current-status.md` (~18,866 tokens — CRITICAL)
**What's stale:**
- File is 75KB and growing every session. Contains detailed session histories going back 20+ sessions that are never re-read.
- Multiple items marked "NEED TESTING" from sessions 185-190 (DL-185, DL-186, DL-188, DL-190) that are likely resolved — no recent follow-up.
- DL-203 (WF05 migration) still described as "in progress" in some sections — migration is complete.
- E2E test suite section references a run from session 186 (2026-03-25) with "all 14 passed" — stale snapshot.
- `reviewed_by` dead field cleanup TODO noted but never acted on.

**What it should say:** Trim to last 5 sessions max. Move older session details to a separate archive file or delete. Keep only: (1) Priority items, (2) Active TODOs, (3) Known issues, (4) E2E test status. Target: under 5,000 tokens.

### 2. `docs/architecture.md` (~2,304 tokens)
**What's stale:**
- Does not mention the Cloudflare Workers migration at all. Describes architecture as if n8n handles all API endpoints.
- No reference to the new `docs/architecture/*.mmd` diagrams.
- Endpoint list (if any) references old n8n webhook paths.

**What it should say:** Add a section clarifying: (1) API layer migrated to Cloudflare Workers (March 2026), (2) n8n now handles only: document generation ([SUB]), scheduled jobs (WF06/07), and monitoring, (3) cross-reference `docs/architecture/` for visual diagrams.

### 3. `docs/project-overview.md` (~1,689 tokens)
**What's stale:**
- Phase 2 (Inbound Document Processing) marked "🔜 Planned" — it's been live since WF[05] and is now fully migrated to Workers.

**What it should say:** Phase 2 → "✅ Built". Add brief note about Workers migration.

### 4. `docs/workflow-ids.md` (~860 tokens)
**What's stale:**
- WF[05] listed as active — should be marked `[ARCHIVED]` with note "migrated to Workers `process-inbound-email` endpoint (DL-203)".
- WF[05-SUB] (Email Subscription Manager) status unclear post-migration.

**What it should say:** Mark WF[05] and WF[05-SUB] as archived. Add migration date.

### 5. `docs/architecture/document-processing-flow.mmd` (~956 tokens)
**What's stale:**
- Inbound processing subgraph still references "WF[05]" node labels and n8n scheduling.

**What it should say:** Update to show Workers endpoint as the processing entry point. Remove n8n-specific language from inbound section.

### 6. `docs/cloudflare-workers-research.md` (~3,305 tokens)
**What's stale:**
- Titled as "research" but migration is complete. Creates confusion about whether this is still planning.

**What it should say:** Add header "STATUS: RESEARCH COMPLETE — Migration executed March 2026. See `docs/performance-benchmarks.md` for results."

### 7. `docs/capital-statements-feasibility.md` (~7,419 tokens)
**What's stale:**
- Infrastructure phases 1-5 are marked ✅ DONE but the file reads as a feasibility study.

**What it should say:** Add header "STATUS: FEASIBILITY COMPLETE — Infrastructure implemented. Content tasks (Tally forms, templates) pending firm input. See `capital-statements-implementation-plan.md` for current checklist."

---

## CLAUDE.md Cleanup Suggestions

### References to Remove
- None found. All file paths in CLAUDE.md point to existing files.

### References to Add
| Item | Why | Suggested Location |
|------|-----|-------------------|
| `docs/performance-benchmarks.md` | Documents the Workers migration results (3-10x faster). Useful when evaluating architecture decisions. | On-Demand Docs |
| `docs/meeting-with-natan-action-items.md` | Active backlog of firm stakeholder requests. Read frequently when prioritizing work. | On-Demand Docs |
| `SSOT_CS_required_documents.md` | Capital statements SSOT file (companion to the annual reports SSOT). Referenced when doing CS work. | Near existing SSOT reference |

### Inline Content to Extract (CLAUDE.md → On-Demand Doc)

| Section | Lines | ~Tokens | Recommendation |
|---------|-------|---------|----------------|
| **CORS Rules for n8n Webhooks** | 104-116 | ~450 | **Extract to `docs/cors-rules.md`**. Only relevant when creating new n8n webhooks (rare now that API is on Workers). Replace with one-liner: "CORS rules: `docs/cors-rules.md` (required when adding n8n Respond to Webhook nodes)." |
| **Google Workspace CLI** | 128-149 | ~400 | **Extract to `docs/gws-cli.md`**. Debug-only tool used a few times per month. Replace with one-liner: "Google Workspace CLI: `docs/gws-cli.md` (for inspecting test emails)." |
| **Cost Optimization Rules** | 166-182 | ~350 | **Keep as-is**. These are behavioral rules Claude reads every session. They earn their token cost. |

**Net savings from extraction:** ~850 tokens per session (~7% of CLAUDE.md).

### Content to Consolidate INTO CLAUDE.md

| Item | Source | Why |
|------|--------|-----|
| Workers base URL | Currently only in code (`api/wrangler.toml`) | Added to Quick Reference would save a file read every session: `Workers API: annual-reports-api.liozshor1.workers.dev/webhook` |

---

## .agent/current-status.md Cleanup

### Resolved TODOs to Remove

| Item | Evidence of Resolution |
|------|----------------------|
| DL-203 "WF05 Worker Migration — NEED TESTING" | Migration complete per DL-206, DL-207. Architecture diagrams updated. |
| DL-205 "Clear File Fields — NEED TESTING" | Session 209 confirms tested and working. Commit `44fd38e`. |
| DL-204 "Daily Digest Claude AI — NEED TESTING" | DL-204 design log marked complete. Commits pushed. |
| DL-201 "Fix Review Classification 422" | Design log exists, commit `5caf060`. |
| DL-200 "Document Manager UX — NEED TESTING" | DL-200 design log complete. UI deployed. |
| DL-199 "Client Communication Notes — NEED TESTING" | Session 208 confirms working. DL-208 builds on it. |
| DL-198/194 "Remove Batch Status" | DL-210 references it as completed prerequisite. |
| `reviewed_by` dead field cleanup | Either do it or remove the TODO. It's been sitting since session ~130. |
| Session histories older than session 204 | No re-read value. Trim or archive. |

### Items to Keep
| Item | Reason |
|------|--------|
| DL-206 (Classification Prompt Parity) — PRIORITY 1 | NOT STARTED. 3-line stub vs 350-line production prompt. |
| DL-182 (Capital Statements Tally) | User needs to finish conditional rules. Active. |
| DL-166 (Filing Type Tabs) | Deferred until CS content exists. |
| E2E Test Suite (14 tests) | Keep as checklist but update status to "last run: session 186." |
| DL-185-190 "NEED TESTING" items | Either test them or remove. They're accumulating. |

### Structural Recommendation
**current-status.md should be capped at ~5,000 tokens.** Currently at ~18,866. Proposed structure:
1. **Priority Queue** (active urgent items) — ~500 tokens
2. **Active TODOs** (unresolved, with owner) — ~1,000 tokens
3. **Recently Completed** (last 5 sessions only) — ~1,500 tokens
4. **Deferred/Blocked** (with trigger condition) — ~500 tokens
5. **E2E Test Checklist** (14 items with last-run date) — ~500 tokens

Everything else → delete or move to `.agent/archive/status-history-YYYY-MM.md`.

---

## Context Budget Estimate

### Files CLAUDE.md References (Loaded On-Demand)

| File | ~Tokens | Read Frequency | Verdict |
|------|---------|----------------|---------|
| `CLAUDE.md` (always loaded) | 2,725 | 100% | **KEEP** — core operating rules |
| `docs/airtable-schema.md` | 5,971 | ~40% | **KEEP** — needed for any Airtable work |
| `docs/email-design-rules.md` | 5,391 | ~20% | **KEEP** — mandatory for email work, clearly gated |
| `docs/ui-design-system.md` | 1,860 | ~25% | **KEEP** — mandatory for UI work, small |
| `docs/ui-design-system-full.md` | 7,429 | ~10% | **OK** — only loaded for new components, clearly gated |
| `SSOT_required_documents_from_Tally_input.md` | 10,228 | ~15% | **FLAG** — 10K tokens, read only for doc generation. Consider if it can be trimmed or split. |
| `.agent/current-status.md` | 18,866 | ~60% | **FLAG** — Bloated. Should be <5,000 tokens. See cleanup above. |
| `.agent/design-logs/INDEX.md` | 3,655 | ~30% | **KEEP** — lookup table for design logs |
| `.agent/design-logs/ARCHIVE-INDEX.md` | 6,674 | ~5% | **FLAG** — 6.7K tokens, rarely read. Consider trimming older entries or loading only on request. |
| `docs/architecture.md` | 2,304 | ~20% | **KEEP** — but update for accuracy |
| `docs/common-mistakes.md` | 1,276 | ~15% | **KEEP** — small, high-value bug patterns |
| `docs/workflow-ids.md` | 860 | ~25% | **KEEP** — small, frequently needed |
| `docs/project-overview.md` | 1,689 | ~5% | **OK** — rarely read, small |
| `docs/architecture/*.mmd` (4 files) | 4,513 | ~10% | **OK** — on-demand visual reference |
| `docs/architecture/ARCHITECTURE-NOTES.md` | 817 | ~5% | **OK** — small metadata |
| `.claude/skills/ssot-verify/SKILL.md` | 336 | ~10% | **KEEP** — tiny, needed for SSOT work |
| `.claude/skills/n8n-mcp/SKILL.md` | 311 | ~15% | **KEEP** — tiny, needed for n8n work |

### Total Budget

| Category | Tokens | Notes |
|----------|--------|-------|
| **Always loaded** (CLAUDE.md) | 2,725 | Cannot reduce much further |
| **Frequently loaded** (>30% of sessions) | ~28,492 | current-status (18,866) + airtable-schema (5,971) + INDEX (3,655) |
| **Occasionally loaded** (10-30%) | ~21,164 | email-design (5,391) + ui-design (1,860) + SSOT (10,228) + architecture (2,304) + workflow-ids (860) + common-mistakes (1,276) + .mmd files (4,513) |
| **Rarely loaded** (<10%) | ~16,609 | ui-full (7,429) + ARCHIVE-INDEX (6,674) + project-overview (1,689) + ARCH-NOTES (817) |

**Total addressable context:** ~69,000 tokens across all referenced files.

### Top Optimization Targets

| Target | Current | Goal | Savings |
|--------|---------|------|---------|
| **current-status.md** | 18,866 | 5,000 | **~13,866 tokens** |
| **ARCHIVE-INDEX.md** | 6,674 | Load only on explicit request | **~6,674 tokens** (remove from On-Demand Docs list, keep file) |
| **CORS + gws extraction from CLAUDE.md** | 850 inline | 100 (one-liner refs) | **~750 tokens** |
| **SSOT doc** | 10,228 | No change (needed as-is) | 0 |

**Potential savings: ~21,290 tokens** (~31% of total budget) with no information loss.

---

## Missing Documentation (Gaps Found)

### High Priority — Should Create

| Doc | Why Missing Matters | Estimated Effort |
|-----|---------------------|-----------------|
| `docs/workers-deployment.md` | No documented deployment/rollback procedure for Cloudflare Workers. Currently relies on tribal knowledge (`npm run deploy`). Risk: if something breaks in prod, no recovery guide. | 1 session |
| `docs/error-handling.md` | `error-logger.ts` exists with categories, throttling, alert emails — but no docs. New code won't use it consistently without a guide. | 30 min |
| `docs/testing.md` | Zero automated tests. No manual testing checklist. E2E suite exists only in current-status.md. Should be a standalone doc. | 1 session |

### Medium Priority — Nice to Have

| Doc | Why |
|-----|-----|
| Workers endpoint reference (all routes, auth, params) | Currently only discoverable by reading `api/src/index.ts`. Would save time on every API task. |
| Airtable table relationship diagram | Schema doc has fields but not relationships. A simple ERD would help. |

---

## Summary of Recommendations

1. **Trim `current-status.md` from 18,866 → ~5,000 tokens** (biggest win)
2. **Delete 10+ files** (session-memories, duplicate PDFs, debug artifacts, outdated research)
3. **Update 7 files** with stale content (architecture.md, project-overview.md, workflow-ids.md, etc.)
4. **Extract CORS + gws from CLAUDE.md** to on-demand docs (~750 tokens saved per session)
5. **Create 3 missing docs** (workers-deployment, error-handling, testing)
6. **Remove ARCHIVE-INDEX.md from On-Demand Docs** in CLAUDE.md (load only when explicitly needed)
7. **Add 3 references to CLAUDE.md** (performance-benchmarks, meeting action items, CS SSOT)
