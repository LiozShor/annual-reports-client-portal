# Multi-Tenant Scalability Audit

**Date:** 2026-04-12
**Current tenant:** Moshe Atsits CPA Firm (משרד רו"ח Client Name)
**Client count:** 500+

---

## 1. Executive Summary

| Category | Findings | Difficulty Breakdown |
|----------|----------|---------------------|
| BRANDING | 22 | 18 EASY, 4 MEDIUM |
| INFRASTRUCTURE | 28 | 12 EASY, 10 MEDIUM, 6 HARD |
| FORMS | 4 | 4 EASY |
| EMAIL | 18 | 14 EASY, 4 MEDIUM |
| STORAGE | 2 | 2 HARD |
| AUTH | 2 | 2 MEDIUM |
| BUSINESS_LOGIC | 15 | 3 EASY, 8 MEDIUM, 4 HARD |
| LOCALE | 8 | 2 EASY, 4 MEDIUM, 2 HARD |
| **TOTAL** | **~99** | **53 EASY, 32 MEDIUM, 14 HARD** |

**Overall effort estimate: LARGE** — the system has zero multi-tenant abstractions. Every layer (frontend, API, n8n, Airtable, email, storage) is hardcoded to a single firm. Phase 1 (config extraction) is mechanical; Phases 2-4 require architectural decisions.

---

## 2. Findings Table

### 2.1 BRANDING — Firm name, logo, display text

| File | Line | Value (truncated) | Category | Difficulty |
|------|------|--------------------|----------|------------|
| `github/.../admin/index.html` | 9 | `פורטל ניהול - משרד רו"ח Client Name` (page title) | BRANDING | EASY |
| `github/.../admin/index.html` | 31 | `משרד רו"ח Client Name` (sidebar branding) | BRANDING | EASY |
| `github/.../admin/index.html` | 49 | `משרד רו״ח Client Name` (logo alt) | BRANDING | EASY |
| `github/.../admin/index.html` | 130 | `לבדיקה של משה` (stage label) | BRANDING | MEDIUM |
| `github/.../admin/index.html` | 188 | `לבדיקה של משה` (dropdown option) | BRANDING | MEDIUM |
| `github/.../index.html` | 31 | `משרד רו״ח Client Name` (logo alt) | BRANDING | EASY |
| `github/.../view-documents.html` | 29 | `משרד רו״ח Client Name` (logo alt) | BRANDING | EASY |
| `github/.../document-manager.html` | 43 | `משרד רו״ח Client Name` (logo alt) | BRANDING | EASY |
| `github/.../document-manager.html` | 47 | `משרד רו״ח Client Name` (subtitle text) | BRANDING | EASY |
| `github/.../approve-confirm.html` | 23 | `משרד רו״ח Client Name` (logo alt) | BRANDING | EASY |
| `github/.../privacy-policy.html` | 9,133,142 | `משרד רו״ח Client Name` (policy text) | BRANDING | EASY |
| `github/.../admin/js/script.js` | 7159 | `Client Name רו"ח` (print footer) | BRANDING | EASY |
| `github/.../assets/js/document-manager.js` | 2658 | `Client Name רו"ח` (print footer) | BRANDING | EASY |
| `api/src/lib/email-html.ts` | 83 | `alt="Moshe Atsits"` (email logo) | BRANDING | EASY |
| `api/src/lib/email-html.ts` | 462 | `Moshe Atsits CPA Firm / משרד רו"ח Client Name` (bilingual footer) | BRANDING | EASY |
| `api/src/lib/email-html.ts` | 484 | `משרד רו"ח Client Name` (HE-only footer) | BRANDING | EASY |
| `api/src/lib/email-html.ts` | 620 | `alt="Moshe Atsits"` (batch email logo) | BRANDING | EASY |
| `api/src/lib/email-html.ts` | 635 | `צוות משרד רו"ח Client Name` (sign-off) | BRANDING | EASY |
| `api/src/routes/chat.ts` | 10 | `Moshe Atsits CPA firm` (AI system prompt) | BRANDING | EASY |
| `api/src/routes/feedback.ts` | 33 | `alt="Moshe Atsits"` (feedback email logo) | BRANDING | EASY |
| `assets/images/logo.png` | — | Firm logo file | BRANDING | EASY |
| `assets/images/logo-email.png` | — | Email logo file | BRANDING | EASY |

### 2.2 INFRASTRUCTURE — Service URLs, Airtable, n8n, KV

| File | Line | Value (truncated) | Category | Difficulty |
|------|------|--------------------|----------|------------|
| `api/wrangler.toml` | 1 | `name = "annual-reports-api"` | INFRASTRUCTURE | EASY |
| `api/wrangler.toml` | 11 | `ALLOWED_ORIGIN = "https://liozshor.github.io"` | INFRASTRUCTURE | EASY |
| `api/wrangler.toml` | 12 | `AIRTABLE_BASE_ID = "appqBL5RWQN9cPOyh"` | INFRASTRUCTURE | EASY |
| `api/wrangler.toml` | 29 | `TOKEN_CACHE KV id = "5e3beec6..."` | INFRASTRUCTURE | MEDIUM |
| `api/wrangler.toml` | 33 | `CACHE_KV id = "39bcc73f..."` | INFRASTRUCTURE | MEDIUM |
| `api/src/lib/inbound/types.ts` | 15 | `CLIENTS: 'tblFFttFScDRZ7Ah5'` | INFRASTRUCTURE | MEDIUM |
| `api/src/lib/inbound/types.ts` | 16 | `REPORTS: 'tbls7m3hmHC4hhQVy'` | INFRASTRUCTURE | MEDIUM |
| `api/src/lib/inbound/types.ts` | 17 | `DOCUMENTS: 'tblcwptR63skeODPn'` | INFRASTRUCTURE | MEDIUM |
| `api/src/lib/inbound/types.ts` | 18 | `EMAIL_EVENTS: 'tblJAPEcSJpzdEBcW'` | INFRASTRUCTURE | MEDIUM |
| `api/src/lib/inbound/types.ts` | 19 | `PENDING_CLASSIFICATIONS: 'tbloiSDN3rwRcl1ii'` | INFRASTRUCTURE | MEDIUM |
| `api/src/routes/*.ts` | various | 5+ more table IDs scattered across route files | INFRASTRUCTURE | MEDIUM |
| `api/src/lib/email-styles.ts` | 41 | `FRONTEND_BASE = 'https://liozshor.github.io/...'` | INFRASTRUCTURE | EASY |
| `api/src/lib/email-styles.ts` | 42 | `WORKER_BASE = 'https://annual-reports-api.liozshor1...'` | INFRASTRUCTURE | EASY |
| `api/src/lib/email-styles.ts` | 48 | `LOGO_URL = 'https://liozshor.github.io/.../logo-email.png'` | INFRASTRUCTURE | EASY |
| `api/src/lib/email-styles.ts` | 38 | `WA_ICON = 'https://liozshor.github.io/.../whatsapp-icon.png'` | INFRASTRUCTURE | EASY |
| `api/src/routes/edit-documents.ts` | 38 | `'https://liozshor.app.n8n.cloud/webhook'` | INFRASTRUCTURE | EASY |
| `api/src/routes/reminders.ts` | 158 | `'https://liozshor.app.n8n.cloud/webhook'` | INFRASTRUCTURE | EASY |
| `api/src/routes/approve-and-send.ts` | 16 | `FRONTEND_BASE` (duplicate) | INFRASTRUCTURE | EASY |
| `api/src/routes/send-questionnaires.ts` | 13 | `FRONTEND_BASE` (duplicate) | INFRASTRUCTURE | EASY |
| `github/.../shared/constants.js` | 7 | `API_BASE = 'https://liozshor.app.n8n.cloud/webhook'` | INFRASTRUCTURE | EASY |
| `github/.../shared/endpoints.js` | 13 | `CF_BASE = 'https://annual-reports-api.liozshor1...'` | INFRASTRUCTURE | EASY |
| `github/.../admin/js/chatbot.js` | 15 | `'https://annual-reports-api.liozshor1.../admin-chat'` | INFRASTRUCTURE | EASY |
| `github/.../admin/js/script.js` | 6037 | `'https://liozshor.github.io/...'` (view-documents link) | INFRASTRUCTURE | EASY |
| `github/.../n8n/workflow-processor-n8n.js` | 827 | Workers API URL | INFRASTRUCTURE | EASY |
| `github/.../n8n/workflow-processor-n8n.js` | 829 | GitHub Pages URL | INFRASTRUCTURE | EASY |
| `github/.../*.html` (5 files) | CSP tags | CSP connect-src with hardcoded domains | INFRASTRUCTURE | MEDIUM |
| `.mcp.json` | — | `N8N_API_URL: "https://liozshor.app.n8n.cloud"` + API key | INFRASTRUCTURE | EASY |
| `docs/workflow-ids.md` | — | 9 active + 22 archived workflow IDs | INFRASTRUCTURE | HARD |

### 2.3 FORMS — Tally form IDs

| File | Line | Value | Category | Difficulty |
|------|------|-------|----------|------------|
| `github/.../assets/js/landing.js` | 21 | `form_he: '1AkYKb'` (AR Hebrew form) | FORMS | EASY |
| `github/.../assets/js/landing.js` | 21 | `form_en: '1AkopM'` (AR English form) | FORMS | EASY |
| `github/.../assets/js/landing.js` | 22 | `form_he: '7Roovz'` (CS Hebrew form) | FORMS | EASY |
| `api/src/routes/submission.ts` | — | Same 3 IDs duplicated server-side | FORMS | EASY |

### 2.4 EMAIL — Addresses, domains, contacts

| File | Line | Value | Category | Difficulty |
|------|------|-------|----------|------------|
| `api/src/lib/email-styles.ts` | 33 | `OFFICE_EMAIL = 'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/lib/email-styles.ts` | 34 | `OFFICE_SENDER = 'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/lib/inbound/types.ts` | 23 | `MAILBOX = 'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/lib/inbound/processor.ts` | 67 | `SYSTEM_SENDER = 'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/lib/inbound/client-identifier.ts` | 32 | `OFFICE_DOMAIN = '@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/routes/approve-and-send.ts` | 17 | `SENDER = 'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/routes/send-questionnaires.ts` | 14 | `SENDER = 'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/routes/feedback.ts` | 9 | `SENDER = 'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/lib/error-logger.ts` | 115 | `'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/lib/email-html.ts` | 142 | `'reports@moshe-atsits.co.il'` | EMAIL | EASY |
| `api/src/lib/email-html.ts` | 151 | `natan@moshe-atsits.co.il` (contact person) | EMAIL | EASY |
| `api/src/lib/email-html.ts` | 520 | `natan@moshe-atsits.co.il` (footer contact) | EMAIL | EASY |
| `api/src/routes/feedback.ts` | 10 | `liozshor1@gmail.com` (feedback recipient) | EMAIL | EASY |
| `api/wrangler.toml` | 13 | `ALERT_EMAIL = "liozshor1@gmail.com"` | EMAIL | EASY |
| `github/.../index.html` | 23 | `reports@moshe-atsits.co.il` | EMAIL | EASY |
| `github/.../view-documents.html` | 21 | `reports@moshe-atsits.co.il` | EMAIL | EASY |
| `github/.../document-manager.html` | 21 | `reports@moshe-atsits.co.il` | EMAIL | EASY |
| `github/.../admin/index.html` | 23 | `reports@moshe-atsits.co.il` | EMAIL | EASY |
| `github/.../assets/js/error-handler.js` | 65-66 | `reports@moshe-atsits.co.il` (bilingual) | EMAIL | EASY |
| `github/.../assets/js/view-documents.js` | 188,260 | `'reports@moshe-atsits.co.il'` (fallback) | EMAIL | EASY |
| `github/.../privacy-policy.html` | 180 | `liozshor1@gmail.com` (privacy contact) | EMAIL | EASY |

### 2.5 STORAGE — OneDrive/SharePoint

| File | Line | Value | Category | Difficulty |
|------|------|-------|----------|------------|
| `api/src/lib/classification-helpers.ts` | 15-16 | `DRIVE_ID = 'b!SxgoZq...'` (OneDrive drive ID) | STORAGE | HARD |
| `api/src/lib/inbound/attachment-utils.ts` | 7 | `ONEDRIVE_SHARING_TOKEN = 'u!aHR0cH...'` (SharePoint encoded URL) | STORAGE | HARD |

### 2.6 AUTH — Token binding

| File | Line | Value | Category | Difficulty |
|------|------|-------|----------|------------|
| `api/src/routes/classifications.ts` | 739+ | `reviewed_by: 'Natan'` (6 occurrences) | AUTH | MEDIUM |
| `api/src/lib/email-styles.ts` | 37 | WhatsApp URL with phone `972779928421` | AUTH | MEDIUM |

### 2.7 BUSINESS_LOGIC — Filing types, stages, document categories

| File | Line | Value | Category | Difficulty |
|------|------|-------|----------|------------|
| `github/.../shared/constants.js` | 19 | `'Moshe_Review'` stage key (named after firm owner) | BUSINESS_LOGIC | HARD |
| `api/src/routes/stage.ts` | 12 | `Moshe_Review: 6` in stage ordering | BUSINESS_LOGIC | HARD |
| `api/src/routes/dashboard.ts` | 14 | `Moshe_Review: 6` | BUSINESS_LOGIC | HARD |
| `api/src/routes/chat.ts` | 26 | `Moshe_Review` in AI system prompt | BUSINESS_LOGIC | HARD |
| `api/src/lib/classification-helpers.ts` | 18-34 | `HE_TITLE` — 31 document type names (Israeli tax forms) | BUSINESS_LOGIC | MEDIUM |
| `api/src/lib/classification-helpers.ts` | 36-44 | `REJECTION_REASONS` — 7 Hebrew rejection labels | BUSINESS_LOGIC | MEDIUM |
| `api/src/lib/inbound/attachment-utils.ts` | 91-94 | `FILING_TYPE_FOLDER` — folder names by filing type | BUSINESS_LOGIC | MEDIUM |
| `api/src/lib/inbound/document-classifier.ts` | 31-500+ | 53 template definitions (T001-T1701, CS-T001-T022) | BUSINESS_LOGIC | MEDIUM |
| `api/src/lib/inbound/document-classifier.ts` | 493+ | Issuer matching for Israeli institutions | BUSINESS_LOGIC | MEDIUM |
| `api/src/lib/email-html.ts` | 60-62 | `FILING_LABELS` object | BUSINESS_LOGIC | EASY |
| `github/.../shared/constants.js` | 13-22 | 8 stage definitions with Hebrew labels | BUSINESS_LOGIC | EASY |
| `SSOT_required_documents_from_Tally_input.md` | — | 34 document templates (Israeli tax-specific) | BUSINESS_LOGIC | MEDIUM |
| `SSOT_CS_required_documents.md` | — | 22 capital statement templates | BUSINESS_LOGIC | MEDIUM |

### 2.8 LOCALE — Language defaults, RTL, bilingual templates

| File | Line | Value | Category | Difficulty |
|------|------|-------|----------|------------|
| `api/src/lib/email-html.ts` | various | Hebrew-first email templates with `dir="rtl"` | LOCALE | MEDIUM |
| `api/src/lib/inbound/types.ts` | 42 | `לקוח לא מזוהה` (unidentified client label) | LOCALE | EASY |
| `api/src/lib/inbound/attachment-utils.ts` | 92-93 | `דוח שנתי` / `הצהרת הון` filing type labels | LOCALE | EASY |
| `github/.../assets/css/design-system.css` | 12-17 | Brand indigo palette (#6366F1-#4338CA) | LOCALE | MEDIUM |
| `.claude/rules/bilingual.md` | — | Language policy (Hebrew-first, English secondary) | LOCALE | MEDIUM |
| `api/src/routes/chat.ts` | 31 | Hebrew stage names in AI prompt | LOCALE | MEDIUM |
| All HTML files | — | `lang="he"` / `dir="rtl"` hardcoded | LOCALE | HARD |
| Email templates | — | Bilingual card pattern (EN primary, HE secondary) | LOCALE | HARD |

---

## 3. Architecture Gaps

### 3.1 No Tenant Configuration Layer

The system has **zero tenant abstraction**. Every tenant-specific value is a constant scattered across source files. There is no:
- Tenant config object or module
- Config injection mechanism for frontend
- Per-tenant environment resolution
- Tenant ID concept anywhere in the data model

**What exists today:**
- `wrangler.toml` [vars] holds 3 configurable values (ALLOWED_ORIGIN, AIRTABLE_BASE_ID, ALERT_EMAIL)
- `wrangler.toml` secrets hold 10 properly-externalized secrets
- `api/src/lib/email-styles.ts` centralizes some constants (but hardcoded, not configurable)
- `github/.../shared/constants.js` centralizes stage definitions (but hardcoded)

### 3.2 Airtable Scaling Strategy

**Current state:** Single base `appqBL5RWQN9cPOyh` with 13+ tables. All 500+ clients share every table.

**Options for multi-tenancy:**

| Approach | Pros | Cons |
|----------|------|------|
| **One base per tenant** | Full isolation, simple to reason about | Airtable pricing (per-base limits), 10+ table IDs per tenant to configure, n8n would need per-tenant webhook routing |
| **Shared base + tenant column** | Single deployment, cheaper | No row-level security in Airtable, risk of data leakage, all queries need `AND({tenant_id}='X', ...)` filters, performance degrades |
| **Airtable Enterprise workspaces** | Airtable-native isolation | Expensive, complex API management |

**Recommendation:** One base per tenant is the safest path. Airtable has no row-level security, so a shared base is a data isolation risk. Each tenant gets their own base, and table IDs are loaded from a tenant config at startup.

### 3.3 n8n Workflow Strategy

**Current state:** 9 active workflows on `liozshor.app.n8n.cloud`. Workflows are hardcoded to:
- Single Airtable base (via Airtable nodes with hardcoded credentials)
- Single email account (MS Graph with firm's Azure tenant)
- Single OneDrive storage (firm's SharePoint)

**Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **One n8n instance per tenant** | Full isolation, no code changes to workflows | Cost scales linearly ($20+/tenant/month on Cloud), operational burden |
| **Shared n8n with routing** | Single instance, lower cost | Massive refactor — every workflow needs tenant_id routing, credential switching, Airtable base routing |
| **Replace n8n with Workers** | Already migrating (DL-169+), single codebase | Large effort, but long-term simplest. Workers already handle most endpoints |

**Recommendation:** Continue the n8n → Workers migration. Most critical paths are already on Workers. The remaining n8n workflows ([04] Document Edit, [06] Reminders, [SUB] Document Service) should be migrated to Workers for true multi-tenancy.

### 3.4 Frontend Multi-Tenant Routing

**Current state:** Single GitHub Pages deploy at `liozshor.github.io/annual-reports-client-portal`. All clients share the same HTML/JS/CSS.

**Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **Single deploy + config injection** | One codebase, easy updates | Need a config endpoint; branding (logo, firm name, colors) loaded at runtime; GitHub Pages has no server-side rendering |
| **Custom domain per tenant** | Professional branding | GitHub Pages supports one custom domain per repo; would need separate repos or a CDN (Cloudflare Pages) |
| **Cloudflare Pages** | Custom domains, env vars, edge functions | Migration effort from GitHub Pages |

**Recommendation:** Migrate frontend to Cloudflare Pages (already using Cloudflare Workers). Each tenant gets a custom domain. Config loaded from a `/tenant-config` Worker endpoint at page load.

### 3.5 Auth & Token Binding

**Current state:**
- Admin auth: single `ADMIN_PASSWORD` secret — anyone with the password is admin
- Client auth: HMAC tokens embed `report_id` and bind to `CLIENT_SECRET_KEY`
- No user accounts, no roles, no tenant scoping
- Tokens do NOT carry a tenant identifier

**For multi-tenancy:**
- Each tenant needs its own admin credentials (or a user/role system)
- Client HMAC tokens need a `tenant_id` claim
- `SECRET_KEY` and `CLIENT_SECRET_KEY` must be per-tenant or include tenant in HMAC input
- The `reviewed_by: 'Natan'` hardcoding must become a user identity from the auth context

### 3.6 Email Infrastructure

**Current state:** All emails sent via MS Graph as `reports@moshe-atsits.co.il`. Single Azure tenant. Single mailbox for inbound email processing.

**For multi-tenancy:**
- Each tenant needs their own email domain + mailbox
- MS Graph credentials (tenant ID, client ID, refresh token) are per-tenant
- Inbound email processing (`OFFICE_DOMAIN` filter) is hardcoded to `@moshe-atsits.co.il`
- Email templates embed firm name, contact info, WhatsApp number

---

## 4. Recommended Migration Path

### Phase 1: Extract Hardcoded Values into Tenant Config (2-3 weeks)

**Goal:** Every tenant-specific value comes from ONE config source.

1. Create `api/src/config/tenant.ts`:
   ```typescript
   export interface TenantConfig {
     firmName: { he: string; en: string };
     officeDomain: string;
     officeEmail: string;
     contactEmail: string;
     contactPhone: string;    // WhatsApp
     alertEmail: string;
     frontendBase: string;
     workerBase: string;
     n8nBase: string;
     logoUrl: string;
     waIconUrl: string;
     airtableBaseId: string;
     airtableTables: Record<string, string>;
     tallyForms: Record<string, { he: string; en: string }>;
     driveId: string;
     oneDriveToken: string;
     reviewerName: string;
     stages: Record<string, StageDefinition>;
   }
   ```

2. Populate from `wrangler.toml` [vars] + KV store (for complex config).

3. Replace all hardcoded constants with `tenantConfig.*` references.

4. Create equivalent `tenant-config.js` for frontend, loaded from a Worker endpoint.

5. Centralize duplicated table IDs (currently scattered across 7+ route files) into single import.

**Estimated changes:** ~99 hardcoded values across ~35 files.

### Phase 2: Infrastructure Decisions (3-4 weeks)

1. **Airtable:** Implement base-per-tenant. Create an Airtable "base template" that can be cloned for new tenants. Table IDs loaded from tenant config.

2. **n8n:** Migrate remaining 3 workflows to Workers. This eliminates the n8n multi-instance problem entirely.

3. **Email:** Store per-tenant MS Graph credentials in KV or D1. Route inbound emails by domain. Implement credential-per-tenant in `ms-graph.ts`.

4. **Storage:** Per-tenant OneDrive drive ID and sharing token from tenant config.

### Phase 3: Frontend Multi-Tenant Routing (2-3 weeks)

1. Migrate from GitHub Pages to Cloudflare Pages.
2. Add `/api/tenant-config` endpoint that returns branding, form IDs, URLs based on domain.
3. Frontend loads config at startup: `const config = await fetch('/api/tenant-config')`.
4. Replace hardcoded firm names, logos, emails with config values.
5. Support custom domains per tenant (Cloudflare Pages custom domains).
6. CSP headers generated dynamically from tenant config.

### Phase 4: Onboarding Flow for New Tenants (2-3 weeks)

1. **Tenant provisioning script:**
   - Clone Airtable base from template
   - Create Cloudflare KV entries with tenant config
   - Set up custom domain in Cloudflare Pages
   - Generate HMAC secret keys
   - Create Tally forms (or manual step)
   
2. **MS Graph onboarding:**
   - OAuth flow for tenant's Azure AD
   - Store refresh token in KV
   - Validate mailbox access

3. **Admin panel:** Add tenant selector (super-admin view) or isolate per-tenant admin panels.

4. **Rename `Moshe_Review` stage** to a generic name (e.g., `Partner_Review`) across Airtable, frontend, and API. This is a data migration across all existing records.

---

## 5. Things That Already Scale Well

These patterns are tenant-agnostic and need minimal or no changes:

| Pattern | Why It's Good |
|---------|---------------|
| **Secret externalization** | 10 secrets properly in `wrangler secret put` — just need per-tenant secrets |
| **HMAC token architecture** | Token-per-report design works for any tenant; just parameterize the secret key |
| **SSOT document generation** | Template-driven from Airtable config — new tenant just needs their own templates table |
| **Stage pipeline logic** | 8-stage FSM is generic; stage names need renaming but flow is universal |
| **Hono API framework** | `c.env.*` pattern makes adding env vars trivial |
| **Cloudflare Workers runtime** | Edge deployment, KV/D1 available for tenant config storage |
| **Bilingual support** | EN/HE infrastructure already exists; adding languages is additive |
| **CSP-based security** | Already has CSP; just needs dynamic origin injection |
| **Inbound email processing pipeline** | AI classification is firm-agnostic; just needs per-tenant credential routing |
| **Error logging + alerting** | `logError()` pattern works; just parameterize alert email |
| **Client portal token flow** | Opaque `report_id` + HMAC works for any tenant |
| **Print CSS layouts** | Generic document/table styling (only footer text needs config) |
| **Frontend shared modules** | `constants.js` / `endpoints.js` centralize values — just need to source from config instead of hardcoded |

### Already-Externalized Secrets (no changes needed beyond per-tenant provisioning)

| Secret | Mechanism |
|--------|-----------|
| `ADMIN_PASSWORD` | Cloudflare secret |
| `SECRET_KEY` | Cloudflare secret |
| `CLIENT_SECRET_KEY` | Cloudflare secret |
| `AIRTABLE_PAT` | Cloudflare secret |
| `MS_GRAPH_CLIENT_ID` | Cloudflare secret |
| `MS_GRAPH_CLIENT_SECRET` | Cloudflare secret |
| `MS_GRAPH_TENANT_ID` | Cloudflare secret |
| `MS_GRAPH_REFRESH_TOKEN` | Cloudflare secret |
| `N8N_INTERNAL_KEY` | Cloudflare secret |
| `ANTHROPIC_API_KEY` | Cloudflare secret |
| `APPROVAL_SECRET` | Cloudflare secret |

---

## Appendix: Files Requiring Changes (by priority)

### Critical Path (must change for any multi-tenant deployment)

1. `api/src/lib/email-styles.ts` — 8 hardcoded values (central config hub)
2. `api/src/lib/inbound/types.ts` — 5 table IDs + mailbox
3. `api/src/lib/email-html.ts` — 10+ firm name/email references in templates
4. `api/src/lib/classification-helpers.ts` — DRIVE_ID + document type names
5. `api/src/lib/inbound/attachment-utils.ts` — OneDrive sharing token
6. `api/src/lib/inbound/client-identifier.ts` — office domain filter
7. `api/wrangler.toml` — base config vars
8. `github/.../shared/constants.js` — API_BASE + stage names
9. `github/.../shared/endpoints.js` — CF_BASE URL

### Secondary (can be phased in)

10. `api/src/routes/classifications.ts` — `reviewed_by: 'Natan'` (6x)
11. `api/src/routes/chat.ts` — AI system prompt with firm name
12. All 5 HTML files — CSP headers, logo alts, email links
13. `github/.../assets/js/landing.js` — Tally form IDs
14. `github/.../assets/js/error-handler.js` — support email
15. `github/.../privacy-policy.html` — full rewrite per tenant

### Documentation (no runtime impact, update when ready)

16. `docs/workflow-ids.md` — n8n workflow ID registry
17. `docs/airtable-schema.md` — base/table ID references
18. `docs/architecture.md` — URL references
19. `docs/architecture/*.mmd` — diagram URL references
20. `.claude/rules/*` — agent configuration assumptions

---

## Backend Audit

**Audit Date:** 2026-04-12
**Scope:** n8n workflows (35 total: 11 active, 24 archived), Cloudflare Workers API (`api/src/`), Airtable schema (13 tables), external integrations (MS Graph, OneDrive, Tally, Claude API)

---

### Backend Findings Table

#### n8n Active Workflows

| Workflow | Node | Type | Hardcoded Value | Category |
|----------|------|------|----------------|----------|
| [07] Daily Natan Digest | Query Pending Approval | httpRequest | `appqBL5RWQN9cPOyh` | AIRTABLE_ID |
| [07] Daily Natan Digest | Query Pending Approval | httpRequest | `tbls7m3hmHC4hhQVy` | AIRTABLE_ID |
| [07] Daily Natan Digest | Query Pending Approval | httpRequest | `pat2XQGRyzPdycQWr.059c...` (Airtable PAT plaintext) | SECRET |
| [07] Daily Natan Digest | Query Pending Reviews | httpRequest | `tbloiSDN3rwRcl1ii` | AIRTABLE_ID |
| [07] Daily Natan Digest | Summarize Inbox (Claude) | code | `reports@moshe-atsits.co.il` | EMAIL |
| [07] Daily Natan Digest | Summarize Inbox (Claude) | code | CPA firm system prompt | AI_PROMPT |
| [07] Daily Natan Digest | Call Claude API | httpRequest | `sk-ant-api03-8Xzh...` (Anthropic API key plaintext) | SECRET |
| [07] Daily Natan Digest | Build Digest Email | code | `liozshor.github.io/annual-reports-client-portal/admin/` | FRONTEND_URL |
| [07] Daily Natan Digest | Build Digest Email | code | `Moshe Atsits` | FIRM_NAME |
| [07] Daily Natan Digest | Build Digest Email | code | `moshe@moshe-atsits.co.il` | EMAIL |
| [07] Daily Natan Digest | Build Digest Email | code | `natan@moshe-atsits.co.il` | EMAIL |
| [07] Daily Natan Digest | Send Email | httpRequest | `reports@moshe-atsits.co.il` (Graph sendMail) | EMAIL |
| [06] Reminder Scheduler | Fetch Config | airtable | `appqBL5RWQN9cPOyh` + `tblqHOkDnvb95YL3O` | AIRTABLE_ID |
| [06] Reminder Scheduler | Search Due Reminders | airtable | `appqBL5RWQN9cPOyh` + `tbls7m3hmHC4hhQVy` | AIRTABLE_ID |
| [06] Reminder Scheduler | Search Missing Docs | airtable | `tblcwptR63skeODPn` | AIRTABLE_ID |
| [06] Reminder Scheduler | Fetch Pending Cls | airtable | `tbloiSDN3rwRcl1ii` | AIRTABLE_ID |
| [06] Reminder Scheduler | Build Type A Email | code | `db3f995dd145fa5d...` (client token secret plaintext) | SECRET |
| [06] Reminder Scheduler | Build Type A Email | code | `liozshor.github.io/annual-reports-client-portal/` | FRONTEND_URL |
| [06] Reminder Scheduler | Build Type A Email | code | `reports@moshe-atsits.co.il`, `natan@moshe-atsits.co.il` | EMAIL |
| [06] Reminder Scheduler | Build Type A Email | code | `wa.me/972779928421`, `03-6390820`, `077-9928421` | PHONE |
| [06] Reminder Scheduler | Build Type A Email | code | `Client Name` (Hebrew firm name) | FIRM_NAME |
| [06] Reminder Scheduler | Build Type B Email | code | Same as Type A: secret, URLs, emails, phones, firm name | MULTI |
| [06] Reminder Scheduler | Prepare Type B Input | code | `'annual_report'` hardcoded default | FILING_TYPE |
| [06] Reminder Scheduler | Call Document Service | executeWorkflow | `hf7DRQ9fLmQqHv3u` (sub-workflow ID) | WORKFLOW_ID |
| [MONITOR] Security Alerts | Query Security Logs | httpRequest | `appqBL5RWQN9cPOyh` + `security_logs` | AIRTABLE_ID |
| [MONITOR] Security Alerts | Query Security Logs | httpRequest | `pat2XQGRyzPdycQWr.059c...` (Airtable PAT plaintext) | SECRET |
| [MONITOR] Security Alerts | Build Alert Email | code | `Moshe Atsits` (logo alt), `liozshor.github.io` | FIRM_NAME |
| [MONITOR] Security Alerts | Send Email | httpRequest | `liozshor1@gmail.com` (alert recipient) | EMAIL |
| [MONITOR] Log Cleanup | All nodes | httpRequest/code | `appqBL5RWQN9cPOyh` + `security_logs` + Airtable PAT (x3) | AIRTABLE_ID, SECRET |
| [API] Send Batch Status | Parse & Verify | code | `0d1a9b04f3c2...` (N8N_INTERNAL_KEY plaintext) | SECRET |
| [API] Send Batch Status | Parse & Verify | code | `QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_` (HMAC secret) | SECRET |
| [API] Send Batch Status | Get Report | airtable | `appqBL5RWQN9cPOyh` + `tbls7m3hmHC4hhQVy` | AIRTABLE_ID |
| [API] Send Batch Status | Search Documents | airtable | `tblcwptR63skeODPn` | AIRTABLE_ID |
| [API] Send Batch Status | Build Email | code | `reports@moshe-atsits.co.il`, `natan@moshe-atsits.co.il` | EMAIL |
| [API] Send Batch Status | Build Email | code | `wa.me/972779928421`, `03-6390820`, `077-9928421` | PHONE |
| [API] Send Batch Status | Build Email | code | `Moshe Atsits CPA Firm` / `משרד רו"ח Client Name` | FIRM_NAME |
| [API] Send Batch Status | Build Email | code | `liozshor.github.io/.../view-documents.html` | FRONTEND_URL |
| [API] Send Batch Status | Build Email | code | `db3f995dd145fa5d...` (client token secret) | SECRET |
| [API] Send Batch Status | Update Notification | code | `patvXzYxSlSUEKx9i.25f38...` (2nd Airtable PAT) | SECRET |
| [API] Send Batch Status | Respond nodes | respondToWebhook | `liozshor.github.io` (CORS) | FRONTEND_URL |
| [02] Questionnaire Processing | 8 Airtable nodes | airtable | `appqBL5RWQN9cPOyh` + 6 table IDs | AIRTABLE_ID |
| [02] Questionnaire Processing | Clear Reminder Date | code | `patvXzYxSlSUEKx9i.25f38...` (Airtable PAT plaintext) | SECRET |
| [02] Questionnaire Processing | Extract & Map | code | `'annual_report'` default | FILING_TYPE |
| [02] Questionnaire Processing | Prepare Email | code | `reports@moshe-atsits.co.il` | EMAIL |
| [02] Questionnaire Processing | Call Document Service | executeWorkflow | `hf7DRQ9fLmQqHv3u` | WORKFLOW_ID |
| [05] Inbound Processing | Forward to Worker | httpRequest | `annual-reports-api.liozshor1.workers.dev/webhook/...` | WORKER_URL |
| [05] Inbound Processing | Forward to Worker | httpRequest | `Bearer 0d1a9b04f3c2...` (internal key plaintext) | SECRET |
| [05] Inbound Processing | Extract Notification | code | `wf05-inbound-secret` (clientState) | SECRET |
| [05] Inbound Processing | Pinned data | webhook | Azure tenantId `1c7cac5b-...` | AZURE_ID |
| [SUB] Document Service | 4 Airtable nodes | airtable | `appqBL5RWQN9cPOyh` + 3 table IDs | AIRTABLE_ID |
| [SUB] Document Service | Generate HTML | code | `reports@`, `natan@moshe-atsits.co.il` | EMAIL |
| [SUB] Document Service | Generate HTML | code | `annual-reports-api.liozshor1.workers.dev` | WORKER_URL |
| [SUB] Document Service | Generate HTML | code | `liozshor.github.io/annual-reports-client-portal` (x4) | FRONTEND_URL |
| [SUB] Document Service | Generate HTML | code | `Moshe Atsits` / `משרד רו"ח Client Name` | FIRM_NAME |
| [06-SUB] Monthly Reset | 4 Airtable nodes | airtable | `appqBL5RWQN9cPOyh` + `tbls7m3hmHC4hhQVy` (x4) | AIRTABLE_ID |
| [05-SUB] Email Subscription | Create Subscription | httpRequest | `liozshor.app.n8n.cloud/webhook/wf05-email-notification` | WEBHOOK_URL |
| [05-SUB] Email Subscription | Multiple nodes | code/httpRequest | `wf05-inbound-secret`, `liozshor1@gmail.com` | SECRET, EMAIL |
| [04] Document Edit Handler | Webhook | webhook | `https://liozshor.github.io` (CORS) | FRONTEND_URL |
| [04] Document Edit Handler | Extract & Validate | code | `appqBL5RWQN9cPOyh` + `tbls7m3hmHC4hhQVy` | AIRTABLE_ID |
| [04] Document Edit Handler | 6 Airtable nodes | airtable | `appqBL5RWQN9cPOyh` + 2 table IDs (x6) | AIRTABLE_ID |
| [04] Document Edit Handler | Build Edit Email | code | `reports@moshe-atsits.co.il` | EMAIL |
| [04] Document Edit Handler | Build Edit Email | code | `annual-reports-api.liozshor1.workers.dev`, `liozshor.github.io` | WORKER_URL, FRONTEND_URL |
| [04] Document Edit Handler | Build Edit Email | code | `משרד רו"ח Client Name` (x2) | FIRM_NAME |
| [04] Document Edit Handler | Verify Admin Token | code | N8N_INTERNAL_KEY + HMAC secret (plaintext) | SECRET |
| [04] Document Edit Handler | MS Graph - Send | httpRequest | `reports@moshe-atsits.co.il` (from address) | EMAIL |

#### n8n Archived Workflows (Pattern Summary)

| Category | Occurrences | Details |
|----------|-------------|---------|
| AIRTABLE_ID | 22 of 24 workflows | Base ID `appqBL5RWQN9cPOyh` + 12 distinct table IDs |
| SECRET (CRITICAL) | 17 workflows | Admin HMAC key in Code nodes |
| SECRET (CRITICAL) | 8 workflows | 2 distinct Airtable PATs in plaintext Code nodes |
| SECRET (CRITICAL) | 4 workflows | Client token secret in Code nodes |
| SECRET (CRITICAL) | 1 workflow | Admin password `reports3737!` in plaintext (Auth & Verify) |
| SECRET | 1 workflow | Webhook approval secret |
| SECRET | 1 workflow | N8N internal key |
| FRONTEND_URL | 20 workflows | `liozshor.github.io` in CORS headers |
| FRONTEND_URL | 5 workflows | Landing page and confirmation URLs |
| EMAIL | 3 workflows | `reports@`, `natan@moshe-atsits.co.il` |
| FIRM_NAME | 2 workflows | `צוות משרד רו"ח Client Name` in email HTML |
| PHONE | 1 workflow | `03-6390820`, `077-9928421`, WhatsApp `972779928421` |
| ONEDRIVE | 1 workflow | Drive ID `b!SxgoZqBDPEO...` + SharePoint path |
| TALLY_ID | 2 workflows | `1AkYKb` (HE), `1AkopM` (EN) in pinned data |
| CREDENTIAL_REF | 7 workflows | MS Graph credential `GcLQZwzH2xj41sV7` |
| WORKFLOW_ID | 3 workflows | Sub-workflow references |

#### Cloudflare Workers API (`api/src/`)

| File | Lines | Hardcoded Value | Category |
|------|-------|----------------|----------|
| `wrangler.toml` | 11-13 | `ALLOWED_ORIGIN`, `AIRTABLE_BASE_ID`, `ALERT_EMAIL` | CONFIG |
| `wrangler.toml` | 29,33 | KV namespace IDs | INFRA_ID |
| `routes/approve-and-send.ts` | 16-22 | Frontend URL, office email, 3 table IDs | MULTI |
| `routes/send-questionnaires.ts` | 13-16 | Frontend URL, office email, 2 table IDs | MULTI |
| `routes/edit-documents.ts` | 19-38 | 2 table IDs + n8n webhook URL | AIRTABLE_ID, WEBHOOK_URL |
| `routes/reminders.ts` | 19-158 | 2 table IDs + n8n webhook URL | AIRTABLE_ID, WEBHOOK_URL |
| `routes/feedback.ts` | 9-33 | `reports@`, `liozshor1@gmail.com`, asset URL | EMAIL |
| `routes/classifications.ts` | 58-1085 | 7 table IDs + `reviewed_by: 'Natan'` (6x) | AIRTABLE_ID, STAFF_NAME |
| `routes/client.ts` | 22-147 | `tbls7m3hmHC4hhQVy` (8 instances) | AIRTABLE_ID |
| `routes/client-reports.ts` | 12-99 | Table IDs + filing_type hardcoding | AIRTABLE_ID |
| `routes/dashboard.ts` | 14-47 | Table ID + stage names | AIRTABLE_ID |
| `routes/documents.ts` | 19-23 | Multiple table IDs | AIRTABLE_ID |
| `routes/upload-document.ts` | 18-88 | Table IDs + OneDrive path | AIRTABLE_ID, ONEDRIVE |
| `routes/questionnaires.ts` | 30-56 | Table IDs | AIRTABLE_ID |
| `routes/rollover.ts` | 33-106 | Table IDs | AIRTABLE_ID |
| `routes/submission.ts` | 49-99 | Table IDs | AIRTABLE_ID |
| `routes/import.ts` | 28-130 | Table IDs | AIRTABLE_ID |
| `routes/pending.ts` | 27 | Table ID | AIRTABLE_ID |
| `routes/reset.ts` | 23-62 | Multiple table IDs | AIRTABLE_ID |
| `routes/stage.ts` | 12-84 | Table IDs + stage ordering | AIRTABLE_ID |
| `routes/chat.ts` | 10,26 | AI prompt: `Moshe Atsits CPA firm's...`, `Moshe_Review` | AI_PROMPT, STAFF_NAME |
| `lib/email-styles.ts` | 33-48 | Office email, WhatsApp, asset URLs, API URL | EMAIL, PHONE, URL |
| `lib/email-html.ts` | 83-635 | Firm names (EN+HE), phones, emails (15+) | FIRM_NAME, EMAIL, PHONE |
| `lib/classification-helpers.ts` | 15-16 | OneDrive drive ID `b!SxgoZqBDPEO...` | ONEDRIVE |
| `lib/inbound/types.ts` | 15-19 | Multiple table IDs | AIRTABLE_ID |
| `lib/inbound/processor.ts` | 67 | `reports@moshe-atsits.co.il` | EMAIL |
| `lib/inbound/client-identifier.ts` | 32 | `@moshe-atsits.co.il` domain | EMAIL |
| `lib/error-logger.ts` | 115 | `reports@moshe-atsits.co.il` | EMAIL |

#### Summary by Category (All Backend Components)

| Category | n8n Active | n8n Archived | Workers | Total |
|----------|-----------|-------------|---------|-------|
| AIRTABLE_ID (base + table) | ~54 | ~100+ | ~50+ | **200+** |
| SECRET (plaintext keys/tokens) | 12 | 30+ | 0 (in secrets) | **42+** |
| EMAIL (@moshe-atsits.co.il) | 14 | 6 | 8 | **28** |
| FIRM_NAME (HE + EN) | 8 | 4 | 5 | **17** |
| FRONTEND_URL (github.io) | 12 | 25 | 8 | **45** |
| WORKER_URL (workers.dev) | 3 | 0 | 2 | **5** |
| WEBHOOK_URL (n8n.cloud) | 4 | 0 | 2 | **6** |
| PHONE / WhatsApp | 9 | 2 | 3 | **14** |
| STAFF_NAME (Natan/Moshe) | 0 | 0 | 8 | **8** |
| AI_PROMPT (firm context) | 1 | 0 | 1 | **2** |
| FILING_TYPE (hardcoded default) | 2 | 2 | 1 | **5** |
| ONEDRIVE (drive ID) | 0 | 1 | 1 | **2** |
| AZURE_ID (tenant/user) | 1 (pinned) | 0 | 0 | **1** |
| TALLY_ID (form IDs) | 0 | 2 (pinned) | 0 | **2** |
| CREDENTIAL_REF (n8n cred IDs) | 6 | 7 | 0 | **13** |
| WORKFLOW_ID (sub-workflow refs) | 3 | 3 | 0 | **6** |
| **TOTAL** | | | | **~394** |

---

### Airtable Schema Assessment

#### Current Schema (13 tables)

| Table | ID | Purpose | Multi-Tenant Concern |
|-------|-----|---------|---------------------|
| `clients` | tblFFttFScDRZ7Ah5 | Client master | `client_id` formula hardcodes `"CPA-"` prefix |
| `reports` | tbls7m3hmHC4hhQVy | Report tracking | Stage `Moshe_Review` is staff-specific; no tenant field |
| `email_events` | tblJAPEcSJpzdEBcW | Email processing | No tenant field |
| `documents` | tblcwptR63skeODPn | Document tracking | No tenant field |
| `pending_classifications` | tbloiSDN3rwRcl1ii | AI classification queue | No tenant field |
| `תשובות שאלון שנתי` | tblxEox8MsbliwTZI | Questionnaire responses | Hebrew table name; Israel-specific fields |
| `system_logs` | tblVjLznorm0jrRtd | Workflow logs | No tenant field |
| `documents_templates` | tblQTsbhC6ZBrhspc | Template definitions | `filing_type` select limited to AR/CS |
| `question_mappings` | tblWr2sK1YvyLWG3X | Tally-to-template mapping | Embeds Airtable field IDs in select options |
| `categories` | tblbn6qzWNfR8uL2b | Document categories | Hebrew category names (generic enough to share) |
| `system_config` | tblqHOkDnvb95YL3O | Key-value config | Global — no tenant scoping |
| `security_logs` | tbljTNfeEkb3psIf8 | Security audit log | No tenant field |
| `company_links` | tblDQJvIaEgBw2L6T | Company URL directory | Israel-specific financial institutions |

#### Multi-Tenancy Readiness

**Verdict: Inherently single-tenant.** No `tenant_id` or `firm_id` field exists on any table.

**Key concerns:**
1. **`client_id` formula:** `"CPA-" & {counter}` — prefix hardcoded in Airtable formula
2. **Stage `Moshe_Review`:** Staff name in a stage. Would need renaming to `Partner_Review`
3. **Hebrew table name `תשובות שאלון שנתי`:** Not a blocker but signals single-firm design
4. **Linked records:** All 6 link fields connect within the same base — shared-base model needs tenant isolation on every linked table
5. **`question_mappings`:** `template_ids` and `condition` embed Tally form field references — tightly coupled to one firm's Tally forms
6. **`company_links`:** Israel-specific financial institutions — different tenant = different directory
7. **Formula fields** reference field IDs (`fldXXX`) which differ per base — formulas break on clone

---

### Backend Architecture Decisions Needed

#### 1. n8n Workflow Engine

| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| **A. Shared n8n, routing layer** | One instance; shared monitoring | No tenant isolation; credential mixing risk; execution limits shared | High |
| **B. One n8n instance per tenant** | Full isolation; independent scaling | $50+/mo each; schema drift; 11 workflows to clone per tenant | Medium |
| **C. Migrate remaining n8n to Workers** | Eliminates n8n dependency; per-request pricing | MS Graph OAuth complexity; cron scheduling; significant rewrite | Very High |

**Recommendation:** Option B initially. Clone 11 active workflows per tenant. Long-term, migrate to Workers (Option C).

**Workflows that could be shared:** [MONITOR] Log Cleanup, [06-SUB] Monthly Reset (pure Airtable ops).
**Workflows that MUST be per-tenant:** All others (email branding, HMAC secrets, Graph credentials, Tally forms).

#### 2. Airtable Data Layer

| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| **A. Shared base + tenant_id** | Efficient; one schema; cross-tenant analytics | Cross-tenant leak risk; every query needs filter; formulas can't filter; rate limits shared (5 req/sec/base) | High |
| **B. Separate base per tenant** | Full isolation; independent rate limits | Schema sync manual; formula field IDs differ; no cross-tenant reporting | Medium |
| **C. Separate workspace per tenant** | Strongest isolation; separate billing | Highest cost; most complex | Low dev, High ops |

**Recommendation:** Option B. Linked records and formula field references make a shared base impractical. Airtable lacks row-level security — tenant isolation must be at the base level.

#### 3. Email (Microsoft Graph)

| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| **A. Per-tenant Azure AD app + mailbox** | Full isolation; tenant controls email; proper SPF/DKIM | Each tenant needs Azure AD admin; per-tenant token management | Medium |
| **B. Shared Azure AD app** | Single app registration | Requires admin consent in each tenant's Azure AD | High |
| **C. Shared sending (SendGrid)** | Simple; scales well | Generic domain; deliverability per tenant | Medium |

**Recommendation:** Option A. Israeli accounting firms already have M365. They provide Azure AD credentials; system stores refresh tokens per tenant.

#### 4. Document Storage (OneDrive/SharePoint)

| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| **A. Per-tenant OneDrive** | Natural isolation; familiar to accountants | Drive ID per tenant; folder structure must be consistent | Low |
| **B. Centralized storage (R2/S3)** | Simpler code | Accountants lose OneDrive access; storage costs | High |

**Recommendation:** Option A. Only one hardcoded drive ID to parameterize.

#### 5. Authentication & Security

| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| **A. Per-tenant HMAC secrets** | Isolation; compromised key = one tenant | More keys to manage | Low |
| **B. Shared secrets with tenant claims** | Simpler key management | One compromise = all tenants | Low |
| **C. Per-tenant Worker deployment** | Full isolation | Highest ops cost; code duplication | High |

**Recommendation:** Option A. Per-tenant secrets in KV, tenant ID in JWT claims.

#### 6. AI Classification (Anthropic Claude)

| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| **A. Shared API key, per-tenant prompts** | Simple; one billing | Can't attribute costs per tenant | Low |
| **B. Per-tenant API keys** | Cost attribution | Billing complexity | Medium |

**Recommendation:** Option A with usage tracking per tenant.

---

### Cost Implications

#### Per-Tenant Cost Estimates

| Component | Current (1 tenant) | Per Additional Tenant | Notes |
|-----------|-------------------|----------------------|-------|
| **n8n Cloud** | ~$50/mo (Starter) | +$50/mo per instance | 2,500 exec/mo. Shared: watch limits |
| **Airtable** | ~$20/mo (Team) | +$20/mo per base | 50k records/base, 100k API calls/mo |
| **Azure AD / M365** | $0 | $0 | Firms already have M365 |
| **Cloudflare Workers** | ~$5/mo (paid) | +$0-5/mo | 10M req/mo included; shared Worker |
| **Cloudflare KV** | ~$5/mo | +$1/mo | Token cache + config per tenant |
| **Anthropic API** | ~$30/mo | +$15-30/mo | ~1,500 calls/mo at ~$0.02 each |
| **Domain/DNS** | ~$15/yr | +$15/yr if custom domain | Or subdomain |
| **GitHub Pages** | $0 | $0 | Static; path-based routing |
| **TOTAL** | **~$115/mo** | **+$85-110/mo per tenant** | |

#### API Rate Limit Analysis

| Service | Limit | Current Usage (~500 clients) | Multi-Tenant Concern |
|---------|-------|------------------------------|---------------------|
| Airtable | 5 req/sec/base | ~2,000 calls/day peak | Separate base = separate limit. Shared base bottlenecks at 3+ tenants |
| MS Graph | 10k req/10min | ~200 emails + 50 file ops/day | Per-tenant app = per-tenant limits |
| Anthropic | Tier-dependent RPM | ~50 calls/day | Shared key scales to 10+ tenants |
| Cloudflare Workers | 10M req/mo | ~5,000 req/day | Handles 20+ tenants easily |
| n8n Cloud (Starter) | 2,500 exec/mo | ~1,500 exec/mo | Per-instance. Need Pro ($100/mo) at 3+ tenants shared |

---

### Security Findings (CRITICAL)

Plaintext secrets hardcoded in n8n Code nodes across 20+ workflows:

| Secret Type | Exposure | Workflows Affected |
|-------------|----------|-------------------|
| Airtable PAT #1 (`pat2XQG...`) | Full Airtable read/write | 6 active + 6 archived |
| Airtable PAT #2 (`patvXzY...`) | Full Airtable read/write | 3 active + 3 archived |
| Admin HMAC secret | Forge admin auth tokens | 2 active + 17 archived |
| Client token secret | Forge client portal tokens | 2 active + 4 archived |
| N8N internal key | Call internal webhooks | 2 active + 1 archived |
| Anthropic API key | Make AI calls on our account | 1 active |
| Admin password (`reports3737!`) | Direct admin login | 1 archived |
| Webhook approval secret | Forge approval requests | 1 archived |

**Impact:** Visible to anyone with n8n instance access. **Showstopper** for multi-tenancy — must be remediated before any tenant onboarding.

**Remediation:** (1) Rotate ALL secrets immediately. (2) Move to n8n credential store (note: `$env` blocked on n8n Cloud). (3) Workers secrets already use `wrangler secret put` correctly.

---

### Implementation Roadmap

| Phase | Scope | Effort | Prerequisite |
|-------|-------|--------|-------------|
| **0. Secret Rotation** | Rotate all 8 exposed secrets; move to credential store | 1 day | None — **do this NOW** |
| **1. Workers Parameterization** | Move hardcoded values to `wrangler.toml` vars or KV config | 3-5 days | None |
| **2. n8n Parameterization** | Extract hardcoded values to `system_config` or credential store | 5-7 days | Phase 0 |
| **3. Email Template Externalization** | Move firm name, contact info, branding to config | 3-5 days | Phase 1 |
| **4. Airtable Base Template** | Create "golden" base template; document schema sync | 2-3 days | Phase 2 |
| **5. Tenant Config System** | KV-based tenant config; routing by subdomain or path | 5-7 days | Phase 1 |
| **6. Per-Tenant Onboarding** | Automate: clone Airtable base, clone n8n workflows, configure Worker | 5-7 days | Phases 4-5 |
| **TOTAL** | | **~25-35 days** | |
