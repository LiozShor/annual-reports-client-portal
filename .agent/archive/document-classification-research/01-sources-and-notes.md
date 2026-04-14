# 01 - Sources and Notes

## Research Methodology

1. Evaluated 20 real sample documents from `docs/Samples/` as a blind classification test
2. Reviewed capabilities and pricing of major document AI platforms
3. Assessed Hebrew language support across all solutions
4. Compared multimodal LLMs vs. specialized document AI vs. open-source options
5. Considered integration complexity with n8n automation platform

## Primary Sources

### Multimodal LLM Providers

| Source | URL | Notes |
|--------|-----|-------|
| Anthropic Claude Vision | https://docs.anthropic.com/en/docs/build-with-claude/vision | Claude Sonnet 4.5 / Opus 4.6 - native PDF & image understanding |
| OpenAI GPT-4o | https://platform.openai.com/docs/guides/vision | GPT-4o multimodal - image+text understanding |
| Google Gemini 2.0 | https://ai.google.dev/gemini-api/docs/vision | Gemini 2.0 Flash/Pro - multimodal with document support |

### Specialized Document AI Services

| Source | URL | Notes |
|--------|-----|-------|
| Google Document AI | https://cloud.google.com/document-ai/docs | Pre-trained and custom processors, OCR + extraction |
| Azure AI Document Intelligence | https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/ | Formerly Form Recognizer. Pre-built + custom models |
| Amazon Textract | https://docs.aws.amazon.com/textract/ | OCR + forms + tables extraction |
| ABBYY Vantage | https://www.abbyy.com/vantage/ | Enterprise IDP platform |

### Open-Source Models and Tools

| Source | URL | Notes |
|--------|-----|-------|
| LayoutLMv3 (Microsoft) | https://huggingface.co/microsoft/layoutlmv3-base | Document understanding model combining text+layout+image |
| Donut (Naver) | https://huggingface.co/naver-clova-ix/donut-base | OCR-free document understanding transformer |
| PaddleOCR | https://github.com/PaddlePaddle/PaddleOCR | Open-source OCR with multi-language support |
| Tesseract OCR | https://github.com/tesseract-ocr/tesseract | Google's open-source OCR engine, Hebrew support available |
| Surya OCR | https://github.com/VikParuchuri/surya | Modern OCR with good multilingual support |
| DocTR | https://github.com/mindee/doctr | Document text recognition library |

### Hebrew-Specific Resources

| Source | Notes |
|--------|-------|
| Tesseract Hebrew trained data | `heb.traineddata` - available but accuracy varies significantly on non-standard fonts |
| Google Cloud Vision API | Generally good Hebrew OCR, but character-level only (no document understanding) |
| Azure Computer Vision (Read API) | Good Hebrew OCR, can be combined with Document Intelligence |

### Integration References

| Source | URL | Notes |
|--------|-----|-------|
| n8n HTTP Request node | https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httpRequest/ | For calling external APIs |
| n8n AI Agent node | https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/ | For LLM-based classification |
| n8n Code node | https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/ | For custom processing logic |

## Key Research Notes

### Note 1: Hebrew OCR Quality
Hebrew OCR quality varies dramatically across tools:
- **Google Cloud Vision / Azure Read**: Best quality for Hebrew printed text (~95%+ accuracy)
- **Tesseract (Hebrew)**: Adequate for clean documents (~85-90%), poor for scanned (~60-70%)
- **PaddleOCR**: Supports Hebrew but accuracy is lower than commercial solutions
- Scanned documents with handwriting are problematic across ALL tools

### Note 2: Document AI Hebrew Support
- **Google Document AI**: Custom processors can be trained on Hebrew documents, but pre-built processors (invoices, receipts) are optimized for English/European languages. Israeli tax forms are NOT in the pre-built processor catalog.
- **Azure Document Intelligence**: Pre-built models support Hebrew text extraction, but custom models need training data. No Israeli tax form pre-built models exist.
- Both require significant training data investment for custom Hebrew form types.

### Note 3: Multimodal LLM Advantage for This Use Case
Multimodal LLMs (Claude Vision, GPT-4o) have a unique advantage:
- They understand document LAYOUT visually (not just OCR text)
- They read Hebrew natively without separate OCR step
- They can be given a classification schema (SSOT templates) as context
- They return structured JSON output
- Zero training data required - just a well-crafted prompt
- They handle the DIVERSITY of document formats (each bank/institution has its own layout)

### Note 4: Scanned Document Handling
For the ~15% of documents that are scanned images:
- Direct multimodal LLM input works well for clean scans
- For degraded scans (CamScanner, fax quality), a preprocessing step helps:
  1. Image enhancement (deskew, contrast, denoise)
  2. OCR extraction as supplementary text
  3. Send both image + OCR text to the LLM

### Note 5: Multi-Page Document Challenge
Several sample documents contain 10-22 pages. Approaches:
- **Page-by-page**: Classify each page independently, then merge. Good for mixed bundles.
- **First-page-only**: Many documents can be classified from page 1 alone. Cheaper but misses multi-type PDFs.
- **Sampling**: Send pages 1, 2, and last page. Good balance of cost vs. accuracy.
- **Recommended**: First page + last page for initial classification, full document for extraction.

### Note 6: Format Conversion
The sample set included .docx and .xlsx files:
- Pre-processing must convert these to PDF/images before classification
- LibreOffice headless (`soffice --convert-to pdf`) handles this well
- n8n can do this via a Code node with child_process or via a separate conversion service
