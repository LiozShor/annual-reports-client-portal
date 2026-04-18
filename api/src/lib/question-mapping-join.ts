/**
 * DL-302: PA card hover cross-reference — join answers ↔ doc templates via the
 * Airtable `question_mappings` table.
 *
 * Schema (tblWr2sK1YvyLWG3X):
 *   - mapping_id, label_he, label_en
 *   - tally_key_he      e.g. "question_d6arvd" or UUID (capital-statement Tally)
 *   - airtable_field_name  Hebrew column name in the questionnaire row
 *   - template_ids      singleSelect — single template (e.g. "T501")
 *   - condition         "yes" | "no" | "has_value" | literal | (empty → always)
 *   - per_item, is_spouse (checkbox)
 *   - filing_type       "annual_report" | "capital_statement"
 *
 * Join key: `airtable_field_name` matches the answer's raw column key (before
 * `cs_` stripping). For yes/no questions whose raw key is `question_xxx`,
 * `format-questionnaire.ts` filters them out today, so they never appear as
 * hover sources — their generated docs simply show as orphans.
 */

import type { AirtableRecord } from './airtable';
import type { AnswerEntry } from './format-questionnaire';

export interface QuestionMappingFields {
  mapping_id?: string;
  tally_key_he?: string;
  airtable_field_name?: string;
  template_ids?: string;
  condition?: string;
  per_item?: boolean;
  is_spouse?: boolean;
  filing_type?: string;
}

export type QuestionMappingRecord = AirtableRecord<QuestionMappingFields>;

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

/** Port of workflow-processor-n8n.js shouldGenerateDocs(). */
function shouldGenerateDocs(condition: string | undefined, value: string): boolean {
  if (!value) return false;
  const c = (condition || '').trim().toLowerCase();
  if (!c) return true;
  const v = value.trim().toLowerCase();
  if (c === 'has_value') return v.length > 0;
  if (c === 'yes') return v === '✓ כן' || v === '✓ yes' || v === 'כן' || v === 'yes' || v === 'true';
  if (c === 'no') return v === '✗ לא' || v === '✗ no' || v === 'לא' || v === 'no' || v === 'false';
  return v === c;
}

export interface JoinIndex {
  /** raw answer key → template IDs that the answer triggers. */
  byAnswerKey: Map<string, string[]>;
  /** template ID → set of raw answer keys that trigger it (for orphan detection on the doc side). */
  byTemplateId: Map<string, Set<string>>;
}

/**
 * Pre-build a per-filing-type lookup from the mappings table. Cheap to call
 * per request — we only iterate the mappings once for both directions.
 */
export function indexMappings(
  mappings: QuestionMappingRecord[],
  filingType: string,
): { byKey: Map<string, QuestionMappingFields[]> } {
  const byKey = new Map<string, QuestionMappingFields[]>();
  for (const rec of mappings) {
    const f = rec.fields;
    if (!f.template_ids) continue;
    if (f.filing_type && f.filing_type !== filingType) continue;
    // index by both raw airtable_field_name AND tally_key_he so future
    // yes/no chip rendering (DL-299 follow-up) can pick up the link too.
    const keys = [f.airtable_field_name, f.tally_key_he].filter(Boolean) as string[];
    for (const k of keys) {
      const arr = byKey.get(k) || [];
      arr.push(f);
      byKey.set(k, arr);
    }
  }
  return { byKey };
}

/**
 * Mutates each AnswerEntry to attach `template_ids: string[]` based on the
 * mapping table. Returns the same array for chaining.
 */
export function attachTemplateIds(
  answers: AnswerEntry[],
  mappings: QuestionMappingRecord[],
  filingType: string,
): AnswerEntry[] {
  const { byKey } = indexMappings(mappings, filingType);
  for (const a of answers) {
    const key = a.tally_key || a.label;
    const candidates = byKey.get(key);
    if (!candidates || candidates.length === 0) continue;
    const triggered = new Set<string>();
    for (const m of candidates) {
      if (!m.template_ids) continue;
      if (!shouldGenerateDocs(m.condition, norm(a.value))) continue;
      triggered.add(m.template_ids);
    }
    if (triggered.size > 0) a.template_ids = Array.from(triggered);
  }
  return answers;
}
