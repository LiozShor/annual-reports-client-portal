/**
 * DL-299: Shared questionnaire print helper.
 * Opens a print window with a self-contained RTL sheet: client header, Q&A table
 * (non-"לא" answers), client questions section, office notes.
 *
 * Consumers:
 *  - frontend/assets/js/document-manager.js → printQuestionnaireFromDocManager() (wrapper)
 *  - frontend/admin/js/script.js            → printPaQuestionnaire() (PA card button)
 *
 * data = {
 *   clientName, year, email, phone,
 *   submissionDate,       // ISO string or null
 *   filingTypeLabel,      // "דוח שנתי" / "הצהרת הון"
 *   answers,              // [{label, value}]
 *   clientQuestions,      // [{text, answer}] OR ["string"]
 *   reportNotes,          // string
 * }
 */
(function (global) {
    'use strict';

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function showToast(msg, type) {
        if (typeof window !== 'undefined' && typeof window.showAIToast === 'function') {
            window.showAIToast(msg, type);
        } else if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast(msg, type);
        }
    }

    function printQuestionnaireSheet(data) {
        if (!data || !Array.isArray(data.answers) || data.answers.length === 0) {
            showToast('אין נתוני שאלון להדפסה', 'warning');
            return;
        }

        const printWindow = window.open('', '_blank', 'width=900,height=700');
        if (!printWindow) {
            showToast('לא ניתן לפתוח חלון הדפסה. אפשר חלונות קופצים.', 'error');
            return;
        }

        const clientName = data.clientName || '';
        const year = data.year || '';
        const email = data.email || '';
        const phone = data.phone || '';
        const filingTypeLabel = data.filingTypeLabel || 'דוח שנתי';
        const submissionDate = data.submissionDate
            ? new Date(data.submissionDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';

        // Drop explicit "No" answers — matches doc-manager behaviour
        const printAnswers = data.answers.filter(a => a && a.value && a.value !== '✗ לא' && a.value !== '✗ No');
        const rows = printAnswers.map(a => `<tr>
            <td class="q-col">${escapeHtml(a.label)}</td>
            <td class="a-col">${escapeHtml(String(a.value || ''))}</td>
        </tr>`).join('');

        // Client questions — accepts either {text, answer} objects or bare strings
        const rawCQ = Array.isArray(data.clientQuestions) ? data.clientQuestions : [];
        const printCQ = rawCQ.filter(q => q && ((typeof q === 'string' && q.trim()) || (q.text && q.text.trim())));

        let cqHtml = '';
        if (printCQ.length > 0) {
            cqHtml += `<div class="client-questions"><h4>שאלות הלקוח</h4>`;
            printCQ.forEach((q, idx) => {
                const text = typeof q === 'string' ? q : (q.text || q.question || '');
                const answer = (typeof q === 'object' && q.answer) ? String(q.answer).trim() : '';
                cqHtml += `<div class="cq-item">
                    <div class="cq-q">${idx + 1}. ${escapeHtml(text)}</div>
                    <div class="cq-a${answer ? '' : ' cq-no-answer'}">${answer ? escapeHtml(answer) : 'ללא תשובה'}</div>
                </div>`;
            });
            cqHtml += `</div>`;
        }

        let notesHtml = '';
        if (data.reportNotes && String(data.reportNotes).trim()) {
            notesHtml = `<div class="office-notes"><h4>הערות משרד</h4><div class="notes-content">${escapeHtml(data.reportNotes)}</div></div>`;
        }

        const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head>
<meta charset="UTF-8"><title>שאלון — ${escapeHtml(clientName)}</title>
<style>
  @page{margin:15mm;size:A4}*{box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:12pt;color:#1f2937;direction:rtl;margin:0}
  .header{border-bottom:3px solid #4f46e5;padding-bottom:10px;margin-bottom:16px}
  .header h2{margin:0 0 4px;font-size:18pt}.meta{font-size:10pt;color:#6b7280}
  table{width:100%;border-collapse:collapse;font-size:10pt}
  th{background:#f3f4f6;padding:7px 10px;font-weight:700;color:#374151;border-bottom:2px solid #d1d5db;text-align:right}
  td{padding:6px 10px;border-bottom:1px solid #f3f4f6;vertical-align:top;text-align:right}
  tr:nth-child(even) td{background:#f9fafb}
  .q-col{font-weight:600;color:#374151;width:40%}.a-col{color:#4b5563}
  .client-questions{margin-top:12px;border-right:3px solid #d97706;padding:8px 12px;background:#fffbeb;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .client-questions h4{margin:0 0 8px;font-size:10pt;color:#92400e;text-transform:uppercase;letter-spacing:0.05em}
  .cq-item{padding:6px 0;border-bottom:1px solid #fde68a;break-inside:avoid}
  .cq-item:last-child{border-bottom:none}
  .cq-q{font-weight:600;color:#78350f;font-size:10pt}
  .cq-a{color:#4b5563;font-size:10pt;margin-top:2px;padding-right:16px}
  .cq-no-answer{color:#9ca3af;font-style:italic}
  .office-notes{margin-top:12px;border-right:3px solid #3b82f6;padding:8px 12px;background:#eff6ff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .office-notes h4{margin:0 0 8px;font-size:10pt;color:#1e40af;text-transform:uppercase;letter-spacing:0.05em}
  .office-notes .notes-content{color:#1f2937;font-size:10pt;white-space:pre-wrap}
  .footer{margin-top:12px;font-size:8pt;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px}
</style></head><body>
<div class="header">
  <h2>${escapeHtml(clientName || '—')} — ${escapeHtml(filingTypeLabel)} ${escapeHtml(String(year || '—'))}</h2>
  <div class="meta">${escapeHtml(email || '—')}${phone ? ` | ${escapeHtml(phone)}` : ''} | שאלון הוגש: ${submissionDate}</div>
</div>
<table><thead><tr><th class="q-col">שאלה</th><th class="a-col">תשובה</th></tr></thead>
<tbody>${rows}</tbody></table>
${cqHtml}
${notesHtml}
<div class="footer">הודפס מתוך מערכת ניהול דוחות — Client Name רו"ח</div>
</body></html>`;

        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 500);
    }

    global.printQuestionnaireSheet = printQuestionnaireSheet;
})(typeof window !== 'undefined' ? window : this);
