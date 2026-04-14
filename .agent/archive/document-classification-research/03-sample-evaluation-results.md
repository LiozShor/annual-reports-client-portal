# 03 - Sample Evaluation Results

## Blind Test: 20 Documents from `docs/Samples/`

Each document was examined without prior labels. For each: document type identified, key metadata extracted, confidence score assigned, and challenges noted.

---

### Summary Statistics

| Metric | Value |
|--------|-------|
| Total documents | 20 |
| Successfully classified | 18 |
| Unreadable (binary format) | 1 (doc13.docx) |
| Non-tax document | 1 (doc14.xlsx - inventory) |
| Unique document types found | 12 |
| Hebrew-only documents | 16 |
| English-only documents | 2 |
| Mixed/bilingual | 0 |
| Scanned (image-based) | 3 |
| Digital (text-extractable) | 15 |
| Multi-page (>2 pages) | 8 |
| Single-page | 10 |

---

### Document-by-Document Analysis

#### doc01.pdf - Form 106 (Employer Tax Certificate)
| Field | Value |
|-------|-------|
| **Document Type** | טופס 106 - אישור שנתי למעסיק |
| **SSOT Template** | T201 |
| **Tax Year** | 2024 |
| **Person** | לולו קורל |
| **ID Number** | 318599545 |
| **Employer** | עיריית תל אביב - יפו |
| **Pages** | 2 |
| **Format** | Digital PDF (text-extractable) |
| **Language** | Hebrew |
| **Confidence** | **98%** |
| **Challenges** | None - clean structured form with clear field labels. Standard Israeli tax authority layout. |

#### doc02.pdf - Form 867 (Interest Tax Certificate)
| Field | Value |
|-------|-------|
| **Document Type** | טופס 867 - אישור ניכוי מס במקור על ריבית |
| **SSOT Template** | T601 |
| **Tax Year** | 2024 |
| **Person** | עמר נסים נתנאל / שרח אושרית |
| **ID Numbers** | 203298815 / 203442223 |
| **Institution** | אוצר החייל / הבנק הבינלאומי |
| **Key Amounts** | Interest: 386.09, Tax deducted: 57.91 |
| **Pages** | 1 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **97%** |
| **Challenges** | Joint account (two holders) - need to handle spouse association. |

#### doc03.pdf - Form 867 (Interest + Capital Gains)
| Field | Value |
|-------|-------|
| **Document Type** | טופס 867 א+ב - ריבית + רווחי הון |
| **SSOT Template** | T601 |
| **Tax Year** | 2024 |
| **Person** | אברהם אביב אלבוכר |
| **ID Number** | 038459640 |
| **Institution** | מיטב טרייד |
| **Pages** | 2 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **90%** |
| **Challenges** | Some text encoding issues in OCR layer (garbled characters), but visual content is clear. Two parts (א+ב) in one document - need to identify both sub-types. |

#### doc04.pdf - Academic Degree Certificate
| Field | Value |
|-------|-------|
| **Document Type** | תואר אקדמי / Academic degree certificate |
| **SSOT Template** | T1501 (Other / degree) |
| **Person** | ניסים עמר |
| **ID Number** | 203298815 |
| **Institution** | מכון טכנולוגי חולון (HIT) |
| **Degree** | B.Sc. Electrical Engineering |
| **Date** | 05/07/2021 |
| **Pages** | 2 |
| **Format** | Scanned (CamScanner) |
| **Language** | Hebrew + English |
| **Confidence** | **65%** |
| **Challenges** | **High difficulty.** Scanned document with CamScanner watermark. Not a standard tax form - unusual document type for tax filing. Handwritten elements present. Would require context about WHY it was submitted (likely for academic tax credit). No standard form number to match on. |

#### doc05.pdf - Pension Withdrawal Certificate
| Field | Value |
|-------|-------|
| **Document Type** | אישור משיכת כספים מקופת גמל |
| **SSOT Template** | T401 (pension/provident withdrawal) |
| **Person** | בר אוהד איתן |
| **ID Number** | 43122407 |
| **Institution** | מגדל מקפת |
| **Date** | 28/11/2024 |
| **Amount** | Redemption: 15,581.76, Tax: 5,453.62 |
| **Pages** | 1 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **95%** |
| **Challenges** | Need to distinguish from annual pension report vs. withdrawal certificate. The word "פדיון" (redemption) is the key signal. |

