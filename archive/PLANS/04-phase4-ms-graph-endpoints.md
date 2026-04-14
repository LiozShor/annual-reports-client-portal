# Phase 4: Microsoft Graph Endpoints

**Status:** Phase 4a COMPLETE (session 173, 2026-03-23), Phase 4b NEXT
- [x] OAuth2 credential setup (tenant ID, client ID, client secret confirmed, fresh refresh token)
- [x] KV namespace `TOKEN_CACHE` created + 4 secrets set
- [x] `ms-graph-token.ts` — token refresh + KV caching (lock TTL 60s)
- [x] `ms-graph.ts` — REST client (batch, get, post, patch)
- [x] `routes/preview.ts` — get-preview-url (GET+POST)
- [x] `lib/doc-builder.ts` — document grouping module (office mode field names fixed)
- [x] `routes/documents.ts` — get-client-documents (dual auth, parallel queries, MS Graph batch)
- [x] Frontend endpoint switch (2 URLs)
- [x] Deploy + end-to-end testing — 4-10x speedup verified
- [x] `routes/classifications.ts` — get-pending-classifications (Phase 4b, DL-173)
- [x] `routes/classifications.ts` — review-classification (Phase 4b, DL-173)

## Goal

Migrate the four endpoints that interact with **Microsoft Graph API** for OneDrive file operations. These power the document preview panel, AI classification review, and document management — features the office uses heavily. This is the **hardest phase** because it requires managing MS Graph OAuth2 tokens within the Worker.

---

## Endpoints Being Migrated

### 1. `GET /get-client-documents`

**Current workflow:** `[API] Get Client Documents` (Ym389Q4fso0UpEZq)

**Current logic:**
1. Dual auth: client token (CLIENT_SECRET_KEY, timing-safe) OR admin token (Bearer)
2. **Parallel Airtable loads (4 queries):**
   - Get Report (by record ID)
   - Get Document Categories (`tblbn6qzWNfR8uL2b`)
   - Get Document Templates (`tblQTsbhC6ZBrhspc`)
   - Get Company Links (`tblDQJvIaEgBw2L6T`)
3. Search Documents: `FIND('{report_id}', ARRAYJOIN({report_record_id}))`
4. **Build Response (~1000 lines of logic):**
   - **Client mode (default):** Groups docs by person (client/spouse), then by category. Whitelist-based security (SEC-015/016/023) — only safe fields exposed. Returns: report metadata, groups, document_count, company_links
   - **Office mode:** Returns same structure PLUS templates array for add-document dropdown, all internal fields visible
   - Category/template lookups from Airtable (SSOT pattern)
   - Deduplicates onedrive_item_ids for batch resolution
   - Company links alias matching (names → URLs)
5. **MS Graph Batch Resolve URLs:**
   - Extract unique `onedrive_item_id` values (max 20)
   - `POST /v1.0/$batch` with array of `GET /me/drive/items/{itemId}` requests
   - Map resolved `webUrl` + `@microsoft.graph.downloadUrl` back to nested doc structure
6. Return grouped, enriched document list

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| annual_reports | `tbls7m3hmHC4hhQVy` | GET | year, client_name, spouse_name, source_language, stage, filing_type, docs_first_sent_at, client_questions, notes |
| documents | `tblcwptR63skeODPn` | SEARCH | issuer_name, type, status, file_url, onedrive_item_id, person, category, file_hash, bookkeepers_notes, issuer_name_en |
| document_categories | `tblbn6qzWNfR8uL2b` | SEARCH (all) | category_id, emoji, name_he, name_en, sort_order |
| documents_templates | `tblQTsbhC6ZBrhspc` | SEARCH (all) | template_id, name_he, name_en, category, scope, variables, help_he, help_en |
| company_links | `tblDQJvIaEgBw2L6T` | SEARCH (all) | name_he, name_en, url, aliases |

**MS Graph calls:**
- `POST /v1.0/$batch` — batch resolve OneDrive item URLs (up to 20 per request)

---

### 2. `GET /get-pending-classifications`

**Current workflow:** `[API] Get Pending Classifications` (kdcWwkCQohEvABX0)

