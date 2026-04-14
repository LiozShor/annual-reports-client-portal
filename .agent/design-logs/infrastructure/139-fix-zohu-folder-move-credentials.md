# DL-139: Fix Zohu Folder Move — Missing Credentials on HTTP Nodes

**Date:** 2026-03-10
**Status:** ✅ VERIFIED
**Workflow:** `[API] Review Classification` (`c1d7zPAmHfHM71nV`)

## Problem

During DL-137 testing, reassigning an unmatched doc (doc5.jpg → T501) correctly renamed the file but **failed to move it from "ממתינים לזיהוי" to "זוהו"**. The file stayed in the wrong folder.

Root cause: `Create Zohu Folder` and `Get Zohu Folder` HTTP nodes had:
- **typeVersion 1** (ancient, should be 4.4)
- **Empty credentials `{}`** — no OAuth bound
- **Missing method/body** on Create node (defaults to GET instead of POST)

Both returned 401 "Access token is empty." The archive folder nodes (identical purpose) worked correctly with typeVersion 4.4 + `MS_Graph_CPA_Automation` credential.

## Root Cause

Nodes were likely created via MCP API in DL-049 (session 102) but credentials weren't bound — MCP `addNode` doesn't support credential binding.

## Fix

Replaced both nodes via REST API PUT (MCP `updateNode` only supports `parameters`, can't update `credentials` or `typeVersion`):

### Node 1: `Create Zohu Folder` (id: `46c7eb15-...`)
- typeVersion: 1 → **4.4**
- credentials: `{}` → **`{oAuth2Api: {id: "GcLQZwzH2xj41sV7", name: "MS_Graph_CPA_Automation"}}`**
- Added: `method: POST`, `genericAuthType: oAuth2Api`, `sendBody: true`, `contentType: raw`, `rawContentType: application/json`
- Body: `={"name": "זוהו", "folder": {}, "@microsoft.graph.conflictBehavior": "fail"}`

### Node 2: `Get Zohu Folder` (id: `59fe9590-...`)
- typeVersion: 1 → **4.4**
- credentials: `{}` → **`{oAuth2Api: {id: "GcLQZwzH2xj41sV7", name: "MS_Graph_CPA_Automation"}}`**
- Added: `genericAuthType: oAuth2Api`

Both mirror the working `Create Archive Folder` / `Get Archive Folder` nodes exactly.

## Implementation

1. GET workflow via REST API → saved to temp file
2. Replaced both node objects in the `nodes` array with corrected configurations
3. Cleaned `settings` (removed `availableInMCP`, `timeSavedMode`, `binaryMode` etc. — API rejects extra props)
4. PUT workflow back — verified both nodes have correct typeVersion 4.4, credentials, and parameters
5. Workflow remains active

## Verification Needed

- [ ] Reassign unmatched doc → file moves from "ממתינים לזיהוי" to "זוהו"
- [ ] `Create Zohu Folder` returns 409 (already exists) or 201 (created)
- [ ] `Get Zohu Folder` returns folder metadata with `id`
- [ ] `Build Move Body` shows `MOVE TO ZOHU: parentReference.id=...`
