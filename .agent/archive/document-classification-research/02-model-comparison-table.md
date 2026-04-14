# 02 - Model Comparison Table

## Comparison Matrix

### Tier 1: Multimodal LLMs (Recommended for this use case)

| Feature | Claude Sonnet 4.5 | Claude Opus 4.6 | GPT-4o | Gemini 2.0 Flash |
|---------|-------------------|-----------------|--------|------------------|
| **Hebrew text understanding** | Excellent | Excellent | Excellent | Very Good |
| **Visual layout understanding** | Excellent | Excellent | Excellent | Good |
| **Document type classification** | Excellent | Excellent | Excellent | Good |
| **Key field extraction** | Excellent | Excellent | Excellent | Good |
| **Structured JSON output** | Yes (native) | Yes (native) | Yes (native) | Yes |
| **Multi-page handling** | Up to 100 pages PDF | Up to 100 pages PDF | Via image tiles | Via image input |
| **OCR built-in** | Yes (reads images directly) | Yes | Yes | Yes |
| **Scanned document quality** | Very Good | Excellent | Very Good | Good |
| **Handwriting recognition** | Fair | Good | Fair | Fair |
| **Zero-shot (no training)** | Yes | Yes | Yes | Yes |
| **Custom schema support** | Yes (via system prompt) | Yes | Yes | Yes |
| **Speed (per document)** | 2-5 sec | 5-15 sec | 2-8 sec | 1-3 sec |
| **Cost per document** | ~$0.02-0.08 | ~$0.10-0.40 | ~$0.03-0.10 | ~$0.01-0.03 |
| **API availability** | Global | Global | Global | Global |
| **n8n integration** | HTTP Request or AI Agent node | HTTP Request or AI Agent node | HTTP Request or AI Agent node | HTTP Request |
| **Rate limits** | 4000 RPM (Tier 4) | 2000 RPM | 10000 RPM | 2000 RPM |

### Tier 2: Specialized Document AI Services

| Feature | Google Document AI | Azure Doc Intelligence | Amazon Textract |
|---------|-------------------|----------------------|-----------------|
| **Hebrew OCR quality** | Excellent | Very Good | Good |
| **Pre-built Israeli tax forms** | No | No | No |
| **Custom classifier training** | Yes (needs 10+ samples/class) | Yes (needs 5+ samples/class) | No |
| **Custom extractor training** | Yes (needs 50+ samples) | Yes (needs 5+ samples) | No |
| **Structured output** | Yes | Yes | Yes (tables/forms) |
| **Multi-page handling** | Yes (up to 2000 pages) | Yes (up to 2000 pages) | Yes |
| **Document splitting** | Yes (built-in) | Yes (built-in) | No |
| **Classification accuracy** | High (after training) | High (after training) | N/A |
| **Setup complexity** | High | High | Medium |
| **Training data requirement** | 10-50 samples per type | 5-50 samples per type | N/A |
| **Time to production** | 2-4 weeks | 2-4 weeks | 1 week (OCR only) |
| **Cost per document** | ~$0.01-0.065 | ~$0.01-0.05 | ~$0.01-0.02 |
| **n8n integration** | HTTP Request | HTTP Request | HTTP Request |

### Tier 3: Open-Source Models

| Feature | LayoutLMv3 | Donut | Tesseract + Custom ML |
|---------|-----------|-------|----------------------|
| **Hebrew support** | Requires fine-tuning | Requires fine-tuning | Hebrew traineddata available |
| **Pre-trained on tax forms** | No | No | No |
| **Training data requirement** | 100+ samples/class | 100+ samples/class | Varies |
| **GPU required** | Yes | Yes | No (CPU ok for OCR) |
| **Classification accuracy** | Good (after training) | Good (after training) | Depends on ML pipeline |
| **Self-hosted** | Yes | Yes | Yes |
| **Setup complexity** | Very High | Very High | High |
| **Time to production** | 4-8 weeks | 4-8 weeks | 3-6 weeks |
| **Cost per document** | ~$0.001-0.005 (compute) | ~$0.001-0.005 | ~$0.001 |
| **Maintenance burden** | High (model updates, GPU) | High | Medium |
| **n8n integration** | Custom API wrapper needed | Custom API wrapper needed | Code node |

---

## Detailed Evaluation by Criterion

### 1. Hebrew Language Support

