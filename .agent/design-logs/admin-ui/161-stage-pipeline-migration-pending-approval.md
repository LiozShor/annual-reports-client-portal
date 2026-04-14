# Design Log 161: Stage Pipeline Migration — Remove Numbering + Add Pending_Approval
**Status:** [COMPLETE]
**Date:** 2026-03-16
**Related Logs:** DL-102 (stage redesign), DL-133 (shared constants extraction), DL-055 (stage badges)

## 1. Context & Problem

The 7-stage pipeline uses numbered keys (`1-Send_Questionnaire`, `2-Waiting_For_Answers`, etc.). Inserting a new stage between 2 and 3 requires renumbering everything downstream — all Airtable records, frontend code, and 16+ n8n workflows.

Additionally, there's a real operational gap: when a client fills the questionnaire, WF[02] jumps them straight to `3-Collecting_Docs`. But the office hasn't reviewed or approved yet — no "Approve & Send" has happened. This missing stage means the admin panel conflates "filled questionnaire but not yet processed" with "actively collecting documents."

## 2. User Requirements

1. **Q:** What should the new stage be called?
   **A:** "התקבל שאלון, טרם נשלחו המסמכים" — key: `Pending_Approval`

2. **Q:** Should we renumber all stages or use a non-numeric insertion?
   **A:** Remove numbering entirely from all keys. Future-proof against further insertions.

3. **Q:** Visual treatment for the new stage?
   **A:** Orange/amber — distinct from stage 2 (warning orange).

4. **Q:** Migration strategy for existing clients at stage 3?
   **A:** Check who was already approved. Leon + Moshe → keep at `Collecting_Docs`. Others → `Pending_Approval`.

5. **Q:** Grid layout for 9 stat cards?
   **A:** 9 columns, smaller cards.

6. **Q:** Scope — include n8n workflows?
   **A:** Yes, all together. Don't rename workflow names, just update stage keys inside.

## 3. Research

### Domain
State Machine Migration, Enum Renaming in Production Systems

### Sources Consulted
1. **Airtable Single Select behavior** — Renaming options in UI auto-updates all records instantly. Internal IDs are preserved, so Airtable automations referencing by ID survive. But string-based comparisons (n8n formulas, frontend code) break immediately.
2. **"Designing Data-Intensive Applications" (Kleppmann)** — Enum migration: add new values before removing old ones. Never delete a state while resources are in it.
3. **Big-bang vs gradual migration analysis** — For a system with ~500 clients, 1 admin user, and string-keyed state: big-bang cutover is correct. Dual-format compatibility layers add complexity disproportionate to the risk.

### Key Principles Extracted
- **Add before remove:** Add `Pending_Approval` in Airtable first, then rename existing options.
- **Deactivate during cutover:** n8n workflows that write stages must be paused during the rename window to prevent stale keys.
- **Audit every consumer:** The most common migration failure is a missed reference. Grep everything.

### Patterns to Use
- **Coordinated big-bang cutover:** Deactivate workflows → rename Airtable → update n8n → push frontend → reactivate.
- **SSOT-driven renaming:** `shared/constants.js` is the single source — all frontend code already derives from it.

### Anti-Patterns to Avoid
- **Gradual/feature-flag migration:** Overkill for this scale. Would require every consumer to handle both old and new keys simultaneously.
- **Keeping numeric prefixes:** The whole point is to avoid this pain next time.

### Research Verdict
Big-bang cutover with a short deactivation window. Airtable renames are instant, frontend is a git push, n8n updates via MCP. Total downtime: ~10 minutes.

## 4. Codebase Analysis

### Existing Solutions Found
- `shared/constants.js` is the SSOT for frontend — all stage logic derives from `STAGES` object
- `STAGE_ORDER`, `STAGE_NUM_TO_KEY`, `STAGE_LABELS` are auto-derived from STAGES
- CSS classes (`stage-1` through `stage-7`) are referenced only via STAGES `.class` property

### Reuse Decision
The STAGES pattern is solid — just update the entries. No structural changes needed to the constants pattern itself.

### Frontend Files Affected (6 files)
| File | What Changes |
|------|-------------|
| `shared/constants.js` | STAGES object: 8 entries, no numeric prefixes, new nums |
| `admin/css/style.css` | `.stat-card.stage-*` and `.stage-badge.stage-*` — add stage-3 amber, renumber 3→4 through 7→8 |
| `admin/index.html` | 9th stat card, grid `repeat(9, 1fr)`, renumber IDs |
| `admin/js/script.js` | `recalculateStats()` (stage8), `stageNum <= 2` → `<= 3`, all hardcoded key strings |
| `assets/js/document-manager.js` | `startsWith('1')` → STAGE_ORDER lookup |
| `assets/js/landing.js` | Default stage key |

