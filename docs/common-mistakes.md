# Common Mistakes (from 45+ design logs)

Patterns that have caused real bugs. Read before writing any code that touches these areas.

## Data Structures (#1 bug category)
- **ALWAYS** verify actual data structure before writing access code — assume nothing
- Airtable paths differ by operation: Upsert → `item.json.fields.*`, Search → `item.json.*`
- Node references in `$('NodeName')` must match EXACTLY (spaces, hyphens, case) — verify with `n8n_get_workflow(mode='structure')`
- Test with REAL data — mock data hides nesting issues

## Templates & Placeholders
- Use `.replaceAll()`, NEVER `.replace()` for placeholder substitution
- Loop ALL array items — don't just use `[0]`
- Placeholder formats must match templates EXACTLY (case-sensitive)

## Deduplication & Logic
- Dedup keys must be unique per item — use `document_key` (not type + question ID)
- Category IDs ≠ display names — never mix them
- Multiple mappings to same template: parent yes/no triggers linked list — don't also generate documents

## Airtable Gotchas
- Single-select: exact PascalCase values from schema. Empty = `null` (not `""`)
- Date fields: `null` to clear (not `""`)
- Airtable Trigger is unreliable (n8n bug #16831) → use Schedule + Search pattern

## n8n Airtable Node — Null Stripping (DL-146)
- n8n's Airtable node **silently strips `null` values** from update payloads — fields set to `null` are simply not sent to Airtable
- This means you **cannot clear a Single Select field** using the Airtable node (clearing requires sending `null` to the API; `""` fails with `INVALID_MULTIPLE_CHOICE_OPTIONS`)
- **FIX:** Replace the Airtable Update node with a Code node + HTTP Request node. The Code node pre-stringifies the payload (`JSON.stringify({ fields: { mySelect: null } })`), and the HTTP Request sends it as raw JSON via `PATCH /v0/{baseId}/{tableId}/{recordId}` using `predefinedCredentialType: "airtableTokenApi"`
- HTTP Request params: `contentType: "raw"`, `rawContentType: "application/json"`, `body: "={{ $json._payload }}"`
- Same issue applies to clearing Number fields — if Airtable node strips nulls, the field won't be cleared

## n8n Code Gotchas
- Tally multi-select returns arrays even for single values — handle both String and Array
- Spouse titles: spot-check format (name in MIDDLE, not appended)
- `eval()` on bare return statements fails → wrap in function or use `new Function()`

## n8n HTTP Request Node — HTML in JSON Body
- **NEVER** use `specifyBody: "json"` + `jsonBody` with n8n expressions (`{{ $json.htmlField }}`) when the field contains HTML — the double quotes in `style="..."` attributes break JSON parsing → error: "JSON parameter needs to be valid JSON"
- **FIX:** Pre-stringify the payload in a Code node (`JSON.stringify({...})`) and use `contentType: "raw"` + `rawContentType: "application/json"` + `body: "={{ $json._payload }}"` — this is the pattern used by WF[06] Send Email
- Same applies to any field containing unescaped quotes, newlines, or special chars

## n8n MCP `updateNode` — Credential Loss
- `n8n_update_partial_workflow` `updateNode` replaces the **entire `parameters` object** — if you only send `{jsCode: "..."}`, all other params (like `nodeCredentialType`, `authentication`, `method`, `url`) are lost
- **FIX:** When updating an HTTP Request node's parameters, include ALL existing params in the update, not just the changed field
- For Code nodes this is fine (only param is `jsCode`), but for HTTP/Airtable/other nodes: fetch current params first, merge your change, then send the full object

## n8n Airtable Search Node — Single-Item Expression Evaluation
- Airtable Search `filterByFormula` expressions (e.g., `{{ "{record_id}='" + $json.report_record_id + "'" }}`) only evaluate against the **first input item** — the node does NOT iterate per item
- If 4 items enter the node, only the first item's `report_record_id` is used → only 1 Airtable result → 3 items silently dropped
- **FIX:** Add a Code node before the Airtable Search that collects all IDs and builds an `OR({record_id}='rec1',{record_id}='rec2')` formula, then outputs 1 item. The Airtable Search evaluates this single item's formula and returns all matching records.
- Pattern: `Prep Formula (Code) → Airtable Search → Merge (Code)` — the merge Code node cross-references Airtable results back to original items using `$('OriginalNode').all()`

## n8n Code Node — `$env` and `this.getCredentials()` Limitations
- `$env.SOME_VAR` only works if the env var is set in n8n cloud Settings → Environment Variables — local `.env` files don't apply
- `this.getCredentials('credentialType')` in Code nodes requires the credential to be **manually attached** to the Code node in the n8n UI — it's NOT inherited from other nodes in the workflow
- **FIX:** Don't use raw HTTP with credentials in Code nodes. Instead, use an Airtable/HTTP Request node (which has the credential attached via UI) and wire it into the flow. Keep Code nodes for data transformation only.
