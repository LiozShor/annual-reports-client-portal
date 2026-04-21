/**
 * DL-314: Reference counting for shared OneDrive files.
 *
 * When multiple Airtable doc records point at the same `onedrive_item_id`
 * (via the multi-match "גם תואם ל..." admin action), the physical file must
 * only be archived when the LAST record referencing it is reverted.
 *
 * Used at every call site that would otherwise call `moveFileToArchive`:
 * - classifications.ts: approve-override, reassign-override, reject
 * - edit-documents.ts: status revert to Required_Missing / Waived
 */
import { AirtableClient } from './airtable';

const DOCUMENTS_TABLE = 'tblcwptR63skeODPn';

/**
 * Count doc records with status=Received that share the given OneDrive item.
 * Optionally exclude a specific record (the one about to be reverted).
 */
export async function countDocsSharingFile(
  airtable: AirtableClient,
  onedriveItemId: string,
  excludeRecordId?: string
): Promise<number> {
  if (!onedriveItemId) return 0;
  const esc = onedriveItemId.replace(/'/g, "\\'");
  const recs = await airtable.listAllRecords(DOCUMENTS_TABLE, {
    filterByFormula: `AND({onedrive_item_id} = '${esc}', {status} = 'Received')`,
  });
  if (!excludeRecordId) return recs.length;
  return recs.filter(r => r.id !== excludeRecordId).length;
}

/**
 * Returns true if the given record is the LAST one still holding a reference
 * to the shared OneDrive file — i.e. safe to archive.
 *
 * Treat the excluded record as "about to be cleared" — if no OTHER record
 * references the file, this is the last reference.
 */
export async function isLastReference(
  airtable: AirtableClient,
  onedriveItemId: string,
  excludeRecordId?: string
): Promise<boolean> {
  if (!onedriveItemId) return true;
  const remaining = await countDocsSharingFile(airtable, onedriveItemId, excludeRecordId);
  return remaining === 0;
}

/**
 * Group an array of doc records by `onedrive_item_id` and return a map:
 *   onedrive_item_id -> { count, titles[] }
 *
 * Used by GET /get-client-documents to surface `shared_ref_count` + `shared_with_titles`
 * to the frontend (for the 🔗 chip). Operates on the in-memory doc array — no Airtable
 * calls, just a local reduce.
 */
export function buildSharedRefMap(
  docs: Array<{ id: string; onedrive_item_id?: unknown; issuer_name?: unknown; status?: unknown }>
): Map<string, { count: number; titles: string[]; ids: string[] }> {
  const map = new Map<string, { count: number; titles: string[]; ids: string[] }>();
  for (const d of docs) {
    const itemId = typeof d.onedrive_item_id === 'string' ? d.onedrive_item_id : '';
    if (!itemId) continue;
    if (d.status !== 'Received') continue;
    const entry = map.get(itemId) || { count: 0, titles: [], ids: [] };
    entry.count += 1;
    entry.ids.push(d.id);
    const title = typeof d.issuer_name === 'string' ? d.issuer_name : '';
    if (title) entry.titles.push(title);
    map.set(itemId, entry);
  }
  return map;
}