### n8n Workflows Affected (16 active workflows)
| Workflow | ID | Change Type |
|----------|----|-------------|
| [01] Send Questionnaires | 9rGj2qWyvGWVf9jXhv7cy | Stage value: `Waiting_For_Answers` |
| [02] Questionnaire Response | QqEIWQlRs1oZzEtNxFUcQ | **Stage value: `Pending_Approval`** (was Collecting_Docs) |
| [03] Approve & Send | cNxUgCHLPZrrqLLa | Stage value: `Collecting_Docs` |
| [04] Document Edit Handler | y7n4qaAUiCS4R96W | Stage value: `Review` |
| [05] Inbound Document Processing | cIa23K8v1PrbDJqY | Filter: fix stale `4-In_Review` → `Review` |
| [06] Reminder Scheduler | FjisCdmWc4ef0qSV | Filter + Code node type check |
| [06-SUB] Monthly Reset | pW7WeQDi7eScEIBk | 2 filters |
| [Admin] Dashboard | AueLKVnkdNUorWVYfGUMG | Code node: STAGE_ORDER + stats (8 stages) |
| [API] Admin Change Stage | 3fjQJAwX1ZGj93vL | Code nodes: VALID_STAGES + STAGE_ORDER |
| [Admin] Bulk Import | DjIXYUiERMe-vMYnAImuO | Stage value: `Send_Questionnaire` |
| [Admin] Year Rollover | ODsIuVv0d8Lxl12R | Stage value: `Send_Questionnaire` |
| [Admin] Mark Complete | loOiiYcMqIgSRVfr | Stage value: `Completed` |
| [Admin] Pending Clients | s7u7iZkk2OrKYQq4CVedd | Filter: `Send_Questionnaire` |
| [API] Reset Submission | ZTigIbycpt0ldemO | Stage value: `Waiting_For_Answers` |
| [API] Check Existing Submission | QVCYbvHetc0HybWI | Code node: STAGE_ORDER |
| [API] Review Classification | c1d7zPAmHfHM71nV | IF condition + stage value |
| [API] Reminder Admin | RdBTeSoqND9phSfo | 3 filters + Code node type check |

### Alignment with Research
The SSOT pattern in constants.js is exactly right per best practices. The n8n workflows each have their own hardcoded STAGE_ORDER copies — this is unavoidable since n8n Code nodes can't import shared modules.

## 5. Technical Constraints & Risks

* **Security:** No security impact — stage keys are internal, never exposed to clients as raw strings.
* **Airtable token limitation:** Can't rename Select options via API (no `schema.bases:write`). Must rename in Airtable UI manually.
* **Breaking Changes:** Any missed consumer will break immediately on cutover. Mitigation: exhaustive grep completed.
* **Bug found:** WF[05] has stale `4-In_Review` in filter (doesn't match any current stage). Will fix during migration.
* **Reminder logic:** `Pending_Approval` is NOT a reminder stage. Client can't act — office needs to approve. Filters stay: `Waiting_For_Answers` + `Collecting_Docs`.

## 6. Proposed Solution (The Blueprint)

### Cutover Sequence
1. Deactivate stage-writing n8n workflows
2. Airtable UI: Add `Pending_Approval`, rename 7 existing options
3. Airtable: Migrate specific records to `Pending_Approval`
4. n8n: Update 16 workflows via MCP
5. Frontend: Git commit + push
6. Reactivate n8n workflows
7. Verify

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `shared/constants.js` | Modify | 8 unnumbered stages |
| `admin/css/style.css` | Modify | Add stage-3 amber, renumber to stage-8 |
| `admin/index.html` | Modify | 9 stat cards, grid repeat(9) |
| `admin/js/script.js` | Modify | recalculateStats, thresholds, key strings |
| `assets/js/document-manager.js` | Modify | Fix startsWith checks |
| `assets/js/landing.js` | Modify | Default stage key |
| `docs/airtable-schema.md` | Modify | 8-stage documentation |
| 16 n8n workflows | Modify (MCP) | Stage key renames |

## 7. Validation Plan
* [ ] Admin dashboard loads — 9 stat cards visible, counts correct
* [ ] Stage dropdown shows 8 stages in correct order
* [ ] Stage change forward works
* [ ] Stage change backward shows confirmation
* [ ] Doc progress hidden for stages 1-3, visible for 4+
* [ ] Questionnaire link visible for stages 3+
* [ ] Reminder tab shows only Waiting_For_Answers + Collecting_Docs clients
* [ ] Landing page: filled questionnaire client sees "already submitted"
* [ ] WF[02] sets `Pending_Approval` on questionnaire fill
* [ ] WF[03] Approve & Send sets `Collecting_Docs`
* [ ] Document-manager shows correct stage label
* [ ] Send questionnaire button only for `Send_Questionnaire` stage

## 8. Implementation Notes (Post-Code)
*(To be filled during implementation)*
