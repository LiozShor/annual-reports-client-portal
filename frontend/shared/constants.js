/* ===========================================
   SHARED CONSTANTS — Single Source of Truth
   Loaded before page-specific scripts via <script> tag.
   =========================================== */

// --- API ---
const API_BASE = 'https://liozshor.app.n8n.cloud/webhook';

// --- Auth ---
const ADMIN_TOKEN_KEY = 'admin_token';

// --- Stage definitions (SSOT) ---
const STAGES = {
    'Send_Questionnaire':  { num: 1, label: 'ממתין לשליחה',                    icon: 'clipboard-list',  class: 'stage-1' },
    'Waiting_For_Answers': { num: 2, label: 'טרם מילא שאלון',                  icon: 'hourglass',       class: 'stage-2' },
    'Pending_Approval':    { num: 3, label: 'התקבל שאלון, טרם נשלחו המסמכים',  icon: 'clipboard-check', class: 'stage-3' },
    'Collecting_Docs':     { num: 4, label: 'ממתין למסמכים',                   icon: 'folder-open',     class: 'stage-4' },
    'Review':              { num: 5, label: 'מוכן להכנה',                      icon: 'file-text',       class: 'stage-5' },
    'Moshe_Review':        { num: 6, label: 'מוכן לבדיקה של משה',              icon: 'user-check',      class: 'stage-6' },
    'Before_Signing':      { num: 7, label: 'לפני חתימה של הלקוח',             icon: 'pen-tool',        class: 'stage-7' },
    'Completed':           { num: 8, label: 'הוגש',                           icon: 'circle-check',    class: 'stage-8' }
};

// Derived lookups
const STAGE_NUM_TO_KEY = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [v.num, k]));
const STAGE_LABELS = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, v.label]));
const STAGE_ORDER = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, v.num]));