#### doc06.pdf - Pension Withdrawal Certificate (2)
| Field | Value |
|-------|-------|
| **Document Type** | אישור משיכת כספים מקופת גמל |
| **SSOT Template** | T401 |
| **Person** | בר אוהד איתן |
| **ID Number** | 43122407 |
| **Institution** | מגדל מקפת |
| **Date** | 12/11/2024 |
| **Amount** | Redemption: 35,402.26, Tax: 12,390.79 |
| **Pages** | 1 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **96%** |
| **Challenges** | Same person/fund as doc05 - deduplication needed. Multiple withdrawals from same source in same year. |

#### doc07.pdf - Pension Withdrawal Certificate (3)
| Field | Value |
|-------|-------|
| **Document Type** | אישור משיכת כספים מקופת גמל (partial) |
| **SSOT Template** | T401 |
| **Person** | בר אוהד איתן |
| **ID Number** | 43122407 |
| **Institution** | מגדל מקפת |
| **Date** | 12/03/2024 |
| **Amount** | Partial withdrawal: 40,000 (includes compensation from א.ט. סיילסטק) |
| **Pages** | 1 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **94%** |
| **Challenges** | Partial withdrawal (משיכה חלקית) vs. full withdrawal - slightly different terminology. Includes compensation funds from employer (פיצויים). Third document from same person/fund. |

#### doc08.pdf - Residency Certificate
| Field | Value |
|-------|-------|
| **Document Type** | אישור תושבות (טופס 1312א) |
| **SSOT Template** | T001 |
| **Person** | שרח אשרית עמר |
| **ID Number** | 203442223 |
| **Issuer** | עיריית שדרות |
| **Tax Year** | 2024 |
| **Address** | בן יהודה 3 דירה 7 |
| **Pages** | 1 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **97%** |
| **Challenges** | None - clear form with standard tax authority layout (Form 1312א). |

#### doc09.pdf - Life Insurance Annual Report + Tax Certificate
| Field | Value |
|-------|-------|
| **Document Type** | דוח שנתי ביטוח חיים + אישור מס |
| **SSOT Template** | T501 (deposit certificate) or custom insurance type |
| **Person** | סופר אופיר |
| **ID Number** | 039128319 |
| **Institution** | איי.די.איי (IDI Insurance) |
| **Tax Year** | 2024 |
| **Key Amounts** | Two policies, premiums ~1,627 NIS |
| **Pages** | 3 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **75%** |
| **Challenges** | **Medium difficulty.** Insurance annual report doesn't directly match a single SSOT template. Contains both an annual summary AND tax certificates. Multiple policies in one document. Need to determine if this maps to deposit certificate (T501), insurance premium deduction, or a separate type. |

#### doc10.pdf - US State Tax Return (PA-40)
| Field | Value |
|-------|-------|
| **Document Type** | US State Tax Return (Pennsylvania PA-40 Amended) |
| **SSOT Template** | FRA01 (foreign tax return) |
| **Person** | SAHAR LULU |
| **SSN** | 970-96-3454 |
| **Tax Year** | 2024 |
| **Key Details** | Israeli resident (Petah Tikva), 4 US rental properties |
| **Pages** | 10 |
| **Format** | Digital PDF |
| **Language** | English |
| **Confidence** | **85%** |
| **Challenges** | Foreign (US) tax document. Completely different format from Israeli forms. Requires knowledge of US tax form types. Multi-page with schedules. Israeli resident address suggests foreign income scenario. |

#### doc11.pdf - US Federal Tax Return (1040-X/1040-NR)
| Field | Value |
|-------|-------|
| **Document Type** | US Federal Tax Return (Form 1040-X / 1040-NR Amended) |
| **SSOT Template** | FRA01 (foreign tax return) |
| **Person** | SAHAR LULU |
| **Tax Year** | 2024 |
| **Key Details** | Cover letter + 1040-NR + Schedule E (4 properties) + Form 8582 + depreciation |
| **AGI** | $270 |
| **Pages** | 22 |
| **Format** | Digital PDF |
| **Language** | English |
| **Confidence** | **80%** |
| **Challenges** | **High difficulty / stress test.** 22-page document with multiple IRS forms and schedules. Would need to classify the entire bundle as a single "foreign tax return" rather than trying to classify each page independently. First page is a cover letter, not the actual form. Page-splitting challenge. |

#### doc12.pdf - Rental Lease Agreement
| Field | Value |
|-------|-------|
| **Document Type** | הסכם שכירות בלתי מוגנת |
| **SSOT Template** | T901/T902 (rental agreement) |
| **Landlord ID** | 79263638 |
| **Tenants** | Judith & Guy Lewis |
| **Location** | Ramat Bet Shemesh |
| **Monthly Rent** | ~30,000 NIS |
| **Pages** | 9 |
| **Format** | Scanned (image-based) |
| **Language** | Hebrew |
| **Confidence** | **70%** |
| **Challenges** | **High difficulty.** 9-page scanned legal contract. Handwritten additions and signatures throughout. Dense legal text. No standard form number. OCR will struggle with handwritten sections. Multiple parties. Need to determine if this is landlord (rental income) or tenant perspective. |

