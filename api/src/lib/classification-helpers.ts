/**
 * classification-helpers.ts
 *
 * Shared helpers used by classification endpoints:
 *   - get-pending-classifications
 *   - review-classification
 */

import type { TemplateInfo } from './doc-builder';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DRIVE_ID =
  'b!SxgoZqBDPEO0HvDis07yp0Xz4ILuDT1HgybQqCBgswSh1U7riujVTp5LgjZqkM_c';

export const HE_TITLE: Record<string, string> = {
  T001:'אישור תושב', T002:'ספח תעודת זהות', T003:'מסמכי שינוי מצב משפחתי',
  T101:'אישור ועדת השמה', T102:'אישור קצבת ילד נכה',
  T201:'טופס 106', T202:'טופס 106',
  T302:'אישור קצבה ביטוח לאומי',
  T303:'אישור קצבת נכות', T304:'אישור דמי לידה',
  T305:'אישור קצבת שאירים', T306:'אישור קצבת שאירים',
  T401:'אישור משיכת ביטוח', T402:'אישור משיכת ביטוח',
  T501:'אישור שנתי קופת גמל', T601:'טופס 867',
  T701:'דוח רווחי קריפטו', T801:'אישור זכייה',
  T901:'חוזה שכירות (הכנסה)', T902:'חוזה שכירות (הוצאה)',
  T1001:'רשימת מלאי', T1101:'אישור ניכוי מס הכנסה', T1102:'אישור ניכוי ביטוח לאומי',
  T1201:'קבלות תרומה', T1301:'תעודת שחרור צבאי',
  T1401:'קבלות הוצאות אבל', T1402:'מסמכי מוסד', T1403:'מסמכי פטור ממס',
  T1501:'תעודת השכלה', T1601:'אסמכתאות הכנסה מחול', T1602:'דוח מס מחול',
  T1701:'מסמכי הכנסה אחרת',
};

