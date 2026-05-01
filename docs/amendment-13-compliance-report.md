# Amendment 13 Compliance Report

**System:** Annual Reports CRM — Moshe Atsits CPA Firm
**Audit Date:** 2026-03-11
**Last Updated:** 2026-03-12 (Phase 2 implemented — see §6)
**Auditor:** Automated compliance audit (Claude Code)
**Regulation:** Israel Protection of Privacy Law, Amendment No. 13 (effective August 14, 2025)
**Scope:** Full system audit — Airtable, n8n workflows, frontend, third-party processors

---

## 1. Executive Summary

### Overall Compliance Posture: ⚠️ Partial Compliance

The system has a **solid security foundation** (HMAC auth, CSP, CORS, security logging, URL parameter stripping) and an **existing privacy compliance checklist** (`docs/privacy-compliance.md`). However, several **critical gaps** exist that require immediate attention to comply with Amendment 13.

### Critical Findings (5):
1. ~~**No privacy notice or consent mechanism**~~ ✅ RESOLVED (2026-03-12) — Privacy notice + consent checkbox added to both Tally forms
2. ~~**No AI processing disclosure**~~ ✅ RESOLVED (2026-03-12) — AI disclosure included in Tally privacy notice
3. **No DPIA conducted** for the AI classification system — DEFERRED
4. **Hardcoded secrets in n8n workflow code** — admin password, HMAC keys, and Airtable API tokens are plaintext in JavaScript Code nodes across 6+ workflows (see Finding 24)
5. **Admin password is weak and hardcoded** — plaintext in Code node, single shared password for all admin access

### High-Priority Findings (5):
6. No executed Data Processing Agreements (DPAs) with key processors (~~Airtable~~, ~~Anthropic~~, Tally)
7. PII (full_name, email) passed as URL parameters to Tally forms
8. No formal data subject rights request procedure
9. No privacy policy published on the client portal
10. Google Fonts loaded on all pages — sends client IP addresses to Google without disclosure

### Medium-Priority Findings (7):
11. DPO appointment assessment needed
12. Pending PPA database registration assessment
13. AI classification data retention not automated
14. 30-day client token expiry may be excessive for tax data
15. No penetration testing conducted
16. Tally retains questionnaire data (including ISS) indefinitely after processing
17. approve-confirm.html exposes tokens via GET form submission

**Total: 29 findings** (5 compliant, 13 partial, 9 non-compliant, 2 unknown)

---

## 2. Data Map Summary

See `docs/data-map-amendment-13.md` for the complete data map.

**Key facts:**
- **~600 client records** across Airtable tables
- **ISS data processed:** Family status, disability/health info, financial data
- **6 external processors:** Airtable (US), Anthropic (US), Microsoft 365 (EU/IL), n8n Cloud (EU), Tally (EU), GitHub Pages (US)
- **AI processing:** Document images sent to Anthropic Claude API for classification
- **Cross-border transfers:** Client data flows to US (Airtable, Anthropic) and EU (n8n, Tally)

---

## 3. Findings by Category

### 3.1 Consent & Transparency

#### Finding 1: ~~No Privacy Notice on Tally Questionnaire~~ RESOLVED
- **Current State (updated 2026-03-12):** Privacy notice added to page 1 of both Tally forms (HE `1AkYKb` + EN `1AkopM`). Covers: who collects, what data, purpose, recipients (incl. AI with human oversight), retention (7 years / 90 days), rights under Amendment 13, and contact email. Published.
- **Compliance Status:** ✅ Compliant
- **Resolution:** Implemented via Tally MCP (session 148). Text documented in `docs/templates/tally-privacy-notice.md`.
- **Risk Level:** 🟢 Resolved

#### Finding 2: ~~No AI Processing Disclosure~~ RESOLVED
- **Current State (updated 2026-03-12):** AI disclosure included in the Tally privacy notice on both forms: "...ומערכת AI לסיווג מסמכים (עם פיקוח אנושי)" / "...and an AI document classification system (with human oversight)". Clients are informed before submitting any data.
- **Compliance Status:** ✅ Compliant
- **Resolution:** Included in Tally privacy notice (session 148). Separate email/portal disclosures deemed unnecessary since consent is captured at the point of data collection.
- **Risk Level:** 🟢 Resolved

#### Finding 3: No Published Privacy Policy — DEFERRED
- **Current State:** No privacy policy is linked or displayed on any page of the client portal (`index.html`, `view-documents.html`, `document-manager.html`, `admin/index.html`). The `privacy-compliance.md` is an internal document, not a client-facing policy.
- **Compliance Status:** ❌ Non-Compliant
- **Gap:** Amendment 13 requires accessible privacy information for data subjects.
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Mandatory
- **Recommended Action:** Create a client-facing privacy policy page (Hebrew + English) hosted on the GitHub Pages site. Link it from the footer of all client-facing pages and from the Tally questionnaire.
- **Implementation Complexity:** Medium — requires drafting bilingual legal text
- **Decision:** ⏸️ Deferred. The Tally privacy notice (F1) already covers all required disclosures (who collects, what, why, recipients, retention, rights). A separate privacy policy page is nice-to-have but not legally required if the Tally notice is comprehensive.

