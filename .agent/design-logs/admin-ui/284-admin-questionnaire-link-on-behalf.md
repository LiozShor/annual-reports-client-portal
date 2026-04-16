# Design Log 284: Admin "Fill Questionnaire on Behalf of Client" Link
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-16
**Related Logs:** [152-move-view-as-client-to-row-menu.md](152-move-view-as-client-to-row-menu.md), [124-dashboard-actions-menu-revamp.md](124-dashboard-actions-menu-revamp.md), [064-fix-type-a-questionnaire-link.md](../reminders/064-fix-type-a-questionnaire-link.md), [073-type-a-single-cta-mirror-wf01.md](../email/073-type-a-single-cta-mirror-wf01.md), [090-hmac-token-architecture.md](../security/090-hmac-token-architecture.md)

## 1. Context & Problem
Some elderly clients cannot fill the Tally questionnaire themselves — they ask the office to fill it on their behalf. Today, the office has no one-click way to reach the client's questionnaire landing page from the admin dashboard:
- The existing right-click menu item **"צפייה כלקוח"** (`viewClient`) goes to `view-documents.html`, not the questionnaire form.
- Staff would have to dig up the email the system sent and copy the landing-page URL.

**Goal:** Add a right-click context-menu item on the client row — **"מלא שאלון במקום הלקוח"** — that mints a short-TTL client token, opens the landing page in a new tab with an `assisted=1` flag, displays a visible "assisted mode" banner on the landing page, and writes an audit row via the existing `logSecurity` mechanism.

## 2. User Requirements
1.  **Q:** Which URL should the admin link open — landing page with HE/EN picker, direct Tally, or both?
    **A:** Landing page (HE/EN picker) — same experience the client gets by email.
2.  **Q:** What happens when the admin clicks the menu item — open new tab, copy to clipboard, or both?
    **A:** Open in new tab.
3.  **Q:** For which client stages should the menu item appear?
    **A:** Only stages 1–2 (`Send_Questionnaire`, `Waiting_For_Answers`) — hide after submission.
4.  **Q:** What Hebrew label?
    **A:** "מלא שאלון במקום הלקוח" (Fill questionnaire on behalf of client).

## 3. Research
### Domain
Admin impersonation / "act on behalf of user" UX and security patterns.

### Sources Consulted
1. **Stripe Engineering / Connect docs** — Every impersonated API call is logged with the support agent's identity alongside the account ID.
2. **Auth0 Blog — "The Impersonation Pattern"** — Recommends separate impersonation tokens with a distinct `act` claim (RFC 8693), short TTL, and always-visible banner. Warns against reusing the user's own token.
3. **Google SRE "Building Secure and Reliable Systems"** (Ch. 5 & 21) — "Tool-proxy" pattern: privileged actions go through a logged proxy that records *who*, *what*, *why*.
4. **Salesforce "Login As"** — Banner at top of every page, session-scoped, auto-logged to Setup Audit Trail.
5. **OWASP ASVS v4 §V7 (Logging)** — Requires logging of "use of higher-risk functions" including on-behalf-of operations with actor identity distinct from subject identity.

### Key Principles Extracted
- **Actor ≠ subject separation:** the existing HMAC client token identifies the *client* (subject); the audit log must also record the *admin* (actor). A single combined token isn't enough.
- **Short-TTL, purpose-bound token:** don't reuse the client's 45-day email token. Mint a fresh, time-limited token for the assisted session.
- **Visible assisted-mode indicator:** staff forgets they're in client context unless the UI reminds them. A non-dismissible banner on the landing page is standard.
- **Irrefutable audit trail:** even for benign assistance, log actor + subject + action + timestamp. Protects staff from disputes ("I never filled that form").

### Patterns to Use
- **Token Exchange (lightweight):** admin-auth'd endpoint mints a new client token (24h TTL via existing `generateClientToken(reportId, secret, ttlDays)`).
- **Impersonation Banner:** persistent banner at top of `#content` on the landing page when `assisted=1`.
- **Audit via existing `logSecurity`** (`api/src/lib/security-log.ts`): `severity: 'INFO'`, `event_type: 'ADMIN_ASSISTED_OPEN'`. No new infrastructure needed.
- **Pre-action confirm modal** (`showConfirmDialog`): explicit "this will be logged" message.

### Anti-Patterns to Avoid
- **Reusing the 45-day client token** for admin access (breaks actor/subject separation; admin traffic indistinguishable from client in logs).
- **Silent open with no confirmation or audit** — no accountability.
- **Banner-less landing page** — admin may forget they're assisting and type own identifiers.
- **Passing `assisted=1` through to Tally** — would clutter downstream payload. UI-only flag; consumed on landing, never forwarded.

### Research Verdict
Apply the 80/20: fresh short-TTL token + audit row + landing-page banner + confirm modal. Defer full RFC 8693 `act` claim and Tally-submission stamping — overkill for a 5-person office. The audit log, banner, and confirm modal cover the realistic failure modes (accidental mis-filling, disputed actions, forgotten assisted mode).