**Current logic:**
1. Verify admin token (Bearer or query param)
2. **Build Response (massive Code node):**
   - Search classifications: `{notification_status} = ''` (pending + reviewed-unsent)
   - Batch fetch `client_is_active` for linked reports (50-item chunks)
   - Fetch all documents (non-confirmed) and templates
   - **DL-112 dedup:** Filter by `file_hash` to prevent duplicate processing
   - **DL-129 short name resolution:** Extract bold text from `issuer_name` HTML → substitute into `short_name_he` template variables
   - Build lookups: `missingByReport`, `allDocsByReport`, `templateInfo`
   - Calculate stats: matched, unmatched, high_confidence (≥ 0.85), pending vs reviewed
3. **MS Graph Batch Resolve URLs:**
   - Extract unique `onedrive_item_id` values (max 20)
   - Resolve via `POST /v1.0/$batch`
   - Apply fresh URLs back to items
4. Return enriched items with nested docs arrays and stats

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| classifications | `tbloiSDN3rwRcl1ii` | SEARCH | client_name, client_id, year, review_status, report, document, matched_template_id, ai_confidence, ai_reason, issuer_name, issuer_match_quality, matched_doc_name, file_url, onedrive_item_id, sender_email, sender_name, received_at, notes, reviewed_at, file_hash, attachment_name, attachment_content_type, attachment_size |
| annual_reports | `tbls7m3hmHC4hhQVy` | SEARCH (batch) | client_is_active |
| documents | `tblcwptR63skeODPn` | SEARCH | report, type, issuer_name, status, category |
| documents_templates | `tblQTsbhC6ZBrhspc` | SEARCH (all) | template_id, name_he, short_name_he, variables |
| document_categories | `tblbn6qzWNfR8uL2b` | SEARCH (all) | category_id, name_he, emoji, sort_order |

**MS Graph calls:**
- `POST /v1.0/$batch` — batch resolve OneDrive URLs (same as Get Client Documents)

---

### 3. `POST /get-preview-url`

**Current workflow:** `[API] Get Preview URL` (aQcFuRJv8ZJFRONt)

**Current logic:**
1. Verify admin token
2. Extract `itemId` from request
3. **Two sequential MS Graph calls:**
   - `POST /v1.0/me/drive/items/{itemId}/preview` → get `previewData.getUrl`
   - `GET /v1.0/me/drive/items/{itemId}?$select=@microsoft.graph.downloadUrl` → get download URL
4. Return `{ok: true, previewUrl, downloadUrl}`

**Airtable tables:** None

**MS Graph calls:**
- `POST /v1.0/me/drive/items/{itemId}/preview` (preview URL)
- `GET /v1.0/me/drive/items/{itemId}?$select=@microsoft.graph.downloadUrl` (download URL)

**Simplest MS Graph endpoint** — no Airtable, no complex logic.

---

### 4. `POST /review-classification`

**Current workflow:** `[API] Review Classification` (c1d7zPAmHfHM71nV)

**The most complex endpoint in the entire system.**

**Current logic:**
1. Verify admin token
2. Extract: `classification_id, action (approve/reject/reassign), reassign_template_id, reassign_doc_record_id, notes, new_doc_name, force_overwrite`
3. Fetch classification record + source document
4. **Process Action (~300 lines):**
   - **Approve:** Set doc status→Received, review_status→confirmed, copy file metadata
   - **Reject:** Set doc status→Required_Missing, clear file fields, map rejection reason to Hebrew string (`image_quality` → "איכות תמונה ירודה", etc.)
   - **Reassign:** Clear source doc, prepare target doc
   - DL-070 guard: Prevent overwrite of Received doc with different file_hash
   - DL-081: Inline Airtable PATCH for reject/reassign (ensures null fields cleared)
5. **Find Target Doc (for reassign, ~80 lines):**
   - Direct lookup by doc ID, OR
   - Create new custom doc (general_doc + new_doc_name), OR
   - Search by template_id + report
6. **Prepare File Move (~250 lines):**
   - Fetch templates for `buildShortName` resolution (DL-137)
   - **Approve:** Rename to short_name_he (unless exact match)
   - **Reassign:** Move to זוהו folder, rename to target short_name_he
   - **Reject:** Move to ארכיון folder (archive)
   - Sanitize filenames (remove illegal chars)
   - HE_TITLE fallback map: 30+ template IDs → Hebrew titles