#### Finding 4: ~~Consent Not Explicit or Documented for Sensitive Data~~ RESOLVED
- **Current State (updated 2026-03-12):** Required consent checkbox added at the end of both Tally forms (page 11, before thank-you page). Combined consent covers all processing including sensitive data and AI: "קראתי והבנתי את הפרטים לעיל ואני מאשר/ת את איסוף ועיבוד המידע לצורך הכנת הדוח השנתי." Consent is recorded in Tally submission data.
- **Compliance Status:** ✅ Compliant
- **Resolution:** Implemented via Tally MCP (session 148). Checkbox is required — form cannot be submitted without consent.
- **Risk Level:** 🟢 Resolved
- **Remaining:** Consider adding `consent_given_at` timestamp field to Airtable for audit trail.

#### Finding 5: PII in Tally Redirect URL
- **Current State:** `landing.js:291-303` (`goToForm()`) passes `full_name` and `email` as URL query parameters when redirecting to Tally.
- **Compliance Status:** ⚠️ Partial
- **Gap:** PII in URLs appears in browser history, address bar, and potentially Tally server logs. The `no-referrer` meta tag mitigates referrer leakage but doesn't prevent the other exposures.
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Security best practice (not explicitly prohibited but contradicts data minimization principle)
- **Recommended Action:** Use Tally's hidden fields feature or POST-based prefill to avoid PII in URLs. Alternatively, have Tally fetch the prefill data from an API endpoint using only the report_id/token.
- **Implementation Complexity:** Medium — requires Tally configuration changes
- **Code Reference:** `github/annual-reports-client-portal/assets/js/landing.js:291-303`

---

### 3.2 Data Minimization & Retention

#### Finding 6: Data Retention Policy Exists but Partially Implemented — DEFERRED
- **Current State:** `docs/privacy-compliance.md` defines retention periods (7 years for tax data, 90 days for AI classification, 1 year for email events). Security logs have automated cleanup (`[MONITOR] Log Cleanup`). But AI classification and email event cleanup are marked as manual.
- **Compliance Status:** ⚠️ Partial
- **Gap:** No automated enforcement of retention for: AI classification data (90 days), email events (1 year), system_logs (undefined), questionnaire responses.
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Mandatory — Amendment 13 requires not retaining data longer than necessary
- **Recommended Action:** Create automated cleanup workflows for: (1) pending_classifications older than 90 days, (2) email_events older than 1 year, (3) system_logs older than 90 days. For tax data (7-year retention), create an annual review workflow that flags records past retention.
- **Implementation Complexity:** Medium — n8n scheduled workflows
- **Decision:** ⏸️ Deferred. Manual yearly cleanup is sufficient for a firm with ~600 clients. Retention periods are documented in privacy-compliance.md. Automation can be added later if volume grows.

#### Finding 7: Duplicate Data in `client_questions` — DEFERRED
- **Current State:** `annual_reports.client_questions` stores a JSON copy of questionnaire Q&A, duplicating data from the `תשובות שאלון שנתי` table.
- **Compliance Status:** ⚠️ Partial
- **Gap:** Data duplication increases the surface area for breaches and complicates deletion requests.
- **Risk Level:** 🟢 Low
- **Legal Requirement:** Best practice (data minimization principle)
- **Recommended Action:** Document the business justification (DL-110 — used by Document Manager for questionnaire tab display). If the original data is accessible via API, consider removing the duplicate.
- **Implementation Complexity:** High — would require refactoring the Document Manager
- **Decision:** ⏸️ Deferred indefinitely. Low risk, high effort. The duplication serves a functional purpose (Document Manager questionnaire tab).

---

### 3.3 Data Subject Rights

#### Finding 8: No Formal Data Subject Rights Procedure — PLANNED
- **Current State:** No documented process for handling client requests to access, correct, or delete their data. No contact mechanism on the portal. The existing privacy-compliance.md lists this as "Pending."
- **Compliance Status:** ❌ Non-Compliant
- **Gap:** Amendment 13 §13 grants data subjects explicit rights. The firm needs a procedure to handle requests within reasonable time.
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Mandatory
- **Recommended Action:** (1) Create a Data Subject Rights Request procedure document. (2) Add contact information for privacy requests to the portal and privacy policy. (3) Designate a staff member to handle requests. (4) Consider building an admin workflow to export all data for a given client.
- **Implementation Complexity:** Medium
- **Decision:** 📋 Planned. Procedure document already written at `docs/templates/dsr-procedure.md` (Hebrew). Moshe needs to read and approve it — 15 minutes. Includes spouse clause and AI objection handling.
- **Note:** For deletion requests, the system must handle cascade deletion across: clients → annual_reports → documents → email_events → pending_classifications → questionnaire responses. The 7-year tax retention period provides legal basis to decline deletion of active tax records.

