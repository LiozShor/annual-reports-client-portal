/**
 * Email HTML generation — ported from n8n Code nodes.
 *
 * Sources:
 *   - Generate HTML node from [SUB] Document Service
 *   - Build Email Data node from Send Questionnaires
 *   - Inject Questions node from Approve & Send
 *
 * All functions are pure: typed params in, string out.
 * Output parity with n8n code is non-negotiable.
 */

import { FONT, C, BG, ACCENT, WA_URL, WA_ICON, FRONTEND_BASE, OFFICE_EMAIL, LOGO_URL } from './email-styles';

// ── Types ──────────────────────────────────────────────────────────

export interface DocItem {
  type?: string;
  person?: string;
  category?: string;
  issuer_name?: string;
  issuer_name_en?: string;
  status?: string;
}

export interface CategoryInfo {
  category_id: string;
  name_he: string;
  name_en?: string;
  emoji: string;
  sort_order: number;
}

export interface RejectedUpload {
  id: string;
  cls_id?: string;
  filename: string;
  received_at: string;       // YYYY-MM-DD
  reason_code?: string;
  reason_text?: string;       // Hebrew reason from REJECTION_REASONS
  notes?: string;
  rejected_at?: string;
  rejected_by?: string;
}

export interface ClientEmailParams {
  clientName: string;
  spouseName: string;
  year: string;
  language: string;    // 'he' or 'en'
  reportId: string;
  documents: DocItem[];
  sortedCategories: CategoryInfo[];
  clientToken: string;  // pre-generated 45-day HMAC token
  questions?: Array<{ text: string; answer?: string }>;
  filingType?: string;  // 'annual_report' | 'capital_statement'
  rejectedUploads?: RejectedUpload[];
}

const FILING_LABELS: Record<string, { he: string; he_definite: string; en: string }> = {
  annual_report: { he: 'דו״ח שנתי', he_definite: 'הדו״ח השנתי', en: 'annual report' },
  capital_statement: { he: 'הצהרת הון', he_definite: 'הצהרת ההון', en: 'capital statement' },
};

export interface QuestionnaireEmailParams {
  clientName: string;
  year: string;
  landingPageUrl: string;
  language?: string;   // defaults to 'he'
  showFamilyNote?: boolean;
  filingType?: string; // 'annual_report' | 'capital_statement'
}

// ── Shared HTML Builders ───────────────────────────────────────────

function wrapWithHeader(headerSubject: string, contentRows: string, dir: string = 'rtl'): string {
  const dirAttr = dir ? ` dir="${dir}"` : '';
  const dirCss = dir === 'rtl' ? 'direction:rtl; text-align:right;' : 'direction:ltr; text-align:left;';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG.outer}"${dirAttr} style="${dirCss} font-family:${FONT};">` +
    `<tr><td align="center" style="padding-top:32px; padding-right:16px; padding-bottom:32px; padding-left:16px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG.card}" style="max-width:600px; margin:0 auto; border-radius:8px;">` +
    `<tr><td align="center" bgcolor="#f7f8fa" style="background-color:#f7f8fa;padding:24px 0 16px;">` +
    `<img src="${LOGO_URL}" alt="Moshe Atsits" width="180" height="auto" style="display:block;border:0;max-width:180px;height:auto;" />` +
    `</td></tr>` +
    `<tr><td style="padding-top:24px; padding-right:32px; padding-bottom:24px; padding-left:32px; background-color:${ACCENT.clientBg}; border-bottom:3px solid ${C.brand}; border-radius:0;" dir="${dir}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="font-size:22px; font-weight:bold; color:${C.brand}; line-height:1.3; font-family:${FONT}; ${dirCss}">${headerSubject}</td></tr>` +
    `</table></td></tr>` +
    `<tr><td style="padding-top:32px; padding-right:32px; padding-bottom:32px; padding-left:32px;">` +
    contentRows +
    `</td></tr>` +
    `</table></td></tr></table>`;
}

function spacerRow(height: number): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="padding-top:${height}px; font-size:1px; line-height:1px;">&nbsp;</td></tr></table>`;
}

function dividerRow(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="padding-top:24px; padding-bottom:24px;">` +
    `<div style="border-top:1px solid ${C.border}; font-size:1px; line-height:1px;">&nbsp;</div>` +
    `</td></tr></table>`;
}

function personSectionHeader(label: string, name: string, accentColor: string, bgTint: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="border-right:4px solid ${accentColor}; background-color:${bgTint}; padding-top:8px; padding-right:16px; padding-bottom:8px; padding-left:16px; font-size:16px; font-weight:bold; color:${C.heading}; line-height:1.5; font-family:${FONT};">` +
    `${label}: <b>${name}</b>` +
    `</td></tr></table>`;
}

function categoryHeader(emoji: string, name: string): string {
  return `<tr><td style="padding-top:8px; padding-bottom:8px; font-size:16px; font-weight:bold; color:${C.body}; border-bottom:1px solid ${C.border}; line-height:1.5; font-family:${FONT};">` +
    `${emoji} ${name}` +
    `</td></tr>`;
}

function documentRow(title: string, status?: string): string {
  if (status === 'Waived') {
    return '';
  }
  if (status === 'Received') {
    return `<tr><td style="padding-top:6px; padding-right:40px; padding-bottom:6px; padding-left:16px; font-size:15px; color:${C.muted}; line-height:1.6; font-family:${FONT}; text-decoration:line-through;">` +
      `<span style="color:#059669;">&#x2611;</span> ${title}` +
      `</td></tr>`;
  }
  return `<tr><td style="padding-top:6px; padding-right:40px; padding-bottom:6px; padding-left:16px; font-size:15px; color:${C.body}; line-height:1.6; font-family:${FONT};">` +
    `&#x2610; ${title}` +
    `</td></tr>`;
}

