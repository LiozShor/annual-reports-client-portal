# Israel Protection of Privacy Law — Amendment No. 13: Key Requirements

**Effective Date:** August 14, 2025
**Research Date:** 2026-03-11
**Context:** Compliance audit for Moshe Atsits CPA Firm (600+ clients, tax document collection)

---

## 1. Expanded Definition of "Personal Information"

- **Now covers:** Any data related to an identified or **identifiable** person (expanded from just "identified")
- Explicitly includes: IP addresses, online identifiers, geolocation data, device fingerprints
- Financial data (income, tax details, banking) is clearly within scope
- The broader definition means virtually all data in the CPA system qualifies as personal information

**Relevance to CPA system:** All client data (names, emails, tax year info, document metadata, questionnaire answers) is unambiguously personal information.

---

## 2. Information of Special Sensitivity (ISS)

**Defined categories:**
- Health / medical information
- Family/intimate life
- Sexual orientation
- Ethnic/national origin
- Political views
- Religious beliefs
- Biometric data
- Genetic data
- Criminal record
- Financial data (newly explicit)

**Extra obligations when processing ISS for 100,000+ individuals:**
- Must notify PPA and submit a "database definitions document"
- Must appoint a DPO

**Relevance to CPA system:** The system processes:
- Family status (marital status, spouse details, children with disabilities)
- Health/disability data (NII disability benefits, maternity leave)
- Financial data (income, employment, investments, real estate)
- However, only ~600 clients — well below the 100K threshold

---

## 3. Transparency & Consent

**Notice obligations (must disclose before collection):**
1. What data is being collected
2. Purpose of collection
3. Who will receive the data (recipients/processors)
4. Data sources (if not collected directly from data subject)
5. Risks associated with the processing
6. Whether providing data is required by law or voluntary
7. Rights of the data subject

**Consent requirements:**
- Must be **explicit, documented, and granular**
- For sensitive data: consent must be **specific** to each category of sensitive data
- Only **informed consent** is valid — must be free, specific, informed, and unambiguous
- Consent records must be retained as proof

**Relevance:** The Tally questionnaire collects sensitive data (family status, disability, income) — consent must be captured before submission with full disclosure.

---

## 4. Data Minimization & Retention

- Collect only what is **necessary** for the stated purpose
- Do not retain data longer than needed
- Must have a documented retention policy
- Israeli Tax Ordinance Section 25 requires 7-year retention for tax documents — this provides legal basis for retention

**Relevance:** System logs, email event logs, AI classification data may be retained longer than necessary.

---

## 5. Data Subject Rights

Data subjects have the right to:
1. **Access** — see all data held about them
2. **Correction** — fix inaccurate data
3. **Deletion** — request erasure (subject to legal retention obligations)
4. **Objection** — especially for direct marketing
5. **Right to explanation** — for automated decisions (including AI)

**Response requirements:**
- Must respond in **Hebrew, English, or Arabic** (as requested by data subject)
- Response must be provided within a reasonable time
- Cannot charge excessive fees

---

## 6. Data Protection Officer (DPO)

**Mandatory appointment for:**
- Public bodies
- Data brokers
- Organizations conducting systematic monitoring
- Databases primarily handling sensitive data
- Entities processing ISS for 100,000+ individuals

**Assessment criteria (no fixed numerical threshold):**
- Number of data subjects
- Scope and types of information
- Sensitivity of information
- Duration and frequency of processing
- Duration of data retention
- Geographical scope

**Relevance to CPA firm:** Processing sensitive financial/medical data for 600+ clients. The PPA interprets the obligation broadly — a CPA firm processing tax data with medical/disability information may be considered to primarily handle sensitive data. Recommend legal consultation on whether DPO appointment is required.

---

## 7. Security Obligations

**Required measures:**
- Encryption at rest and in transit
- Access controls (principle of least privilege)
- Routine security audits
- Vulnerability assessments
- Risk assessments
- Documentation of security protocols
- Breach preparedness and incident response plan

**Penetration testing:**
- Required every **18 months** for large sensitive databases
- Specific fines for failure to conduct: up to **ILS 320,000** per violation

---

## 8. Data Breach Notification

**Severe Security Incident:**
- Must **immediately** notify the PPA
- PPA may order notification to affected data subjects "likely to be harmed"
- Specific threshold: breaches affecting 100,000+ individuals' highly sensitive data trigger mandatory notification

**Notification must include:**
- Nature of the breach
- Categories of data affected
- Approximate number of affected individuals
- Measures taken or proposed
- Contact point for further information

**Relevance:** Existing incident response plan (in privacy-compliance.md) references 72-hour notification for breaches affecting >250 records. Amendment 13's exact threshold is higher (100K) for mandatory notification, but PPA can order notification for any breach — the conservative approach in the existing plan is appropriate.

---

## 9. AI-Specific Requirements

