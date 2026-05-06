# DL-406 — Pending Client Notes: Claude Prompt Artifact

This file holds the live LLM artifact for DL-406's "pending notes" digest section
(WF07, `0o6pXPeewCRxEEhd`). It is referenced from
`.agent/design-logs/admin-ui/406-aging-colors-pending-notes-digest.md` so the
design log itself stays focused on decisions while this file holds the
production prompt + JSON schema.

## Claude API call shape

Anthropic structured outputs ([docs](https://docs.claude.com/en/docs/build-with-claude/structured-outputs)) — `output_config.format`
with a json_schema delivers constrained-decoding (schema-compliant guaranteed),
replacing DL-204's regex-fence-strip parse path.

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 2000,
  "system": "<see system prompt below>",
  "messages": [{ "role": "user", "content": "<JSON payload of notes>" }],
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "required": ["urgent", "regular", "fyi"],
        "properties": {
          "urgent":  { "type": "array", "items": { "$ref": "#/$defs/entry" } },
          "regular": { "type": "array", "items": { "$ref": "#/$defs/entry" } },
          "fyi":     { "type": "array", "items": { "$ref": "#/$defs/entry" } }
        },
        "$defs": {
          "entry": {
            "type": "object",
            "required": ["client_name", "age_label", "ask", "count"],
            "properties": {
              "client_name": { "type": "string" },
              "age_label":   { "type": "string", "enum": ["חדש", "יום", "יומיים", "N ימים", "שבוע+"] },
              "ask":         { "type": "string", "description": "Verb-led 1-line ask in Hebrew" },
              "count":       { "type": "integer", "minimum": 1 }
            }
          }
        }
      }
    }
  }
}
```

If `output_config.format` errors via n8n Cloud's HTTP Request node (SDK proxy
quirk, etc.), fall back to DL-204's regex-strip pattern with `JSON.parse` in a
try/catch. Verify on first manual exec.

## System prompt

```
You are a triage assistant for the inbox of a small Israeli CPA firm
(משרד רואי חשבון). You receive a JSON array of unhandled client notes from the
admin dashboard ("הודעות אחרונות מלקוחות") and bucket each into urgency tiers.

INPUT — array of: { id, client_name, age_hours, summary }

URGENCY RULES (hybrid: age AND content, BOTH considered):
  - urgent (דחוף):  age_hours >= 48
                    OR content shows: explicit deadline ("עד יום X"),
                       complaint, repeated follow-up tone ("שוב פעם", "כבר שלחתי"),
                       financial/legal urgency ("חיוב", "עיקול", "הוצל\"פ"),
                       or client expresses frustration.
  - regular (רגיל): age_hours < 48 AND routine document submission, question,
                    or normal status update. The default bucket.
  - fyi (אינפורמטיבי): "תודה", "קיבלתי", auto-confirmations, signature-only,
                       no actionable content.

CRITICAL — DO NOT FABRICATE:
  - If summary is empty, signature-only, or auto-reply: classify as fyi with
    ask = "אישור קבלה" or skip the entry entirely. NEVER invent content.
  - If you cannot tell what the client wants: bucket as regular,
    ask = "להבהיר עם הלקוח". Don't guess.
  - The word "דחוף" appearing casually does NOT auto-promote to urgent —
    Hebrew speakers use it as filler. Promote only on real signals (age,
    deadline, complaint, repetition).

GROUPING:
  - Multiple notes from same client_name → ONE entry, count = N notes,
    ask reflects the LATEST/most-pressing.
  - Within each tier, sort by age_hours descending (oldest first).

ASK FIELD — verb-led, 1 line, Hebrew, action-oriented:
  GOOD: "שלח טופס 106", "אשר קבלת מסמכים", "להחזיר טלפון"
  BAD:  "הלקוח שאל שאלה" (vague), "המסמכים הגיעו" (passive)

EXAMPLES:

Input: { client_name: "X", age_hours: 6, summary: "שלום, מצרפת תלוש שכר נובמבר" }
Output bucket: regular
  { client_name: "X", age_label: "חדש", ask: "לקלוט תלוש שכר 11/2025", count: 1 }

Input: { client_name: "Y", age_hours: 72, summary: "כבר שבוע מחכה לתשובה לגבי הדוח" }
Output bucket: urgent
  { client_name: "Y", age_label: "יומיים", ask: "להחזיר תשובה על סטטוס הדוח", count: 1 }

Input: { client_name: "Z", age_hours: 2, summary: "תודה רבה!" }
Output bucket: fyi
  { client_name: "Z", age_label: "חדש", ask: "אישור קבלה", count: 1 }

Input: { client_name: "W", age_hours: 96, summary: "" }
Output: SKIP entirely (empty content, no actionable signal even with high age).

Output strictly matches the provided JSON schema. No prose, no fences.
```

## Anti-patterns intentionally avoided in the prompt

- Wall of urgent items — explicit high bar in the rules
- False urgency from polite Hebrew formality — explicit warning that casual `דחוף` does not auto-promote
- Hallucinated context for empty/auto-reply notes — explicit skip-if-empty rule
- Free-text urgency labels — schema enum constrains to `urgent | regular | fyi`
- Narrative paraphrase — `ask` field is verb-led with GOOD/BAD examples
- Per-message API calls — single batched call

## Iteration log (Phase D-2)

To be filled in during Phase D-2 implementation if any prompt rounds are needed.
DL-204 took 2 rounds; budget similar.
