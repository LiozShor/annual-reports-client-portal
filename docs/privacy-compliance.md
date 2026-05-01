# Privacy Compliance Checklist

**System:** Annual Reports CRM — Moshe Atsits CPA Firm
**Regulation:** Israeli Privacy Protection Act (PPA), Amendment 13 (effective Aug 2025)
**Last Reviewed:** 2026-03-04

---

## 1. PPA Database Registration

| Item | Status | Notes |
|------|--------|-------|
| Register Airtable base as a "database" with the PPA | Pending | Required for databases with >10,000 records or sensitive data |
| Registration number | — | Obtain after registration |
| Annual renewal | — | Check renewal requirements |

**Action:** Consult with legal counsel on whether the client database (500+ clients, tax documents) requires formal PPA registration.

---

## 2. Data Security Officer (DSO)

| Item | Status | Notes |
|------|--------|-------|
| Appoint a DSO | Pending | Required for organizations processing sensitive personal data |
| DSO contact details documented | — | |
| DSO responsibilities defined | — | |

**Note:** For a small firm, the DSO can be an existing staff member with defined responsibilities.

---

## 3. Privacy Notices

### 3.1 Tally Questionnaire
| Item | Status | Notes |
|------|--------|-------|
| Privacy notice at form start | Pending | Inform clients what data is collected and why |
| Data retention period stated | Pending | 7 years for tax records (per Israeli tax law) |
| Purpose of collection stated | Pending | "Annual tax report preparation" |
| Third-party sharing disclosure | Pending | Mention Airtable, OneDrive, n8n as processors |
| Right to access/correct/delete | Pending | Per PPA Section 13 |
| Contact for privacy inquiries | Pending | Office email |

### 3.2 Client Portal
| Item | Status | Notes |
|------|--------|-------|
| Privacy policy link in footer | Pending | |
| Cookie/tracking disclosure | N/A | No cookies or tracking used |

---

## 4. Data Flow Documentation

### 4.1 Data Collection
```
Client → Tally Form (Hebrew/English)
  → Airtable (questionnaire responses table)
  → n8n workflows (document generation)
  → Airtable (documents table, annual_reports table)
```

### 4.2 Document Reception
```
Client → Email (attachments)
  → Microsoft Graph API
  → n8n workflows (AI classification)
  → OneDrive (file storage)
  → Airtable (document status tracking)
```

### 4.3 Data Processors

| Processor | Data Type | Location | Purpose |
|-----------|-----------|----------|---------|
| Airtable | Client PII, tax data | US (Airtable cloud) | Primary database |
| Microsoft 365 (OneDrive) | Documents, files | EU/IL (M365 tenant) | File storage |
| n8n Cloud | Processing metadata | EU (n8n cloud) | Workflow automation |
| Tally | Form responses | EU (Tally servers) | Questionnaire collection |
| GitHub Pages | Static HTML | US (GitHub) | Client portal (no PII stored) |
| Anthropic (Claude) | Document text (transient) | US | AI document classification |

### 4.4 Cross-Border Transfers
- Airtable (US): Covered under Standard Contractual Clauses
- GitHub Pages: No PII stored — static content only
- Anthropic: Transient processing only — no data retention

### 4.5 Anthropic (Claude) Data Categories

Documents submitted by clients (PDFs and scans of tax forms, bank statements, receipts, National Insurance letters, medical certificates) are sent to Anthropic's Claude API for automatic classification. The API returns classification metadata only: `template_id`, `confidence`, `reason`, and `issuer`. Anthropic retains API inputs for up to 7 days for trust and safety purposes; a Zero Data Retention (ZDR) option is available upon request. Anthropic does not train on data submitted through the API. All AI classification results are reviewed by office staff before any action is taken on client records.

---

## 5. Data Retention Policy

