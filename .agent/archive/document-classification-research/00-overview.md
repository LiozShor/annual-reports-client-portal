# 00 - Document Classification Research: Overview

## Purpose

Research and evaluate approaches for automatic document identification and classification in the Annual Reports CRM system. The firm handles 500+ clients who submit tax documents annually (~4,000 documents/year). Currently, staff manually identifies and files each document. This research evaluates AI/ML solutions to automate that process.

## Scope

### What the system must do:
1. **Classify** - Determine document type (Form 106, Form 867, pension report, donation receipt, etc.)
2. **Extract** - Pull key metadata (person name, ID number, institution, tax year, amounts)
3. **Match** - Map the classified document to the client's required document list in Airtable
4. **Reject** - Identify non-tax documents or irrelevant attachments

### Constraints:
- **Bilingual**: Hebrew (primary, ~85%) and English (~15%) documents
- **Volume**: ~4,000 documents/year across ~600 clients (~6-7 docs per client)
- **Format mix**: PDF (90%), scanned images (10-15%), occasional DOCX/XLSX
- **Integration**: Must work within n8n automation + Airtable pipeline
- **Budget**: Cost-effective for a small CPA firm (not enterprise pricing)
- **Accuracy target**: >90% correct classification, with human review fallback

### Document types to classify (from SSOT templates):
- T001: Residency certificate (אישור תושבות)
- T101: ID appendix (ספח ת"ז)
- T201: Form 106 - Employer tax certificate
- T301: Form 106 - Spouse employer certificate
- T401: Pension/provident withdrawal certificate
- T501: Deposit certificate / Annual savings report
- T601: Form 867 - Interest/capital gains certificate
- T701: Rental income documents
- T801-T802: Mortgage certificates
- T901-T902: Rental agreements
- T1001-T1002: Sale documents
- T1101: Self-employment income documents
- T1201: National Insurance (NII) benefits
- T1301: Donation receipts (section 46)
- T1401: Foreign income documents
- T1501+: Other (academic degrees, medical certificates, etc.)
- **REJECT**: Non-tax documents (inventory lists, personal files, etc.)

## Research Deliverables

| File | Contents |
|------|----------|
| `00-overview.md` | This file - project scope and summary |
| `01-sources-and-notes.md` | Research sources, links, and methodology notes |
| `02-model-comparison-table.md` | Detailed comparison of models and services |
| `03-sample-evaluation-results.md` | Blind test results on 20 sample documents |
| `04-recommended-architecture.md` | Recommended system architecture and pipeline |
| `05-cost-estimates.md` | Cost analysis at scale for each approach |

## Key Conclusions (Executive Summary)

1. **Recommended approach**: Claude Vision (claude-sonnet-4-5-20250929) as primary classifier with structured output, integrated into the existing n8n pipeline via HTTP Request node.

2. **Why not specialized services**: Google Document AI and Azure Document Intelligence excel at OCR and form extraction for known form types, but they require per-form-type training and don't handle the diversity of Israeli tax documents well out of the box. The cost of training custom processors for 15+ document types exceeds the cost of using multimodal LLMs.

3. **Architecture**: Two-stage pipeline — (1) OCR/preprocessing for scanned documents, (2) Multimodal LLM classification + extraction with structured JSON output. Fallback to human review for low-confidence results.

4. **Cost**: ~$0.15-0.30 per document with Claude Sonnet, totaling ~$600-1,200/year for 4,000 documents. Well within budget for a CPA firm.

5. **Hebrew is the differentiator**: Most specialized document AI services have weak Hebrew support. Multimodal LLMs (Claude, GPT-4o) handle Hebrew natively and are the clear winner for this use case.