| Approach | Score (1-5) | Notes |
|----------|------------|-------|
| Claude Vision | **5** | Native Hebrew understanding, reads right-to-left naturally, handles mixed Hebrew-English |
| GPT-4o | **5** | Equivalent Hebrew capability |
| Gemini 2.0 | **4** | Good Hebrew but occasionally misreads similar characters (ב/כ, ד/ר) |
| Google Document AI | **4** | Excellent OCR but custom models need Hebrew training data |
| Azure Doc Intelligence | **4** | Good OCR, custom models available |
| LayoutLMv3 | **2** | Requires Hebrew fine-tuning, limited pre-trained Hebrew support |
| Donut | **2** | Requires Hebrew fine-tuning |
| Tesseract | **3** | Hebrew pack available but accuracy drops on non-standard fonts |

### 2. Classification Accuracy (Estimated for Israeli Tax Documents)

| Approach | Easy docs (>90%) | Medium docs (75-90%) | Hard docs (<75%) |
|----------|-----------------|---------------------|-----------------|
| Claude Sonnet (with SSOT prompt) | ~98% | ~90% | ~75% |
| GPT-4o (with SSOT prompt) | ~97% | ~88% | ~72% |
| Google Doc AI (trained) | ~95% | ~85% | ~60% |
| Azure Doc Intel (trained) | ~95% | ~83% | ~58% |
| Open-source (trained) | ~90% | ~75% | ~45% |

### 3. Integration Complexity with n8n

| Approach | Effort | Method |
|----------|--------|--------|
| Claude Vision | **Low** (1-2 days) | HTTP Request to Anthropic API, or AI Agent node with vision |
| GPT-4o | **Low** (1-2 days) | HTTP Request to OpenAI API, or AI Agent node |
| Gemini | **Low** (1-2 days) | HTTP Request to Google AI API |
| Google Document AI | **Medium** (1-2 weeks) | HTTP Request + GCP auth setup + custom processor training |
| Azure Doc Intelligence | **Medium** (1-2 weeks) | HTTP Request + Azure auth + custom model training |
| Open-source | **High** (3-6 weeks) | Self-hosted API + Code node + GPU infrastructure |

### 4. Handling Sample Document Challenges

| Challenge | Claude/GPT-4o | Google Doc AI | Open-Source |
|-----------|--------------|---------------|-------------|
| Multi-page PDFs (doc11: 22 pages) | Good (native PDF) | Good | Requires page splitting |
| Scanned documents (doc04, doc12) | Good (direct image input) | Good (strong OCR) | Fair (needs OCR pipeline) |
| Non-tax rejection (doc14) | Excellent (understands context) | Poor (needs training) | Poor (needs training) |
| Multiple doc types in one PDF (doc16) | Good (can describe all types found) | Good (built-in splitter) | Poor |
| Foreign documents (doc10, doc11) | Excellent (multilingual) | Fair (English forms not pre-built for Israeli context) | Poor |
| Poor OCR quality (doc20 receipts) | Good (visual understanding bypasses OCR) | Fair (OCR struggles) | Poor |
| Word/Excel files (doc13, doc14) | Needs conversion | Needs conversion | Needs conversion |

---

## Winner Summary

| Criterion | Winner | Runner-up |
|-----------|--------|-----------|
| Hebrew support | Claude = GPT-4o | Google Document AI |
| Classification accuracy | Claude Vision | GPT-4o |
| Key field extraction | Claude Vision | GPT-4o |
| Cost per document | Gemini 2.0 Flash | Open-source (self-hosted) |
| Setup speed | Claude / GPT-4o (1-2 days) | Gemini (1-2 days) |
| Scanned document handling | Google Document AI | Claude Vision |
| Multi-page documents | Google Document AI | Claude Vision |
| n8n integration ease | Claude / GPT-4o | Gemini |
| Maintenance burden | Claude / GPT-4o (zero) | Google Doc AI (low) |
| **Overall recommendation** | **Claude Sonnet 4.5** | GPT-4o |

### Why Claude Sonnet 4.5 Wins

1. **Best Hebrew + layout understanding** without any training data
2. **Native PDF input** - send the PDF directly, no OCR pipeline needed
3. **Structured JSON output** - define the exact schema you want
4. **Cheapest adequate option** - $0.02-0.08/doc vs. $0.10-0.40 for Opus
5. **Fastest integration** - already using Anthropic in the tech stack
6. **Zero maintenance** - no model training, no GPU, no retraining when form layouts change
7. **Built-in rejection** - can be prompted to identify non-tax documents
8. **Handles document diversity** - works equally well on bank statements, government forms, insurance reports, and charity receipts without per-type training
