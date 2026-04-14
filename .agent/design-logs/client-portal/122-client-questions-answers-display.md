# Design Log 122: Client Questions + Answers in Questionnaire Views & Print

**Status:** DONE
**Date:** 2026-03-08
**Related Logs:** DL-110 (questions feature), DL-116 (questionnaires tab), DL-120 (UX improvements)

## Problem

Client questions showed only question text — no answers — in:
- Admin Questionnaires Tab detail row
- Admin Questionnaires Print
- Document-Manager questionnaire view (section entirely missing)
- Document-Manager questionnaire print (section entirely missing)

## Solution

### 5 changes across 3 files:

1. **Admin detail row** (`admin/js/script.js` → `buildQADetailHTML()`): Added answer below each question with green/orange status dots and "ללא תשובה" for unanswered
2. **Admin print CSS** (`admin/js/script.js` → `generateQuestionnairePrintHTML()`): Updated print CSS with amber border-right, `break-inside:avoid`, `print-color-adjust:exact`; added answer rendering with `.cq-item/.cq-q/.cq-a` classes
3. **Admin print content** (`admin/js/script.js` → `generateQuestionnairePrintHTML()`): Changed from `<p>` per question to `.cq-item` with question + answer
4. **Document-Manager view** (`assets/js/document-manager.js` → `_renderQuestionnaire()`): Added amber client questions section after Tally Q&A table with inline styles
5. **Document-Manager print** (`assets/js/document-manager.js` → `printQuestionnaireFromDocManager()`): Added client questions section with print styles matching admin print
6. **Admin CSS** (`admin/css/style.css`): Added `.qa-cq-question`, `.qa-cq-status`, `.qa-cq-answered`, `.qa-cq-unanswered`, `.qa-cq-answer`, `.qa-cq-no-answer` classes

### Bonus fix
- Replaced native `alert()` calls in `printQuestionnaireFromDocManager()` with `showToast()` (per project UI rules)

## Design Decisions

- **Status dots**: Green (#10b981) for answered, orange (#f59e0b) for unanswered — following Carbon Design System pattern
- **Print fallback**: `border-right: 3px solid #d97706` instead of background for print reliability
- **Inline styles for document-manager view**: Document-manager uses inline styles throughout (no external CSS classes for Q&A), so kept consistent
- **`break-inside: avoid`**: Prevents splitting a question from its answer across pages
