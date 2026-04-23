export const AIRTABLE_REC_ID = /^rec[A-Za-z0-9]{14}$/;

export function sanitizeBatchUpdates(records) {
  const valid = [];
  const dropped = [];
  for (const r of records) {
    if (!r || typeof r.id !== 'string' || !AIRTABLE_REC_ID.test(r.id)) {
      dropped.push({ id: (r && r.id) || '<empty>', reason: 'invalid_id' });
      continue;
    }
    const fields = r.fields && typeof r.fields === 'object' ? r.fields : {};
    const cleanFields = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(cleanFields).length === 0) {
      dropped.push({ id: r.id, reason: 'empty_fields' });
      continue;
    }
    valid.push({ id: r.id, fields: cleanFields });
  }
  return { valid, dropped };
}