#### doc13.docx - Unreadable (Word Document)
| Field | Value |
|-------|-------|
| **Document Type** | Unknown (binary .docx format) |
| **SSOT Template** | N/A |
| **Pages** | Unknown |
| **Format** | Microsoft Word (.docx) |
| **Confidence** | **0%** (could not read) |
| **Challenges** | **Critical challenge.** Word documents cannot be directly read by PDF-based classification pipelines. Would need format conversion (docx → PDF/image) before classification. This is a real-world scenario - clients email Word documents alongside PDFs. |

#### doc14.xlsx - Business Inventory (Non-Tax Document)
| Field | Value |
|-------|-------|
| **Document Type** | Business inventory / order list (NOT a tax document) |
| **SSOT Template** | None - not a recognized tax document type |
| **Contents** | Nail polish inventory (לק ג'ל, לק רגיל) with SKUs, quantities, unit prices |
| **Key Data** | Product codes (A15, A16, etc.), prices (52 NIS gel, 17 NIS regular), drying machines (640 NIS) |
| **Format** | Microsoft Excel (.xlsx) |
| **Confidence** | **95%** (confident it's NOT a tax document) |
| **Challenges** | **Important test case.** The system must be able to reject non-tax documents. This is a beauty supply inventory spreadsheet - clearly not relevant to tax filing. Clients may accidentally send business documents alongside tax documents. The classifier needs a "not a tax document" / "unknown" category. |

#### doc15.pdf - Pension Annual Report (Altshuler Shaham)
| Field | Value |
|-------|-------|
| **Document Type** | דוח שנתי לעמית בקרן פנסיה מקיפה |
| **SSOT Template** | T501 (deposit certificate / דוח שנתי מקוצר) |
| **Person** | סהר לולו |
| **ID Number** | 315960377 |
| **Institution** | אלטשולר שחם פנסיה מקיפה |
| **Tax Year** | 2024 |
| **Key Amounts** | Total deposits: 11,900, Balance: 117,623 |
| **Pages** | 3 (includes tax certificates) |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **93%** |
| **Challenges** | Combined document: annual report + tax certificate pages. Need to classify the bundle as a whole. |

#### doc16.pdf - Multi-Account Annual Report Package
| Field | Value |
|-------|-------|
| **Document Type** | דוח שנתי מרובה חשבונות (גמל + השתלמות + גמל להשקעה) + אישורי מס |
| **SSOT Template** | T501 (deposit certificates, multiple) |
| **Person** | מיכל עזוז |
| **ID Number** | 04315775/9 |
| **Institution** | אלטשולר שחם |
| **Tax Year** | 2024 |
| **Accounts** | 10 gemel accounts + 1 hishtalmut + 1 investment gemel |
| **Total Deposits (gemel)** | 176,063 NIS cumulative |
| **Total Deposits (hishtalmut)** | 37,400 NIS cumulative, 13,000 NIS in 2024 |
| **Total Deposits (investment)** | 76,750 NIS cumulative, 71,800 NIS in 2024 |
| **Employers** | עיריית רעננה, אלטשולר שחם סוכנות, אלטשולר שחם גמל ופנסיה, עגור, עיריית כפר סבא |
| **Pages** | 15 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **85%** |
| **Challenges** | **Major stress test.** 15 pages containing 12 separate annual reports + 3 tax certificates, all for the same person but different account types and employers. A classifier must either: (a) treat the entire PDF as one "deposit package" or (b) split by page and classify each sub-report. Multiple employers mean multiple T501 instances. The tax certificates at the end (pages 14-16) are different document types from the annual reports (pages 1-13). |

#### doc17.pdf - Training Fund Annual Report + Tax Certificate
| Field | Value |
|-------|-------|
| **Document Type** | דוח שנתי לקרן השתלמות + אישור מס |
| **SSOT Template** | T501 (deposit certificate) |
| **Person** | סהר לולו |
| **ID Number** | 31596037/7 |
| **Institution** | אלטשולר שחם השתלמות |
| **Tax Year** | 2024 |
| **Key Amounts** | Balance: 49,373, Deposits in 2024: 20,520 |
| **Pages** | 2 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **95%** |
| **Challenges** | Annual report + tax certificate combined in 2 pages. Self-employed (עמית עצמאי). |

#### doc18.pdf - Training Fund Tax Certificate (More)
| Field | Value |
|-------|-------|
| **Document Type** | אישור מס עבור קרן השתלמות |
| **SSOT Template** | T501 (deposit certificate) |
| **Person** | אביב עזוז |
| **ID Number** | 033736711 |
| **Institution** | מור השתלמות (More Gemel) |
| **Tax Year** | 2024 |
| **Key Amounts** | Cumulative: 25,352, Year 2024: 19,351 |
| **Pages** | 1 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **96%** |
| **Challenges** | None - clean single-page tax certificate. Different fund company (More vs. Altshuler Shaham) but same document type. |

#### doc19.pdf - National Insurance Maternity Benefits Certificate
| Field | Value |
|-------|-------|
| **Document Type** | אישור שנתי למס הכנסה - תקבולי אמהות (ביטוח לאומי) |
| **SSOT Template** | T1201 (NII benefits - דמי לידה) |
| **Person** | קורל לולו |
| **ID Number** | 31859954-5 |
| **Issuer** | המוסד לביטוח לאומי |
| **Tax Year** | 2024 |
| **Key Amounts** | Gross: 41,927 NIS, Tax deducted: 372 NIS |
| **Pages** | 1 |
| **Format** | Digital PDF |
| **Language** | Hebrew |
| **Confidence** | **98%** |
| **Challenges** | None - clean NII certificate with clear header and standard layout. The maternity benefit type (דמי לידה / תקבולי אמהות) needs to be distinguished from disability (נכות) or other NII benefit types. |

#### doc20.pdf - Donation Receipts Collection
| Field | Value |
|-------|-------|
| **Document Type** | קבלות על תרומות (סעיף 46) |
| **SSOT Template** | T1301 (donation receipts) |
| **Person** | אדריאנו חאובל (Adriano Jauvel) |
| **ID Number** | 021605654 |
| **Organizations** | מריט ספרד פאונדיישן, חוות קרן-אור, לחיות בכבוד, רוח נכונה, הזנק לעתיד, חלאסרטן |
| **Total Donations** | ~1,059 NIS across 9 receipts |
| **Tax Year** | 2024 (and one from 12/2023) |
| **Pages** | 9 |
| **Format** | Mixed - some digital, some scanned |
| **Language** | Hebrew (some with poor OCR) |
| **Confidence** | **75%** |
| **Challenges** | **High difficulty.** 9 pages, each a separate receipt from a different organization with completely different layouts and templates. Some pages have extremely poor OCR quality (garbled text). Each organization uses its own receipt format. Need section 46 (סעיף 46) detection as the common thread. One donation is from December 2023 (edge case for tax year assignment). |

---

### Classification Difficulty Distribution

| Difficulty | Count | Documents |
|-----------|-------|-----------|
| Easy (>90% confidence) | 10 | doc01, doc02, doc05, doc06, doc07, doc08, doc17, doc18, doc19, doc14 (reject) |
| Medium (75-90%) | 5 | doc03, doc10, doc15, doc16, doc09 |
| Hard (<75%) | 3 | doc04, doc12, doc20 |
| Impossible (format) | 1 | doc13 |
| Not applicable | 1 | doc14 (non-tax) |

### Key Findings for System Design

1. **Multi-document PDFs are common**: doc16 (15 pages, 12 sub-reports), doc20 (9 receipts), doc11 (22 pages of US forms). The system MUST handle page-level classification or bundle detection.

2. **Same-type deduplication needed**: doc05/06/07 are three separate withdrawal certificates from the same person and fund. The system needs to track "already received" vs. "new document" per client.

3. **Non-PDF formats exist**: doc13.docx and doc14.xlsx. At minimum 10% of submissions may be Word/Excel. Conversion pipeline needed.

4. **Rejection capability critical**: doc14 is clearly not a tax document. The system must have a "not a tax document" / "unknown" output class.

5. **Foreign documents**: doc10/doc11 are US tax returns in English. The system needs bilingual support and knowledge of foreign tax form types.

6. **Scanned vs. digital**: 3 of 20 documents are scanned (15%). Scanned documents have significantly lower OCR quality, especially with handwritten additions (doc12).

7. **Institution diversity**: Documents come from banks (אוצר החייל), brokerages (מיטב טרייד), insurance companies (IDI, מגדל), pension funds (אלטשולר שחם), municipalities (עיריית שדרות), government (ביטוח לאומי), and charities (multiple). Each has its own format.

8. **Variable page counts**: Range from 1 page (doc08, doc18, doc19) to 22 pages (doc11). Average is ~4.5 pages.
