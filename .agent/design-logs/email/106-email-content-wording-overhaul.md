# Design Log 106: Email Content & Wording Overhaul (Natan Meeting Group 3)
**Status:** [DRAFT]
**Date:** 2026-03-06
**Related Logs:** DL-062 (reminder tones), DL-073 (Type A layout), DL-076 (bilingual cards), DL-084 (email uniformity audit)

## 1. Context & Problem

The Natan meeting (Group 3) identified three email improvements:
1. **3.1** — All client emails use cold/bureaucratic Hebrew. Warmer, friendlier tone needed with emojis.
2. **3.2** — Batch status email shows full doc list (received + missing). Should only show what's still needed.
3. **3.3** — Questionnaire email needs complete rewrite (Natan provided new text) + Natan's contact info (phone, WhatsApp, email) in ALL client-facing emails.

Currently: 5 email templates across 4 workflows, each with independently written text. No shared contact block. No WhatsApp link.

## 2. User Requirements

1. **Q:** Year in email text — dynamic or hardcoded 2024?
   **A:** Dynamic (use report year).

2. **Q:** Contact info scope — which emails?
   **A:** ALL client-facing emails (questionnaire, reminders, doc list, batch status).

3. **Q:** New wording for 3.1 — user provides or agent drafts?
   **A:** Agent drafts, with emojis. Match Natan's tone from 3.3.

4. **Q:** Batch status — mention received count?
   **A:** Yes. "We received X documents" before listing what's missing.

5. **Q:** WhatsApp number for Natan?
   **A:** 077-9928421 (confirmed correct, VoIP with WhatsApp).

## 3. Research

### Domain
Transactional email copywriting (CPA/accounting firms), emoji in professional emails, WhatsApp buttons in HTML email.

Prior research: DL-062 (reminder tones — helpfulness > urgency), DL-073 (single CTA), DL-076 (bilingual cards), DL-084 (email design system).

### Sources Consulted (Incremental — new since prior logs)
1. **TaxDome — 16 Accounting Email Templates** — Document request emails: lead with purpose, short clear list, single CTA. Soft deadlines ("to keep your timeline on track") over threats.
2. **ClientHub — Brand Voice for Accounting Firms** — "Familiarity so clients feel understood, not just serviced." Plain language, not stiff technical Hebrew.
3. **Journal of Accountancy — The Art of the Client Email** — Encourage batching: "upload everything in one go." Progress framing > deficit framing.
4. **Mindbaz — Emojis in Emails** — 29% increase in open rates with emoji (Swiftpage). But 15% of 45+ view emoji as inappropriate in professional context.
5. **SimpleToolsHub — Universal Safe Emojis** — Legacy-safe set: ✓ ✔ ★ → • ☎ ✉. Avoid skin-tone modifiers, modern colorful emoji, ZWJ sequences.
6. **Remarkety — RTL Subject Lines** — Hebrew subjects MUST start with Hebrew char. Emoji at start causes LTR rendering. Emoji only mid-line or end.
7. **Campaign Monitor — Bulletproof Email Buttons** — Table-based with VML fallback for Outlook. Dual-layer approach.
8. **Kommo — WhatsApp Link for Email** — URL: `wa.me/COUNTRY_NUMBER` (no +, no dashes). Pre-filled message via `?text=URL_ENCODED`.

### Key Principles Extracted
- **Progress framing** — "We received X" before "Y still needed" (research: frames client as making progress, not failing)
- **Warm-authority tone** — direct but helpful. Hebrew professional culture: clear sentences, not overly formal
- **Legacy-safe symbols only** — ✓ → ☎ ✉ work in Outlook desktop; colorful emoji may render as [X]
- **Hebrew subject line: Hebrew char first** — prevents RTL reversal
- **One primary CTA** — don't compete. WhatsApp is secondary, in contact block
- **WhatsApp pre-filled message** — blank chat = friction = abandonment

### Anti-Patterns to Avoid
- **Emoji at start of Hebrew subject** — breaks RTL rendering
- **Multiple competing CTAs** — questionnaire + WhatsApp + email all as primary buttons
- **Deficit framing** — "You still haven't submitted" → replace with "We've received X, Y more needed"
- **Base64-embedded WhatsApp icon** — blocked by Gmail/Outlook. Use hosted image or text-only
- **Money/alarm emoji** (💰 🚨 ⚠️) — spam-flagged, inappropriate for CPA firm

### Research Verdict
Warm professional tone with legacy-safe functional symbols. Contact block as reusable footer component across all emails. WhatsApp as secondary CTA with pre-filled message. Batch status filters to missing-only with received acknowledgment.

## 4. Codebase Analysis

