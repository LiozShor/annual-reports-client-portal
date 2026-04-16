# DL-108: Batch Status Email — Remove Bilingual, Single-Language Per Client

**Date:** 2026-03-07
**Status:** Deployed
**Workflow:** `[API] Send Batch Status` (`QREwCScDZvhF9njF`)
**Node:** `code-build-email`

## Problem

The Batch Status email had a bilingual card layout for English-speaking clients — two bordered cards side by side with `🔤 English` and `🔤 עברית` language tags. User tested and determined bilingual is unnecessary for this email type.

## Solution

Replaced the `if (isEnglish)` branch with a single English email that mirrors the Hebrew path's structure:

### English email structure (new):
```
┌─ Blue header bar: "Document Status Update" (LTR)
├─ Content area (LTR):
│  ├─ "Dear [name],"
│  ├─ "✓ Received X of Y documents — thank you!"
│  ├─ Rejected docs section (if any, with EN reasons)
│  ├─ Send docs box (if rejected)
│  ├─ Contact block (EN)
│  └─ CTA button (EN)
└─ Footer: "Moshe Atsits CPA Firm | reports@moshe-atsits.co.il"
```

### What was removed:
- Two bordered card containers (`border:1px solid #e5e7eb`)
- `🔤 English` / `🔤 עברית` language tags
- Duplicate Hebrew card content for EN clients
- Bilingual footer (`Moshe Atsits CPA Firm / משרד רו״ח Client Name`)

### What was kept:
- All shared functions: `contactBlock`, `sendDocsBox`, `ctaButton`, `buildRejectedHtml`, `buildApprovedHtml`, `progressOneLiner`, `esc`, `stripBold`
- `REASONS_EN` — still needed for EN rejected docs
- `heToEn` name mapping — still used for EN approved doc names
- Hebrew (`else`) branch — completely unchanged
- Blue header bar design (matching Hebrew path)
- Subject line format: `Document Status Update — [name]`

## Files Changed

| Location | Change |
|----------|--------|
| n8n `code-build-email` in `QREwCScDZvhF9njF` | Replaced bilingual EN branch with single-language EN |
| `tmp/batch-build-email.js` | Reference copy of updated code |

## Verification Checklist

- [ ] Hebrew client → Hebrew-only email, unchanged from before
- [ ] English client → English-only email, no Hebrew card, LTR, single content area
- [ ] Contact block present in both languages
- [ ] CTA button works in both
- [ ] Rejected docs section shows with English reasons for EN client
- [ ] Subject: Hebrew starts with Hebrew char, English starts with "Document"