// ── CTA + Help merged block (DL-127) ──────────────────────────────

function ctaBlock(dir: string, lang: string): string {
  const align = dir === 'rtl' ? 'right' : 'left';
  const ctaText = lang === 'en'
    ? 'Send your documents here \uD83D\uDE0A'
    : 'לשליחת המסמכים כבר עכשיו \uD83D\uDE0A';
  const helpLabel = lang === 'en' ? 'Need help? Contact us' : 'צריכים עזרה? פנו אלינו';
  const emailAddr = 'reports@moshe-atsits.co.il';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">` +
    `<tr><td style="background-color:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding-top:20px; padding-right:24px; padding-bottom:20px; padding-left:24px; direction:${dir}; text-align:${align};">` +
    `<p style="margin:0 0 8px; font-family:${FONT}; font-size:16px; font-weight:bold; color:#1e40af; line-height:1.4;">${ctaText}</p>` +
    `<a href="mailto:${emailAddr}" style="font-family:${FONT}; font-size:20px; font-weight:bold; color:#2563eb; text-decoration:none;">${emailAddr}</a>` +
    `<div style="border-top:1px dashed #bfdbfe; margin-top:16px; padding-top:14px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="font-family:${FONT};font-size:14px;font-weight:bold;color:${C.meta};padding-bottom:6px;">&#9658; ${helpLabel}</td></tr>` +
    `<tr><td style="font-family:${FONT};font-size:14px;color:${C.meta};padding-bottom:4px;">&#9742; 03-6390820 &nbsp;|&nbsp; 077-9928421</td></tr>` +
    `<tr><td style="font-family:${FONT};font-size:14px;color:${C.meta};"><a href="mailto:natan@moshe-atsits.co.il" style="color:${C.brand};text-decoration:none;font-size:14px;">&#9993; natan@moshe-atsits.co.il</a></td></tr>` +
    `<tr><td style="font-family:${FONT};font-size:14px;color:${C.meta};"><a href="${WA_URL}" target="_blank" style="color:#25D366;text-decoration:none;font-family:${FONT};font-size:14px;font-weight:bold;"><img src="${WA_ICON}" width="16" height="16" alt="WhatsApp" style="vertical-align:middle;border:0;"> WhatsApp</a></td></tr>` +
    `</table></div>` +
    `</td></tr></table>`;
}

// ── View Documents Button (DL-153) ────────────────────────────────

function viewDocsButton(reportId: string, clientToken: string, lang: string): string {
  const url = FRONTEND_BASE + '/view-documents.html?report_id=' + reportId + '&token=' + clientToken;
  const text = lang === 'en' ? 'View Documents Status' : 'צפייה בסטטוס המסמכים';
  const introText = lang === 'en'
    ? 'To view the full status of your documents and learn how to obtain them:'
    : 'לצפייה בסטטוס המלא של המסמכים והסבר על אופן הפקתם:';
  const dir = lang === 'en' ? 'ltr' : 'rtl';
  const align = lang === 'en' ? 'left' : 'right';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-top:24px;direction:' + dir + ';text-align:' + align + ';font-family:' + FONT + ';font-size:14px;color:#6b7280;line-height:1.5;">' + introText + '</td></tr><tr><td style="padding-top:12px;padding-bottom:16px;" align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#059669;border-radius:8px;min-width:200px;text-align:center;"><a href="' + url + '" style="font-family:' + FONT + ';font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;display:block;padding:14px 32px;line-height:1.4;">' + text + '</a></td></tr></table></td></tr></table>';
}

// ── No Docs Needed Box (DL-158) ───────────────────────────────────

function noDocsNeededBox(lang: string, filingType?: string): string {
  const labels = FILING_LABELS[filingType || 'annual_report'] || FILING_LABELS.annual_report;
  const isHe = lang !== 'en';
  const dir = isHe ? 'rtl' : 'ltr';
  const align = isHe ? 'right' : 'left';
  const title = isHe
    ? 'חדשות טובות!'
    : 'Great news!';
  const body = isHe
    ? `על סמך המידע שמסרת, לא נדרשים מסמכים נוספים להכנת ${labels.he_definite} שלך. נעדכן אותך כשיהיה התקדמות.`
    : `Based on the information you provided, no additional documents are needed for your ${labels.en}. We will update you when there is progress.`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="background-color:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; padding:24px; direction:${dir}; text-align:${align}; font-family:${FONT};">` +
    `<p style="margin:0 0 8px; font-size:18px; font-weight:bold; color:#065f46; line-height:1.4;">\u2705 ${title}</p>` +
    `<p style="margin:0; font-size:15px; color:#047857; line-height:1.6;">${body}</p>` +
    `</td></tr></table>`;
}

// ── Document List Grouped by Category ─────────────────────────────

function generateDocListHtml(docs: DocItem[], lang: string, sortedCategories: CategoryInfo[]): string {
  const visibleDocs = docs.filter(d => d.status !== 'Waived');
  if (visibleDocs.length === 0) return '';
  const grouped: Record<string, DocItem[]> = {};
  for (const doc of visibleDocs) {
    const cat = doc.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(doc);
  }
  let html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`;
  for (const cat of sortedCategories) {
    const catDocs = grouped[cat.category_id];
    if (!catDocs || catDocs.length === 0) continue;
    catDocs.sort((a, b) => {
      const numA = parseInt((a.type || '').replace(/\D/g, '')) || 0;
      const numB = parseInt((b.type || '').replace(/\D/g, '')) || 0;
      if (numA !== numB) return numA - numB;
      return (a.issuer_name || '').localeCompare(b.issuer_name || '');
    });
    const catName = lang === 'he' ? cat.name_he : cat.name_en;
    const emoji = cat.emoji || '\uD83D\uDCC4';
    html += categoryHeader(emoji, catName || cat.name_he);
    for (const doc of catDocs) {
      const title = lang === 'he' ? doc.issuer_name : (doc.issuer_name_en || doc.issuer_name);
      html += documentRow(title || '', doc.status);
    }
  }
  html += `</table>`;
  return html;
}

