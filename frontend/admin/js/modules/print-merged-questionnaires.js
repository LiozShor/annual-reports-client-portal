/**
 * DL-404 — Merge Clients: merged-questionnaire fan-out for print/preview.
 *
 * Extracted into a module because script.js is on a one-way size ratchet
 * (`.claude/script-size-baseline.json`). New code goes here; script.js
 * only calls these helpers via window globals.
 *
 * Exposed on window:
 *   - buildMergedQuestionnaireSections(item, paData)
 *       → HTML string for the PA preview panel (appended after winner's questions).
 *   - buildMergedPrintSections(item, paData, escapeHtmlFn)
 *       → HTML string for the print sheet (appended after winner's client-questions block).
 *
 * `item` is a pendingApprovalData or questionnairesData element.
 * `paData` is the caller's local pendingApprovalData array (already in memory).
 *
 * When `item.merged_from_report_ids` is absent or empty, both functions return ''.
 * Lookup failures (deleted source report) render a muted fallback note — never throw.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Helpers                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Parse the CSV field `merged_from_report_ids` into an ordered array of IDs.
     * Returns [] when the field is absent, blank, or non-string.
     */
    function parseMergedIds(item) {
        const raw = (item && item.merged_from_report_ids) ? String(item.merged_from_report_ids) : '';
        if (!raw.trim()) return [];
        return raw.split(',').map(s => s.trim()).filter(Boolean);
    }

    /**
     * Look up a source report by its report_id in the local paData array.
     * Returns the matching item or null.
     */
    function findSourceItem(id, paData) {
        if (!Array.isArray(paData)) return null;
        return paData.find(i => i && (i.report_id === id || i.report_record_id === id)) || null;
    }

    /**
     * Render a single client-questions list as HTML.
     * `questions` is [{text, answer}] (already filtered for non-empty text).
     * Used by the preview helper (uses inline CSS classes from the design system).
     */
    function renderQuestionsPreviewHtml(questions) {
        if (!questions || questions.length === 0) {
            return `<p style="color:var(--gray-400);font-size:var(--text-sm);margin:0">אין שאלות ללקוח</p>`;
        }
        return questions.map((q, i) => `<div class="pa-preview-question">
            <span class="pa-preview-qnum">${i + 1}.</span>
            <div style="flex:1;">
                <div>${escHtml(q.text || '')}</div>
                ${q.answer ? `<div class="pa-preview-answer">↳ ${escHtml(q.answer)}</div>` : ''}
            </div>
        </div>`).join('');
    }

    /**
     * Render a single client-questions list as print-sheet HTML.
     * Mirrors the existing `clientQuestions` render inside generateQuestionnairePrintHTML.
     */
    function renderQuestionsPrintHtml(questions, escapeHtmlFn) {
        const esc = typeof escapeHtmlFn === 'function' ? escapeHtmlFn : escHtml;
        if (!questions || questions.length === 0) {
            return `<div class="cq-item"><div class="cq-q cq-no-answer">אין שאלות ללקוח</div></div>`;
        }
        return questions.map((q, idx) => {
            const text = typeof q === 'string' ? q : (q.text || q.question || JSON.stringify(q));
            const answer = (typeof q === 'object' && q.answer) ? String(q.answer).trim() : '';
            return `<div class="cq-item">
                <div class="cq-q">${idx + 1}. ${esc(text)}</div>
                <div class="cq-a${answer ? '' : ' cq-no-answer'}">${answer ? esc(answer) : 'ללא תשובה'}</div>
            </div>`;
        }).join('');
    }

    /** Minimal HTML escape used when script.js's escapeHtml is not available. */
    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Extract a display name + year string for a source item. */
    function sourceLabel(src, fallbackId) {
        if (!src) return escHtml(fallbackId || 'מקור לא ידוע');
        const name = src.client_name || src.name || '';
        const year = src.year ? String(src.year) : '';
        return `${escHtml(name)}${year ? ` — ${escHtml(year)}` : ''}`;
    }

    /* ------------------------------------------------------------------ */
    /* Public: Preview (PA panel)                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Build the merged-source questionnaire sections for the PA preview panel.
     * Returns an HTML string (possibly empty) to be appended after the winner's
     * "שאלות ללקוח" section inside buildPaPreviewBody.
     *
     * @param {object} item       - The winner's pendingApprovalData element
     * @param {Array}  paData     - The full pendingApprovalData array (passed from script.js)
     */
    function buildMergedQuestionnaireSections(item, paData) {
        const ids = parseMergedIds(item);
        if (ids.length === 0) return '';

        let html = '';
        ids.forEach(function (srcId) {
            const src = findSourceItem(srcId, paData);
            let questions = [];
            if (src) {
                const rawCQ = src.client_questions;
                if (Array.isArray(rawCQ)) {
                    questions = rawCQ.filter(function (q) { return q && (q.text || '').trim(); });
                }
            }
            const label = sourceLabel(src, srcId);
            html += `<div class="pa-preview-section" style="border-right:3px solid var(--amber-400,#f59e0b);padding-right:var(--sp-3,12px);opacity:0.9">
                <div class="pa-preview-section-title" style="color:var(--amber-700,#b45309)">
                    שאלון מקורי — ${label}
                </div>
                ${src ? renderQuestionsPreviewHtml(questions) : `<p style="color:var(--gray-400);font-size:var(--text-sm);margin:0">לא ניתן לטעון את השאלון (רשומה נמחקה)</p>`}
            </div>`;
        });
        return html;
    }

    /* ------------------------------------------------------------------ */
    /* Public: Print sheet                                                  */
    /* ------------------------------------------------------------------ */

    /**
     * Build the merged-source questionnaire sections for the print sheet.
     * Returns an HTML string (possibly empty) to be injected after the winner's
     * client-questions block inside generateQuestionnairePrintHTML.
     *
     * @param {object}   item          - The current print item (questionnairesData or pendingApprovalData element)
     * @param {Array}    paData        - pendingApprovalData (or questionnairesData) to look up sources in
     * @param {Function} escapeHtmlFn  - The caller's escapeHtml function (or null to use built-in)
     */
    function buildMergedPrintSections(item, paData, escapeHtmlFn) {
        const esc = typeof escapeHtmlFn === 'function' ? escapeHtmlFn : escHtml;
        const ids = parseMergedIds(item);
        if (ids.length === 0) return '';

        let html = '';
        ids.forEach(function (srcId) {
            const src = findSourceItem(srcId, paData);
            let questions = [];
            if (src) {
                // paData may hold client_questions as parsed array OR raw JSON string
                const rawCQ = src.client_questions;
                if (Array.isArray(rawCQ)) {
                    questions = rawCQ;
                } else if (typeof rawCQ === 'string' && rawCQ.trim()) {
                    try { questions = JSON.parse(rawCQ); } catch { questions = []; }
                }
            }
            const label = sourceLabel(src, srcId);
            html += `<div class="client-questions" style="border-right-color:#d97706;margin-top:16px">
                <h4 style="color:#b45309">שאלון מקורי — ${esc(label)}</h4>
                ${src ? renderQuestionsPrintHtml(questions, esc) : `<div class="cq-item"><div class="cq-q cq-no-answer">${esc('לא ניתן לטעון את השאלון (רשומה נמחקה)')}</div></div>`}
            </div>`;
        });
        return html;
    }

    /* ------------------------------------------------------------------ */
    /* Exports                                                              */
    /* ------------------------------------------------------------------ */

    window.buildMergedQuestionnaireSections = buildMergedQuestionnaireSections;
    window.buildMergedPrintSections = buildMergedPrintSections;

}());