#### Finding 9: Bilingual Support Adequate
- **Current State:** The system already supports Hebrew and English throughout (questionnaires, portal, emails). Arabic is not supported.
- **Compliance Status:** ⚠️ Partial
- **Gap:** Amendment 13 requires responses in Hebrew, English, or Arabic. Arabic support is absent.
- **Risk Level:** 🟢 Low — Unlikely to have Arabic-speaking clients given the CPA firm's client base
- **Legal Requirement:** Mandatory (if requested)
- **Recommended Action:** Add Arabic as a future option. For now, document that Arabic requests will be handled manually.
- **Implementation Complexity:** Low (for manual handling)

---

### 3.4 Security Assessment

#### Finding 24: Hardcoded Secrets in n8n Workflow Code — DEFERRED (Accepted Risk)
- **Current State:** The n8n workflow audit discovered multiple secrets hardcoded directly in JavaScript Code nodes (not in n8n's credential store):

| Secret | Exposure | Workflows |
|--------|----------|-----------|
| Admin password (plaintext in Code node) | Plaintext admin password | Auth & Verify |
| Admin HMAC signing key | Universal admin HMAC signing key | 6+ workflows |
| Client token signing key | Client portal token signing key | Send Questionnaires |
| Airtable PAT #1 (full base read/write) | Full Airtable PAT (read/write all bases) | Questionnaire Processing, Get Pending Classifications |
| Airtable PAT #2 (security_logs) | Security logs Airtable PAT | Auth & Verify, Security Alerts, Log Cleanup |
| MS Graph subscription validation secret | MS Graph subscription secret | Email Subscription Manager |

- **Compliance Status:** ❌ Non-Compliant
- **Gap:** Amendment 13 §13(b) requires "appropriate security measures" for personal data. These secrets are hardcoded in JavaScript Code nodes within the n8n Cloud workspace. They are visible to anyone with **n8n Cloud editor access** to this workspace (currently the workspace owner). While not publicly exposed on the internet, this still constitutes inadequate security: n8n Cloud support staff may have access, there is no per-secret audit trail, and the secrets cannot be rotated independently of the code. The Airtable PAT with full base access is especially critical — it provides read/write access to all 600+ client records.
- **Risk Level:** 🔴 Critical
- **Legal Requirement:** Mandatory (adequate security measures)
- **Recommended Action:** (1) **Immediately rotate** the admin password and both Airtable PATs. (2) Migrate all secrets to n8n's credential store or environment variables. n8n Cloud's **Team/Enterprise plan** offers credential-level access controls and environment variables — this is the recommended migration path. (3) As interim on the current plan, use n8n environment variables where possible. (4) Change admin password to a strong unique value.
- **Implementation Complexity:** Medium — requires updating 6+ workflows
- **Note:** Actual secret values are intentionally not included in this report.
- **Decision:** ⏸️ Deferred. Only 2 users have n8n Cloud editor access. Secrets are not publicly exposed. Migration to n8n credential store is blocked by current plan. Risk accepted for now — will revisit on n8n plan upgrade.

#### Finding 25: Single Shared Admin Password — DEFERRED
- **Current State:** All admin access uses a single shared password (weak, hardcoded in plaintext). No individual user accounts, no audit trail of which admin performed actions.
- **Compliance Status:** ❌ Non-Compliant
- **Gap:** Cannot attribute actions to specific individuals. If the password is compromised, all admin access is compromised.
- **Risk Level:** 🟡 Medium (lower priority than secret rotation)
- **Legal Requirement:** Best practice (access control, audit trail)
- **Recommended Action:** Implement per-user admin accounts when feasible. In the meantime, change the shared password to a strong value and restrict knowledge to essential staff only.
- **Implementation Complexity:** High

- **Decision:** ⏸️ Deferred. 2 admin users, low risk. Per-user accounts require full auth rework.
#### Finding 26: ~~Google Fonts IP Leakage~~ RESOLVED
- **Current State (updated 2026-03-11):** ~~All pages load fonts from `fonts.googleapis.com` and `fonts.gstatic.com`. ~~ Fonts now self-hosted locally in assets/fonts/. Google Fonts import removed from design-system.css. CSP headers updated across all 7 HTML files. Commit 0b09ae1.
- **Compliance Status:** ✅ Compliant
- **Resolution:** Commit `0b09ae1` — 12 woff2 files self-hosted, local fonts.css, CSP headers cleaned across all HTML files.
- **Risk Level:** 🟢 Resolved




#### Finding 27: approve-confirm.html Uses GET Form Submission — Accepted Risk
- **Current State (updated 2026-03-11):** Form remains `method=GET` — n8n Cloud does not properly route POST requests to this webhook (500 at infrastructure level). The GET params contain an HMAC hash token (not reversible, not PII) and `report_id`. The page strips all URL params via `history.replaceState` on load. n8n Verify Token node was updated to merge POST body + GET query (harmless, stays for future use).
- **Compliance Status:** ⚠️ Accepted Risk
- **Gap:** HMAC hash tokens appear briefly in URL bar and persist in browser history and server logs. However: (1) tokens are non-reversible hashes, not PII, (2) URL params stripped immediately on page load, (3) tokens are single-use and scoped to a specific report.
- **Risk Level:** 🟢 Low (accepted)
- **Decision:** Risk accepted. Will revisit if n8n Cloud adds proper POST webhook support or if a dedicated POST-only webhook path becomes feasible.




#### Finding 10: Strong Authentication Foundation
- **Current State:**
  - Admin: password authentication → HMAC token (8-hour expiry) stored in localStorage
  - Client: HMAC tokens with 30-day expiry, passed via URL then stored in sessionStorage
  - URL parameters stripped immediately from browser bar (`history.replaceState`)
  - CSP headers on all pages
  - SRI on external scripts (Lucide)
  - CORS restrictions on n8n webhooks
  - POST for mutations
  - Security event logging with automated monitoring
- **Compliance Status:** ✅ Compliant (mostly)
- **Risk Level:** 🟢 Low
- **Notes:** Security implementation is above average for a system of this size.

#### Finding 11: ~~30-Day Client Token Expiry~~ RESOLVED
- **Current State (updated 2026-03-11):** Token expiry reduced from 30 to 14 days. Updated in n8n workflows [01] Send Questionnaires and [06] Reminder Scheduler.
- **Compliance Status:** ✅ Compliant
- **Resolution:** n8n Code nodes updated in workflows `9rGj2qWyvGWVf9jXhv7cy` and `FjisCdmWc4ef0qSV`.
- **Risk Level:** 🟢 Resolved




#### Finding 12: Admin Single-Factor Authentication — DEFERRED
- **Current State:** Admin portal uses password-only authentication. No MFA.
- **Compliance Status:** ⚠️ Partial
- **Gap:** Admin has access to all client data for 600+ clients. Single-factor auth is a risk.
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Best practice for sensitive data
- **Recommended Action:** Implement MFA for admin access (e.g., TOTP via authenticator app). The existing `privacy-compliance.md` lists this as "Not planned — consider if office grows."
- **Implementation Complexity:** High
- **Decision:** ⏸️ Deferred. 2 admin users, low risk. Revisit when team grows.

#### Finding 13: Encryption Assessment
- **Current State:**
  - **In transit:** All API calls use HTTPS (n8n webhooks, Airtable API, MS Graph, Tally). GitHub Pages serves over HTTPS. ✅
  - **At rest — Airtable:** Airtable encrypts data at rest (AES-256). ✅
  - **At rest — OneDrive:** Microsoft encrypts data at rest. ✅
  - **At rest — n8n:** n8n Cloud encrypts data at rest. ✅
- **Compliance Status:** ✅ Compliant
- **Risk Level:** 🟢 Low

#### Finding 14: No Penetration Testing
- **Current State:** No penetration testing has been conducted.
- **Compliance Status:** ❌ Non-Compliant (if classified as "large sensitive database") / ⚠️ Partial (if not)
- **Gap:** Amendment 13 requires pen testing every 18 months for large sensitive databases. Even if the threshold is not met, it is recommended.
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Mandatory for qualifying databases; best practice otherwise
- **Recommended Action:** Engage a qualified security firm to conduct penetration testing. Focus on: webhook authentication bypass, token manipulation, admin panel access, IDOR on report_id/client_id parameters.
- **Implementation Complexity:** Medium — requires external engagement

#### Finding 15: Secrets Management
- **Current State:** Secrets stored in n8n Code nodes and environment variables. `.env` file at project root. Known issue: secrets in env variables blocked pending n8n plan upgrade.
- **Compliance Status:** ⚠️ Partial
- **Gap:** Secrets hardcoded in Code nodes are visible to anyone with n8n access.
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Security best practice
- **Recommended Action:** Migrate to n8n credentials store when plan allows. Document which secrets are stored where.
- **Implementation Complexity:** Medium — blocked by n8n plan

---

### 3.5 AI-Specific Compliance (Critical Section)

#### Finding 16: No DPIA for AI Classification System — DEFERRED
- **Current State:** No Data Protection Impact Assessment has been conducted for the AI document classification system (Workflow [05], Claude API).
- **Compliance Status:** ❌ Non-Compliant
- **Gap:** PPA AI guidelines explicitly state: "conducting a DPIA prior to using AI systems to process personal information is the best and recommended way to verify compliance." The classification system processes document images that may contain tax IDs, financial data, medical information.
- **Risk Level:** 🔴 Critical
- **Legal Requirement:** Mandatory (PPA AI guidelines)
- **Recommended Action:** Conduct a DPIA covering: (1) purpose and necessity of AI classification, (2) what personal data is sent to Anthropic, (3) risks to data subjects, (4) safeguards (human review, accuracy monitoring), (5) Anthropic's data handling policies, (6) alternatives considered.
- **Implementation Complexity:** Medium — documentation exercise
- **Decision:** ⏸️ Deferred. PPA *recommends* DPIAs but has not mandated them for systems of this size. Human-in-the-loop is already in place. Can be done later as a documentation exercise.

#### Finding 17: Human-in-the-Loop Exists (Positive Finding)
- **Current State:** The AI classification system includes a human review step:
  1. AI classifies document → stored in `pending_classifications` with `review_status: pending`
  2. Admin reviews via "סקירת AI" tab → can approve, reject, or reassign
  3. Only approved classifications update the `documents` table
- **Compliance Status:** ✅ Compliant
- **Gap:** None — this is the recommended approach
- **Risk Level:** 🟢 Low
- **Code Reference:** Admin panel AI review tab (`admin/index.html:78-81`), n8n workflow `c1d7zPAmHfHM71nV`

#### Finding 18: ~~Data Sent to Anthropic Not Documented~~ RESOLVED
- **Current State (updated 2026-03-12):** Documented in `docs/privacy-compliance.md` §4.5 "Anthropic (Claude) Data Categories". Covers: document types sent (PDFs/scans of tax forms, bank statements, receipts, NII letters, medical certificates), classification metadata returned (template_id, confidence, reason, issuer), 7-day API retention (ZDR available), no training on API data, human review before action.
- **Compliance Status:** ✅ Compliant
- **Resolution:** Added §4.5 to privacy-compliance.md (session 148, commit `8f1ff0c`).
- **Risk Level:** 🟢 Resolved

#### Finding 19: No Right-to-Explanation Mechanism for AI Decisions — RESOLVED
- **Current State (updated 2026-03-12):** DSR procedure (`docs/templates/dsr-procedure.md` §2.1) includes instruction to provide `ai_reason` field content from `pending_classifications` or `documents` tables when a client asks why a document was classified a certain way.
- **Compliance Status:** ✅ Compliant
- **Resolution:** Already included in the DSR procedure template.
- **Risk Level:** 🟢 Resolved

---

### 3.6 Cross-Border Data Transfers

#### Finding 20: DPAs with Key Processors — Partially Resolved ✅
- **Current State (updated 2026-03-11):**
  - ✅ **Airtable:** DPA executed via DocuSign on 2026-03-11. Includes EU SCCs. Saved at `docs/DPAS/Online_Customer_DPA_(Moshe_Atsits_CPA_and_Airtable).pdf`
  - ✅ **Anthropic:** DPA with SCCs auto-included in Commercial ToS (accepted on API signup). 7-day retention; ZDR addendum available on request.
  - ✅ **Tally:** DPA is in effect by default for all Tally users (included in Tally's Terms of Service)
  - ❌ **n8n:** DPA not yet executed
- **Compliance Status:** ⚠️ Partial (was ❌ Non-Compliant — improved)
- **Gap:** n8n DPA still pending. EU-based (lower risk than the US-based processors which are now covered).
- **Risk Level:** 🟢 Low (was 🟡 Medium — reduced: US processors now covered, Tally DPA in effect)
- **Legal Requirement:** Mandatory
- **Remaining Action:** (1) Execute n8n's DPA. (2) Document all DPAs in a register.
- **Implementation Complexity:** Low — administrative task

#### Finding 28: Tally Retains Questionnaire Data Including ISS
- **Current State:** Tally.so stores all form submission data (including ISS: marital status, disability, health info, family details) on EU servers (Belgium). Tally retains data for the duration of the contractual relationship. Deleted submissions are purged from backups within 90 days. Tally Business plan offers automatic submission deletion after a configurable period.
- **Compliance Status:** ⚠️ Partial
- **Gap:** After questionnaire responses are processed by n8n (workflow [02]) and stored in Airtable, the original Tally submissions remain indefinitely. This creates a secondary copy of ISS data on a third-party platform with no automated cleanup.
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Data minimization — don't retain data longer than necessary
- **Recommended Action:** (1) Evaluate Tally Business plan's auto-deletion feature to delete submissions after processing (e.g., 30 days after submission). (2) Alternatively, periodically export and manually delete processed submissions from Tally.
- **Implementation Complexity:** Low (manual deletion) / Medium (auto-deletion requires Tally plan upgrade)
- **Source:** [Tally GDPR documentation](https://tally.so/help/gdpr), [Tally DPA](https://tally.so/help/data-processing-agreement)

#### Finding 21: Microsoft 365 Tenant Location
- **Current State:** `privacy-compliance.md` lists Microsoft 365 as "EU/IL" but this depends on tenant configuration.
- **Compliance Status:** ⚠️ Partial
- **Gap:** Need to verify actual data residency of the M365 tenant.
- **Risk Level:** 🟢 Low — Microsoft provides comprehensive DPA and has Israeli data centers
- **Recommended Action:** Verify M365 tenant data residency in Azure portal. Document the finding.
- **Implementation Complexity:** Low

---

### 3.7 DPO Assessment

#### Finding 22: DPO Appointment May Be Required
- **Current State:** No DPO appointed. `privacy-compliance.md` lists "Appoint a DSO" as "Pending."
- **Compliance Status:** ❓ Unknown — requires legal assessment
- **Gap:** The PPA interprets the DPO obligation broadly. A CPA firm processing tax data (financial) plus health/disability data for 600+ clients could be considered to "primarily handle sensitive data."
- **Risk Level:** 🟡 Medium
- **Legal Requirement:** Mandatory if the firm meets the threshold (no fixed numerical threshold — assessed by totality of circumstances)
- **Recommended Action:** Consult with a privacy lawyer to determine if DPO appointment is required. If required, the DPO can be an existing staff member with defined responsibilities (proportionate to firm size).
- **Implementation Complexity:** Low-Medium

---

### 3.8 Database Registration

#### Finding 23: PPA Database Registration Status Unknown
- **Current State:** `privacy-compliance.md` lists registration as "Pending" and notes the threshold as ">10,000 records or sensitive data."
- **Compliance Status:** ❓ Unknown
- **Gap:** With ~600 clients, the 100K threshold for mandatory ISS notification is not met. However, the general registration requirement for databases containing sensitive personal data needs legal review.
- **Risk Level:** 🟢 Low
- **Legal Requirement:** Depends on legal assessment
- **Recommended Action:** Consult with privacy lawyer. The simplified registration requirements under Amendment 13 may reduce the burden.
- **Implementation Complexity:** Low

---

## 4. AI Processing Special Section

### 4.1 System Overview

The CPA firm uses Anthropic's Claude API to classify inbound tax documents received via email. This is implemented in n8n Workflow [05] ("Inbound Document Processing" — 43 nodes).

### 4.2 AI Data Flow

```
Client email → MS Graph poll → Download attachment
  → PDF conversion (if needed)
  → Image extraction
  → Claude API call (with document image + classification prompt)
  → AI returns: matched_template_id, confidence, reason, issuer_name
  → Results stored in Airtable (pending_classifications)
  → Human review by office staff
  → If approved: documents table updated
```

### 4.3 Compliance Assessment

| Requirement | Status | Details |
|------------|--------|---------|
| DPIA conducted | ❌ | No DPIA exists |
| Client disclosure of AI use | ✅ | Included in Tally privacy notice (2026-03-12) |
| Explicit consent for AI processing | ✅ | Combined consent checkbox on Tally forms (2026-03-12) |
| Human-in-the-loop | ✅ | Admin review before acting on AI decisions |
| Right to explanation | ✅ | `ai_reason` field available; DSR procedure includes instruction to provide on request |
| Accuracy monitoring | ⚠️ | Classification testing done (DL-143: 88% accuracy) but no ongoing monitoring system |
| Anthropic DPA executed | ✅ | Auto-included in Commercial ToS (accepted on API signup) |
| Data minimization | ⚠️ | Full document images sent — includes all content, not just relevant portions |
| AI bias monitoring | ❌ | No bias monitoring implemented |

### 4.4 Specific Risks

1. **Document images may contain highly sensitive data:** Tax IDs (teudat zehut), medical certificates, disability determinations, bank statements. All sent to Anthropic's US servers.
2. **Anthropic's API retention:** As of September 2025, API inputs are retained for **7 days** (reduced from 30). A **zero-day retention (ZDR) addendum** is available for organizations with stricter compliance requirements — worth requesting. This means sensitive Israeli data is stored on US servers for up to 7 days (or zero with ZDR).
3. **Classification errors:** DL-143 testing showed 88% accuracy (15/17 correct). Errors can result in wrong documents being requested from clients.

### 4.5 Recommended Actions (AI-Specific)

1. ~~**Immediate:** Add AI disclosure to Tally questionnaire and privacy policy~~ ✅ Done (2026-03-12)
2. **Short-term:** Conduct DPIA for AI classification system
3. ~~**Short-term:** Execute DPA with Anthropic~~ ✅ Auto-included in Commercial ToS
4. **Medium-term:** Implement ongoing accuracy monitoring dashboard
5. **Medium-term:** Evaluate whether document metadata alone could replace full image classification for some document types

---

## 5. Third-Party Processor Assessment

| Processor | Location | DPA Executed? | Adequate Jurisdiction? | Data Categories | Risk |
|-----------|----------|:---:|:---:|---------|------|
| Airtable | US | ✅ Executed 2026-03-11 | No (US) — covered by SCCs in DPA | All client data | 🟢 Low |
| Anthropic (Claude) | US | ✅ Auto-included in Commercial ToS | No (US) — covered by SCCs | Document images | 🟢 Low |
| Microsoft 365 | EU/IL | ✅ Likely | Yes (EU/IL) | Emails, documents | 🟢 Low |
| n8n Cloud | EU (Germany) | ❌ Unconfirmed | Yes (EU) | Processing metadata | 🟡 Medium |
| Tally | EU (Belgium) | ❌ Unconfirmed | Yes (EU) | Questionnaire data + ISS | 🟡 Medium |
| GitHub Pages | US | N/A (no PII stored) | N/A | Static files only | 🟢 Low |

**Priority:** ~~Execute DPAs with Airtable and Anthropic first (US-based, handling most sensitive data).~~ ✅ Done. Remaining: Tally and n8n (both EU-based, lower priority).

---

## 6. Priority Action Plan

### Final Decisions (agreed 2026-03-11)

After reviewing all 29 findings against proportionate risk for a small CPA firm with ~600 clients:
- **2 items to do** (within 30 days — Moshe action items)
- **10 items already done** (Phase 1 + Phase 2 + DPAs)
- **11 items deferred** (low risk for this firm size, or blocked by n8n plan)
- **6 items accepted risk / backlog**

---

### ✅ Already Done

| # | Action | Finding | Date |
|---|--------|---------|------|
| 1 | Self-hosted Google Fonts (eliminated IP leakage to Google) | F26 | 2026-03-11 |
| 2 | Reduced client token expiry from 30 to 14 days | F11 | 2026-03-11 |
| 3 | Airtable DPA executed (DocuSign) | F20 | 2026-03-11 |
| 4 | Anthropic DPA confirmed (auto-included in Commercial ToS) | F20 | 2026-03-11 |
| 5 | approve-confirm.html GET form reviewed — accepted risk | F27 | 2026-03-11 |
| 6 | Secrets redacted from this report | F24 | 2026-03-11 |
| 7 | Privacy notice added to both Tally forms (HE + EN) | F1, F2 | 2026-03-12 |
| 8 | Consent checkbox added to both Tally forms (required) | F4 | 2026-03-12 |
| 9 | Anthropic data categories documented in privacy-compliance.md §4.5 | F18 | 2026-03-12 |
| 10 | AI disclosure included in Tally privacy notice | F2 | 2026-03-12 |

---

### ~~🔴 Do Before Go-Live~~ — ✅ ALL DONE (2026-03-12)

All 4 items completed in session 148:
- ✅ Privacy notice + AI disclosure + consent checkbox on both Tally forms
- ✅ Anthropic data categories documented in `docs/privacy-compliance.md` §4.5
- ❌ ~~Email/portal AI disclosure~~ — Skipped (Tally consent at point of data collection is sufficient)
- ✅ ai_reason line already in DSR procedure §2.1 (F19)

---

### 🟡 Do Within 30 Days (Moshe action items)

| # | Action | Finding | Time | Owner |
|---|--------|---------|------|-------|
| 5 | **Moshe reads and approves DSR procedure** — `docs/templates/dsr-procedure.md` (already written in Hebrew) | F8 | 15 min | Office |

---

### ⏸️ Deferred (low risk for this firm size)

| Finding | Item | Why Deferred |
|---------|------|-------------|
| F3 | Separate privacy policy page | Covered by Tally privacy notice — not needed as separate page |
| F6 | Automated data retention cleanup | Manual yearly cleanup sufficient for ~600 clients |
| F7 | Deduplicate client_questions | Low risk, high refactor effort, serves functional purpose |
| F16 | DPIA for AI classification | PPA recommendation, not mandatory for this size. Human-in-the-loop in place. |
| F24 | Move secrets to n8n env vars | 2 users with n8n access, not publicly exposed. Blocked by n8n plan. |
| F25 | Per-user admin accounts | 2 users, low risk. Requires full auth rework. |
| F12 | Admin MFA | 2 users, low risk. Revisit when team grows. |
| F5 | PII in Tally redirect URLs | Mitigated by no-referrer policy. Medium effort to fix. |
| F14 | Penetration testing | Not mandatory for ~600 clients (below large-database threshold) |
| F22 | DPO appointment | Needs lawyer consultation — not urgent |
| F23 | PPA database registration | Needs lawyer consultation — likely below threshold |

---


## 7. Template Artifacts Needed

The following documents/policies need to be created to achieve compliance:

| Document | Language | Priority | Status |
|----------|----------|----------|--------|
| Tally Questionnaire Privacy Notice | Hebrew + English | Tier 2 | ✅ Implemented in both Tally forms (2026-03-12). Documented: `docs/templates/tally-privacy-notice.md` |
| AI Processing Disclosure | Hebrew + English | Tier 2 | ✅ Included in Tally privacy notice (2026-03-12). Separate email/portal disclosure skipped. |
| Data Subject Rights Request Procedure | Hebrew | Tier 3 | ✅ Draft: `docs/templates/dsr-procedure.md` |
| Google Fonts Self-Hosting Script | — | Tier 1 | ✅ Script: `docs/templates/self-host-fonts.sh` |
| Privacy Policy (client-facing) | Hebrew + English | Tier 3 | ❌ Needs legal review — use Tally notice as starting point |
| Consent Form (Amendment 13 compliant) | Hebrew + English | Tier 2 | ✅ Required checkbox on both Tally forms (2026-03-12) |
| Data Processing Agreements | English | Tier 3 | ⚠️ Airtable ✅, Anthropic ✅, Tally ❌, n8n ❌ |
| Data Breach Response Plan | Hebrew + English | Tier 4 | ⚠️ Partial (exists in privacy-compliance.md §7) |
| Data Retention Policy (formal) | Hebrew + English | Tier 4 | ⚠️ Partial (exists in privacy-compliance.md §5) |
| DPIA — AI Classification System | English | Tier 4 | ❌ Not created |
| DPA Register (executed agreements) | English | Tier 4 | ⚠️ Partial — `docs/DPAS/` folder created with Airtable DPA |

---

## 8. Positive Findings (What's Already Done Well)

The system shows **proactive privacy and security awareness** well above what is typical for a small firm. The existing `docs/privacy-compliance.md` was created before this audit and demonstrates forward-looking compliance planning.

1. **Defense-in-depth security architecture:** HMAC tokens, CSP on all pages, SRI for external scripts, CORS restrictions on n8n webhooks, POST-for-mutations pattern, URL parameter stripping via `history.replaceState()` on every page
2. **Comprehensive security logging:** `security_logs` table with automated hourly monitoring (`[MONITOR] Security Alerts`), automated log cleanup with defined retention (90d/365d), fire-and-forget logging pattern that never breaks main workflow execution
3. **Human-in-the-loop for AI decisions:** AI classification results go to `pending_classifications` → admin review → only approved results update documents. This is exactly what PPA AI guidelines recommend.
4. **Consistent XSS prevention:** `escapeHtml()`, `escapeAttr()`, `sanitizeDocHtml()` used throughout all frontend code — no raw HTML insertion from untrusted sources. 145+ design logs demonstrate sustained code quality discipline.
5. **Bilingual support** (Hebrew + English) throughout questionnaires, portal, and emails — covers Amendment 13 language requirements
6. **No tracking or analytics:** Zero third-party tracking scripts, no marketing pixels, no analytics cookies on any client-facing page — a privacy-positive design choice
7. **Data flow documentation** exists (`docs/architecture.md`, `docs/airtable-schema.md`) — provides the foundation this audit built on
8. **Proactive privacy compliance checklist** (`docs/privacy-compliance.md`) — created before this audit with retention periods, processor map, incident response plan, and audit schedule
9. **Referrer policy** (`no-referrer` on all pages) prevents URL leakage to external services
10. **Client-facing API** strips internal fields — only returns data necessary for the client view
11. **SEC-004 compliance:** PII (name, email) fetched from API using opaque tokens, not passed in URLs (except for the Tally redirect — see Finding 5)
12. **Security hardening track record:** 145+ design logs document systematic security improvements across sessions — this is not a system where security was an afterthought

---

## 9. Risk Summary Matrix

| Category | Compliant | Partial | Non-Compliant | Unknown | Findings |
|----------|:---------:|:-------:|:-------------:|:-------:|----------|
| Consent & Transparency | 3 | 1 | 1 | 0 | F1✅, F2✅, F3, F4✅, F5 |
| Data Minimization & Retention | 0 | 3 | 0 | 0 | F6, F7, F28 |
| Data Subject Rights | 0 | 1 | 1 | 0 | F8, F9 |
| Security | 4 | 4 | 3 | 0 | F10-F15, F24-F27 |
| AI Compliance | 2 | 2 | 0 | 0 | F16, F17✅, F18✅, F19 |
| Cross-Border Transfers | 0 | 2 | 0 | 0 | F20, F21 |
| DPO | 0 | 0 | 0 | 1 | F22 |
| Database Registration | 0 | 0 | 0 | 1 | F23 |
| **Total** | **9** | **12** | **6** | **2** | **29 findings** |

---

## 10. Disclaimer

This audit was conducted programmatically by analyzing codebase, configuration, and available documentation. It should be reviewed by a qualified Israeli privacy lawyer to confirm legal interpretations, especially regarding:
- DPO appointment obligation for a CPA firm of this size
- PPA database registration requirements
- Specific DPA requirements for US-based processors under Israeli law
- Whether the firm qualifies as a "large sensitive database" requiring mandatory pen testing

The audit identifies compliance gaps but does not constitute legal advice.

---

**Sources:**
- [IAPP: Israel marks a new era in privacy law](https://iapp.org/news/a/israel-marks-a-new-era-in-privacy-law-amendment-13-ushers-in-sweeping-reform)
- [Safetica: Amendment 13 explained](https://www.safetica.com/resources/guides/israel-s-amendment-13-what-the-new-data-protection-law-means-for-your-business)
- [BigID: What Amendment 13 Means for Businesses](https://bigid.com/blog/what-israel-amendment-13-means-for-businesses-in-2025/)
- [Baker McKenzie: DPOs and Notification Requirements](https://resourcehub.bakermckenzie.com/en/resources/global-data-and-cyber-handbook/emea/israel/topics/dpos-and-notification-requirements)
- [Bar Law: DPO Appointment Under Amendment 13](https://barlaw.co.il/practice_areas/high-tech/cyber/client_updates/a-practical-guide-to-board-responsibility-and-dpo-appointment-under-amendment-13/)
- [Gornitzky: PPA Guidelines on Privacy in AI Systems](https://www.gornitzky.com/privacy-in-artificial-intelligence-systems-guidelines-of-the-israeli-privacy-protection-authority/)
- [MineOS: Amendment 13 Explained](https://www.mineos.ai/articles/israels-amendment-13-a-new-era-for-privacy)
