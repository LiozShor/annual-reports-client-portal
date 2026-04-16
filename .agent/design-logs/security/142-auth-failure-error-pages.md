# DL-142: Auth Failure Error Pages for WF-03

**Date:** 2026-03-10
**Status:** Implemented
**Triggered by:** DL-140 testing — white screens on auth failures

## Problem

WF-03 (`[3] Approve & Send`) Verify Token node used `throw` for auth failures. Since no error handler caught these, the webhook returned no response → white screen for users.

## Solution

### 1. Verify Token Code Update
Replaced all 4 `throw` statements with `return` statements that include routing metadata:
- `ok: false` — signals auth failure
- `error: 'INVALID_TOKEN' | 'MISSING_PARAMS'` — error type
- `respond: 'json' | ''` — routing hint (Bearer path always 'json', hash path uses query param)
- `report_id` — for logging context

### 2. New Nodes Added (4)
- **IF Auth OK** — checks `$json.ok !== false`, routes true→IF Confirm, false→error branch
- **IF Respond JSON Auth** — checks `$json.respond === 'json'`
- **JSON Auth Error** — responds with `{ok: false, error}` + CORS headers (for admin panel fetch calls)
- **Auth Error Page** — redirects to `approve-confirm.html?result=error` (for browser navigation)

### 3. Connection Changes
- Rewired: Verify Token → IF Auth OK (was: Verify Token → IF Confirm)
- IF Auth OK true → IF Confirm (existing flow unchanged)
- IF Auth OK false → IF Respond JSON Auth → JSON Auth Error / Auth Error Page

## Node IDs
- IF Auth OK: `8e408f7b-aa95-4e99-a267-14f15d92f077`
- IF Respond JSON Auth: `e630c9dd-d11f-4646-9d54-68c87e17a286`
- JSON Auth Error: `afe04802-6ca5-42fa-9caf-7ec0937bdb91`
- Auth Error Page: `1ff24d00-b978-400f-82e5-9ef22d0967d0`

## Files Changed
- WF-03 `cNxUgCHLPZrrqLLa` — Verify Token code + 4 new nodes + rewired connections

## Bugfixes During Testing
1. Success returns initially lacked `ok: true` → IF Auth OK routed everything to error branch. Fixed by adding `ok: true` to both success returns.
2. IF Auth OK condition used `{type: "boolean", operation: "notEqual"}` which doesn't work in n8n strict mode. Fixed by using `{type: "boolean", operation: "true"}` (unary check).

## Verification
1. Invalid hash token (browser) → redirects to approve-confirm.html?result=error
2. No token (browser) → same error redirect
3. Invalid Bearer token (fetch) → `{ok: false, error: 'INVALID_TOKEN'}` JSON
4. Valid hash token → still works (no regression)
5. Valid Bearer token → still works (no regression)