## 4. Codebase Analysis
### Existing Solutions Found
- **`generateClientToken(reportId, secret, ttlDays)`** at `api/src/lib/client-token.ts:78` — already supports custom TTL via 3rd arg. Reusable as-is.
- **`verifyToken(body.token, c.env.SECRET_KEY)`** pattern for admin auth — mirrored from `api/src/routes/send-questionnaires.ts:33`.
- **`logSecurity(ctx, airtable, fields)`** at `api/src/lib/security-log.ts:5` — supports `severity: 'INFO'` per `SecurityLogFields` interface. Reusable as-is.
- **`getClientIp(headers)`** at `api/src/lib/security-log.ts:18` — reusable.
- **`openClientContextMenu(e)`** at `frontend/admin/js/script.js:6874` — existing right-click menu; just adds one conditional item.
- **`showConfirmDialog`, `showLoading`, `hideLoading`, `showAIToast`, `fetchWithTimeout`, `authToken`, `ENDPOINTS`** — all existing admin-panel helpers.
- **Landing page query-param stripping** at `frontend/assets/js/landing.js:15` (`history.replaceState(null, '', window.location.pathname)`) — strips all query params immediately. Must read `assisted` BEFORE this call.

### Reuse Decision
100% reuse of existing helpers. One new worker route file, one new frontend function, one new landing-page conditional, one new CSS block, one new `ENDPOINTS` entry. No new abstractions or shared utilities.

### Relevant Files
| File | Why examined |
|------|--------------|
| `api/src/routes/send-questionnaires.ts` | Admin-auth + stage-guard pattern |
| `api/src/routes/approve-and-send.ts` | `logSecurity` + `getClientIp` usage |
| `api/src/lib/client-token.ts` | Token minting signature |
| `api/src/lib/security-log.ts` | Audit log helper |
| `api/src/index.ts` | Route registration pattern |
| `frontend/shared/endpoints.js` | Endpoint constants |
| `frontend/assets/js/landing.js` | Query parsing + UI render |
| `frontend/assets/css/landing.css` | Landing styles |
| `frontend/admin/js/script.js` | `openClientContextMenu` + `viewClient` |
| `frontend/assets/js/resilient-fetch.js` | `FETCH_TIMEOUTS` keys |

### Existing Patterns
- All admin-authenticated POST endpoints follow: `verifyToken(body.token, SECRET_KEY)` → validate input → mutate / mint → `logSecurity` on failure → `logError` in try/catch → JSON response.
- Frontend calls admin endpoints via `fetchWithTimeout(ENDPOINTS.X, {method, headers, body: JSON.stringify({token: authToken, ...})}, FETCH_TIMEOUTS.mutate)`.
- Context-menu items use string concat with `onclick` handlers, Lucide icons, Hebrew labels.

### Alignment with Research
- Our existing `logSecurity` + `SecurityLogFields` already separates `actor`, `subject` (via `details`), `endpoint`, and timestamp — aligns with OWASP ASVS §V7 out of the box.
- `generateClientToken` already supports short TTL — no need to add a new "assisted token" type; we just pass `ttlDays=1`.
- `showConfirmDialog` + `showAIToast` match the Intercom "confirm before acting as user" pattern.
- Landing page already strips URL params (SEC-004) — aligns with "no token in URL bar" best practice.

### Dependencies
- Airtable table `security_logs` (existing)
- Airtable `Reports` table (existing) — stage check
- `CLIENT_SECRET_KEY`, `SECRET_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_PAT` env vars (existing)

## 5. Technical Constraints & Risks
* **Security:** Admin auth gates token minting — no unauthenticated issuance. The minted client token is a real 24h token and could be forwarded; TTL limits blast radius. Audit log records every issuance.
* **PII:** `details` field logs `client_name` — already the case for other security log rows.
* **Risks:**
  - Admin could be confused which client they're assisting if they open multiple tabs. Mitigated by banner showing client name.
  - `FETCH_TIMEOUTS` has no `default` key — use `mutate` (15s).
* **Breaking Changes:** None. Purely additive — new route, new UI item, one conditional render branch on landing page.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Admin right-clicks an active client on stages 1–2, clicks "מלא שאלון במקום הלקוח", confirms the modal, a new tab opens the landing page with a visible "assisted mode" banner, and a `security_logs` row with `event_type=ADMIN_ASSISTED_OPEN` is created.

### Logic Flow
1. Admin right-clicks a client row → `openClientContextMenu` renders menu; if stage ∈ {`Send_Questionnaire`, `Waiting_For_Answers`}, include the new item.
2. Admin clicks item → `openAssistedQuestionnaire(reportId, clientName)` → `showConfirmDialog` prompts "פתח שאלון במקום הלקוח <name>? הפעולה תירשם ביומן המערכת."
3. On confirm → `showLoading('מכין קישור...')` → POST to `/webhook/admin-assisted-link` with `{token: authToken, report_id}`.
4. Worker: verify admin token → fetch report → stage guard (1/2 only) → mint 24h client token → `logSecurity` INFO row → return `{ok, url}`.
5. Frontend: `window.open(url, '_blank', 'noopener,noreferrer')`.
6. Landing page loads: parses `assisted=1` from URL, strips all query params (existing SEC-004 behavior), stores `assistedMode = true` in module scope, renders persistent yellow banner above content.