7. **MS Graph File Operations:**
   - Get current file location (parent folder)
   - Navigate up to year folder
   - Create/get archive folder (ארכיון) or zohu folder (זוהו)
   - PATCH file: rename + move (`@microsoft.graph.conflictBehavior=rename`)
8. Update Airtable: doc records, classification record, file URLs
9. **Stage advancement:** If all docs in report now Received → advance to Review (stage 5)
10. Return `{ok, action, classification_id, doc_id, doc_title, client_name, report_key, errors[]}`

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| classifications | `tbloiSDN3rwRcl1ii` | GET, UPDATE | review_status, reviewed_at, notes, + all metadata |
| documents | `tblcwptR63skeODPn` | GET, UPDATE, CREATE | status, review_status, file_url, onedrive_item_id, file_hash, ai_confidence, issuer_name, document_uid, + many more |
| annual_reports | `tbls7m3hmHC4hhQVy` | GET, UPDATE | stage, docs_completed_at |
| documents_templates | `tblQTsbhC6ZBrhspc` | SEARCH | template_id, name_he, short_name_he, variables |

**MS Graph calls:**
| Operation | Endpoint | Method |
|-----------|----------|--------|
| Get file location | `/v1.0/drives/{driveId}/items/{itemId}?$select=id,name,parentReference` | GET |
| Get year folder | `/v1.0/drives/{driveId}/items/{parentId}?$select=...` | GET |
| Create archive folder | `/v1.0/drives/{driveId}/items/{yearFolderId}/children` | POST |
| Get archive folder | `/v1.0/drives/{driveId}/items/{yearParentId}:/ארכיון:` | GET |
| Create zohu folder | `/v1.0/drives/{driveId}/items/{yearParentId}/children` | POST |
| Get zohu folder | `/v1.0/drives/{driveId}/items/{yearParentId}:/זוהו:` | GET |
| Move/rename file | `/v1.0/drives/{driveId}/items/{itemId}?@microsoft.graph.conflictBehavior=rename` | PATCH |

---

## The MS Graph OAuth2 Challenge

### Current Setup
n8n manages the MS Graph OAuth2 token lifecycle automatically via its built-in credential system (`MS_Graph_CPA_Automation`). The credential stores:
- Client ID
- Client Secret
- Tenant ID
- Refresh Token
- Access Token (auto-refreshed)

### Options for the Worker

#### Option A: Worker Manages OAuth2 Tokens (Recommended)
Store the MS Graph credentials in Cloudflare Worker secrets and implement token refresh directly:

1. Store `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID`, `MS_GRAPH_REFRESH_TOKEN` as Worker secrets
2. Implement token refresh: `POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token` with `grant_type=refresh_token`
3. Cache the access token in Cloudflare KV with TTL (~3500 seconds, token expires at 3600)
4. On each MS Graph call, check KV for valid token → refresh if expired → cache new token

**Pros:** Full edge performance, no n8n dependency, clean architecture
**Cons:** Need to extract OAuth2 credentials from n8n, implement token refresh logic

**Token Refresh Implementation:**
```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={clientId}
&scope=https://graph.microsoft.com/.default offline_access
&refresh_token={refreshToken}
&grant_type=refresh_token
&client_secret={clientSecret}
```

Response: `{ access_token, refresh_token, expires_in }`

**Important:** MS Graph may return a new refresh token on each refresh. Store the latest refresh token in KV to avoid invalidation.

#### Option B: Proxy MS Graph Calls Through n8n
Worker makes the Airtable calls directly but delegates MS Graph operations to a thin n8n webhook that just proxies MS Graph with its managed credentials.

**Pros:** No OAuth2 management in Worker, uses n8n's existing credential
**Cons:** Adds latency for MS Graph calls (back to Frankfurt), more complex architecture, n8n dependency persists

#### Option C: Service Account with Client Credentials
If the MS Graph app registration supports `client_credentials` grant (app-level permissions instead of delegated), no refresh token is needed — just `client_id + client_secret → access_token`.

**Pros:** Simplest token management (no refresh token rotation)
**Cons:** Requires app-level permissions in Azure AD, may need reconfiguration

