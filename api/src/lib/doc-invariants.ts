/**
 * DL-356: Documents-table state invariants.
 *
 * Centralizes the rule established in DL-205: any Documents row whose
 * `status` is set to `Required_Missing` must have its file/source/AI/review
 * fields nulled in the same PATCH. Previously this logic was duplicated
 * across edit-documents, classifications.reject, classifications.reassign,
 * and classifications.revert_cascade — each with a slightly different
 * field list. A residual stale `onedrive_item_id` on a Required_Missing
 * row is what produced the MS Graph 404 that triggered this design log.
 *
 * Usage: any code path that may write `status: 'Required_Missing'`
 * to the Documents table should pass its update payload through
 * `applyMissingStatusInvariant` BEFORE sending it to Airtable.
 */

/**
 * Canonical list of fields that must be `null` whenever a Documents row
 * is in (or transitions to) `Required_Missing`. Setting `null` on an
 * already-null field is a no-op, so this is idempotent.
 */
export const MISSING_STATE_NULL_FIELDS = [
  // file location
  'file_url',
  'onedrive_item_id',
  'expected_filename',
  'file_hash',
  'uploaded_at',
  'attachment_name',
  'document_uid',
  // source email metadata
  'source_attachment_name',
  'source_message_id',
  'source_internet_message_id',
  'source_sender_email',
  // AI classification
  'ai_confidence',
  'ai_reason',
  // review state
  'review_status',
  'reviewed_by',
  'reviewed_at',
] as const;

/**
 * If `fields.status === 'Required_Missing'`, sets every field in
 * `MISSING_STATE_NULL_FIELDS` to `null` on the same object. Mutates
 * and returns `fields` for fluent use. Safe to call when status is
 * something else — it's a no-op then.
 */
export function applyMissingStatusInvariant<T extends Record<string, unknown>>(fields: T): T {
  if (fields.status !== 'Required_Missing') return fields;
  for (const f of MISSING_STATE_NULL_FIELDS) {
    (fields as Record<string, unknown>)[f] = null;
  }
  return fields;
}
