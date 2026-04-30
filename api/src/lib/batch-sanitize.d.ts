export declare const AIRTABLE_REC_ID: RegExp;

export declare function sanitizeBatchUpdates(
  records: Array<{ id: string; fields: Record<string, unknown> } | null | undefined>
): {
  valid: Array<{ id: string; fields: Record<string, unknown> }>;
  dropped: Array<{ id: string; reason: string }>;
};