// ── Rejected Uploads Callout (DL-244, grouped by reason DL-253) ───

const REJECTION_REASONS_EN: Record<string, string> = {
  image_quality: 'Poor image quality',
  wrong_document: 'Wrong document',
  incomplete: 'Incomplete / cropped document',
  wrong_year: 'Wrong year',
  wrong_person: 'Not related to this client',
  not_relevant: 'Not relevant',
  other: 'Other',
};

export function buildRejectedUploadsCallout(
  entries: RejectedUpload[] | undefined,
  lang: 'he' | 'en',
): string {
  if (!Array.isArray(entries) || entries.length === 0) return '';

  const isHe = lang === 'he';
  const dir = isHe ? 'rtl' : 'ltr';
  const align = isHe ? 'right' : 'left';

  const title = isHe
    ? 'מסמכים שקיבלנו ממך בעבר'
    : 'Files we received from you previously';

  // Group entries by reason
  const fallbackReason = isHe ? 'נדחה ע"י המשרד' : 'Rejected by office';
  const groups = new Map<string, RejectedUpload[]>();
  for (const entry of entries) {
    const reason = isHe
      ? (entry.reason_text?.trim() || fallbackReason)
      : (REJECTION_REASONS_EN[entry.reason_code || ''] || entry.reason_text?.trim() || fallbackReason);
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason)!.push(entry);
  }

  let groupsHtml = '';
  let groupIdx = 0;
  for (const [reason, items] of groups) {
    const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Group header with ⚠ prefix
    const topPad = groupIdx > 0 ? '16px' : '0';
    groupsHtml += `<tr><td style="padding-top:${topPad};padding-bottom:4px;font-size:14px;font-weight:700;color:#92400E;direction:${dir};text-align:${align};font-family:${FONT};">\u26A0 ${esc(reason)}</td></tr>`;

    // File rows under this reason
    for (const entry of items) {
      const rawDate = entry.received_at || '';
      let dateStr = rawDate;
      const m = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        dateStr = `${m[3]}/${m[2]}/${m[1]}`;
      }
      let rowText = `\u2022 ${esc(entry.filename)} \u00B7 ${dateStr}`;
      if (entry.notes && entry.notes.trim()) {
        rowText += ` (${esc(entry.notes)})`;
      }
      groupsHtml += `<tr><td style="padding:4px 12px;font-size:14px;color:#92400E;direction:${dir};text-align:${align};font-family:${FONT};">${rowText}</td></tr>`;
    }
    groupIdx++;
  }

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">` +
    `<tr><td style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:20px;">` +
    `<table width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="font-size:16px;font-weight:700;color:#92400E;padding-bottom:12px;text-align:${align};direction:${dir};font-family:${FONT};">${title}</td></tr>` +
    `<tr><td style="padding:0;"><table width="100%" cellpadding="0" cellspacing="0" border="0">${groupsHtml}</table></td></tr>` +
    `</table></td></tr></table>`;
}

// ── Person-Separated Doc Sections ─────────────────────────────────

function separateByPerson(docs: DocItem[]): { client: DocItem[]; spouse: DocItem[] } {
  return {
    client: docs.filter(d => d.person !== 'spouse'),
    spouse: docs.filter(d => d.person === 'spouse'),
  };
}

function buildDocSection(
  cDocs: DocItem[],
  sDocs: DocItem[],
  lang: string,
  married: boolean,
  cName: string,
  sName: string,
  sortedCategories: CategoryInfo[],
  splitMode?: boolean,
  rejectedUploads?: RejectedUpload[],
): string {
  const rejCallout = buildRejectedUploadsCallout(rejectedUploads, lang as 'he' | 'en');

  if (!splitMode) {
    let html = rejCallout;
    if (cDocs.length > 0) {
      if (married) {
        const label = lang === 'en' ? 'Client documents' : 'מסמכים של הלקוח';
        html += personSectionHeader(label, cName, ACCENT.client, ACCENT.clientBg);
        html += spacerRow(8);
      }
      html += generateDocListHtml(cDocs, lang, sortedCategories);
    }
    if (married && sDocs.length > 0) {
      if (cDocs.length > 0) html += spacerRow(32);
      const label = lang === 'en' ? 'Spouse documents' : 'מסמכים של בן/בת הזוג';
      html += personSectionHeader(label, sName, ACCENT.spouse, ACCENT.spouseBg);
      html += spacerRow(8);
      html += generateDocListHtml(sDocs, lang, sortedCategories);
    }
    return html;
  }

  // Split mode: combined status counts across all persons
  const allVisible = [...cDocs, ...sDocs].filter(d => d.status !== 'Waived');
  const isMissingFn = (d: DocItem) => !d.status || d.status === 'Required_Missing' || d.status === 'Requires_Fix';
  const totalMissing = allVisible.filter(isMissingFn).length;
  const totalReceived = allVisible.filter(d => d.status === 'Received').length;
  const cLabel = lang === 'en' ? 'Client documents' : 'מסמכים של הלקוח';
  const sLabel = lang === 'en' ? 'Spouse documents' : 'מסמכים של בן/בת הזוג';

  let html = rejCallout;

  if (totalMissing > 0) {
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      `<tr><td style="padding-top:12px; padding-bottom:8px; font-size:16px; font-weight:bold; color:${C.heading}; line-height:1.4; font-family:${FONT};">` +
      `${lang === 'en' ? 'Missing' : 'חסרים'} (${totalMissing})` +
      `</td></tr></table>`;
    const cMissing = cDocs.filter(d => d.status !== 'Waived' && isMissingFn(d));
    const sMissing = sDocs.filter(d => d.status !== 'Waived' && isMissingFn(d));
    if (married && cMissing.length > 0) {
      html += personSectionHeader(cLabel, cName, ACCENT.client, ACCENT.clientBg);
      html += spacerRow(8);
    }
    if (cMissing.length > 0) html += generateDocListHtml(cMissing, lang, sortedCategories);
    if (married && sMissing.length > 0) {
      if (cMissing.length > 0) html += spacerRow(16);
      html += personSectionHeader(sLabel, sName, ACCENT.spouse, ACCENT.spouseBg);
      html += spacerRow(8);
      html += generateDocListHtml(sMissing, lang, sortedCategories);
    }
  }

  if (totalReceived > 0) {
    if (totalMissing > 0) html += spacerRow(16);
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      `<tr><td style="padding-top:12px; padding-bottom:8px; font-size:16px; font-weight:bold; color:${C.muted}; line-height:1.4; font-family:${FONT};">` +
      `${lang === 'en' ? 'Received' : 'התקבלו'} (${totalReceived})` +
      `</td></tr></table>`;
    const cReceived = cDocs.filter(d => d.status === 'Received');
    const sReceived = sDocs.filter(d => d.status === 'Received');
    if (married && cReceived.length > 0) {
      html += personSectionHeader(cLabel, cName, ACCENT.client, ACCENT.clientBg);
      html += spacerRow(8);
    }
    if (cReceived.length > 0) html += generateDocListHtml(cReceived, lang, sortedCategories);
    if (married && sReceived.length > 0) {
      if (cReceived.length > 0) html += spacerRow(16);
      html += personSectionHeader(sLabel, sName, ACCENT.spouse, ACCENT.spouseBg);
      html += spacerRow(8);
      html += generateDocListHtml(sReceived, lang, sortedCategories);
    }
  }

  return html;
}

