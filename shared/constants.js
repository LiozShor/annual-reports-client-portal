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
    '1-Send_Questionnaire':  { num: 1, label: 'ממתין לשליחה',           icon: 'clipboard-list', class: 'stage-1' },
    '2-Waiting_For_Answers': { num: 2, label: 'טרם מילא שאלון',         icon: 'hourglass',      class: 'stage-2' },
    '3-Collecting_Docs':     { num: 3, label: 'מילא שאלון וחסרים מסמכים', icon: 'folder-open',    class: 'stage-3' },
    '4-Review':              { num: 4, label: 'מוכן להכנה',             icon: 'file-text',      class: 'stage-4' },
    '5-Moshe_Review':        { num: 5, label: 'מוכן לבדיקה של משה',     icon: 'user-check',     class: 'stage-5' },
    '6-Before_Signing':      { num: 6, label: 'לפני חתימה של הלקוח',    icon: 'pen-tool',       class: 'stage-6' },
    '7-Completed':           { num: 7, label: 'הוגש',                  icon: 'circle-check',   class: 'stage-7' }
};

// Derived lookups
const STAGE_NUM_TO_KEY = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [v.num, k]));
const STAGE_LABELS = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, v.label]));
const STAGE_ORDER = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, v.num]));
