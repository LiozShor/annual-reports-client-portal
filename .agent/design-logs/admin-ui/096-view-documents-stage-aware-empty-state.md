# Design Log 096: View Documents — Stage-Aware Empty State
**Status:** [DRAFT]
**Date:** 2026-03-05
**Related Logs:** [047-document-status-visual-indicators](047-document-status-visual-indicators.md), [074-live-doc-state-and-card-labels](074-live-doc-state-and-card-labels.md)

## 1. Context & Problem

When a client visits the view-documents page before submitting their Tally questionnaire, the page shows:
> "כל המסמכים התקבלו! אין מסמכים חסרים." (All documents received! No missing documents.)

This is a false positive. The client hasn't submitted their questionnaire yet, so no documents have been generated in Airtable. The API returns `document_count: 0`, and `renderDocuments()` treats `0` as "all complete" — but it also means "nothing started."

The page currently cannot distinguish these two structurally different states because the API doesn't return the client's pipeline stage.

## 2. User Requirements

1. **Q:** Should the fix apply to both client and admin views?
   **A:** Both views — clients and admins both see stage-appropriate messages.

2. **Q:** What stages should show what message?
   **A:** Stages 1-2 (pre-questionnaire): show "questionnaire not yet submitted" warning. Stages 3+ with 0 missing: show "all received."

3. **Q:** Should the empty state include a CTA?
   **A:** Yes — message + CTA button linking to the Tally questionnaire (via landing page).

4. **Q:** Should the API return the stage field or a boolean?
   **A:** Return the full `stage` field for flexibility.

## 3. Research

### Domain
Empty State UX Design, Status Messaging, Dashboard State Management

### Sources Consulted
1. **"Designing Web Interfaces" (Scott & Neil)** — Defines the "Blank State" pattern as a starting state requiring an invitation to action, not a completion indicator. Their "Blank Slate Invitation" pattern maps directly to our CTA approach.
2. **Nielsen Norman Group: "Designing Empty States in Complex Applications"** — Documents the exact anti-pattern occurring here: "A common scenario is when the system defaults to a misleading system-status message declaring that there are no items to display... users develop a severe distrust of the application." Three jobs of empty states: communicate status, teach the interface, provide a direct action path.
3. **Atlassian Design System: Empty State vs Blank Slate** — Draws sharp line: empty state = cleared/completed tasks; blank slate = never-used feature. Using a completion message for a blank slate is "a category error, not just a copy problem."
4. **PatternFly Empty State Guidelines** — "State what needs to be done instead of what hasn't been done yet." Correct: "Configure your system." Wrong: "You haven't configured anything."