// ── Client Questions (Inject Questions node, DL-127) ──────────────

function buildClientQuestionsHtml(questions: Array<{ text: string; answer?: string }>): string {
  const unanswered = questions.filter(q => q.text && q.text.trim() && (!q.answer || !q.answer.trim()));
  if (unanswered.length === 0) return '';

  let questionsHtml = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:20px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:16px;font-weight:700;color:#92400E;padding-bottom:12px;text-align:right;direction:rtl;font-family:${FONT};">\u2753 שאלות מהמשרד</td></tr><tr><td style="font-size:14px;color:#78350F;padding-bottom:12px;text-align:right;direction:rtl;font-family:${FONT};">נשמח לקבל מענה לשאלות הבאות בהקדם \ud83d\ude4f</td></tr><tr><td style="padding:0;"><table width="100%" cellpadding="0" cellspacing="0" border="0">`;
  unanswered.forEach((q, i) => {
    questionsHtml += `<tr><td style="padding:8px 12px;border-bottom:1px solid #FDE68A;font-size:14px;color:#92400E;direction:rtl;text-align:right;font-family:${FONT};"><strong>${i + 1}.</strong> ${q.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td></tr>`;
  });
  questionsHtml += `</table></td></tr></table></td></tr></table>`;
  return questionsHtml;
}

function injectQuestions(html: string, questions?: Array<{ text: string; answer?: string }>): string {
  if (!questions || questions.length === 0) {
    return html.replaceAll('<!-- CLIENT_QUESTIONS -->', '');
  }
  const questionsHtml = buildClientQuestionsHtml(questions);
  if (!questionsHtml) {
    return html.replaceAll('<!-- CLIENT_QUESTIONS -->', '');
  }
  return html.replaceAll('<!-- CLIENT_QUESTIONS -->', questionsHtml);
}

// ── Main Exports ──────────────────────────────────────────────────