### Recommendation
**Go with Option A.** The token refresh logic is ~30 lines of code, and it eliminates the n8n dependency entirely for these endpoints. Use Cloudflare KV for token caching.

---

## Migration Approach

### New Modules

```
api/src/
├── lib/
│   ├── ms-graph.ts          # MS Graph client with OAuth2 token management
│   ├── ms-graph-token.ts    # Token refresh + KV caching
│   └── doc-builder.ts       # Shared doc grouping/formatting logic (Get Client Documents + Classifications)
├── routes/
│   ├── documents.ts         # GET /get-client-documents
│   ├── classifications.ts   # GET /get-pending-classifications + POST /review-classification
│   └── preview.ts           # POST /get-preview-url
```

### MS Graph Client (`lib/ms-graph.ts`)
```typescript
class MSGraphClient {
  constructor(private env: Env, private ctx: ExecutionContext) {}

  async getAccessToken(): Promise<string> {
    // Check KV cache
    const cached = await this.env.TOKEN_KV.get('ms_graph_access_token');
    if (cached) return cached;

    // Refresh token
    const response = await fetch(`https://login.microsoftonline.com/${this.env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.MS_GRAPH_CLIENT_ID,
        scope: 'https://graph.microsoft.com/.default offline_access',
        refresh_token: this.env.MS_GRAPH_REFRESH_TOKEN, // or latest from KV
        grant_type: 'refresh_token',
        client_secret: this.env.MS_GRAPH_CLIENT_SECRET,
      })
    });

    const data = await response.json();
    // Cache access token (TTL: 55 minutes)
    await this.env.TOKEN_KV.put('ms_graph_access_token', data.access_token, { expirationTtl: 3300 });
    // Store new refresh token if rotated
    if (data.refresh_token) {
      await this.env.TOKEN_KV.put('ms_graph_refresh_token', data.refresh_token);
    }
    return data.access_token;
  }

  async batch(requests: BatchRequest[]): Promise<BatchResponse[]> { ... }
  async get(path: string): Promise<any> { ... }
  async post(path: string, body: any): Promise<any> { ... }
  async patch(path: string, body: any): Promise<any> { ... }
}
```

### Review Classification — Modular Approach
This ~1000-line workflow should be broken into clear functions:

1. `processApprove(classification, sourceDoc)` → doc update fields
2. `processReject(classification, sourceDoc, notes)` → doc update fields + rejection reasons
3. `processReassign(classification, targetDoc)` → source clear + target update
4. `resolveTargetDoc(params)` → find or create target document
5. `buildShortName(templateId, issuerName, templates)` → resolve display name
6. `prepareFileMove(action, item, templates)` → compute new filename + target folder
7. `executeFileMove(msGraph, moveSpec)` → MS Graph folder operations + PATCH

### Get Client Documents — Response Builder
The ~1000-line response builder should be extracted into `lib/doc-builder.ts` since similar grouping/categorization logic is used by both Get Client Documents and Get Pending Classifications.

---

## Cloudflare KV Namespace

Phase 4 introduces the first KV namespace for MS Graph token caching:

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "TOKEN_KV"
id = "xxxxx"  # Created via: wrangler kv namespace create TOKEN_KV
```

Keys:
- `ms_graph_access_token` — cached access token (TTL: 55 min)
- `ms_graph_refresh_token` — latest refresh token (no TTL, persists indefinitely)

---

## Additional Worker Secrets (Phase 4)

```bash
wrangler secret put MS_GRAPH_CLIENT_ID
wrangler secret put MS_GRAPH_CLIENT_SECRET
wrangler secret put MS_GRAPH_TENANT_ID
wrangler secret put MS_GRAPH_REFRESH_TOKEN  # Extract from n8n credential
```

### Extracting OAuth2 Credentials from n8n
The MS Graph credential is stored in n8n as `MS_Graph_CPA_Automation`. To extract:
1. Open n8n → Settings → Credentials → MS_Graph_CPA_Automation
2. Note: Client ID, Client Secret, Tenant ID are visible in the credential config
3. Refresh token: May need to check n8n's internal storage or re-authenticate via Azure AD consent flow
4. Alternative: Create a new Azure AD app registration with the same permissions and complete the OAuth flow to get a fresh set of credentials for the Worker

---

## Rollback Plan

