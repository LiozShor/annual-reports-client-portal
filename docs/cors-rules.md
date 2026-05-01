# CORS Rules for n8n Webhooks (CRITICAL)

GitHub Pages (`liozshor.github.io`) → n8n webhooks (`liozshor.app.n8n.cloud`) is cross-origin.

**How CORS works in this project:**
1. All Respond to Webhook nodes MUST include these headers:
   - `Access-Control-Allow-Origin: https://liozshor.github.io`
   - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type`
2. n8n cloud handles OPTIONS preflight automatically — BUT only for webhooks that existed when the workflow was first activated. **Webhooks added via API to already-active workflows may NOT get proper OPTIONS handling** (returns 500 instead of 204). Deactivate/reactivate does NOT fix this.
3. **Preferred fix when CORS fails:** Use HTML `<form method="POST">` instead of `fetch()`. Form submissions bypass CORS entirely. n8n responds with a 302 redirect back to the originating page with a `?result=` query param.
4. **For existing webhooks that work:** `fetch()` with `application/json` is fine — n8n's OPTIONS handler returns proper CORS headers.
5. **Session 78 baseline:** 27 Respond to Webhook nodes across 12 workflows have CORS headers. Any NEW Respond nodes must include them too.
