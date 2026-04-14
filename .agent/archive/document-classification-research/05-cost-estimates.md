# 05 - Cost Estimates

## Assumptions

| Parameter | Value | Notes |
|-----------|-------|-------|
| Clients per year | 600 | Active clients requiring annual reports |
| Avg documents per client | 6-7 | Based on questionnaire complexity |
| Total documents per year | ~4,000 | 600 x 6.7 average |
| Avg pages per document | 3-4 | Based on sample evaluation (range 1-22) |
| Total pages per year | ~14,000 | 4,000 x 3.5 average |
| Scanned documents | ~15% | ~600 documents need OCR preprocessing |
| Non-PDF files | ~5% | ~200 DOCX/XLSX/image files |
| Documents needing human review | ~25% | Based on confidence thresholds |
| Processing period | 4 months | Jan-Apr peak tax season |

---

## Option A: Claude Sonnet 4.5 (Recommended)

### Per-Document Cost Breakdown

| Component | Calculation | Cost |
|-----------|------------|------|
| Input tokens (PDF pages as images) | ~1,600 tokens/page x 3.5 avg pages = 5,600 tokens | $0.0168 |
| Input tokens (system prompt + schema) | ~2,000 tokens | $0.006 |
| Output tokens (JSON response) | ~500 tokens | $0.005 |
| **Total per document** | | **~$0.028** |

*Pricing: Sonnet 4.5 — $3/M input, $15/M output (standard). With prompt caching on system prompt: even lower.*

### Annual Cost

| Item | Calculation | Annual Cost |
|------|------------|-------------|
| Classification API calls | 4,000 docs x $0.028 | **$112** |
| Prompt caching savings | ~40% reduction on system prompt (repeated) | -$16 |
| Re-classification (reviews) | 400 docs x $0.028 | $11 |
| Format conversion (5% non-PDF) | 200 files, free (LibreOffice) | $0 |
| **Total API cost** | | **~$107** |
| n8n cloud (already paying) | Existing subscription | $0 incremental |
| Development time (one-time) | ~40 hours setup + testing | ~$0 (self-built) |
| **Annual recurring cost** | | **~$107/year** |

### With Prompt Caching (Recommended)

The SSOT classification schema (~2,000 tokens) is identical for every call. Using Anthropic's prompt caching:
- Cache write: $3.75/M tokens (first call)
- Cache read: $0.30/M tokens (subsequent calls within 5-min window)
- Savings: ~90% on system prompt tokens during batch processing

**Batched processing cost**: If processing 50+ docs in a session, effective cost drops to **~$0.02/doc** = **~$80/year**.

---

## Option B: GPT-4o

### Per-Document Cost

| Component | Calculation | Cost |
|-----------|------------|------|
| Input tokens (images + text) | ~5,600 image tokens + 2,000 text | $0.019 |
| Output tokens | ~500 tokens | $0.005 |
| **Total per document** | | **~$0.024** |

*Pricing: GPT-4o — $2.50/M input, $10/M output*

### Annual Cost

| Item | Annual Cost |
|------|------------|
| Classification API calls (4,000 docs) | **$96** |
| Re-classification (reviews) | $10 |
| **Total** | **~$106/year** |

**Pros**: Slightly cheaper per call.
**Cons**: No native PDF input (need to convert to images), slightly lower Hebrew accuracy in testing.

---

## Option C: Gemini 2.0 Flash

### Per-Document Cost

| Component | Calculation | Cost |
|-----------|------------|------|
| Input tokens | ~7,600 tokens | $0.0008 |
| Output tokens | ~500 tokens | $0.0002 |
| **Total per document** | | **~$0.001** |

*Pricing: Gemini 2.0 Flash — $0.10/M input, $0.40/M output*

### Annual Cost

| Item | Annual Cost |
|------|------------|
| Classification API calls (4,000 docs) | **$4** |
| Re-classification | $1 |
| **Total** | **~$5/year** |

**Pros**: Extremely cheap. Almost free.
**Cons**: Lower accuracy on Hebrew documents, less reliable structured output, may need more human review (increasing hidden labor cost). Good as a pre-filter but not reliable enough as sole classifier.

---

## Option D: Google Document AI (Custom Processors)

### Setup Cost (One-Time)

| Item | Cost |
|------|------|
| Custom classifier training | Free (included in per-page pricing) |
| Training data preparation (15 types x 20 samples) | ~10 hours labor |
| Custom extractor training (per type) | Free (included) |
| Testing and validation | ~5 hours labor |
| **Total setup** | **~15 hours labor** |

### Per-Document Cost

