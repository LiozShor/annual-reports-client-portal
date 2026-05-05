/**
 * DL-402 — Hebrew translations for Airtable enum values surfaced to users.
 *
 * Single source of truth on the Worker side. Mirrors the canonical labels in
 * `frontend/shared/constants.js` (admin UI) and `frontend/admin/js/script.js`
 * (doc-status badges) — keep in sync if either side changes.
 *
 * Why a separate file: the Telegram bot returns these labels in `*_he` fields
 * so the LLM sees user-facing text, never the raw English code. Other Worker
 * surfaces (admin endpoints) keep returning raw codes — this module is the
 * thin display layer at the bot's edge.
 */

// ─── Pipeline stage (Reports.stage) ──────────────────────────────────────────

/**
 * Maps Airtable singleSelect stage values → Hebrew display label.
 * SSOT: `frontend/shared/constants.js:14-21` (`STAGES[code].label`).
 */
export const STAGE_HE: Record<string, string> = {
  Send_Questionnaire: 'ממתין לשליחה',
  Waiting_For_Answers: 'טרם מילא שאלון',
  Pending_Approval: 'התקבל שאלון, טרם נשלחו המסמכים',
  Collecting_Docs: 'ממתין למסמכים',
  Review: 'מוכן להכנה',
  Moshe_Review: 'מוכן לבדיקה של משה',
  Before_Signing: 'לפני חתימה של הלקוח',
  Completed: 'הוגש',
};

/**
 * Translate a stage code. Unknown codes return a visible bug marker
 * (`[stage: <code>]`) instead of being papered over — surfaces translation
 * gaps during M1 testing rather than silently shipping English to chat.
 */
export function translateStage(code: string | null | undefined): string {
  if (!code) return '[stage: <empty>]';
  return STAGE_HE[code] ?? `[stage: ${code}]`;
}

// ─── Document status (Classifications.status) ────────────────────────────────

/**
 * Maps Airtable doc-status values → Hebrew badge label.
 * SSOT: `frontend/admin/js/script.js:9399-9401` + `9742-9745`.
 */
export const DOC_STATUS_HE: Record<string, string> = {
  Received: 'התקבל',
  Required_Missing: 'חסר',
  Requires_Fix: 'נדרש תיקון',
  Waived: 'לא נדרש',
  Removed: 'הוסר',
};

export function translateDocStatus(code: string | null | undefined): string {
  if (!code) return '[status: <empty>]';
  return DOC_STATUS_HE[code] ?? `[status: ${code}]`;
}

// ─── Progress text helper ────────────────────────────────────────────────────

/**
 * Build "5 מתוך 49 מסמכים" or null if the client has no document tracking yet.
 * Pure: input → string | null, no side effects.
 */
export function formatDocProgress(
  received: number | null | undefined,
  total: number | null | undefined
): string | null {
  const r = typeof received === 'number' ? received : null;
  const t = typeof total === 'number' ? total : null;
  if (r === null || t === null || t === 0) return null;
  return `${r} מתוך ${t} מסמכים`;
}
