/** Shared email HTML constants — extracted from n8n Document Service Generate HTML node */

export const FONT = "Calibri, -apple-system, 'Segoe UI', Arial, sans-serif";

/** Text colors */
export const C = {
  heading: '#1a1a1a',
  body: '#374151',
  meta: '#6b7280',
  muted: '#9ca3af',
  brand: '#2563eb',
  brandDark: '#1e40af',
  approve: '#059669',
  border: '#e5e7eb',
};

/** Background colors */
export const BG = {
  outer: '#f7f8fa',
  card: '#ffffff',
  summary: '#f0f4f8',
  altRow: '#f9fafb',
  header: '#f3f4f6',
};

/** Person accent colors */
export const ACCENT = {
  client: '#2563eb', clientBg: '#eff6ff',
  spouse: '#7c3aed', spouseBg: '#f5f3ff',
};

/** Office contact info */
export const OFFICE_EMAIL = 'reports@moshe-atsits.co.il';
export const OFFICE_SENDER = 'reports@moshe-atsits.co.il';

/** WhatsApp contact */
export const WA_URL = 'https://wa.me/972779928421?text=%D7%A9%D7%9C%D7%95%D7%9D%2C+%D7%90%D7%A0%D7%99+%D7%A6%D7%A8%D7%99%D7%9A%2F%D7%94+%D7%A2%D7%96%D7%A8%D7%94';
export const WA_ICON = 'https://liozshor.github.io/annual-reports-client-portal/assets/images/whatsapp-icon.png';

/** URLs */
export const FRONTEND_BASE = 'https://liozshor.github.io/annual-reports-client-portal';
export const WORKER_BASE = 'https://annual-reports-api.liozshor1.workers.dev/webhook';

/** Approval token secret placeholder — actual value from env.APPROVAL_SECRET at runtime */
export const APPROVAL_SECRET_PLACEHOLDER = 'use-env-secret';

/** Office logo URL */
export const LOGO_URL = 'https://liozshor.github.io/annual-reports-client-portal/assets/images/logo-email.png';