export function buildClientEmailHtml(params: ClientEmailParams): string {
  const {
    clientName, spouseName, year, language, reportId,
    documents, sortedCategories, clientToken, questions, filingType, rejectedUploads,
  } = params;

  const isMarried = !!spouseName;
  const isEnglish = language === 'en';
  const noDocsNeeded = documents.length === 0;
  const docCount = documents.length;
  const ftLabels = FILING_LABELS[filingType || 'annual_report'] || FILING_LABELS.annual_report;
  const { client: clientDocs, spouse: spouseDocs } = separateByPerson(documents);
  const hasStatusVariation = documents.some(d => d.status && d.status !== 'Required_Missing');
  const officeEmailAddr = OFFICE_EMAIL;

  let clientEmailHtml: string;

  if (isEnglish) {
    const enDocs = noDocsNeeded ? noDocsNeededBox('en', filingType) : buildDocSection(clientDocs, spouseDocs, 'en', isMarried, clientName, spouseName, sortedCategories, undefined, rejectedUploads);
    const heDocs = noDocsNeeded ? noDocsNeededBox('he', filingType) : buildDocSection(clientDocs, spouseDocs, 'he', isMarried, clientName, spouseName, sortedCategories, undefined, rejectedUploads);

    clientEmailHtml =
      // Outer wrapper (no dir — bilingual)
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG.outer}" style="font-family:${FONT};">` +
      `<tr><td align="center" style="padding-top:32px; padding-right:16px; padding-bottom:32px; padding-left:16px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG.card}" style="max-width:600px; margin:0 auto; border-radius:8px;">` +
      // Blue header bar
      `<tr><td style="padding-top:24px; padding-right:32px; padding-bottom:24px; padding-left:32px; background-color:${ACCENT.clientBg}; border-bottom:3px solid ${C.brand}; border-radius:8px 8px 0 0;" dir="ltr">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      `<tr><td style="font-size:22px; font-weight:bold; color:${C.brand}; line-height:1.3; font-family:${FONT}; direction:ltr; text-align:left;">${noDocsNeeded ? `No Documents Needed - ${clientName} - ${year}` : `Required Documents \u2014 ${ftLabels.en} ${year} - ${clientName}`}</td></tr>` +
      `</table></td></tr>` +
      // English card
      `<tr><td style="padding-top:24px; padding-right:32px; padding-bottom:0; padding-left:32px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.border}; border-radius:8px; background-color:${BG.card};">` +
      `<tr><td style="padding:24px;" dir="ltr">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="ltr" style="direction:ltr; text-align:left;">` +
      `<tr><td style="font-size:12px; color:${C.muted}; padding-bottom:16px; font-family:${FONT};">\u{1F524} English</td></tr>` +
      `<tr><td style="font-size:15px; color:${C.body}; line-height:1.5; padding-bottom:16px; font-family:${FONT};">Dear ${clientName},</td></tr>` +
      `<tr><td style="font-size:15px; color:${C.body}; line-height:1.5; padding-bottom:24px; font-family:${FONT};">${noDocsNeeded
        ? `We have processed your questionnaire for tax year <b>${year}</b> &#10024;`
        : `We have processed your questionnaire &#10024; Below are the <b>${docCount}</b> documents required for your ${ftLabels.en}, tax year <b>${year}</b>:`}</td></tr>` +
      `<tr><td style="padding-bottom:16px;">${enDocs}</td></tr>` +
      `<tr><td><!-- CLIENT_QUESTIONS --></td></tr>` +
      `<tr><td>${viewDocsButton(reportId, clientToken, 'en')}</td></tr>` +
      `<tr><td>${ctaBlock('ltr', 'en')}</td></tr>` +
      `</table></td></tr></table></td></tr>` +
      // Spacer
      `<tr><td style="padding-top:16px; font-size:1px; line-height:1px;">&nbsp;</td></tr>` +
      // Hebrew card
      `<tr><td style="padding-top:0; padding-right:32px; padding-bottom:24px; padding-left:32px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.border}; border-radius:8px; background-color:${BG.altRow};">` +
      `<tr><td style="padding:24px;" dir="rtl">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="direction:rtl; text-align:right;">` +
      `<tr><td style="font-size:12px; color:${C.muted}; padding-bottom:16px; font-family:${FONT};">\u{1F524} עברית</td></tr>` +
      `<tr><td style="font-size:15px; color:${C.body}; line-height:1.6; padding-bottom:16px; font-family:${FONT};">שלום ${clientName},</td></tr>` +
      `<tr><td style="font-size:15px; color:${C.body}; line-height:1.6; padding-bottom:24px; font-family:${FONT};">${noDocsNeeded
        ? `סיימנו לעבד את השאלון שלך לשנת המס <b>${year}</b> &#10024;`
        : `להלן רשימת <b>${docCount}</b> המסמכים הנדרשים להכנת ${ftLabels.he_definite} לשנת המס <b>${year}</b>:`}</td></tr>` +
      `<tr><td style="padding-bottom:16px;">${heDocs}</td></tr>` +
      `<tr><td><!-- CLIENT_QUESTIONS --></td></tr>` +
      `<tr><td>${viewDocsButton(reportId, clientToken, 'he')}</td></tr>` +
      `<tr><td>${ctaBlock('rtl', 'he')}</td></tr>` +
      `</table></td></tr></table></td></tr>` +
      // Bilingual footer
      `<tr><td style="padding-top:24px; padding-right:32px; padding-bottom:24px; padding-left:32px; border-top:1px solid ${C.border};">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      `<tr><td align="center" style="font-size:14px; color:${C.muted}; line-height:1.5; font-family:${FONT};">Moshe Atsits CPA Firm / משרד רו"ח Client Name | ${officeEmailAddr}</td></tr>` +
      `</table></td></tr>` +
      `</table></td></tr></table>`;
  } else {
    const heDocs = noDocsNeeded ? noDocsNeededBox('he', filingType) : buildDocSection(clientDocs, spouseDocs, 'he', isMarried, clientName, spouseName, sortedCategories, undefined, rejectedUploads);
    const heSubject = noDocsNeeded
      ? `אין צורך במסמכים - ${ftLabels.he} ${year} - ${clientName}`
      : `דרישת מסמכים — ${ftLabels.he} ${year} - ${clientName}`;

    const heContentRows =
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      `<tr><td style="font-size:15px; color:${C.body}; line-height:1.6; padding-bottom:16px; font-family:${FONT};">שלום ${clientName},</td></tr>` +
      `<tr><td style="font-size:15px; color:${C.body}; line-height:1.6; padding-bottom:16px; font-family:${FONT};">${noDocsNeeded
        ? `סיימנו לעבד את השאלון שלך לשנת המס <b>${year}</b> &#10024;`
        : `סיימנו לעבד את השאלון שלך &#10024; להלן רשימת <b>${docCount}</b> מסמכים הנדרשים להכנת ${ftLabels.he_definite} לשנת המס <b>${year}</b>:`}</td></tr>` +
      `<tr><td>${heDocs}</td></tr>` +
      `<tr><td><!-- CLIENT_QUESTIONS --></td></tr>` +
      `<tr><td>${viewDocsButton(reportId, clientToken, 'he')}</td></tr>` +
      `<tr><td>${ctaBlock('rtl', 'he')}</td></tr>` +
      `</table>` +
      dividerRow() +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      `<tr><td align="center" style="font-size:14px; color:${C.muted}; line-height:1.5; font-family:${FONT};">משרד רו"ח Client Name | ${officeEmailAddr}</td></tr>` +
      `</table>`;

    clientEmailHtml = wrapWithHeader(heSubject, heContentRows, 'rtl');
  }

  // Inject client questions if present
  clientEmailHtml = injectQuestions(clientEmailHtml, questions);

  return clientEmailHtml;
}

