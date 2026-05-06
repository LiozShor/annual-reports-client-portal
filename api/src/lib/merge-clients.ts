/**
 * DL-404: mergeClients() — pure orchestrator for consolidating two client records.
 *
 * Sequence (all steps numbered to match §6 Logic Flow in DL-404):
 *  1.  Load both clients + their active reports for current year.
 *  2.  Reject cross-filing-type merges.
 *  3.  Pick winner = oldest createdTime; loser = the other.
 *  4.  Acquire KV lock (CACHE_KV, key `lock:merge:<winner>:<loser>`, TTL 10s).
 *  5.  Idempotent no-op if loser already merged into winner.
 *  6.  Compute merged stage = lower of the two pipeline stages.
 *  7.  Physical OneDrive move of all loser documents into winner's report folder.
 *  8.  Re-point child rows (documents, pending_classifications, email_events) in Airtable.
 *  9.  Append loser client_notes to winner's with a separator.
 *  10. Append loser_report_id to winner.report.merged_from_report_ids (CSV, deduped).
 *  11. Set winner.name = mergedName (or auto-computed "<A> & <B>").
 *  12. Set winner.report.spouse_name = loser.name if currently blank; else warn.
 *  13. Set winner.cc_email = loser.email if currently blank; else warn.
 *  14. Commit: PATCH loser with merged_into, is_active=false, merged_at.
 *  15. Cancel and recompute reminders.
 *  16. logEvent(client_merged).
 *  17. Release KV lock; return success.
 *
 * No HTTP / route concerns live here. Inject env for unit-testability.
 */

import { AirtableClient } from './airtable';
import { MSGraphClient } from './ms-graph';
import { DRIVE_ID } from './classification-helpers';
import {
  resolveOneDriveRoot,
  createClientFolderStructure,
} from './inbound/attachment-utils';
import { logEvent } from './activity-logger';
import { calcReminderNextDate, isReminderStage } from './reminders';
import type { Env } from './types';

// ---------------------------------------------------------------------------
// Table IDs (mirrors inbound/types.ts TABLES)
// ---------------------------------------------------------------------------

const TABLES = {
  CLIENTS: 'tblFFttFScDRZ7Ah5',
  REPORTS: 'tbls7m3hmHC4hhQVy',
  DOCUMENTS: 'tblcwptR63skeODPn',
  EMAIL_EVENTS: 'tblJAPEcSJpzdEBcW',
  PENDING_CLASSIFICATIONS: 'tbloiSDN3rwRcl1ii',
} as const;

// ---------------------------------------------------------------------------
// Stage ordering (matches dashboard.ts STAGE_ORDER + DL-404 §2 Q6)
// ---------------------------------------------------------------------------

const STAGE_ORDER: Record<string, number> = {
  Send_Questionnaire: 1,
  Waiting_For_Answers: 2,
  Pending_Approval: 3,
  Collecting_Docs: 4,
  Review: 5,
  Moshe_Review: 6,
  Before_Signing: 7,
  Completed: 8,
};

// Stages ≥ 5 carry a docs_completed_at that should be cleared when downgraded.
const DOCS_COMPLETED_AT_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MergeParams {
  clientIdA: string;        // any client_id; oldest createdTime wins
  clientIdB: string;
  mergedName?: string;      // pre-trimmed; falls back to "<winner.name> & <loser.name>"
  actor: string;
  idempotencyKey: string;
}