### Key Principles Extracted
- **Principle 1 — Never conflate "nothing started" with "everything done"**: These are structurally different states requiring different visual treatment, copy, and CTAs. (NN/G Heuristic #1: Visibility of System Status)
- **Principle 2 — Empty states should provide a direct action path**: Don't just describe what's missing — enable the next step with a link or button. (Scott & Neil: "Blank Slate Invitation")
- **Principle 3 — Use imperative copy for precondition states**: "Fill your questionnaire to get started" not "No documents found." (PatternFly guidelines)

### Patterns to Use
- **Blank Slate Invitation**: Info-toned message (not success/not error) + CTA button linking to the questionnaire
- **Stage-gated rendering**: Use the pipeline stage from Airtable to determine which empty state variant to show

### Anti-Patterns to Avoid
- **False completion indicator**: Showing "All done!" when nothing has started (exactly the current bug). Violates trust and causes users to take no corrective action.
- **Generic "No data"**: "No documents" doesn't explain why or what to do next.

### Research Verdict
The fix requires two changes: (1) return the `stage` field in the API response so the frontend can distinguish states, (2) add a new "pre-questionnaire" empty state with info styling and CTA. The success message should only appear when documents genuinely existed and were all received.

## 4. Codebase Analysis

### Relevant Files
| File | Purpose |
|------|---------|
| `tmp/get-client-docs-jsCode.json` | n8n Build Response Code node (workflow `Ym389Q4fso0UpEZq`) — already extracts `stage` but only returns it in office mode |
| `github/.../assets/js/view-documents.js` | Frontend JS — `renderDocuments()` at line 196, the `document_count === 0` check at line 202 |
| `github/.../assets/css/view-documents.css` | CSS — `.success-message` at lines 258–267 |

### Existing Patterns
- **Stage field**: Already extracted in n8n code (`const stage = report.stage || ''`) and returned in office mode. Just not in client mode.
- **Bilingual messages**: All done with `isHe` boolean toggling Hebrew/English text.
- **Design system empty state**: `.empty-state` class exists (icon + text, gray/neutral) but isn't used on this page. The `.alert.alert-info` class (blue info box) would be appropriate for the "pre-questionnaire" state.
- **CTA button pattern**: `.btn.btn-primary` for primary actions.

### Alignment with Research
- Current implementation directly violates NN/G Principle #1 (false completion indicator)
- Design system already has the right components (`.alert-info`, `.btn-primary`) — just need to compose them

## 5. Technical Constraints & Risks

* **Security:** The `stage` field is non-sensitive internal data (values like "1-Send_Questionnaire"). Safe to expose to clients — it reveals nothing they don't already know (whether they've filled the form or not).
* **Risks:** Minimal — additive change. No existing functionality changes for clients who HAVE submitted questionnaires.
* **Breaking Changes:** None. The frontend currently ignores unknown fields in the API response. Adding `stage` is backwards-compatible.
* **CTA construction:** The landing page URL can be built from `reportId` and `clientToken` already available in `view-documents.js`. Admin viewers don't get a CTA (they shouldn't fill questionnaires for clients).

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. **n8n API change**: Add `stage` to client-mode response:
   ```js
   // In the client-mode return statement, add stage to the report object
   report: { year, client_name, spouse_name, source_language, stage }
   ```

2. **Frontend change**: In `renderDocuments()`, replace the single `document_count === 0` branch with stage-aware logic:
   ```
   if document_count === 0:
     if stage is "1-Send_Questionnaire" or "2-Waiting_For_Answers":
       → show PRE-QUESTIONNAIRE empty state (info alert + CTA)
     else:
       → show ALL RECEIVED success state (current green message)
   else:
     → render documents normally (unchanged)
   ```

3. **Pre-questionnaire message design**:
   - Use `.alert.alert-info` styling (blue/info tone — not success-green, not error-red)
   - Icon: `clipboard-list` (Lucide)
   - Hebrew: "טרם מולא שאלון שנתי. יש למלא את השאלון כדי שנוכל להכין את רשימת המסמכים הנדרשים."
   - English: "The annual questionnaire hasn't been submitted yet. Please fill it out so we can prepare your required documents list."
   - CTA button (client mode only): "מלא/י שאלון" / "Fill Questionnaire" → links to `index.html?report_id=${reportId}&token=${clientToken}`
   - Admin mode: same message, no CTA button

4. **CSS**: Add `.pre-questionnaire-message` class (or reuse `.alert.alert-info` from design system). Add CTA button styling within the message container.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n workflow `Ym389Q4fso0UpEZq` (Build Response node) | Modify | Add `stage` to client-mode response `report` object |
| `github/.../assets/js/view-documents.js` | Modify | Stage-aware empty state logic in `renderDocuments()` |
| `github/.../assets/css/view-documents.css` | Modify | Add `.pre-questionnaire-message` styling (if `.alert-info` not already available on this page) |

## 7. Validation Plan
- [ ] Visit view-documents page for a client in stage 1 (pre-questionnaire) → should see info message + CTA button
- [ ] Visit view-documents page for a client in stage 2 (waiting for answers) → same info message + CTA
- [ ] Visit view-documents page for a client in stage 3+ with all docs received → should see green success message (unchanged)
- [ ] Visit view-documents page for a client in stage 3+ with missing docs → should see normal document list (unchanged)
- [ ] Click CTA button → should navigate to landing page with correct params
- [ ] Admin viewing pre-questionnaire client → should see info message but NO CTA button
- [ ] Toggle language (HE ↔ EN) on pre-questionnaire page → messages switch correctly
- [ ] Verify API response includes `stage` field in client mode

## 8. Implementation Notes (Post-Code)
* _(To be filled during implementation)_