**PPA's explicit position on AI:**
- **DPIA required** before deploying AI systems that process personal data
- Must provide **detailed disclosures** about AI processing to data subjects
- Must establish **internal rules** for generative AI tools
- Transparency: data subjects must be informed when AI makes decisions affecting them
- **Right to explanation:** data subjects can request explanation of AI-driven decisions
- **Human-in-the-loop:** recommended safeguard for consequential AI decisions
- Accountability for AI outputs — the deploying organization is responsible

**Relevance to CPA system:** Claude AI is used for document classification. This is a consequential decision (determines what documents are required from clients). Must:
1. Disclose AI use to clients
2. Conduct DPIA for the classification system
3. Ensure human review of AI decisions (already in place via admin review workflow)
4. Be able to explain classifications upon request

---

## 10. Cross-Border Data Transfers

**General rules:**
- Receiving country must offer adequate data protection
- Must establish data transfer agreements (similar to SCCs)
- For EEA-origin data: additional obligations under 2023 Mediation Regulations (to maintain EU adequacy status)

**Adequate jurisdictions:** Countries with EU adequacy decisions are generally acceptable. US-based services require additional safeguards.

**Relevance:** Data flows to:
- Airtable (US) — requires adequate safeguards/DPA
- Anthropic/Claude API (US) — requires adequate safeguards/DPA
- GitHub Pages (US) — static hosting, no PII stored
- Microsoft 365 (EU/IL tenant) — likely adequate
- n8n Cloud (EU) — likely adequate
- Tally (EU) — likely adequate

---

## 11. Database Registration

**Updated requirements:**
- Controllers must notify PPA of databases containing sensitive data on **100,000+ individuals**
- Must submit a "database definitions document"
- Some registration requirements simplified for smaller databases
- Registration number must be obtained and documented

**Relevance:** With ~600 clients, the 100K threshold is not met. However, the general registration obligation for databases containing sensitive personal data should be reviewed with legal counsel. The existing privacy-compliance.md notes this as pending.

---

## 12. Enforcement

**Administrative fines:**
- Up to **millions of NIS** for violations
- Up to **5% of annual turnover** (mirroring GDPR)
- Specific fines: e.g., ILS 320,000 for failure to conduct required security testing

**Civil liability:**
- **Statutory damages up to NIS 100,000** per person — without requiring proof of harm
- **7-year limitation period** for civil claims
- Class actions possible

**PPA enforcement powers:**
- Suspend databases
- Issue binding orders
- Publish violators' names for up to 4 years
- Early enforcement signals: PPA already imposed ₪70,000 fine on HOT

---

## 13. Penetration Testing

- Required every **18 months** for large sensitive databases
- Must be conducted by qualified professionals
- Results must be documented and remediated
- Failure to conduct: fine up to **ILS 320,000** per violation

**Relevance:** Whether the CPA firm's database qualifies as a "large sensitive database" requiring mandatory pen testing depends on the PPA's interpretation. Given the sensitivity of tax/medical data (even with only 600 clients), this is recommended as a best practice regardless of whether it's legally mandatory.

---

## Sources

- [IAPP: Israel marks a new era in privacy law](https://iapp.org/news/a/israel-marks-a-new-era-in-privacy-law-amendment-13-ushers-in-sweeping-reform)
- [Safetica: Amendment 13 explained](https://www.safetica.com/resources/guides/israel-s-amendment-13-what-the-new-data-protection-law-means-for-your-business)
- [BigID: What Amendment 13 Means for Businesses](https://bigid.com/blog/what-israel-amendment-13-means-for-businesses-in-2025/)
- [Baker McKenzie: Regulators, Enforcement and Penalties](https://resourcehub.bakermckenzie.com/en/resources/global-data-and-cyber-handbook/emea/israel/topics/regulators-enforcement-priorities-and-penalties)
- [Baker McKenzie: DPOs and Notification Requirements](https://resourcehub.bakermckenzie.com/en/resources/global-data-and-cyber-handbook/emea/israel/topics/dpos-and-notification-requirements)
- [Bar Law: DPO Appointment Under Amendment 13](https://barlaw.co.il/practice_areas/high-tech/cyber/client_updates/a-practical-guide-to-board-responsibility-and-dpo-appointment-under-amendment-13/)
- [Ius Laboris: Major amendment to privacy law in Israel](https://iuslaboris.com/insights/major-amendment-to-privacy-law-in-israel/)
- [Israel Tech Policy Institute: Overview of Amendment 13](https://techpolicy.org.il/wp-content/uploads/2024/10/Overview-of-Amendment-no-13-FINAL-FINAL-FOR-UPLOAD-FOR-WEBSITE-COLLATED-1.pdf)
- [Gornitzky: PPA Guidelines on Privacy in AI Systems](https://www.gornitzky.com/privacy-in-artificial-intelligence-systems-guidelines-of-the-israeli-privacy-protection-authority/)
- [MineOS: Amendment 13 Explained](https://www.mineos.ai/articles/israels-amendment-13-a-new-era-for-privacy)
