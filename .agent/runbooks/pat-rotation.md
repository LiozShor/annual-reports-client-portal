# Runbook: Airtable PAT Rotation

**Last updated:** 2026-04-16 (DL-283)
**Why this exists:** Session 14 rotated an Airtable PAT but missed the shared n8n credential object, which then broke 28 Airtable nodes across 6 active workflows the next morning (see DL-283). This runbook lists every surface the rotation must touch so no step is forgotten.

---

## When to use this
- Airtable PAT compromised or leaked.
- Quarterly / scheduled key rotation.
- Revoking access for a user or integration.

## The 6 surfaces to update (in this exact order)

### 1. Airtable — regenerate the PAT
- Airtable Developer Hub → Personal access tokens → rotate `patvXzYxSlSUEKx9i.*`.
- Scopes to preserve: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`.
- **Copy the full token string once — it is only shown once.** Paste into your password manager / `.env` draft. Going forward, reference it as `$NEW_PAT`.

### 2. Shell `.env` files (both worktree + main repo)
Update `AIRTABLE_API_KEY` in every `.env` you use to hit Airtable from local scripts (pyairtable, ad-hoc curl):

```bash
# Main repo
sed -i "s|^AIRTABLE_API_KEY=.*|AIRTABLE_API_KEY=$NEW_PAT|" C:/Users/liozm/Desktop/moshe/annual-reports/.env

# Worktrees, if any (worktrees don't usually carry .env — check)
ls C:/Users/liozm/Desktop/moshe/worktrees/*/\.env 2>/dev/null
```

> Note: `.env` here may actually carry a **different** PAT (`pat2XQGRyzPdycQWr.*`) used only for ad-hoc scripts; the n8n workflows use a separate PAT (`patvXzYxSlSUEKx9i.*`) stored in the n8n credential. If you rotated the n8n-side token only, skip this step and move on.

### 3. Cloudflare Worker secret
The Worker reads the PAT from env variable `AIRTABLE_PAT` (see memory `feedback_env_var_names.md` — Workers uses `AIRTABLE_PAT`, shell uses `AIRTABLE_API_KEY`).

```bash
cd C:/Users/liozm/Desktop/moshe/annual-reports/api
echo "$NEW_PAT" | npx wrangler secret put AIRTABLE_PAT
# If the Worker also reads from a named env, update wrangler.toml as well.
npx wrangler deploy
```

Smoke-test: `curl -sS https://annual-reports-api.liozshor1.workers.dev/health` then hit any Airtable-backed endpoint (e.g. `/webhook/admin-dashboard?year=…&filing_type=annual_report`) and check for 200.

### 4. n8n shared Airtable credential `ODW07LgvsPQySQxh`  ← **THE FORGOTTEN ONE**
This is the credential that powers every `n8n-nodes-base.airtable` node across WF02 / WF04 / WF06 / WF06-SUB / [SUB] Document Service. **Missing this step is what caused the DL-283 outage.**

```bash
# From main repo shell with .env loaded
set -a && source .env && set +a

curl -sS -X PATCH "https://liozshor.app.n8n.cloud/api/v1/credentials/ODW07LgvsPQySQxh" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary "$(python -c 'import json,os; print(json.dumps({"name":"Airtable Personal Access Token account","type":"airtableTokenApi","data":{"accessToken": os.environ["NEW_PAT"], "allowedHttpRequestDomains":"all"}}))')"
# expect HTTP 200 with updatedAt timestamp close to $(date -u)
```

**Gotcha:** the request body **must include** `allowedHttpRequestDomains: "all"` (or `"none"`/`"domains"` with an `allowedDomains` field). Omitting it returns 400: `"request.body.data requires property allowedDomains"`.

**GET on credential by ID returns 405 by design** — n8n will not hand back secret data. Verify via side effect (step 6 smoke test), not GET.

### 5. Grep design logs + memory for literal token
Redact any leaked copies of the *old* PAT still sitting in committed markdown:

```bash
cd C:/Users/liozm/Desktop/moshe/annual-reports
grep -rn 'patvXzYxSlSUEKx9i\.' .agent/ docs/ CLAUDE.md || echo "clean"
```

If matches appear: replace the token string with `<redacted — see .env AIRTABLE_API_KEY / n8n credential>` and commit.

### 6. Grep n8n Code nodes + HTTP headers for hardcoded token copies
Use the DL-283 scan script (`scan_all_creds.py` at the repo root during the fix; kept here for reference):

```python
# Runs over every ACTIVE workflow pulled via n8n REST API.
# Reports OLD/NEW/OTHER hardcoded token occurrences in Code jsCode + HTTP header/body params.
# Expected after a clean rotation: OLD=0 everywhere.
python scan_all_creds.py  # see DL-283 commit for the exact script
```

If OLD count > 0: update those Code / HTTP nodes via MCP `n8n_update_partial_workflow` or REST API PUT (see `memory_n8n_api_direct_access.md`).

---

## Smoke tests (run after every rotation)

One representative trigger per workflow group:

| Workflow | Trigger | Expected |
|---|---|---|
| **WF02** Questionnaire | `curl -X POST https://liozshor.app.n8n.cloud/webhook/questionnaire-response -d '{"record_id":"<known-good-rec>"}'` | n8n execution shows `success`, `Fetch Record` node `executionStatus: "success"` |
| **WF04** Doc Edit | Submit a doc edit via admin UI | Airtable `document` row updated |
| **WF05** Inbound | Forward a 1-PDF email to `reports@moshe-atsits.co.il` | n8n `Forward to Worker` returns 202 in <1s; Airtable classifications row appears within ~15s |
| **WF06** Reminder | n8n UI → Execute Workflow | First Airtable node succeeds |
| **WF07** Digest | Wait for next hourly trigger OR UI execute | `success` status |
| **MONITOR** Security Alerts | Wait for next hourly trigger | `success` status |

If any workflow fails with `401 Invalid authentication token` on a `Fetch Record` / search / update Airtable node → step 4 was skipped. Redo it.

---

## Lessons learned (from DL-283)

1. **Step 4 is the one you will forget.** The credential object is invisible in the workflow JSON — its nodes just have `credentials.airtableTokenApi.id: "ODW07LgvsPQySQxh"`, so a simple grep for the token value finds nothing. You only notice the miss when a workflow runs at its cron time and 401s. That is why this runbook lists the credential explicitly and before the smoke tests.
2. **Don't trust MCP alone for the audit.** Six active workflows had "MCP access" disabled in their settings (notably WF06). REST API pull via `X-N8N-API-KEY` is the only reliable way to enumerate every node.
3. **The `Clear Reminder Date` Code node in WF02 still hardcodes a PAT.** It is a working workaround (n8n Airtable node can't null a date-time), but it's a second rotation surface. Tracked as a DL-283 follow-up.
4. **Cloudflare Worker secret ≠ n8n credential.** Workers' `AIRTABLE_PAT` and n8n's `airtableTokenApi` credential hold the *same token value* but live in two different systems. Rotating one does not propagate.

---

## Dry-run before a real rotation

Before you rotate, run step 6's grep. That list = your update surface. Add to this runbook if you find a new one.