export function buildClientEmailSubject(params: ClientEmailParams): string {
  const { clientName, year, language, documents, filingType } = params;
  const isEnglish = language === 'en';
  const noDocsNeeded = documents.length === 0;
  const labels = FILING_LABELS[filingType || 'annual_report'] || FILING_LABELS.annual_report;

  if (noDocsNeeded) {
    return isEnglish
      ? `No Documents Needed - ${clientName} - ${year}`
      : `אין צורך במסמכים - ${labels.he} ${year} - ${clientName}`;
  }
  return isEnglish
    ? `Required Documents \u2014 ${labels.en} ${year} - ${clientName}`
    : `דרישת מסמכים — ${labels.he} ${year} - ${clientName}`;
}

// ── Questionnaire Email (from Send Questionnaires workflow) ───────

export function contactBlock(): string {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">'
    + '<tr><td style="padding:20px 24px;background-color:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;direction:rtl;text-align:right;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td style="font-family:' + FONT + ';font-size:14px;font-weight:bold;color:#374151;padding-bottom:10px;">&#9658; צריכים עזרה? פנו אלינו</td></tr>'
    + '<tr><td style="font-family:' + FONT + ';font-size:14px;color:#374151;padding-bottom:4px;">&#9742; 03-6390820 &nbsp;|&nbsp; 077-9928421</td></tr>'
    + '<tr><td style="font-family:' + FONT + ';font-size:14px;color:#374151;padding-bottom:12px;"><a href="mailto:natan@moshe-atsits.co.il" style="color:#2563eb;text-decoration:none;">&#9993; natan@moshe-atsits.co.il</a></td></tr>'
    + '<tr><td style="padding-top:4px;"><a href="' + WA_URL + '" target="_blank" style="color:#25D366;text-decoration:none;font-family:' + FONT + ';font-size:14px;font-weight:bold;"><img src="' + WA_ICON + '" width="18" height="18" alt="WhatsApp" style="vertical-align:middle;border:0;"> WhatsApp</a></td></tr>'
    + '</table></td></tr></table>';
}

function questionnaireCtaButton(url: string): string {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">'
    + '<tr><td align="center" bgcolor="#2563eb" style="border-radius:8px;">'
    + '<a href="' + url + '" target="_blank" style="display:inline-block;padding:0 32px;font-family:' + FONT + ';font-size:16px;font-weight:bold;line-height:48px;color:#ffffff;text-decoration:none;max-width:240px;width:100%;text-align:center;">&#128203; מלא/י שאלון / Fill Questionnaire</a>'
    + '</td></tr></table>';
}

function familyNoteRow(): string {
  return '<tr><td style="padding-bottom:16px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fef9c3;border-right:3px solid #eab308;border-radius:4px;">'
    + '<tr><td style="padding:12px 16px;font-family:' + FONT + ';font-size:14px;color:#92400e;line-height:1.6;">'
    + '<strong>הודעה חשובה:</strong> מייל זה נשלח גם לבן/בת הזוג. יש למלא <strong>שאלון אחד בלבד</strong> עבור כל התא המשפחתי — אין צורך שכל אחד ימלא בנפרד.'
    + '</td></tr></table></td></tr>';
}

// --- Questionnaire email content by filing type ---

interface QuestionnaireContent {
  headerText: string;
  bodyRows: string[];
  footerText: string;
}

function arQuestionnaireContent(year: string): QuestionnaireContent {
  const P = ';font-family:' + FONT + ';font-size:15px;color:#374151;line-height:1.6;';
  return {
    headerText: 'שאלון \u2014 דוח שנתי ' + year,
    bodyRows: [
      '<tr><td style="' + P + 'padding-bottom:16px;">'
        + 'מצורף שאלון לטובת הכנת הדוח השנתי שלך לשנת <strong>' + year + '</strong>.'
        + '</td></tr>',
      '<tr><td style="' + P + 'padding-bottom:24px;">'
        + 'יש למלא את השאלון <strong>באופן מיידי</strong> על מנת שנוכל להתחיל לעבוד על הדוח בהקדם.'
        + '</td></tr>',
      // --- CTA + family note injected by shell ---
      '<tr><td style="' + P + 'padding-bottom:16px;">'
        + 'לאחר סיום מילוי השאלון יישלחו אלינו הפרטים ונשלח אליך מייל עם רשימת מסמכים נדרשים לצורך הכנת הדוח השנתי.'
        + '</td></tr>',
      '<tr><td style="' + P + 'padding-bottom:16px;">'
        + 'כל שאלה מתייחסת לכל הנפשות בתא המשפחתי (כולל בן/בת זוג וילדים עד גיל 18).'
        + '</td></tr>',
      '<tr><td style="' + P + 'padding-bottom:24px;">'
        + 'יש לתת לכל שאלה את מלוא תשומת הלב, היות ולכל שאלה יש משמעות לגבי חבות המס שלך בשנת <strong>' + year + '</strong>.'
        + '</td></tr>',
    ],
    footerText: 'מייל זה נשלח אוטומטית לצורך הכנת הדוח השנתי שלך.',
  };
}