| Data Type | Retention Period | Basis | Deletion Method |
|-----------|-----------------|-------|-----------------|
| Tax documents & reports | 7 years from tax year | Israeli tax law (Ordinance §25) | Manual review + archive |
| Questionnaire responses | 7 years from submission | Same | Airtable record deletion |
| Client contact info | While client is active + 7 years | Legitimate interest | Airtable record deletion |
| Security logs | 90 days (WARNING/INFO), 365 days (CRITICAL) | Security monitoring | Automated (Log Cleanup workflow) |
| Email event logs | 1 year | Operational | Manual cleanup |
| AI classification data | 90 days after review | Operational | Manual cleanup |

---

## 6. Security Measures

### 6.1 Access Control
| Measure | Status | Phase |
|---------|--------|-------|
| Admin password authentication | Active | Phase 2 |
| HMAC client tokens (time-limited) | Active | Phase 3 |
| HMAC approval tokens | Active | Phase 3 |
| Content Security Policy (CSP) | Active | Phase 1 |
| Subresource Integrity (SRI) | Active | Phase 1 |
| CORS restrictions | Active | Phase 4 |
| POST for mutations | Active | Phase 5 |
| Field stripping (client API) | Active | Phase 5 |

### 6.2 Monitoring
| Measure | Status | Phase |
|---------|--------|-------|
| Security event logging | Active | Phase 7 |
| Automated alert monitoring | Active (needs activation) | Phase 7 |
| Log retention automation | Active (needs activation) | Phase 7 |

### 6.3 Future Considerations
| Measure | Status | Priority |
|---------|--------|----------|
| Individual admin accounts | Deferred (Phase 6) | Low — revisit if logs show suspicious activity |
| Report UID migration | Deferred (SEC-012) | Low — HMAC tokens neutralize enumeration |
| Two-factor authentication | Not planned | Consider if office grows |

---

## 7. Incident Response Plan

### 7.1 Detection
- Security logs monitored hourly ([MONITOR] Security Alerts workflow)
- Alert thresholds: 5+ auth failures from same IP, 10+ token failures, any CRITICAL event
- Alerts sent to: reports@moshe-atsits.co.il

### 7.2 Response Procedure
1. **Identify** — Review security_logs in Airtable for scope and severity
2. **Contain** — If active attack: deactivate affected n8n workflows, rotate secrets
3. **Assess** — Determine if client data was accessed/exposed
4. **Notify** — If personal data breach affecting >250 records:
   - Notify PPA within 72 hours (per Amendment 13)
   - Notify affected clients "without undue delay"
5. **Remediate** — Fix vulnerability, update security measures
6. **Document** — Create design log with full incident timeline

### 7.3 Secret Rotation Procedure
| Secret | Location | Rotation |
|--------|----------|----------|
| Admin password | n8n Code node | On compromise |
| Admin HMAC secret | n8n Code nodes (2 workflows) | On compromise |
| Client token secret | n8n Code nodes + .env | On compromise (invalidates all active client links) |
| Airtable API key | n8n credentials + .env | On compromise |
| Approval webhook secret | n8n Set node (Global Config) | On compromise |

---

## 8. Audit Schedule

| Audit Type | Frequency | Next Due | Owner |
|------------|-----------|----------|-------|
| Security log review | Monthly | 2026-04-04 | Office |
| Access control review | Quarterly | 2026-06-04 | Office |
| Data retention compliance | Annually | 2027-03-04 | Office |
| Privacy notice review | Annually | 2027-03-04 | Office |
| Full security audit | Annually | 2027-03-04 | External |

---

## 9. Regulatory References

- **Israeli Privacy Protection Act, 5741-1981** — Primary legislation
- **Amendment 13 (2025)** — Breach notification, DPO requirements, administrative fines
- **Privacy Protection Regulations (Data Security), 5777-2017** — Technical security requirements
- **Israeli Tax Ordinance, Section 25** — 7-year document retention requirement
- **GDPR** — Applicable for EU-resident clients (cross-border transfer rules)
