# Architecture Diagram Notes

## Diagram Inventory

| File | Scope | Direction |
|------|-------|-----------|
| `system-overview.mmd` | Full system: all components, workflows, data flows | `graph LR` |
| `document-processing-flow.mmd` | Inbound classification + SSOT generation + doc status lifecycle | `graph TD` |
| `client-portal-flow.mmd` | 8-stage pipeline + client pages + auth + reminders | `graph TD` |
| `email-generation-flow.mmd` | All 7 email types, triggers, SSOT engine, delivery | `graph TD` |

## Assumptions

1. **WF[03] not shown separately** — "Approve & Send" is now handled by Cloudflare Workers calling `[API] Send Batch Status`. The old standalone WF[03] was archived during the Workers migration.

2. **WF[05] migration complete** — WF[05] migration to Cloudflare Workers is complete. Inbound document processing now runs via the `process-inbound-email` Workers endpoint. The n8n WF[05] workflow is archived.

3. **22 archived workflows omitted** — All `[ARCHIVED]` prefix workflows (migrated to Workers) are excluded from diagrams. See `docs/workflow-ids.md` for the full list.

4. **Airtable field-level detail omitted** — Only table-level relationships shown. For full field schema, see `docs/airtable-schema.md`.

5. **OneDrive folder structure not detailed** — Files are stored in client-specific folders on OneDrive via MS Graph API. Exact folder naming convention not diagrammed.

6. **Chat endpoint excluded** — `admin-chat` endpoint exists but is intentionally disabled per CLAUDE.md.

## Known Gaps

- **Tally webhook payload structure** — Not documented; would require inspecting WF[02] Code nodes
- **HMAC token generation logic** — Lives in Workers code; 45-day expiry noted in memory but exact signing flow not diagrammed
- **Error logging flow** — `api/src/lib/error-logger.ts` sends alerts via MS Graph + KV-throttled cooldowns; not included in main diagrams to keep them readable
- **Year rollover flow** — `admin-year-rollover` endpoint handles bulk activation for next tax year; complex but rarely used

## How to Render

**VS Code:** Install "Mermaid Preview" extension, open `.mmd` file, press `Ctrl+Shift+V`

**CLI:** `npx @mermaid-js/mermaid-cli mmdc -i system-overview.mmd -o system-overview.svg`

**Online:** Paste into [mermaid.live](https://mermaid.live)

## Email Design Rules

These rules apply to all generated emails (extracted from the diagram for clarity):

- **Max width:** 600px single column
- **Layout:** All table-based, inline CSS only (Gmail strips `<style>` blocks)
- **Typography:** Calibri stack, 13-22px
- **Bilingual:** Per-section `dir` attribute (`dir="rtl"` for Hebrew, `dir="ltr"` for English)
- **Hebrew line-height:** 1.6 (vs 1.5 for English)
- **Hebrew subject lines:** Must start with a Hebrew character (not emoji) to prevent RTL reversal

For full email design rules, see `docs/email-design-rules.md`.

## Keeping Diagrams Current

When making changes that affect:
- Adding/removing n8n workflows → update `system-overview.mmd`
- Changing document generation logic → update `document-processing-flow.mmd`
- Adding client portal pages or stage changes → update `client-portal-flow.mmd`
- Adding email types or changing triggers → update `email-generation-flow.mmd`