function csQuestionnaireContent(year: string): QuestionnaireContent {
  const P = ';font-family:' + FONT + ';font-size:15px;color:#374151;line-height:1.6;';
  return {
    headerText: 'שאלון \u2014 הצהרת הון ליום 31.12.' + year,
    bodyRows: [
      '<tr><td style="' + P + 'padding-bottom:16px;">'
        + 'קיבלת דרישה ממס הכנסה להגיש הצהרת הון ליום <strong>31.12.' + year + '</strong>.'
        + '</td></tr>',
      '<tr><td style="' + P + 'padding-bottom:16px;">'
        + 'הצהרת הון היא הכלי של מס הכנסה להילחם בהון שחור והיא מגיעה בד"כ פעם בחמש שנים באופן יזום ממס הכנסה.'
        + '</td></tr>',
      '<tr><td style="' + P + 'padding-bottom:16px;">'
        + 'לרוב ההצהרה הראשונה היא ליום 31 בדצמבר של השנה שבה פתחת את העסק (אך לא תמיד).'
        + '</td></tr>',
      '<tr><td style="' + P + 'padding-bottom:24px;">'
        + 'לקראת הכנת דוח הצהרת ההון שלך ליום <strong>31.12.' + year + '</strong>, נא למלא את השאלון הבא. יש למלא אותו עבור <strong>כל התא המשפחתי</strong>:'
        + '</td></tr>',
      // --- CTA + family note injected by shell ---
      '<tr><td style="' + P + 'padding-bottom:16px;">'
        + 'לאחר מילוי השאלון נשלח רשימת מסמכים לצורך הכנת הצהרת ההון אותם יש לרכז בהקדם ולהעביר לנו על מנת שנוכל להכין את הדוח ולהגישו בזמן.'
        + '</td></tr>',
      '<tr><td style="' + P + 'padding-bottom:16px;">'
        + 'אם יש סעיף בשאלון שאינו ברור אפשר למלא "לא בטוח/צריך לבדוק" \u2014 ואנחנו נרשום לך ברשימת המסמכים לבדוק את זה.'
        + '</td></tr>',
      '<tr><td style="' + P + 'padding-bottom:24px;">'
        + 'שכ"ט להצהרת הון ראשונה הוא <strong>1,000 &#8362; + מע"מ</strong>.'
        + '</td></tr>',
    ],
    footerText: 'מייל זה נשלח אוטומטית לצורך הכנת הצהרת ההון שלך.',
  };
}

export function buildQuestionnaireEmailHtml(params: QuestionnaireEmailParams): string {
  const { clientName, year, landingPageUrl, showFamilyNote, filingType } = params;
  const isCS = filingType === 'capital_statement';
  const content = isCS ? csQuestionnaireContent(year) : arQuestionnaireContent(year);

  // Split body rows: before CTA and after CTA
  // AR: 2 rows before CTA, 3 after. CS: 4 rows before CTA, 3 after.
  const ctaIndex = isCS ? 4 : 2;
  const beforeCta = content.bodyRows.slice(0, ctaIndex).join('');
  const afterCta = content.bodyRows.slice(ctaIndex).join('');

  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f8fa" dir="rtl" style="direction:rtl;text-align:right;font-family:' + FONT + ';">'
    + '<tr><td align="center" style="padding:32px 16px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;margin:0 auto;border-radius:8px;">'
    + '<tr><td align="center" bgcolor="#f7f8fa" style="background-color:#f7f8fa;padding:24px 0 16px;"><img src="' + LOGO_URL + '" alt="Moshe Atsits" width="180" height="auto" style="display:block;border:0;max-width:180px;height:auto;" /></td></tr>'
    + '<tr><td style="padding:24px 32px;background-color:#eff6ff;border-bottom:3px solid #2563eb;border-radius:0;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td style="font-family:' + FONT + ';font-size:22px;font-weight:bold;color:#2563eb;line-height:1.3;">' + content.headerText + '</td></tr>'
    + '</table></td></tr>'
    + '<tr><td style="padding:32px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td style="font-family:' + FONT + ';font-size:16px;color:#374151;line-height:1.6;padding-bottom:16px;">שלום ' + clientName + ',</td></tr>'
    + beforeCta
    + '<tr><td style="padding-bottom:16px;text-align:center;">' + questionnaireCtaButton(landingPageUrl) + '</td></tr>'
    + (showFamilyNote ? familyNoteRow() : '')
    + '<tr><td style="font-family:' + FONT + ';font-size:14px;color:#9ca3af;text-align:center;padding-bottom:24px;">השאלון זמין בעברית ובאנגלית | Questionnaire available in Hebrew and English</td></tr>'
    + afterCta
    + '<tr><td>' + contactBlock() + '</td></tr>'
    + '<tr><td style="font-family:' + FONT + ';font-size:15px;color:#374151;line-height:1.6;padding-top:24px;">'
    + 'בברכה,<br><strong>צוות משרד רו"ח Client Name</strong>'
    + '</td></tr>'
    + '</table></td></tr>'
    + '<tr><td style="padding:16px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td align="center" style="font-family:' + FONT + ';font-size:12px;color:#9ca3af;line-height:1.5;">'
    + content.footerText
    + '</td></tr></table></td></tr>'
    + '</table></td></tr></table>';
}

export function buildQuestionnaireEmailSubject(year: string, filingType?: string): string {
  const label = filingType === 'capital_statement' ? 'הצהרת הון' : 'דוח שנתי';
  return 'שאלון \u2014 ' + label + ' ' + year;
}

// ── Comment/Reply Email (DL-266) ──────────────────────────────────

interface CommentEmailParams {
  commentText: string;
  clientName: string;
  year: string;
}