1. Revert endpoint URLs in `shared/endpoints.js` for any/all four endpoints
2. n8n workflows remain active throughout Phase 4
3. MS Graph credentials in n8n are not touched
4. Tokens are cross-compatible — no data migration

**Partial rollback:** If Review Classification (the most complex) has issues but the other three work, only revert that one endpoint.

---

## Testing Checklist

### Get Client Documents
- [ ] Client mode returns grouped docs with security-filtered fields only
- [ ] Office mode returns full fields + templates array
- [ ] Documents grouped by person (client/spouse), then by category
- [ ] Category sort order matches Airtable sort_order field
- [ ] Company links resolved from aliases
- [ ] OneDrive URLs resolved via MS Graph batch
- [ ] Documents without onedrive_item_id are unaffected
- [ ] Response shape matches n8n exactly (diff JSON)
- [ ] Client token auth works (45-day expiry)
- [ ] Admin token auth works (Bearer)

### Get Pending Classifications
- [ ] Returns only pending/reviewed-unsent classifications
- [ ] Inactive clients filtered out (DL-102)
- [ ] File hash deduplication works (DL-112)
- [ ] Short name resolution works (DL-129) — bold text extraction + variable substitution
- [ ] Stats correct: matched, unmatched, high_confidence, pending, reviewed
- [ ] Missing/all docs arrays populated per classification
- [ ] OneDrive URLs resolved via batch
- [ ] Category sort order applied

### Get Preview URL
- [ ] Returns both preview URL and download URL
- [ ] Invalid item ID returns error gracefully
- [ ] Token validation works

### Review Classification
- [ ] **Approve:** Doc status→Received, file metadata copied, OneDrive file renamed if needed
- [ ] **Reject:** Doc status→Required_Missing, file moved to ארכיון, rejection reason mapped to Hebrew
- [ ] **Reassign:** Source doc cleared, target doc assigned, file moved to זוהו if unmatched
- [ ] DL-070: Conflict guard prevents overwrite of Received doc with different file
- [ ] Custom doc creation works (new_doc_name parameter)
- [ ] buildShortName resolves correctly for all template types
- [ ] File move works: rename + folder move in single PATCH
- [ ] Archive/zohu folders created if they don't exist
- [ ] Stage advancement: all docs Received → advance to Review (stage 5)
- [ ] Error aggregation: partial failures reported in response

### MS Graph Token Management
- [ ] Access token refreshed automatically when expired
- [ ] Refresh token rotation handled (new token stored in KV)
- [ ] KV cache works (no unnecessary token refreshes)
- [ ] Concurrent requests share cached token (no thundering herd)
- [ ] Token refresh failure returns clear error

---

## Estimated Effort

| Task | Hours |
|------|-------|
| MS Graph OAuth2 token management + KV caching | 3 |
| MS Graph client (batch, get, post, patch) | 2 |
| Get Client Documents handler (~1000 lines of response building) | 5 |
| Get Pending Classifications handler (dedup, short names, stats) | 5 |
| Get Preview URL handler | 1 |
| Review Classification handler (approve/reject/reassign + file moves) | 6 |
| Shared doc-builder module | 2 |
| Extract MS Graph credentials from n8n | 1 |
| Response shape validation (diff n8n vs Worker) | 2 |
| End-to-end testing (AI review tab, doc preview, approve/reject) | 3 |
| **Total** | **~30 hours** |

This is the largest phase and carries the most risk. Consider splitting into sub-phases:
- **4a:** Get Preview URL + Get Client Documents (simpler MS Graph usage)
- **4b:** Get Pending Classifications + Review Classification (complex logic + file operations)

---

## Expected Performance Improvement

| Endpoint | Current (n8n) | Expected (Worker) | Improvement |
|----------|---------------|-------------------|-------------|
| Get Client Documents | 3-5s | 800ms-1.5s | 3-4x faster |
| Get Pending Classifications | 4-6s | 1-2s | 3-4x faster |
| Get Preview URL | 2-3s | 500ms-1s | 3-4x faster |
| Review Classification | 3-6s | 1-2s | 2-3x faster |

MS Graph calls add 200-500ms each (irreducible network latency), but removing n8n overhead still yields significant improvements. The batch endpoint ($batch) is particularly efficient.
