# Secret Rotation Runbook — 2026-05-02

**Trigger:** Public-repo audit found 8 hardcoded secrets in `docs/multi-tenant-audit.md`. Doc is now redacted in working tree, but values are live in n8n workflows + Worker secrets and were exposed in commit `cae8a3c1` (still in git history). Rotating live values neutralizes the leak.

**Scope:** Rotating 7 of 9 known leaked credentials. Skipping `reports3737!` (admin password) per user decision.

**How we work:** I tell you what to do. You generate the new value (or paste what the provider returns). I update the corresponding store(s), verify, then we move to the next.

**Order is deliberate** — internal/Worker-side keys first (low blast radius), then base credentials (Airtable, Anthropic), then the user-visible things (client tokens) last so we don't disrupt clients mid-rotation.

---

## Pre-flight (do once, before step 1)

- [ ] Stop any other Claude/IDE session writing to this repo (multi-tab safety).
- [ ] In **canonical clone** `C:\Users\liozm\Desktop\moshe\annual-reports`, on `main`, confirm the redaction edits to `docs/multi-tenant-audit.md` are committed and pushed. If not, we'll commit them on a feature branch first.
- [ ] Source `.env`: `source C:/Users/liozm/Desktop/moshe/annual-reports/.env`
- [ ] Confirm n8n MCP is connected (we'll edit Code nodes via MCP).
- [ ] Have these tabs open: n8n editor (`liozshor.app.n8n.cloud`), Cloudflare dash (Workers → Settings → Variables and Secrets), Airtable (Builder Hub → PATs), Anthropic console.

---

## Step 1 — N8N_INTERNAL_KEY (`0d1a9b04f3c2…`)

**Why first:** Lowest blast radius. Worker↔n8n internal calls only. Easy to verify with one curl.

**Where it lives:**
- Cloudflare Worker secret `N8N_INTERNAL_KEY` (annual-reports-api).
- n8n Code node `Parse & Verify` in workflow `[API] Send Batch Status` (id `QREwCScDZvhF9njF`).
- n8n HTTP node `Forward to Worker` in `[05] Inbound Processing` (in active version, replacing `[ARCHIVED] Inbound Doc Processing`).

**You do:**
1. Generate a new 32-char hex random: in PowerShell run
   ```
   -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
   ```
2. Paste the new value here. **Don't put it anywhere else yet.**

**I'll do:**
3. Update n8n Code node first (so n8n starts accepting both old and new for a few seconds is impossible — single source of truth, just update n8n side first means Worker's old key briefly fails until step 4).
4. Update Worker: `CLOUDFLARE_API_TOKEN="" npx wrangler secret put N8N_INTERNAL_KEY -c wrangler.toml` from `api/`.
5. Verify: trigger one Worker→n8n batch-status call (we'll pick one safe report) and confirm 200.

- [x] **Done — 2026-05-02 ~16:00 UTC.** New value: ✓ ROTATED (len=64, prefix `rCZ1`, URL-safe base64). Old value `0d1a9b04…` no longer present in either workflow nor Worker. Verified Worker accepts new Bearer (202) and rejects old (401). Live Worker→n8n curl skipped because `[API] Send Batch Status` was inactive at rotation time — confirmed via PUT readback (new key in `Parse & Verify` jsCode). Outage window n8n→Worker: ~7s. **`.env` line `N8N_INTERNAL_KEY=` updated to new value (Fix #1, applied 2026-05-02 ~16:10 UTC) — local scripts now use new key. .env stays gitignored.**

---

## Step 1.5 — Delete dead `[API] Send Batch Status` workflow (DL-194 cleanup)

**Why:** Per DL-194 (2026-03-26) the entire batch-status feature was removed (Worker route + frontend deleted, n8n workflow deactivated but not deleted). The dead workflow was still holding plaintext copies of `SECRET_KEY` (Step 2), Airtable PAT #2 (Step 4), and the now-rotated `N8N_INTERNAL_KEY`. Deleting it shrinks the rotation surface and removes a future leak vector.

**Pre-delete checks (2026-05-02):**
- `n8n_get_workflow QREwCScDZvhF9njF` → `active: false` ✅
- `grep -rn "batch-status\|QREwCScDZvhF9njF" api/src` → zero matches ✅
- Deactivated since 2026-03-26, today 2026-05-02 → >7 days ✅

**Action:** `n8n_delete_workflow QREwCScDZvhF9njF` → confirmed deleted; readback returns `NOT_FOUND` ✅.

- [x] **Done — 2026-05-02.** Workflow `[API] Send Batch Status` (id `QREwCScDZvhF9njF`) permanently deleted from n8n. Steps 2 and 4 footprint reduced (see strikethroughs below).

---

## Step 2 — Worker `SECRET_KEY` (HMAC, was `QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_`)

**Why second:** Forging admin tokens. Rotating this **logs out every active admin session**. Do during low-activity window.

**Where it lives:**
- Cloudflare Worker secret `SECRET_KEY`.
- ~~n8n Code node `Parse & Verify` in `[API] Send Batch Status` (same node as step 1).~~ — workflow deleted in Step 1.5.
- n8n Code node `Verify Admin Token` in `[04] Document Edit Handler` (id `y7n4qaAUiCS4R96W`).

**You do:**
1. Generate a 32-char random with mixed case + symbols (or a 48-char base64): in PowerShell
   ```
   [Convert]::ToBase64String((1..32 | %{Get-Random -Maximum 256}))
   ```
2. Paste the new value here.

**I'll do:**
3. `wrangler secret put SECRET_KEY` on Worker.
4. Update both n8n Code nodes via MCP `n8n_update_partial_workflow`.
5. Verify: log in to admin panel with current session → confirm logged out → re-login works.

- [x] **Deployed — 2026-05-02 ~16:07 UTC.** New value: ✓ ROTATED (len=44, prefix `e54j`, base64 with `=` padding). n8n `[04] Document Edit Handler` `Verify Admin Token` updated (PUT 200, 1 replacement, old absent in readback). Worker secret `SECRET_KEY` put successfully. n8n→Worker cutover gap: 6s (16:07:14 → 16:07:21 UTC). **Pending live verification: user to re-login to admin panel.**

---

## Step 3 — Airtable PAT #1 (was `pat2XQGRyzPdycQWr.…`)

**Where it lives:**
- n8n Code/HTTP nodes in: `[07] Daily Natan Digest`, `[MONITOR] Security Alerts`, `[MONITOR] Log Cleanup`.
- Possibly also n8n Credential store under a name like "Airtable Annual Reports" — we'll check.

**You do:**
1. Airtable → Builder Hub → Personal access tokens.
2. **Find the existing one** (likely named "Annual Reports CRM" or similar; first 16 chars `pat2XQGRyzPdycQWr`). Note its **scopes** — write them down before revoking.
3. Click **Regenerate token** (preferred — keeps the same name and scope assignments). Or create a new one with the same scopes if regenerate isn't available.
4. **Suggested minimum scopes:** `data.records:read`, `data.records:write`, `schema.bases:read`. Drop `schema.bases:write` unless something actually uses it.
5. Paste the new token here. (Format: `pat<16chars>.<64-char-hex>`).

**I'll do:**
6. Update each of the 3 n8n workflows via MCP — replace the `AT_KEY` constant in each Code node and the `Authorization` header in each HTTP node.
7. Verify: trigger a Daily Natan Digest manual run (or wait for next 15:00 cron); confirm Airtable queries return 200.

- [x] **Done — 2026-05-02 ~16:16 UTC.** Regenerated via Airtable Builder Hub (prefix kept `pat2XQGRyzPdycQWr.`, new suffix). 3 n8n workflows updated (PUT 200 each): `[07] Daily Natan Digest` (2 replacements), `[MONITOR] Security Alerts` (2 replacements), `[MONITOR] Log Cleanup` (3 replacements). All 3 PUTs completed in 2s window. `.env` `AIRTABLE_API_KEY` synced. Verified: live read against `reports` table with new PAT → 200 / 1 record; same read with old PAT → 401 UNAUTHORIZED (Airtable revoked old token on regenerate). Scopes per user: `data.records:read` + 8 more (full list not enumerated; preserved by Regenerate).

---

## Step 4 — Airtable PAT #2 (was `patvXzYxSlSUEKx9i.25f38a9e…`)

**Why separate from #3:** Different scope/use. Used by inbound + questionnaire processing flows.

**Where it lives:**
- n8n Code nodes in `[02] Questionnaire Processing` (id `QqEIWQlRs1oZzEtNxFUcQ`)~~, `[API] Send Batch Status` (`QREwCScDZvhF9njF`)~~ — Send Batch Status workflow deleted in Step 1.5.
- Cloudflare Worker secret `AIRTABLE_PAT` (this is the Worker-side copy that hits Airtable from the API).
- Local untracked `docs/wf05-backup-pre-migration-2026-03-26.json` — gitignored, but the secret in there will become invalid (good, that's the point).

**You do:**
1. Same flow as Step 3 — find the PAT prefixed `patvXzYxSlSUEKx9i`, regenerate.
2. Paste new token here.

**I'll do:**
3. `wrangler secret put AIRTABLE_PAT` on Worker.
4. Update n8n `[02] Questionnaire Processing` Code nodes via MCP (Send Batch Status is gone, see Step 1.5).
5. Verify: submit a test Tally questionnaire response → confirm `[02] Questionnaire Processing` runs green.

- [x] **Done — 2026-05-02 ~16:40 UTC** (initial deploy 16:21; full fix 16:40 after credential miss). Regenerated via Airtable Builder Hub (token-id prefix `patvXzYxSlSUEKx9i.` kept, new suffix). **Note 1:** the live pre-rotation suffix in `[02]` Code-node was `917c…`, NOT the runbook reference `25f38a9e…` — runbook reference was stale (an earlier silent rotation had occurred). **Note 2 (POST-MORTEM — agent error):** initial deploy only updated **inline Code-node** references; missed the n8n **Airtable credential** (`airtableTokenApi` id `ODW07LgvsPQySQxh`) which actually held PAT #2 and is shared across **6 active workflows**: `[02]`, `[04]`, `[06]`, `[06-SUB]`, `[07]`, `[SUB]`. When Airtable revoked the old PAT, all 6 workflows started 401-ing on Airtable v2 nodes (`Fetch Record`, etc.). User caught it on first Tally submission — execution `12896` failed with "Authorization failed" on `Fetch Record`. Agent then updated the credential via `n8n_manage_credentials.update` (with required `allowedHttpRequestDomains: "all"` schema field). Re-submission `12898` ran all 20 nodes green: Fetch Record ✅, all Airtable upserts ✅, Document Service ✅, MS Graph email send ✅. **Lesson for next rotation:** always enumerate `credentials` references inside every node's parameters, not just inline strings. Worker secret `AIRTABLE_PAT` put successfully. Cutover gap n8n↔Worker: 5s. .env update n/a (no `AIRTABLE_PAT` mirror in .env).

---

## Step 5 — Anthropic API key (was `sk-ant-api03-8Xzh…`)

**Where it lives:**
- Cloudflare Worker secret `ANTHROPIC_API_KEY` (used by `/admin/chat` proxy + AI classification + extract-issuer-names + Phase 9 chat agent).
- n8n HTTP node `Call Claude API` in `[07] Daily Natan Digest`.

**You do:**
1. console.anthropic.com → API Keys → find key starting `sk-ant-api03-8Xzh` → **Revoke**.
2. Click **Create Key**. Name it descriptively (e.g. `annual-reports-prod-2026-05-02`).
3. Copy the new key (one-time view) and paste it here.

**I'll do:**
4. `wrangler secret put ANTHROPIC_API_KEY` on Worker.
5. Update n8n `[07]` httpRequest node `Authorization` header via MCP.
6. Verify: hit `/admin/chat` from admin panel with a "hello" message → 200 with content.

- [x] **Done — 2026-05-02 ~16:25 UTC.** New key prefix `sk-ant-api03-6iSw…`, old `sk-ant-api03-8Xzh…` revoked. n8n `[07] Daily Natan Digest` updated (PUT 200, 1 replacement). Worker secret `ANTHROPIC_API_KEY` put. `.env` line 5 synced. Cutover gap n8n↔Worker: 5s. Initial verify caught a security gap — user had created new key without revoking the old one (old still 200). Flagged, user revoked, re-tested: new → 200 message, old → 401 `authentication_error`. Live `/admin/chat` UI verify deferred (out-of-band; Anthropic API direct verify already covered the secret).

---

## Step 6 — `CLIENT_SECRET_KEY` (was `db3f995dd145fa5d…`)

**⚠ User-visible blast.** Rotating this invalidates **every outstanding client portal link**. ~500 clients have links with up to 45-day TTL. New links go out automatically with the next reminder run, but anyone clicking an old link gets a 401.

**Decision point:** before doing this step, decide:
- **(a) Rotate now and accept clients will see broken links** until next reminder (24-48h on average).
- **(b) Defer this step.** Risk: anyone who has the leaked prefix `db3f995dd145fa5d` AND can find the rest can forge tokens for any client. Low practical risk (only 16 chars leaked, full key is 64 hex), but the leaked prefix in commit `cae8a3c1` is forever.

**My recommendation:** (b) defer for now, schedule for the start of a slow week. Add a calendar reminder.

If you choose (a):

**Where it lives:**
- Cloudflare Worker secret `CLIENT_SECRET_KEY`.
- n8n Code nodes `Build Type A Email` and `Build Type B Email` in `[06] Reminder Scheduler` (id `FjisCdmWc4ef0qSV`).
- n8n Code node in `[API] Send Batch Status` `Build Email`.

**You do:**
1. Generate a 64-char hex (PowerShell):
   ```
   -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
   ```
2. Paste here.

**I'll do:**
3. `wrangler secret put CLIENT_SECRET_KEY`.
4. Update 3 n8n Code nodes via MCP.
5. Verify: generate a fresh client link from admin → confirm clicking it works.

- [x] **DEFERRED — 2026-05-02.** Reason: ~400 outstanding client portal tokens from 2026-05-01 reminder run, signed with current `CLIENT_SECRET_KEY` and valid for 45 days. `api/src/lib/client-token.ts` has no key versioning — rotating now invalidates all 400 immediately, clients clicking reminder links get 401 INVALID_TOKEN on every gated endpoint. Leaked-prefix risk is acceptable: 16/64 hex chars exposed → attacker must brute-force the remaining 192 bits (2^192) to forge → computationally infeasible. **No .env change** (prod stays old, .env stays in sync with prod). See "Post-rotation cleanup" for the prerequisite work to enable rotation safely.

---

## Step 7 — MS Graph webhook `clientState` (was `wf05-inbound-secret`)

**Where it lives:**
- The MS Graph subscription itself (created via `/subscriptions` API, validates incoming notifications).
- n8n Code nodes that compare `notification.clientState` against the expected value, in active inbound flow.
- Worker handler if any path checks it (let me grep when we get here).

**You do:**
1. Pick a new opaque token (any random ≥16 chars, no special meaning):
   ```
   [Convert]::ToBase64String((1..16 | %{Get-Random -Maximum 256}))
   ```
2. Paste here.

**I'll do:**
3. Update n8n Code nodes that validate `clientState` — so they accept the **new** value.
4. Use Microsoft Graph API to **update** the subscription's `clientState` (`PATCH /subscriptions/{id}` — newer subs allow this; if not, delete + recreate).
5. Verify: send a test email to `reports@moshe-atsits.co.il` → confirm the inbound flow executes end-to-end (check activity logs).

- [x] **Done — 2026-05-02 ~16:48 UTC.** New value len=24, prefix `xpRz`. Final subscription id `7171bd0d-7169-4244-9466-e1c637604c9e`, expires `2026-05-05T16:47:29Z`. **Recovery story (agent made two wrong calls this step):**
  1. **Wrong call #1:** Initial `GET /subscriptions` via app-only client_credentials returned `[]` (app identity can't see delegated subs); user's Graph Explorer GET also returned `[]` (different identity scope). Agent concluded subscription was dead, tightened n8n `[05]` to new-only at ~16:36, and declared Step 7 done.
  2. **Detection:** User sent a test email at ~16:34. Execution `12895` showed Graph DID send notification with old `clientState=wf05-inbound-secret` against subscription id `e9e1fa40-1dde-402d-9e19-1fc4d975c4ab` — the subscription IS alive. `Extract Notification` rejected it (0 items output). Agent reverted [05] to dual-accept ([old, new]) at ~16:36 to restore inbound.
  3. **Wrong call #2:** Built temp workflow `K5fL37cEzV4tlBaR` to PATCH `clientState`. Graph 200'd but **silently ignored the field** — readback still showed old value. MS Graph subscriptions: `clientState` is **immutable post-creation**; only `expirationDateTime` is patchable. Side effect: subscription expiration extended 3 days to `2026-05-05`.
  4. **Recovery:** POST a new subscription with new clientState (returned id `7171bd0d…` 201 Created, validated [05] handshake successful). DELETE old subscription `e9e1fa40…` (204 No Content). Verified `GET /subscriptions` returned exactly 1 entry with the new id. Re-tightened n8n `[05]` to new-only (PUT 200, `wf05-inbound-secret` no longer accepted).
  5. Deactivated and deleted temp workflow `K5fL37cEzV4tlBaR`.
  6. Also scrubbed leaked value from `[05]` `pinData` sample payload (cosmetic).
- **Lessons for `MEMORY.md`:** (a) MS Graph subscription `clientState` is immutable — must DELETE+recreate, never assume PATCH works. (b) `GET /subscriptions` with app-only credential can't see user-delegated subs; check `creatorId` in notification payload (we found GUID `d821385d…` from the actual webhook execution). (c) Always check recent executions of a webhook-triggered workflow before declaring an inbound-flow secret "dead".
- **Follow-up TODO updated:** investigate WHO/WHAT renews the subscription. The previous instance (`e9e1fa40…`) was created by a deleted user (creator GUID `d821385d…` was a former office account?) and somehow auto-renewed. The new subscription (`7171bd0d…`) was created via the n8n `MS_Graph_CPA_Automation` OAuth2 credential — when this expires in 3 days, something needs to renew it. Otherwise inbound dies. Add scheduled n8n workflow to PATCH `expirationDateTime` daily.

---

## Skipped intentionally

- **Admin password `reports3737!`** — user decision (2026-05-02). Risk accepted: anyone with the leaked password can log into the admin panel until manually changed. Mitigation idea: enable IP allowlist on the admin endpoints (Worker-side check) so the password alone isn't enough. Tracked separately if you want.
- **OneDrive `DRIVE_ID`** — identifier, not a credential. No action.
- **Azure tenantId `1c7cac5b-…`** — public org identifier. Not rotatable.
- **OneDrive `ONEDRIVE_SHARING_TOKEN`** — leaked in `api/src/lib/inbound/attachment-utils.ts:7` (still in HEAD). Rotation = generate new sharing link from OneDrive UI + update constant + redeploy. Ask separately when ready.
- **MS Graph `MS_GRAPH_CLIENT_SECRET` / refresh token** — not directly leaked, hygiene only. Skip unless wanted.

---

## Post-rotation cleanup

After all steps above are ✓:

- [ ] Re-grep `docs/` for any of the OLD secret values to confirm none slipped past:
  ```
  git grep -E "QKiwUBXVH|reports3737|pat2XQGRyzPdycQWr|patvXzYxSlSUEKx9i|sk-ant-api03-8Xzh|db3f995dd145fa5d|0d1a9b04f3c2|wf05-inbound-secret"
  ```
- [ ] Commit `docs/multi-tenant-audit.md` redactions on a feature branch + PR.
- [ ] Decide on **history rewrite** (optional now that values are dead). If yes, run the `git filter-repo` plan we discussed.
- [ ] Migrate the secrets-in-Code-nodes to **n8n Credentials** so the next rotation doesn't require touching every workflow JSON. (Finding 24 in `multi-tenant-audit.md`.) Track as a separate DL.
- [ ] **MS Graph subscription auto-renewal (surfaced during Step 7, 2026-05-02):** New subscription `7171bd0d-7169-4244-9466-e1c637604c9e` expires `2026-05-05T16:47:29Z` (~3 days). MS Graph caps `messages` subscriptions at ≤3 days. Need a scheduled n8n workflow that runs daily, calls `PATCH /subscriptions/{id}` with `{expirationDateTime: now+3d-1m}` using `MS_Graph_CPA_Automation` OAuth2 cred. Without this, inbound email stops in 3 days. The PRIOR sub (`e9e1fa40…` created by GUID `d821385d…`) was somehow auto-renewing for weeks — investigate whether that mechanism still exists somewhere and update it for the new sub id, OR build a fresh renewal cron.
- [ ] **Prerequisite for `CLIENT_SECRET_KEY` rotation (Step 6, deferred 2026-05-02):** add key-versioning to `api/src/lib/client-token.ts` — verify incoming tokens against `[CLIENT_SECRET_KEY_NEW, CLIENT_SECRET_KEY_OLD]`, fall back to old for ≤45d after rollover, then drop the old key. Open a DL for the implementation. Once shipped, rotate `CLIENT_SECRET_KEY` aligned with the next reminder run so re-issued tokens propagate naturally and the 45-day overlap window covers all in-flight links.
- [ ] Delete `docs/wf05-backup-pre-migration-2026-03-26.json` from local disk (it's gitignored but contains a now-invalid PAT — still good hygiene to remove).
- [ ] Add a pre-commit gitleaks rule for inline-code Markdown patterns matching `(plaintext)` / `(plaintext in Code node)` near values ≥16 chars (so this kind of doc-style leak gets caught next time).
- [ ] **Optional: contribute `audit-doc-plaintext-marker` rule upstream to `gitleaks/gitleaks`.** Rationale: AI-generated audit/compliance docs that paste live secret values + label them "(plaintext)" / "(plaintext in Code node)" / "(real value)" are a real and growing leakage vector that the default gitleaks rule set doesn't cover. Open after Layer 9 lands and the audit script has been running clean for ≥1 week. Reference our 2026-05-02 incident (`docs/multi-tenant-audit.md` leak) as motivation.
- [ ] **Enable GitHub Push Protection** (Lioz to do — UI only): Settings → Code security → Secret scanning → Push protection → enable for `LiozShor/annual-reports-client-portal`. Free for public repos. Catches `sk-ant-`, `pat<X>.`, AWS, Slack, ~200 token formats at the push edge. This is the canonical defense for the 2026-05-02 leak vector — gitleaks/pii-guard catch on commit; Push Protection catches on push, server-side, even if local hooks were bypassed.

---

## Status tracker

| # | Secret | New value received? | n8n updated? | Worker updated? | Verified? | Notes |
|---|---|:-:|:-:|:-:|:-:|---|
| 1 | N8N_INTERNAL_KEY | ☑ | ☑ | ☑ | ☑ | 2026-05-02; 7s n8n→Worker outage during cutover; live Worker→n8n curl skipped (workflow inactive) — readback confirmed |
| 2 | SECRET_KEY (HMAC) | ☑ | ☑ | ☑ | ☑ | 2026-05-02 16:07; 6s cutover; user re-logged in successfully |
| 3 | Airtable PAT #1 | ☑ | ☑ | n/a | ☑ | 2026-05-02 16:16; 3 workflows updated; .env synced; 200 with new / 401 with old |
| 4 | Airtable PAT #2 | ☑ | ☑ | ☑ | ☑ | 2026-05-02 16:21 + cred fix 16:40; missed n8n cred ODW07LgvsPQySQxh on first pass (6 workflows broke); fixed via n8n_manage_credentials.update; verified by Tally re-submit exec 12898 (20/20 nodes green) |
| 5 | Anthropic key | ☑ | ☑ | ☑ | ☑ | 2026-05-02 16:25; old key initially missed revoke, caught and fixed; 200/401 confirmed |
| 6 | CLIENT_SECRET_KEY | — | — | — | — | **DEFERRED 2026-05-02** — 400 in-flight tokens; needs key-versioning in `client-token.ts` first. Tracked in Post-rotation cleanup. |
| 7 | MS Graph clientState | ☑ | ☑ | n/a | ☑ | 2026-05-02 16:48; sub IS live (creator=`d821385d`); PATCH silently ignored clientState (immutable); recovered via DELETE+POST; new sub `7171bd0d…` exp 2026-05-05; n8n tightened to new-only |

---

**Next action:** confirm pre-flight checklist, then start at Step 1. Paste the new `N8N_INTERNAL_KEY` value when ready.

---

## Lessons (post-rotation, 2026-05-02)

1. **n8n Credential store is a third surface.** Step 4 initially only updated inline `Code`-node literals; missed the `airtableTokenApi` credential `ODW07LgvsPQySQxh`, which 6 active workflows (`[02]`, `[04]`, `[06]`, `[06-SUB]`, `[07]`, `[SUB]`) depend on. Caught when the next Tally submission ran [02] — `Fetch Record` (Airtable v2 node) failed with `Authorization failed - please check your credentials`. Fixed via `n8n_manage_credentials.update` (schema requires `allowedHttpRequestDomains: "all"` alongside `accessToken`). For every n8n rotation, enumerate credential refs across all active workflows BEFORE declaring done. Saved to memory: `feedback_n8n_secret_rotation_credential_store.md`.
2. **MS Graph subscription `clientState` is immutable.** `PATCH /v1.0/subscriptions/{id}` 200's the request and silently drops the `clientState` field — only `expirationDateTime` is patchable. Recovery is DELETE the old subscription + POST a fresh one with the new clientState. Same OAuth credential, same notificationUrl, same resource — Graph runs the validation handshake against the n8n webhook automatically.
3. **Step 7 introduced a hard 3-day deadline.** New subscription `7171bd0d-7169-4244-9466-e1c637604c9e` expires `2026-05-05T16:47:29Z`. MS Graph caps `messages` subscriptions at ≤3 days. Without a renewal cron, inbound email stops at expiration. The previous subscription had been auto-renewing for weeks via an unknown mechanism; that mechanism is now decoupled (different sub id) and likely won't resume on its own.
4. **Step 6 deferred for sound reasons** — ~400 outstanding 45-day client portal tokens signed under current `CLIENT_SECRET_KEY`. `api/src/lib/client-token.ts` has no key versioning; rotating now invalidates every token immediately. Leaked-prefix risk acceptable (16/64 hex = 192 bits unbroken). Prerequisite: ship key-versioning (verify against `[NEW, OLD]`, 45d fallback) before next rotation.
5. **One-shot regression test for future rotations.** A single inbound email exercises Steps 1 + 4 + 5 + 7 simultaneously: MS Graph notification (Step 7 clientState) → n8n `[05]` → Worker `/webhook/process-inbound-email` (Step 1 Bearer) → AirtableClient (Step 4 PAT via `AIRTABLE_PAT` env) → AI classification (Step 5 Anthropic key). A single Tally submission additionally exercises Step 3 (PAT #1 via `[02]` Code-node literals) and Step 4 again (via Airtable v2 nodes that use the credential store). After any future rotation: send one email + submit one Tally form, watch executions for green. If both pass, the credential surfaces are clean.
6. **Pre-commit hooks that DID fire correctly through this rotation:** `gitleaks` + `ggshield` + `agent-pii-guard` + `script-size-ratchet` ran cleanly on every runbook commit and never blocked. The leak path that this rotation responded to (markdown-table plaintext markers in `docs/multi-tenant-audit.md`) was not caught — Phase 2 layers are designed to close that specific class of leak.