export function buildCommentEmailHtml(params: CommentEmailParams): string {
  const { commentText, clientName, year } = params;
  const escapedComment = commentText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + BG.outer + '" dir="rtl" style="direction:rtl;text-align:right;font-family:' + FONT + ';">'
    + '<tr><td align="center" style="padding:32px 16px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + BG.card + '" style="max-width:600px;margin:0 auto;border-radius:8px;">'
    // Logo
    + '<tr><td align="center" bgcolor="' + BG.outer + '" style="background-color:' + BG.outer + ';padding:24px 0 16px;"><img src="' + LOGO_URL + '" alt="Moshe Atsits" width="180" height="auto" style="display:block;border:0;max-width:180px;height:auto;" /></td></tr>'
    // Blue header bar
    + '<tr><td style="padding:16px 32px;background-color:' + ACCENT.clientBg + ';border-bottom:3px solid ' + C.brand + ';">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td style="font-family:' + FONT + ';font-size:20px;font-weight:bold;color:' + C.brand + ';line-height:1.3;">'
    + 'הודעה ממשרד רו"ח Client Name \u2014 ' + year
    + '</td></tr></table></td></tr>'
    // Body
    + '<tr><td style="padding:32px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td style="font-family:' + FONT + ';font-size:16px;color:' + C.body + ';line-height:1.6;padding-bottom:16px;">'
    + 'שלום ' + clientName + ','
    + '</td></tr>'
    + '<tr><td style="font-family:' + FONT + ';font-size:15px;color:' + C.body + ';line-height:1.6;padding-bottom:24px;">'
    + escapedComment
    + '</td></tr>'
    // Contact block
    + '<tr><td>' + contactBlock() + '</td></tr>'
    + '<tr><td style="font-family:' + FONT + ';font-size:15px;color:' + C.body + ';line-height:1.6;padding-top:16px;border-top:1px solid ' + C.border + ';">'
    + 'בברכה,<br><strong>צוות משרד רו"ח Client Name</strong>'
    + '</td></tr>'
    + '</table></td></tr>'
    // Footer
    + '<tr><td style="padding:16px 32px;background-color:' + BG.altRow + ';border-top:1px solid ' + C.border + ';border-radius:0 0 8px 8px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td align="center" style="font-family:' + FONT + ';font-size:12px;color:' + C.muted + ';line-height:1.5;">'
    + 'מייל זה נשלח ממשרד רו"ח Client Name בנוגע לתיק ' + year + ' שלך.'
    + '</td></tr></table></td></tr>'
    + '</table></td></tr></table>';
}

export function buildCommentEmailSubject(year: string): string {
  return 'הודעה ממשרד רו"ח Client Name \u2014 דוחות ' + year;
}

// ── Batch Questions Email (DL-328) ─────────────────────────────────

export interface BatchQuestionItem {
  file_id: string;
  attachment_name: string;
  short_name: string;
  question: string;
}

export function buildBatchQuestionsSubject(
  filingType: string,
  year: string | number,
  language: string,
): string {
  const isCapital = filingType === 'capital_statement';
  const labelHe = isCapital ? 'הצהרת הון' : 'דו״ח שנתי';
  const labelEn = isCapital ? 'Capital Statement' : 'Annual Report';
  return language === 'en'
    ? `Questions about the documents you sent - ${labelEn} ${year}`
    : `שאלות לגבי המסמכים שהעברת - ${labelHe} ${year}`;
}

export function buildBatchQuestionsHtml(
  clientName: string,
  language: string,
  questions: BatchQuestionItem[],
  filingType: string,
  year: string | number,
): string {
  const isEnglish = language === 'en';
  const dir = isEnglish ? 'ltr' : 'rtl';
  const align = isEnglish ? 'left' : 'right';

  const greeting = isEnglish
    ? `Dear ${clientName},`
    : `שלום ${clientName},`;

  const intro = isEnglish
    ? `After reviewing the documents you sent, we have a few questions:`
    : `לאחר עיון במסמכים שהעברת, יש לנו מספר שאלות:`;

  const replyText = isEnglish
    ? `Please reply to this email with your answers.`
    : `נודה לתשובתך במענה לאימייל זה.`;

  const docLabel = isEnglish ? 'Document' : 'שם המסמך';
  const questionLabel = isEnglish ? 'Question' : 'שאלה';
  const footerText = isEnglish
    ? `Moshe Atsits CPA Firm | ${OFFICE_EMAIL}`
    : `משרד רו"ח Client Name | ${OFFICE_EMAIL}`;

  // Build question cards
  let cardsHtml = '';
  questions.forEach((q, i) => {
    const docName = q.short_name
      ? `${q.short_name} (${q.attachment_name})`
      : q.attachment_name;
    const docRow = docName
      ? `<tr><td style="font-size:13px;color:#6b7280;padding-bottom:4px;direction:${dir};text-align:${align};">${docLabel}: <strong style="color:#374151;">${docName}</strong></td></tr>`
      : '';
    cardsHtml +=
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">` +
      `<tr><td style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-family:${FONT};">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      `<tr><td style="font-size:12px;font-weight:bold;color:#6b7280;padding-bottom:6px;direction:${dir};text-align:${align};">${i + 1}.</td></tr>` +
      docRow +
      `<tr><td style="font-size:15px;color:#111827;line-height:1.6;direction:${dir};text-align:${align};">${questionLabel}: ${q.question}</td></tr>` +
      `</table>` +
      `</td></tr></table>`;
  });

  const headerSubject = buildBatchQuestionsSubject(filingType, year, language);

  const contentRows =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="font-size:15px; color:${C.body}; line-height:1.6; padding-bottom:16px; font-family:${FONT}; direction:${dir}; text-align:${align};">${greeting}</td></tr>` +
    `<tr><td style="font-size:15px; color:${C.body}; line-height:1.6; padding-bottom:24px; font-family:${FONT}; direction:${dir}; text-align:${align};">${intro}</td></tr>` +
    `<tr><td style="padding-bottom:16px;">${cardsHtml}</td></tr>` +
    `<tr><td style="font-size:15px; color:${C.body}; line-height:1.6; padding-bottom:16px; font-family:${FONT}; direction:${dir}; text-align:${align};">${replyText}</td></tr>` +
    (isEnglish ? '' : `<tr><td>${contactBlock()}</td></tr>`) +
    `</table>` +
    dividerRow() +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td align="center" style="font-size:14px; color:${C.muted}; line-height:1.5; font-family:${FONT};">${footerText}</td></tr>` +
    `</table>`;

  return wrapWithHeader(headerSubject, contentRows, dir);
}
