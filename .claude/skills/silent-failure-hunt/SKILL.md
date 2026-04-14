---
name: silent-failure-hunt
description: >
  Scan n8n workflows and Workers code for silent failure patterns — bugs that don't error but silently drop data,
  skip nodes, or return empty responses. Use this skill before deploying n8n workflow changes, after editing Workers
  route handlers, or when investigating "it works but data is missing" bugs. Also use when the user says "check for
  silent failures", "health check", "audit workflow", or reports data going missing without errors.
---

# Silent Failure Hunt

Proactively scan n8n workflows and Cloudflare Workers code for known silent failure patterns — bugs that don't throw errors but silently drop data, skip execution, or return empty responses.

These patterns are extracted from 45+ real bugs documented in design logs. They're the bugs that pass all error handling but still break the system.

## When to Run

- **Before deploying n8n workflow changes** (mandatory, like `/ssot-verify` for doc generation)
- After editing Workers route handlers in `api/src/routes/`
- When investigating "data is missing but there are no errors"
- Periodic audit (use with the workflow you're currently editing)

## How to Run

1. Identify what changed — the workflow ID or Workers file(s)
2. Load the workflow via `n8n_get_workflow` (for n8n) or read the file (for Workers)
3. Run each pattern check from the catalog below against the code
4. Report findings inline

## Pattern Catalog

### P1: Airtable 0-Result Drop

**What happens:** Airtable Search node returns 0 results → downstream nodes never execute → if a Respond to Webhook node is downstream, the webhook returns an empty body → client gets a JSON parse error.

**How to detect:**
- Find Airtable Search/List nodes
- Check if `alwaysOutputData` is set to `true` on the node
- Check if the next node handles the empty-result case (e.g., filters by `item.id` existing)
- Check if there's a Respond to Webhook node downstream that could be skipped

**Fix pattern:** Set `alwaysOutputData: true` on the Airtable node + add `.filter(r => r.id)` in the next Code node.

---

### P2: Respond to Webhook Returns Upstream Data

**What happens:** Respond to Webhook node uses default mode (`firstIncomingItem`) instead of explicit JSON → returns the raw Airtable record instead of `{ok: true}` → frontend `result.ok` check fails silently.

**How to detect:**
- Find all Respond to Webhook nodes
- Check if `respondWith` is set to `"json"` with an explicit `responseBody`
- Flag any that use `firstIncomingItem` or have no explicit response body

**Fix pattern:** Use `respondWith: "json"` + `responseBody: '={{ JSON.stringify({ ok: true }) }}'`

---

### P3: Boolean IF Node Misuse

**What happens:** IF node uses `{type: "boolean", operation: "notEqual", rightValue: false}` — this evaluates `true notEqual false` as FALSE (counterintuitive). The TRUE branch never fires.

**How to detect:**
- Find IF nodes with `type: "boolean"`
- Check if they use `operation: "notEqual"` or `operation: "equal"` with a `rightValue`
- Flag — boolean checks should use unary `operation: "true"` or `operation: "false"`

**Fix pattern:** Use `{type: "boolean", operation: "true"}` (unary, no rightValue).

---

### P4: Code Node Missing `ok: true` in Return

**What happens:** Code node returns data without `ok: true` → downstream IF node checking `$json.ok` treats `undefined` as `false` → success path never fires.

**How to detect:**
- Find Code nodes that feed into IF nodes
- Check if the IF node checks `$json.ok` (boolean true)
- Check if the Code node's return object includes `ok: true`

**Fix pattern:** Always include `ok: true` in success returns when downstream IF nodes check it.

---

### P5: Airtable Search Single-Item Formula Evaluation

**What happens:** Airtable Search `filterByFormula` with an n8n expression (e.g., `$json.report_record_id`) only evaluates against the first input item. If 4 items enter, only the first item's ID is used → 3 items silently dropped.

**How to detect:**
- Find Airtable Search nodes with `filterByFormula` containing `$json.*` or `{{ }}` expressions
- Check if the node can receive multiple input items (look at upstream node output)
- Flag if no preceding Code node batches IDs into a single `OR()` formula

**Fix pattern:** Add a Code node before Airtable Search that collects all IDs into `OR({field}='id1',{field}='id2')` and outputs 1 item.

---

### P6: Code Node Wrong Mode (runOnceForAllItems vs runOnceForEachItem)

**What happens:** Code node typeVersion 2 defaults to `runOnceForAllItems`. If the code uses `$input.item` syntax (per-item), only the first item is processed — the rest are silently dropped.

**How to detect:**
- Find Code nodes with typeVersion 2
- Check if `mode` is explicitly set
- If code references `$input.item`, `$json` (without `.all()`), or processes single items, it should be `runOnceForEachItem`
- If code references `$input.all()` or processes arrays, it should be `runOnceForAllItems`

**Fix pattern:** Explicitly set `mode: "runOnceForEachItem"` when using per-item syntax.

---

### P7: n8n Airtable Node Null Stripping

**What happens:** n8n's Airtable Update node silently strips `null` values from payloads — fields set to `null` are never sent to Airtable. You can't clear a Single Select or Number field.

**How to detect:**
- Find Airtable Update nodes
- Check if any fields are being set to `null` or cleared
- Flag — the Airtable node cannot clear fields

**Fix pattern:** Replace with Code node + HTTP Request node using `PATCH` with raw JSON body.

---

### P8: Workers — Unhandled Promise in ctx.waitUntil

**What happens:** `ctx.waitUntil(someAsyncFn())` with no `.catch()` — if the async function throws, the error is swallowed. No log, no alert, data silently not written.

**How to detect:**
- Find `ctx.waitUntil(` or `c.executionCtx.waitUntil(` calls
- Check if the promise inside has a `.catch()` handler
- Check if `logError` is called in the catch

**Fix pattern:** Always wrap: `ctx.waitUntil(fn().catch(err => logError(...)))`.

---

### P9: Workers — Missing Error Logging in Route Handler

**What happens:** Route handler has a try/catch but the catch only returns a JSON error — no `logError()` call. The error is invisible in monitoring.

**How to detect:**
- Find route handler functions (Hono `app.get`, `app.post`, etc.)
- Check if catch blocks call `logError()`
- The global `app.onError()` catches unhandled errors, but caught-and-swallowed errors bypass it

**Fix pattern:** Add `logError(c.executionCtx, c.env, { endpoint, error, category })` in every catch block.

---

### P10: HTTP Request Node — HTML in JSON Body

**What happens:** HTTP Request node uses `specifyBody: "json"` with an n8n expression containing HTML — double quotes in `style="..."` break JSON parsing. No error shown in editor, fails at runtime.

**How to detect:**
- Find HTTP Request nodes with `specifyBody: "json"` or `jsonBody` parameter
- Check if any expression references a field that could contain HTML (email bodies, doc content)
- Flag if the field might contain unescaped quotes

**Fix pattern:** Pre-stringify in Code node → use `contentType: "raw"` + `rawContentType: "application/json"`.

---

## Report Format

After scanning, report findings like this:

```
## Silent Failure Scan: [Workflow Name / File Path]

### Findings
- **P1 (Airtable 0-Result Drop):** [Node name] — no alwaysOutputData, feeds into Respond to Webhook
- **P3 (Boolean IF Misuse):** [Node name] — uses notEqual/false instead of unary true

### Clean
- P2, P4, P5, P6, P7, P8, P9, P10 — no issues found

### Summary: 2 issues found, 8 patterns clean
```

If no issues are found, report: "Silent Failure Scan: All 10 patterns clean."

## Adding New Patterns

When you discover a new silent failure pattern (a bug that doesn't error but drops data), add it to this catalog with:
- **Pattern ID** (P11, P12, ...)
- **What happens** — the silent failure behavior
- **How to detect** — what to look for in code/workflow
- **Fix pattern** — the standard fix