### Existing Solutions Found
- **DL-084 established** `email-design-rules.md` with frozen header/footer components, color palette, spacing tokens
- **DL-076 bilingual card layout** already standardized across Type B and WF[03]
- **DL-062 unified reminder tone** — single warm voice, no escalation. Current wording is post-DL-062
- **"Send docs" highlight box** pattern already exists (light blue bg, border, mailto link) — can extend for contact block

### Workflows & Nodes to Modify

| Workflow | Node | Node ID | Current Lines |
|----------|------|---------|---------------|
| WF[01] `9rGj2qWyvGWVf9jXhv7cy` | Build Email Data | `c773bfd8-...` | ~40 lines |
| WF[01] | Send Email (HTTP) | `bc4aff20-...` | Template in params |
| WF[06] `FjisCdmWc4ef0qSV` | Build Type A Email | `build_type_a_email` | ~120 lines |
| WF[06] | Build Type B Email | `build_type_b_email` | ~250 lines |
| Doc Service `hf7DRQ9fLmQqHv3u` | Generate HTML | `generate-html` | ~700 lines |
| Batch Status `QREwCScDZvhF9njF` | Build Email | `code-build-email` | ~1200 lines |

### Alignment with Research
- Current emails lack contact info (research: "provide escape hatch")
- Current batch status shows everything (research: "short lists in body")
- Current tone is neutral but not warm (research: "familiarity over formality")
- RTL subject lines correctly start with Hebrew char ✓
- Single CTA pattern already established ✓

## 5. Technical Constraints & Risks

* **Generate HTML node is ~700 lines** — careful editing required, risk of breaking office email
* **WF[01] email body is in HTTP node params** — need to move to Code node first
* **Batch Status Build Email is ~1200 lines** — need to modify doc list filtering without breaking rejection display
* **WhatsApp 077 number** — VoIP prefix, user confirmed it works
* **No breaking changes** — all changes are text/HTML, no API or schema changes
* **CORS headers** — Respond to Webhook nodes untouched

## 6. Proposed Solution (The Blueprint)

### Shared Contact Block (reusable HTML)

Hebrew version:
```
צריכים עזרה? פנו אלינו →
☎ 03-6390820 | 077-9928421
✉ natan@moshe-atsits.co.il
[WhatsApp button — #25D366, table-based]
```

English version:
```
Need help? Contact us →
☎ 03-6390820 | 077-9928421
✉ natan@moshe-atsits.co.il
[WhatsApp button — #25D366]
```

WhatsApp URL: `https://wa.me/972779928421?text=...` (pre-filled Hebrew)

### Per-Email Changes

**WF[01] + Type A:** New body per Natan's spec (dynamic year). Longer, warmer, emphasizes household scope.

**Type B:** Progress framing — "קיבלנו חלק מהמסמכים ✓ עדיין חסרים X מתוך Y"

**Document Service:** "סיימנו לעבד את השאלון שלך ✓ להלן רשימת X מסמכים..."

**Batch Status:** Filter to missing/requires_fix only. "קיבלנו X מסמכים — תודה! ✓ עדיין נדרשים:"

### Implementation Order
1. WF[01] — restructure (move HTML to Code node) + new text + contact block
2. WF[06] Type A — mirror WF[01] text + contact block
3. WF[06] Type B — friendlier wording + contact block
4. Document Service — friendlier intro + contact block
5. Batch Status — missing-only filter + friendlier wording + contact block
6. Validate all via n8n MCP

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| WF[01] Code node | Modify | Add HTML generation, new body text |
| WF[01] HTTP node | Modify | Reference $json.emailHtml |
| WF[06] Type A node | Modify | New body text, contact block |
| WF[06] Type B node | Modify | Friendlier wording, contact block |
| Doc Service Generate HTML | Modify | New client intro, contact block |
| Batch Status Build Email | Modify | Missing-only filter, new intro, contact block |
| `email-design-rules.md` | Modify | Add contact block as frozen component |

## 7. Validation Plan
* [ ] WF[01]: Send test questionnaire → verify new body text + contact block + WhatsApp link works
* [ ] WF[06] Type A: Trigger reminder → verify mirrors WF[01] text
* [ ] WF[06] Type B: Trigger reminder → verify progress framing + missing-only docs + contact block
* [ ] WF[03]: Approve & send → verify new intro text + contact block
* [ ] Batch Status: Send batch update → verify received count + missing-only list + contact block
* [ ] All emails: Hebrew subjects start with Hebrew char (no RTL breakage)
* [ ] Bilingual emails: EN + HE cards both have contact block
* [ ] WhatsApp button: clickable, opens WhatsApp with pre-filled message
* [ ] Office emails (WF[02], WF[04]): NOT modified, still work correctly

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