| Component | Calculation | Cost |
|-----------|------------|------|
| Document OCR | $1.50 per 1,000 pages | $0.005 |
| Custom classifier | $0.10 per page | $0.35 |
| Custom extractor | $0.065 per page (x3.5 pages) | $0.23 |
| **Total per document** | | **~$0.58** |

### Annual Cost

| Item | Annual Cost |
|------|------------|
| Processing (4,000 docs) | **$2,320** |
| Retraining (quarterly) | ~4 hours labor |
| **Total** | **~$2,320/year** |

**Verdict**: 20x more expensive than Claude, requires training data, needs retraining when form layouts change. NOT recommended.

---

## Option E: Azure Document Intelligence

### Setup Cost (One-Time)

| Item | Cost |
|------|------|
| Custom model training | Free (5 free custom models) |
| Training data preparation | ~10 hours labor |
| **Total setup** | **~10 hours labor** |

### Per-Document Cost

| Component | Calculation | Cost |
|-----------|------------|------|
| Custom classification | $10 per 1,000 pages | $0.035 |
| Custom extraction | $10 per 1,000 pages | $0.035 |
| **Total per document** | | **~$0.07** |

### Annual Cost

| Item | Annual Cost |
|------|------------|
| Processing (4,000 docs x 3.5 pages) | **$280** |
| **Total** | **~$280/year** |

**Verdict**: Reasonable cost, but requires training data investment and ongoing maintenance. More expensive than Claude for lower flexibility.

---

## Option F: Open-Source (Self-Hosted)

### Infrastructure Cost

| Item | Monthly Cost | Annual Cost |
|------|-------------|-------------|
| GPU server (1x T4/A10, cloud) | $150-300/mo | $1,800-3,600 |
| Storage (models + data) | $20/mo | $240 |
| **Total infrastructure** | | **$2,040-3,840** |

### Setup Cost (One-Time)

| Item | Effort |
|------|--------|
| Model fine-tuning (LayoutLMv3/Donut) | 40-80 hours |
| Training data collection + labeling | 20-30 hours |
| API wrapper development | 10-20 hours |
| n8n integration | 5-10 hours |
| **Total setup** | **75-140 hours** |

### Per-Document Cost (Compute Only)

| Item | Cost |
|------|------|
| Inference (GPU time) | ~$0.002/doc |
| **Annual compute** | ~$8/year |

### Total Annual Cost

| Item | Annual Cost |
|------|------------|
| Infrastructure | $2,040-3,840 |
| Maintenance (model updates, bug fixes) | ~40 hours/year |
| **Total** | **$2,040-3,840/year + labor** |

**Verdict**: Overkill for this volume. Only makes sense at 100,000+ documents/year. NOT recommended.

---

## Cost Comparison Summary

| Approach | Annual Cost | Setup Time | Accuracy | Maintenance |
|----------|-----------|-----------|----------|-------------|
| **Claude Sonnet 4.5** | **~$107** | **1-2 weeks** | **High** | **None** |
| GPT-4o | ~$106 | 1-2 weeks | High | None |
| Gemini 2.0 Flash | ~$5 | 1-2 weeks | Medium | None |
| Google Document AI | ~$2,320 | 3-4 weeks | High (trained) | Quarterly retraining |
| Azure Doc Intelligence | ~$280 | 2-3 weeks | High (trained) | Quarterly retraining |
| Open-Source (self-hosted) | ~$2,500+ | 6-10 weeks | Medium (trained) | Ongoing |

### Recommendation

**Primary**: Claude Sonnet 4.5 at **~$107/year** — best accuracy-to-cost ratio, zero maintenance, fastest to production.

**Budget option**: Gemini 2.0 Flash at **~$5/year** as a pre-filter, with Claude Sonnet as a fallback for low-confidence results. This hybrid approach could cost ~$30-50/year total.

**Two-tier hybrid approach** (best of both worlds):
1. **Tier 1**: Gemini Flash classifies all 4,000 docs (~$5)
2. **Tier 2**: Claude Sonnet re-classifies the ~1,000 docs where Gemini confidence < 0.85 (~$28)
3. **Total**: ~$33/year with near-Claude-level accuracy

---

## Hidden Costs to Consider

| Factor | Impact |
|--------|--------|
| **Human review time** | ~25% of docs need review at ~2 min each = ~33 hours/year. Lower AI accuracy = more review time. |
| **Misclassification cost** | Wrong classification → misfiled document → staff time to fix. Hard to quantify but real. |
| **Prompt engineering** | Initial prompt development: ~4-8 hours. Refinement: ~2 hours/quarter. |
| **Edge cases** | New document types, unusual formats → occasional prompt updates. |
| **API dependency** | If Anthropic has outage, manual processing needed. Low risk but non-zero. |