export type MergeResult =
  | {
      ok: true;
      winner_client_id: string;
      winner_report_id: string;
      loser_client_id: string;
      stage: string;
      merged_name: string;
      onedrive: {
        moved: number;
        renamed: number;
        skipped: number;
        failed: number;
        failed_item_ids: string[];
      };
      docs_moved: number;
      warnings: string[];
    }
  | {
      ok: false;
      code:
        | 'cross_filing_type'
        | 'lock_contention'
        | 'partial_onedrive_move'
        | 'invalid_input'
        | 'not_found';
      message: string;
      partial?: Record<string, unknown>;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the first element of an Airtable linked-record array or a plain value. */
function first<T>(v: unknown): T | undefined {
  if (Array.isArray(v)) return v[0] as T;
  return v as T;
}

/** Split a comma-separated string into a deduped array, filtering empty strings. */
function splitCsv(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
}

/**
 * Resolve the winner's report folder ID in OneDrive.
 *
 * The folder hierarchy is: <clientName>/<year>/<filingTypeFolder>
 * We call createClientFolderStructure which is idempotent (create-or-get).
 */
async function resolveWinnerReportFolder(
  graph: MSGraphClient,
  clientName: string,
  year: string,
  filingType: string,
): Promise<{ driveId: string; folderId: string }> {
  const root = await resolveOneDriveRoot(graph);
  const { filingFolderId } = await createClientFolderStructure(
    graph,
    root,
    clientName,
    year,
    filingType,
  );
  return { driveId: root.driveId || DRIVE_ID, folderId: filingFolderId };
}

/**
 * Move a single drive item to a new parent folder, optionally renaming it
 * to avoid collision. Returns the new webUrl or null on failure.
 */
async function moveDriveItem(
  graph: MSGraphClient,
  driveId: string,
  itemId: string,
  targetFolderId: string,
  collisionName?: string,
): Promise<{ webUrl: string | null; renamed: boolean }> {
  const body: Record<string, unknown> = {
    parentReference: { id: targetFolderId },
  };
  if (collisionName) {
    body.name = collisionName;
  }
  const result = await graph.patch(
    `/drives/${driveId}/items/${itemId}`,
    body,
  );
  return {
    webUrl: (result?.webUrl as string) || null,
    renamed: Boolean(collisionName),
  };
}

/**
 * Build a collision-safe filename: insert " (2)" before the last extension.
 * "photo.pdf"  → "photo (2).pdf"
 * "noext"      → "noext (2)"
 */
function buildCollisionName(name: string): string {
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx <= 0) return `${name} (2)`;
  return `${name.slice(0, dotIdx)} (2)${name.slice(dotIdx)}`;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function mergeClients(
  env: Env,
  ctx: ExecutionContext,
  params: MergeParams,
): Promise<MergeResult> {
  const { clientIdA, clientIdB, actor, idempotencyKey } = params;

  // Basic guard
  if (!clientIdA || !clientIdB) {
    return { ok: false, code: 'invalid_input', message: 'clientIdA and clientIdB are required' };
  }
  if (clientIdA === clientIdB) {
    return { ok: false, code: 'invalid_input', message: 'clientIdA and clientIdB must differ' };
  }

  const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);

  // ── Step 1: Load both clients rows ─────────────────────────────────────────
  // client_id is a formula field on clients (`CPA-${client_counter}`), so we
  // must filter rather than getRecord-by-id. (DL-404 followup 2026-05-06.)
  const escA = clientIdA.replace(/'/g, "\\'");
  const escB = clientIdB.replace(/'/g, "\\'");
  let clientARecord: Awaited<ReturnType<typeof airtable.listAllRecords>>[number] | undefined;
  let clientBRecord: Awaited<ReturnType<typeof airtable.listAllRecords>>[number] | undefined;
  try {
    const [aRows, bRows] = await Promise.all([
      airtable.listAllRecords(TABLES.CLIENTS, { filterByFormula: `{client_id}='${escA}'`, maxRecords: 1 }),
      airtable.listAllRecords(TABLES.CLIENTS, { filterByFormula: `{client_id}='${escB}'`, maxRecords: 1 }),
    ]);
    clientARecord = aRows[0];
    clientBRecord = bRows[0];
  } catch (err) {
    return { ok: false, code: 'not_found', message: `Could not load client records: ${(err as Error).message}` };
  }
  if (!clientARecord || !clientBRecord) {
    return { ok: false, code: 'not_found', message: `Client not found: ${!clientARecord ? clientIdA : clientIdB}` };
  }

  // Load each client's most-recent active report (any year). Picking by year
  // server-side was wrong: tax-year reports created in spring 2026 carry
  // year=2025, and `new Date().getFullYear()` would return 2026 → 0 matches.
  const [reportsA, reportsB] = await Promise.all([
    airtable.listAllRecords(TABLES.REPORTS, {
      filterByFormula: `{client_id}='${escA}'`,
      sort: [{ field: 'year', direction: 'desc' }],
      maxRecords: 5,
    }),
    airtable.listAllRecords(TABLES.REPORTS, {
      filterByFormula: `{client_id}='${escB}'`,
      sort: [{ field: 'year', direction: 'desc' }],
      maxRecords: 5,
    }),
  ]);

  const reportA = reportsA[0];
  const reportB = reportsB[0];

  if (!reportA || !reportB) {
    return {
      ok: false,
      code: 'not_found',
      message: `Could not find any reports for both clients`,
    };
  }
  const year = String((reportA.fields as Record<string, unknown>).year ?? '');

  // ── Step 2: Reject cross-filing-type merges ─────────────────────────────────
  const filingTypeA = String((reportA.fields as Record<string, unknown>).filing_type || '');
  const filingTypeB = String((reportB.fields as Record<string, unknown>).filing_type || '');

  if (filingTypeA !== filingTypeB) {
    return {
      ok: false,
      code: 'cross_filing_type',
      message: `Cannot merge clients with different filing types: "${filingTypeA}" vs "${filingTypeB}"`,
    };
  }

  // ── Step 3: Pick winner = older createdTime ────────────────────────────────
  const createdA = new Date(clientARecord.createdTime || 0).getTime();
  const createdB = new Date(clientBRecord.createdTime || 0).getTime();

  const [winnerClient, loserClient, winnerReport, loserReport] =
    createdA <= createdB
      ? [clientARecord, clientBRecord, reportA, reportB]
      : [clientBRecord, clientARecord, reportB, reportA];

  const winnerClientId = winnerClient.id;
  const loserClientId = loserClient.id;
  const winnerReportId = winnerReport.id;
  const loserReportId = loserReport.id;

  const winnerFields = winnerClient.fields as Record<string, unknown>;
  const loserFields = loserClient.fields as Record<string, unknown>;
  const winnerReportFields = winnerReport.fields as Record<string, unknown>;
  const loserReportFields = loserReport.fields as Record<string, unknown>;

  // ── Step 4: Acquire KV lock ────────────────────────────────────────────────
  const lockKey = `lock:merge:${winnerClientId}:${loserClientId}`;
  const lockHeld = await env.CACHE_KV.get(lockKey);
  if (lockHeld) {
    return { ok: false, code: 'lock_contention', message: 'Another merge is in progress for these clients' };
  }
  await env.CACHE_KV.put(lockKey, idempotencyKey, { expirationTtl: 10 });

  try {
    // ── Step 5: Idempotency check ──────────────────────────────────────────────
    const existingMergedInto = String(loserFields.merged_into || '');
    if (existingMergedInto === winnerClientId) {
      // Already merged — return a success-shaped no-op result
      const stage = String(winnerReportFields.stage || 'Send_Questionnaire');
      const mergedName = String(winnerFields.name || '');
      return {
        ok: true,
        winner_client_id: winnerClientId,
        winner_report_id: winnerReportId,
        loser_client_id: loserClientId,
        stage,
        merged_name: mergedName,
        onedrive: { moved: 0, renamed: 0, skipped: 0, failed: 0, failed_item_ids: [] },
        docs_moved: 0,
        warnings: ['idempotent_replay'],
      };
    }

    // ── Step 6: Compute merged stage ───────────────────────────────────────────
    const winnerStageStr = String(winnerReportFields.stage || 'Send_Questionnaire');
    const loserStageStr = String(loserReportFields.stage || 'Send_Questionnaire');
    const winnerStageNum = STAGE_ORDER[winnerStageStr] ?? 1;
    const loserStageNum = STAGE_ORDER[loserStageStr] ?? 1;

    const mergedStageNum = Math.min(winnerStageNum, loserStageNum);
    const mergedStage = Object.keys(STAGE_ORDER).find(k => STAGE_ORDER[k] === mergedStageNum) || 'Send_Questionnaire';

    // Stage downgrade applies when winner is currently ahead of the loser
    const winnerNeedsDowngrade = winnerStageNum > loserStageNum;

    // ── Step 7: Physical OneDrive move ─────────────────────────────────────────
    // Find loser's documents that have a real onedrive_item_id
    const loserDocs = await airtable.listAllRecords(TABLES.DOCUMENTS, {
      filterByFormula: `AND({report}='${loserReportId}',{onedrive_item_id}!='')`,
      fields: ['onedrive_item_id', 'file_url', 'report', 'type'],
    });

    // Resolve winner's report folder (idempotent — create-or-get)
    const winnerName = String(winnerFields.name || '');
    const filingType = filingTypeA;

    const graph = new MSGraphClient(env, ctx);

    let winnerFolderInfo: { driveId: string; folderId: string } | null = null;

    const onedrive = {
      moved: 0,
      renamed: 0,
      skipped: 0,
      failed: 0,
      failed_item_ids: [] as string[],
    };

    if (loserDocs.length > 0) {
      try {
        winnerFolderInfo = await resolveWinnerReportFolder(graph, winnerName, year, filingType);
      } catch (err) {
        // Can't resolve winner folder — treat all loser docs as failed
        for (const doc of loserDocs) {
          const itemId = String((doc.fields as Record<string, unknown>).onedrive_item_id || '');
          if (itemId) onedrive.failed_item_ids.push(itemId);
        }
        onedrive.failed = loserDocs.length;
        return {
          ok: false,
          code: 'partial_onedrive_move',
          message: `Could not resolve winner OneDrive folder: ${(err as Error).message}`,
          partial: { ...onedrive },
        };
      }
    }

    // Track which docs were successfully moved (for Airtable updates)
    const movedDocIds: string[] = [];

    for (const doc of loserDocs) {
      const docFields = doc.fields as Record<string, unknown>;
      const itemId = String(docFields.onedrive_item_id || '');
      if (!itemId || !winnerFolderInfo) {
        onedrive.skipped++;
        continue;
      }

      try {
        // Pre-fetch current parentReference to detect if already in winner folder
        const itemInfo = await graph.get(
          `/drives/${winnerFolderInfo.driveId}/items/${itemId}?$select=parentReference,name,webUrl`,
        );
        const currentParentId = itemInfo?.parentReference?.id as string | undefined;

        if (currentParentId === winnerFolderInfo.folderId) {
          // Already in winner folder — skip (idempotent retry support)
          onedrive.skipped++;
          movedDocIds.push(doc.id);
          continue;
        }

        const originalName = String(itemInfo?.name || 'file');

        // Check if winner folder already has a file with this name
        let newWebUrl: string | null = null;
        let renamed = false;

        try {
          // Attempt a simple move first
          const moveResult = await moveDriveItem(
            graph,
            winnerFolderInfo.driveId,
            itemId,
            winnerFolderInfo.folderId,
          );
          newWebUrl = moveResult.webUrl;
          onedrive.moved++;
        } catch (moveErr) {
          const errMsg = (moveErr as Error).message || '';
          // nameAlreadyExists is the Graph error code for filename collision
          if (errMsg.includes('nameAlreadyExists') || errMsg.includes('409')) {
            try {
              const collisionName = buildCollisionName(originalName);
              const moveResult = await moveDriveItem(
                graph,
                winnerFolderInfo.driveId,
                itemId,
                winnerFolderInfo.folderId,
                collisionName,
              );
              newWebUrl = moveResult.webUrl;
              renamed = true;
              onedrive.moved++;
              onedrive.renamed++;
            } catch (collErr) {
              onedrive.failed++;
              onedrive.failed_item_ids.push(itemId);
              continue;
            }
          } else {
            onedrive.failed++;
            onedrive.failed_item_ids.push(itemId);
            continue;
          }
        }

        // Persist updated webUrl to Airtable if it changed (DL-374 pattern)
        if (newWebUrl && newWebUrl !== String(docFields.file_url || '')) {
          try {
            await airtable.updateRecord(TABLES.DOCUMENTS, doc.id, {
              file_url: newWebUrl,
            });
          } catch {
            // Non-fatal — doc still moved, URL update failed
          }
        }

        movedDocIds.push(doc.id);
        void renamed; // suppress unused-var warning; counter already incremented
      } catch (err) {
        onedrive.failed++;
        onedrive.failed_item_ids.push(itemId);
        // Continue to next doc — do NOT bail
      }
    }

    // If any OneDrive moves failed → abort before mutating Airtable
    if (onedrive.failed > 0) {
      return {
        ok: false,
        code: 'partial_onedrive_move',
        message: `${onedrive.failed} document(s) could not be moved to winner's OneDrive folder`,
        partial: { ...onedrive },
      };
    }

    // ── Step 8: Re-point child rows in Airtable ────────────────────────────────
    // documents.report → winner_report_id
    const docsToRepoint = await airtable.listAllRecords(TABLES.DOCUMENTS, {
      filterByFormula: `{report}='${loserReportId}'`,
      fields: ['report'],
    });
    if (docsToRepoint.length > 0) {
      await airtable.batchUpdate(
        TABLES.DOCUMENTS,
        docsToRepoint.map(r => ({ id: r.id, fields: { report: [winnerReportId] } })),
      );
    }

    // pending_classifications.report → winner_report_id
    const pcToRepoint = await airtable.listAllRecords(TABLES.PENDING_CLASSIFICATIONS, {
      filterByFormula: `{report}='${loserReportId}'`,
      fields: ['report'],
    });
    if (pcToRepoint.length > 0) {
      await airtable.batchUpdate(
        TABLES.PENDING_CLASSIFICATIONS,
        pcToRepoint.map(r => ({ id: r.id, fields: { report: [winnerReportId] } })),
      );
    }

    // email_events.report → winner_report_id
    const eeToRepoint = await airtable.listAllRecords(TABLES.EMAIL_EVENTS, {
      filterByFormula: `{report}='${loserReportId}'`,
      fields: ['report'],
    });
    if (eeToRepoint.length > 0) {
      await airtable.batchUpdate(
        TABLES.EMAIL_EVENTS,
        eeToRepoint.map(r => ({ id: r.id, fields: { report: [winnerReportId] } })),
      );
    }

    // ── Step 9: Append client_notes ────────────────────────────────────────────
    const loserNotes = String(loserFields.client_notes || '').trim();
    if (loserNotes) {
      const today = new Date().toISOString().split('T')[0];
      const separator = `\n\n— [merged from ${loserClientId} on ${today}] —\n\n`;
      const winnerNotes = String(winnerFields.client_notes || '').trim();
      const combinedNotes = winnerNotes ? `${winnerNotes}${separator}${loserNotes}` : loserNotes;
      await airtable.updateRecord(TABLES.CLIENTS, winnerClientId, {
        client_notes: combinedNotes,
      });
    }

    // ── Step 10: Append loser report id to merged_from_report_ids ─────────────
    const existingMergedFrom = String(winnerReportFields.merged_from_report_ids || '');
    const mergedFromSet = splitCsv(existingMergedFrom);
    if (!mergedFromSet.includes(loserReportId)) {
      mergedFromSet.push(loserReportId);
    }
    const mergedFromCsv = mergedFromSet.join(',');

    // ── Step 11: Compute & validate merged name ────────────────────────────────
    const warnings: string[] = [];
    const loserName = String(loserFields.name || '').trim();
    const rawMergedName = params.mergedName?.trim() || `${winnerName.trim()} & ${loserName}`;
    const finalMergedName = rawMergedName.trim();

    if (!finalMergedName) {
      return { ok: false, code: 'invalid_input', message: 'merged_name is empty after trimming' };
    }

    // ── Step 12: spouse_name on winner's report ────────────────────────────────
    const existingSpouseName = String(first(winnerReportFields.spouse_name) || '').trim();
    let newSpouseName: string | undefined;
    if (!existingSpouseName) {
      newSpouseName = loserName;
    } else if (existingSpouseName !== loserName) {
      warnings.push('spouse_name_conflict');
    }

    // ── Step 13: cc_email on winner ────────────────────────────────────────────
    const existingCcEmail = String(winnerFields.cc_email || '').trim();
    const loserEmail = String(loserFields.email || first(loserReportFields.client_email) || '').trim();
    let newCcEmail: string | undefined;
    if (!existingCcEmail) {
      newCcEmail = loserEmail;
    } else if (loserEmail && existingCcEmail !== loserEmail) {
      warnings.push('cc_email_conflict');
    }

    // Batch the winner updates (clients table + reports table)
    const winnerClientUpdates: Record<string, unknown> = { name: finalMergedName };
    if (newCcEmail) winnerClientUpdates.cc_email = newCcEmail;

    const winnerReportUpdates: Record<string, unknown> = {
      merged_from_report_ids: mergedFromCsv,
    };
    if (newSpouseName !== undefined) winnerReportUpdates.spouse_name = newSpouseName;
    if (winnerNeedsDowngrade) {
      winnerReportUpdates.stage = mergedStage;
      if (winnerStageNum >= DOCS_COMPLETED_AT_THRESHOLD) {
        winnerReportUpdates.docs_completed_at = null;
      }
    }

    await Promise.all([
      airtable.updateRecord(TABLES.CLIENTS, winnerClientId, winnerClientUpdates),
      airtable.updateRecord(TABLES.REPORTS, winnerReportId, winnerReportUpdates),
    ]);

    // ── Step 14: Commit point — patch loser ───────────────────────────────────
    const now = new Date().toISOString();
    await airtable.updateRecord(TABLES.CLIENTS, loserClientId, {
      merged_into: winnerClientId,
      is_active: false,
      merged_at: now,
    });

    // ── Step 15: Cancel reminders; recompute on winner ────────────────────────
    // Clear both reports' reminder_next_date
    await Promise.all([
      airtable.updateRecord(TABLES.REPORTS, winnerReportId, { reminder_next_date: null }),
      airtable.updateRecord(TABLES.REPORTS, loserReportId, { reminder_next_date: null }),
    ]);

    // Recompute for winner if its merged stage is a reminder stage
    if (isReminderStage(mergedStageNum)) {
      const nextDate = calcReminderNextDate();
      await airtable.updateRecord(TABLES.REPORTS, winnerReportId, {
        reminder_next_date: nextDate,
      });
    }

    // ── Step 16: Activity log ──────────────────────────────────────────────────
    logEvent({
      event_type: 'client_merged',
      category: 'ADMIN',
      actor,
      details: {
        winner_client_id: winnerClientId,
        loser_client_id: loserClientId,
        winner_report_id: winnerReportId,
        loser_report_id: loserReportId,
        docs_moved: onedrive.moved,
        onedrive_moved: onedrive.moved,
        onedrive_renamed: onedrive.renamed,
        idempotency_key: idempotencyKey,
        merged_stage: mergedStage,
      },
    });

    // ── Step 17: Release lock and return ──────────────────────────────────────
    // Lock auto-expires in 10s — no explicit delete needed (short TTL is intentional).

    return {
      ok: true,
      winner_client_id: winnerClientId,
      winner_report_id: winnerReportId,
      loser_client_id: loserClientId,
      stage: mergedStage,
      merged_name: finalMergedName,
      onedrive,
      docs_moved: onedrive.moved,
      warnings,
    };
  } catch (err) {
    // Ensure lock is cleaned up on unexpected error (best-effort)
    try { await env.CACHE_KV.delete(lockKey); } catch { /* ignore */ }
    throw err;
  }
}