### Data Structures / Schema Changes
None. Uses existing `security_logs` Airtable table:
```json
{
  "timestamp": "2026-04-16T10:30:00.000Z",
  "event_type": "ADMIN_ASSISTED_OPEN",
  "severity": "INFO",
  "actor": "admin-token",
  "actor_ip": "X.X.X.X",
  "endpoint": "/webhook/admin-assisted-link",
  "http_status": 200,
  "details": "{\"report_id\":\"recXXX\",\"client_name\":\"...\"}"
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/admin-assisted-link.ts` | Create | New Hono route POST `/admin-assisted-link` |
| `api/src/index.ts` | Modify | Import + mount under `/webhook` |
| `frontend/shared/endpoints.js` | Modify | Add `ADMIN_ASSISTED_LINK` constant |
| `frontend/assets/js/landing.js` | Modify | Parse `assisted=1` pre-strip; render banner when set |
| `frontend/assets/css/landing.css` | Modify | Add `.assisted-banner` styling |
| `frontend/admin/js/script.js` | Modify | Add menu item + `openAssistedQuestionnaire` function |

### Final Step (Always)
Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 items to `.agent/current-status.md` under "Active TODOs".

## 7. Validation Plan
* [ ] Right-click on a `Send_Questionnaire` client → new menu item appears
* [ ] Right-click on a `Waiting_For_Answers` client → new menu item appears
* [ ] Right-click on a `Pending_Approval` (stage ≥ 3) client → item is NOT shown
* [ ] Right-click on an archived client → item is NOT shown
* [ ] Click item → Hebrew confirm dialog appears with correct client name
* [ ] Confirm → loading spinner, then new tab opens with landing page
* [ ] Landing page shows yellow "assisted mode" banner at top
* [ ] Language picker works (HE/EN); clicking redirects to Tally with all params prefilled
* [ ] URL bar on landing page has no query params (stripped by existing `history.replaceState`)
* [ ] Tally form pre-fills client name / email / year correctly
* [ ] `security_logs` Airtable has a new `ADMIN_ASSISTED_OPEN` row with correct `actor_ip`, `details`
* [ ] Token TTL is 24h (decode `expiryUnix` in returned URL, confirm ≈ now + 86400s)
* [ ] Cancel on confirm dialog → no network call, no new tab
* [ ] Bad `report_id` → red Hebrew toast, no crash
* [ ] Stage-guard: if somehow called from a stage-3+ client (e.g. via console) → worker rejects cleanly with Hebrew error toast

## 8. Implementation Notes (Post-Code)
* **Research principles applied:**
  - *Actor ≠ subject separation* (Auth0, OWASP ASVS): logged admin IP via `getClientIp` into `security_logs` row; report_id + client_name stored in `details` as the subject.
  - *Short-TTL purpose-bound token* (Auth0): minted new token via `generateClientToken(reportId, CLIENT_SECRET_KEY, 1)` — 24h TTL vs the 45d default, reusing the existing 3rd parameter.
  - *Visible assisted-mode indicator* (Salesforce): persistent yellow banner inserted as sibling of `#content` (not inside it) so subsequent `innerHTML` replacements don't wipe it.
  - *Irrefutable audit trail* (Google SRE): `logSecurity` INFO row created on every successful issuance (`event_type=ADMIN_ASSISTED_OPEN`).
  - *Pre-action confirm* (Intercom): `showConfirmDialog` warns "הפעולה תירשם ביומן המערכת" before any network call.
* **Deviations from plan:**
  - `FETCH_TIMEOUTS.default` does not exist — used `FETCH_TIMEOUTS.mutate` (15s), which matches the pattern used by other admin POST endpoints that do server-side work.
  - Client-name lookup in the worker wrapped in a non-fatal `try/catch`: if the client record can't be read, the audit row just omits the name — the main flow (token minting + URL return) still succeeds.
  - Banner Hebrew copy stored as `\uXXXX` escapes in the JS source to match the existing codebase convention (`landing.js` already uses `\uD83D\uDCCB` etc. for emoji + Hebrew).
* **Files changed:**
  - `api/src/routes/admin-assisted-link.ts` (new, ~100 lines)
  - `api/src/index.ts` (+2 lines — import + mount)
  - `frontend/shared/endpoints.js` (+1 line)
  - `frontend/assets/js/landing.js` (+20 lines — `assistedMode` const + `renderAssistedBanner` function + one call in `init`)
  - `frontend/assets/css/landing.css` (+23 lines — `.assisted-banner` styles)
  - `frontend/admin/js/script.js` (+31 lines — one menu-item branch + `openAssistedQuestionnaire` function)
* **Worker typecheck:** `npx tsc --noEmit` in `api/` passes cleanly for the new file. Two pre-existing errors exist in `backfill.ts` and `classifications.ts`, unrelated to this work.
