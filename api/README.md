# Annual Reports API (Cloudflare Workers)

Edge API for the Annual Reports CRM, serving the admin portal and client portal.

## Architecture

```
Browser (Israel)  -->  Cloudflare Worker (Tel Aviv edge)  -->  Airtable (US)
                                  |
                                  |--> Microsoft Graph (email, OneDrive)
                                  |--> Claude API (document classification)
                                  |--> n8n Cloud (scheduled jobs only)
```

## Setup

```bash
cd api
npm install
```

### Secrets

Set via Wrangler CLI (never commit):

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put SECRET_KEY
wrangler secret put CLIENT_SECRET_KEY
wrangler secret put AIRTABLE_PAT
wrangler secret put MS_GRAPH_CLIENT_ID
wrangler secret put MS_GRAPH_CLIENT_SECRET
wrangler secret put MS_GRAPH_TENANT_ID
wrangler secret put MS_GRAPH_REFRESH_TOKEN
wrangler secret put N8N_INTERNAL_KEY
wrangler secret put APPROVAL_SECRET
wrangler secret put ANTHROPIC_API_KEY
```

### Local Development

Create `.dev.vars` in `api/` with your secrets, then:

```bash
npm run dev       # http://localhost:8787
```

### Deploy

```bash
npm run deploy
```

## Routes

27 endpoint modules in `src/routes/`:

| Category | Endpoints |
|----------|-----------|
| **Auth** | auth, submission |
| **Dashboard** | dashboard, pending, stage, rollover |
| **Clients** | client, client-reports, import |
| **Documents** | documents, edit-documents, approve-and-send, upload-document |
| **AI Classification** | classifications, inbound-email |
| **Reminders** | reminders, send-questionnaires |
| **Email** | check-sent-emails |
| **Portal** | questionnaires, preview, reset |
| **OneDrive** | check-folders, create-folders |
| **Other** | chat, feedback, backfill |

## Adding New Endpoints

1. Copy `src/routes/_template.ts`
2. Implement the route handler
3. Mount in `src/index.ts`
4. Deploy: `npm run deploy`
5. Update `frontend/shared/endpoints.js` to point to the new route
