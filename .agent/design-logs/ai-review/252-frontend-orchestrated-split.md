# Design Log 252: Frontend-Orchestrated Split with Live Progress

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-12
**Related Logs:** DL-237 (original split implementation), DL-249 (safe split rollback)

## 1. Context & Problem

DL-249 fixed the delete-before-process bug but `waitUntil` silently dies when processing 8+ segments (upload + AI classify each). The Worker's background processing is unreliable for long chains of API calls. Need a different architecture.

## 2. User Requirements

1. **Q:** How should progress UI look? **A:** Keep split modal open with progress — step list showing each segment with spinner/checkmark/X.
2. **Q:** If one segment's classification fails? **A:** Skip classification, mark as unclassified. Other segments continue.
3. **Q:** When to delete original? **A:** Delete after all segments complete — frontend sends finalize-split call at the end.

## 3. Research

### Domain
Real-time Progress UX, Frontend-orchestrated sequential API calls

### Sources Consulted
1. **Nielsen Norman Group** — Determinate progress with step labels outperforms generic progress bars for multi-step operations
2. **Google Material Design** — "N of M completed" (pessimistic/actual) for sequential operations, not time estimates
3. **Shopify Polaris** — Continue-on-failure with final summary for batch operations

### Key Principles
- Show what is happening, not just how much — vertical stepper with step names and status icons
- Continue on failure, summarize at the end — don't lose completed progress
- Non-dismissable modal during processing, close button only after completion

### Research Verdict
Replace fire-and-forget `waitUntil` with frontend-orchestrated sequential API calls. Each segment is a separate request, so no timeout issues. Modal stays open showing live progress.

## 4. Codebase Analysis

- **Split action** refactored from all-in-one to 3 phases: split, classify-segment, finalize-split
- **OneDrive rename** added to classify-segment to match WF05 inbound behavior (`buildExpectedFilename` pattern)
- Reused existing CSS patterns: `.progress-bar`, `.split-spinner`, `.ai-modal-panel`

## 5. Technical Constraints & Risks

- Each classify-segment call takes ~5-15s (Claude API). 8 segments = ~1-2 minutes total. Acceptable with live progress.
- If user closes browser mid-split: original stays as `splitting` (hidden from list), completed segments exist as `pending`. Admin can manually finalize or retry.

## 6. Proposed Solution

### Architecture
1. `POST /review-classification` with `action: 'split'` — synchronous: split PDF, upload all segments to OneDrive, return segment metadata
2. `POST /review-classification` with `action: 'classify-segment'` — per-segment: classify, rename on OneDrive, create Airtable record
3. `POST /review-classification` with `action: 'finalize-split'` — delete original

### Frontend
- Modal stays open, shows vertical step list with progress bar
- Each step shows: spinner → checkmark (with classification name) or X (with error)
- Close button disabled during processing, changes to "סגור" after completion

### Files Changed
| File | Description |
|------|-------------|
| `api/src/routes/classifications.ts` | 3-phase split API + OneDrive rename |
| `github/.../admin/js/script.js` | Frontend orchestration loop in confirmSplit() |
| `github/.../admin/index.html` | Progress view HTML in split modal |
| `github/.../admin/css/style.css` | Progress step styles |

## 7. Validation Plan
- [x] Split 12-page PDF into 8 segments — all classified successfully
- [x] Progress UI shows step-by-step with checkmarks
- [x] Files renamed on OneDrive based on classification
- [x] Original deleted after all segments complete
- [ ] Test failure path — verify segment marked as failed, others continue
- [ ] Test browser close mid-split — verify original stays as 'splitting'
- [ ] Verify no regression in approve/reject/reassign actions

## 8. Implementation Notes
- Action whitelist in classifications.ts needed update to include new actions
- `sanitizeForOneDrive` logic replicated inline (private function in processor.ts)
- Files without high-confidence classification keep their `_partN` names — correct behavior