export const REJECTION_REASONS: Record<string, string> = {
  image_quality: 'איכות תמונה ירודה',
  wrong_document: 'מסמך לא נכון',
  incomplete: 'מסמך חלקי / חתוך',
  wrong_year: 'שנה לא נכונה',
  wrong_person: 'לא שייך ללקוח',
  not_relevant: 'מסמך לא רלוונטי',
  has_question: 'בהמתנה לתשובת לקוח',
  other: 'אחר',
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function sanitizeFilename(name: string): string {
  const noHtml = name.replace(/<[^>]*>?/gm, '');
  return noHtml.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// buildShortName
// ---------------------------------------------------------------------------

/**
 * Resolves a display name from a template's `short_name_he` pattern + the
 * issuer name (which may contain `<b>…</b>` bold segments).
 *
 * Returns `null` when the template is not found, has no `short_name_he`, or
 * the result is empty after cleanup.
 */
export function buildShortName(
  templateId: string,
  issuerName: string,
  templateMap: Map<string, TemplateInfo>,
): string | null {
  // Step 1 — look up template
  const template = templateMap.get(templateId);
  if (!template || !template.short_name_he) return null;

  const pattern = template.short_name_he;

  // Step 2 — parse {varName} placeholders from pattern
  const placeholderRegex = /\{(\w+)\}/g;
  const placeholders: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = placeholderRegex.exec(pattern)) !== null) {
    placeholders.push(m[1]);
  }

  // Step 3 — extract all <b>…</b> segments from issuerName (outermost tags)
  const boldTagRegex = /<b>(.*?)<\/b>/gi;
  const boldSegments: string[] = [];
  let bm: RegExpExecArray | null;
  let hasBolds = false;
  while ((bm = boldTagRegex.exec(issuerName ?? '')) !== null) {
    hasBolds = true;
    boldSegments.push(bm[1]);
  }
  // DL-355: Only fall through to whole-string-as-issuer when the input is meaningfully
  // different from the template's own title. Otherwise we'd substitute "טופס 106" into
  // a "טופס 106 – {issuer}" pattern and get "טופס 106 – טופס 106".
  if (!hasBolds && issuerName && issuerName.trim()) {
    const trimmed = issuerName.trim().replace(/<[^>]+>/g, '').trim();
    const heTitle = (HE_TITLE[templateId] || '').trim();
    const nameHePlain = (template.name_he || '').replace(/\*\*/g, '').trim();
    const isTemplateTitleEcho =
      trimmed === heTitle ||
      trimmed === nameHePlain ||
      trimmed === pattern.replace(/<[^>]+>/g, '').replace(/\{\w+\}/g, '').replace(/\s+/g, ' ').trim();
    if (!isTemplateTitleEcho) {
      boldSegments.push(trimmed);
    }
  }

  // Step 4 — identify literal bolds in the template (not variable placeholders)
  // A literal bold is a <b>…</b> in the pattern that does NOT wrap a {varName}
  const templateBoldRegex = /<b>(.*?)<\/b>/gi;
  const literalBolds = new Set<string>();
  let tbm: RegExpExecArray | null;
  while ((tbm = templateBoldRegex.exec(pattern)) !== null) {
    const inner = tbm[1].trim();
    // If the inner content is exactly a placeholder like {varName}, skip it
    if (!/^\{\w+\}$/.test(inner)) {
      literalBolds.add(inner);
    }
  }

  // Step 5 — filter out segments that match literal bolds
  // Step 5b — also filter literal bolds from the FULL name_he pattern
  if (template.name_he) {
    const fullPatternBoldRegex = /\*\*(.*?)\*\*/g;
    let fpm;
    while ((fpm = fullPatternBoldRegex.exec(template.name_he)) !== null) {
      const inner = fpm[1].trim();
      if (!inner.includes('{')) {  // literal, not a variable
        literalBolds.add(inner);
      }
    }
  }
  const variableSegments = boldSegments.filter((seg) => !literalBolds.has(seg));

  // Step 6 — if more segments than variables, concatenate extras with ' – '
  let resolvedValues: string[];
  if (placeholders.length === 0) {
    resolvedValues = [];
  } else if (variableSegments.length <= placeholders.length) {
    resolvedValues = variableSegments;
  } else {
    // First (placeholders.length - 1) segments map 1-to-1; remainder merged
    resolvedValues = [
      ...variableSegments.slice(0, placeholders.length - 1),
      variableSegments.slice(placeholders.length - 1).join(' – '),
    ];
  }

  // Steps 7–8 — replace {varName} with resolved values, strip unresolved ones
  let result = pattern;
  for (let i = 0; i < placeholders.length; i++) {
    const varName = placeholders[i];
    const value = resolvedValues[i];
    if (value !== undefined && value.length > 0) {
      result = result.replace(`{${varName}}`, `<b>${value}</b>`);
    } else {
      // Strip unresolved placeholder
      result = result.replace(`{${varName}}`, '');
    }
  }

  // Step 9 — clean up trailing separators and dangling whitespace
  result = result
    .replace(/\s*–\s*$/, '')   // trailing ' – '
    .replace(/\s*-\s*$/, '')   // trailing ' - '
    .replace(/–\s*$/, '')
    .replace(/-\s*$/, '')
    // DL-355: also clean up double separators / parens left when {issuer} stripped mid-pattern
    .replace(/\s*–\s*–\s*/g, ' – ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Step 10 — return null if empty
  return result.length > 0 ? result : null;
}

// ---------------------------------------------------------------------------
// resolveOneDriveFilename — DL-355 single source of truth for OneDrive renames
// ---------------------------------------------------------------------------

/**
 * Resolves the canonical OneDrive filename for a document. Used by every
 * write/rename path (admin upload, inbound classification, approve, reassign,
 * PDF split). Always returns a `.pdf` filename (per DL-115 conversion rule).
 *
 * Resolution order:
 *   1. buildShortName(templateId, issuerName, templateMap) — preferred
 *   2. HE_TITLE[templateId] (+ optional issuer suffix)
 *   3. sanitized stem of attachmentName
 *   4. literal fallback "מסמך.pdf"
 */
export function resolveOneDriveFilename(opts: {
  templateId: string | null | undefined;
  issuerName: string | null | undefined;
  attachmentName?: string | null;
  templateMap: Map<string, TemplateInfo>;
  /** Optional suffix appended before .pdf (e.g. T901/T902 rental period). */
  suffix?: string | null;
}): string {
  const { templateId, issuerName, attachmentName, templateMap, suffix } = opts;
  const issuerStr = (issuerName ?? '').toString();
  const issuerPlain = issuerStr.replace(/<[^>]+>/g, '').trim();

  let base: string | null = null;

  // 1. buildShortName
  if (templateId) {
    const short = buildShortName(templateId, issuerStr, templateMap);
    if (short) base = sanitizeFilename(short);
  }

  // 2. HE_TITLE fallback (only append issuer if it's not an echo of the title)
  if (!base && templateId && HE_TITLE[templateId]) {
    const title = HE_TITLE[templateId];
    const issuerForFallback = issuerPlain && issuerPlain !== title ? ' – ' + issuerPlain : '';
    base = sanitizeFilename(title + issuerForFallback);
  }

  // 3. attachment_name stem
  if (!base && attachmentName) {
    const stem = attachmentName.replace(/\.[a-z0-9]+$/i, '');
    base = sanitizeFilename(stem);
  }

  // 4. last-resort literal
  if (!base) base = 'מסמך';

  // Optional suffix (e.g. rental period)
  if (suffix && suffix.trim()) base += ' ' + suffix.trim();

  return base + '.pdf';
}
