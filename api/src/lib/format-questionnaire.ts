/**
 * Port of [SUB] Format Questionnaire (9zqfOuniztQc2hEl).
 * Transforms raw Airtable questionnaire records into structured Q&A.
 */

const HIDDEN_FIELD_LABELS = [
  'report_record_id', 'client_id', 'year', 'questionnaire_token',
  'full_name', 'email', 'report_id', 'token',
  'סטטוס', 'הערות פנימיות', 'source_language',
  'id', 'createdTime',
  'טלפון', 'phone', 'Phone Number', 'מספר טלפון',
];

const HIDDEN_FIELD_KEYS = [
  'question_mGYN0A', 'question_mGYNJ6', 'question_vAekdl', 'question_K65baX',
];

const SYSTEM_FIELDS = new Set([
  'report_record_id', 'client_id', 'year', 'questionnaire_token',
  'source_language', 'email', 'סטטוס', 'תאריך הגשה', 'הערות פנימיות',
  'טלפון', 'phone', 'Phone Number', 'מספר טלפון',
]);

const WITHDRAWAL_ANCHOR = 'סוג כספים שנמשכו';
const INSURANCE_FIELDS_AFTER_WITHDRAWAL = [
  'חברת ביטוח - קרן השתלמות',
  'חברת ביטוח - קרן פנסיה',
  'חברת ביטוח - קופת גמל להשקעה',
];

export interface ClientInfo {
  name: string;
  spouse: string;
  email: string;
  phone: string;
  year: string;
  submission_date: string;
  report_record_id: string;
}

export interface AnswerEntry {
  label: string;
  value: string;
}

export interface FormattedQuestionnaire {
  client_info: ClientInfo;
  answers: AnswerEntry[];
  raw_answers: Record<string, unknown>;
}

function normalizePhone(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function isHiddenField(key: string): boolean {
  if (HIDDEN_FIELD_LABELS.includes(key)) return true;
  if (HIDDEN_FIELD_KEYS.includes(key)) return true;
  if (key.toLowerCase().includes('hidden')) return true;
  return false;
}

function formatAnswerValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ');
  }
  if (typeof value === 'boolean') return value ? '✓ כן' : '✗ לא';
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => k + ': ' + v)
      .join(', ');
  }
  const strVal = String(value).trim().toLowerCase();
  if (strVal === 'yes' || strVal === 'כן') return '✓ כן';
  if (strVal === 'no' || strVal === 'לא') return '✗ לא';
  const str = String(value).trim();
  if (!str) return null;
  return str;
}

/**
 * Format raw Airtable questionnaire records into structured Q&A.
 * Equivalent to the [SUB] Format Questionnaire n8n sub-workflow.
 */
export function formatQuestionnaire(
  rec: Record<string, unknown>
): FormattedQuestionnaire {
  const rawPhone =
    (rec['טלפון'] as string) ||
    (rec['phone'] as string) ||
    (rec['Phone Number'] as string) ||
    (rec['מספר טלפון'] as string) ||
    '';

  const client_info: ClientInfo = {
    name: (rec['שם ושם משפחה'] as string) || (rec['full_name'] as string) || '',
    spouse: (rec['שם בן/בת הזוג'] as string) || '',
    email: (rec['email'] as string) || '',
    phone: normalizePhone(rawPhone),
    year: String(rec['year'] || ''),
    submission_date: (rec['תאריך הגשה'] as string) || '',
    report_record_id: (rec['report_record_id'] as string) || '',
  };

  // Build raw answers (non-system, non-question_ fields)
  const raw_answers: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (!SYSTEM_FIELDS.has(key) && !key.startsWith('question_')) {
      raw_answers[key] = value;
    }
  }

  // Build ordered answers — skip hidden and empty
  const answerEntries: AnswerEntry[] = [];
  for (const [key, value] of Object.entries(raw_answers)) {
    if (isHiddenField(key)) continue;
    const formatted = formatAnswerValue(value);
    if (formatted === null) continue;
    // Strip leading "cs_" prefix from CS questionnaire column names so the
    // email and admin Q&A view show clean Hebrew labels (DL-182 prefixed CS
    // columns to disambiguate them in the shared submissions table).
    const label = key.replace(/^cs_/, '');
    answerEntries.push({ label, value: formatted });
  }

  // Reorder: move insurance fields after withdrawal anchor
  const anchorIdx = answerEntries.findIndex(e => e.label === WITHDRAWAL_ANCHOR);
  if (anchorIdx >= 0) {
    const insuranceItems: AnswerEntry[] = [];
    const filtered: AnswerEntry[] = [];
    for (const entry of answerEntries) {
      if (INSURANCE_FIELDS_AFTER_WITHDRAWAL.includes(entry.label)) {
        insuranceItems.push(entry);
      } else {
        filtered.push(entry);
      }
    }
    const newAnchorIdx = filtered.findIndex(e => e.label === WITHDRAWAL_ANCHOR);
    if (newAnchorIdx >= 0 && insuranceItems.length > 0) {
      filtered.splice(newAnchorIdx + 1, 0, ...insuranceItems);
    }
    return { client_info, answers: filtered, raw_answers };
  }

  return { client_info, answers: answerEntries, raw_answers };
}
