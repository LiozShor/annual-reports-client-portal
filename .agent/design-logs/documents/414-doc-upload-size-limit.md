# Design Log 414: Raise Doc Upload Size Limit (10 MB → 50 MB)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-14
**Related Logs:** DL-198 (introduced admin per-row upload + 10 MB cap), DL-367 (Gmail Drive smart-link inbound fetch + 25 MB cap)

## 1. Context & Problem

The doc-manager (and inbound email Drive-link path) currently rejects files over **10 MB** at the admin upload surface and **25 MB** on the inbound Drive smart-link path. Tax documents (scanned PDFs, contractor invoices, bank statements with embedded images) regularly exceed 10 MB, and the office hit the cap on a specific real-world upload that motivated this DL.

Raising the cap to **50 MB** removes the bottleneck without requiring infra changes (no MS Graph upload sessions, no browser-direct upload).

## 2. User Requirements

1. **Q:** Which upload surfaces to raise?
   **A:** Admin doc-manager (per-row, DL-198) **and** Inbound email Drive-link fetch path.
2. **Q:** What new limit?
   **A:** **50 MB** — bigger bump, still single-PUT (no Graph upload sessions).
3. **Q:** Trigger?
   **A:** A specific real-world file just hit the limit (concrete incident).
4. **Q:** UX after raising?
   **A:** Keep current Hebrew toast pattern, just update the number.

Out of scope: client portal upload path, MS Graph upload sessions, browser-direct uploads.

## 3. Research

### Domain

File-upload thresholds across the stack: Cloudflare Workers request body limits, MS Graph `driveItem` single-PUT cap, Exchange Online inbound attachment limits.

### Sources Consulted

1. **Cloudflare Workers — *Limits* (developers.cloudflare.com/workers/platform/limits)** — Free/Pro request body cap is **100 MB**, Business 200 MB, Enterprise 500 MB. At 50 MB we are at half the Pro ceiling, with comfortable headroom. No plan upgrade needed.
2. **MS Graph `driveItem: createUploadSession` + community Q&A (learn.microsoft.com)** — Official single-PUT cap is documented as 4 MB, but the *actual* SharePoint/Business OneDrive ceiling is **250 MB** for `PUT /drives/{id}/items/{parent}:/{name}:/content`. Microsoft *recommends* upload sessions for >10 MiB for resumability, but functional correctness holds without them on stable connections.
3. **Exchange Online attachment limits 2026 (sharepointdiary.com + smtp2go 2026 roundup)** — Default inbound = 36 MB, configurable to 150 MB. Base64 inflation adds ~33% wire overhead → real-world raw inbound ceiling on default config ≈ 26-27 MB. Our 50 MB internal cap is intentionally generous so Exchange itself is the binding constraint, not us.

### Key Principles Extracted

- **Server-side validation is the source of truth; client-side is UX only.** Both must match or users see confusing mismatches.
- **Match limits across all surfaces** (uniformity principle from the project's #1 rule). Admin toast number = Worker error number.
- **Don't claim "no limit" when downstream infra imposes one.** Document the real ceiling (CF body cap, Exchange inbound).

### Patterns to Use

- **Constant flip with derived error string.** Worker error message already reads `MAX_FILE_SIZE / 1024 / 1024` so changing the constant updates the user-visible error automatically.
- **Cache-bust on frontend constant change.** Bump `?v=NNN` in `frontend/document-manager.html` per the monolith cache-bust rule so browsers fetch the new JS.

### Anti-Patterns to Avoid

- **Removing the cap entirely.** Would push the failure mode downstream (CF 413 or Graph 413) with worse UX. Explicit caps with friendly Hebrew error are better.
- **Implementing chunked upload sessions for a single complaint.** Premature; multi-day work. Defer until repeated 30-50 MB failures appear in production.

### Research Verdict

50 MB is the right bump for this DL: doubles the headroom relative to default Exchange inbound, stays well under CF Workers 100 MB body cap, stays under Graph's actual 250 MB single-PUT ceiling. Four constants change; no architectural work.

## 4. Codebase Analysis

- **Existing Solutions Found:** Server validation at `api/src/routes/upload-document.ts:26-58`; client validation at `frontend/assets/js/document-manager.js:3103-3125`; inbound Drive-link cap at `api/src/lib/inbound/attachment-utils.ts:124`.
- **Reuse Decision:** No new code paths. Flip 4 constants + 1 toast string + 1 cache-bust version.
- **Relevant Files:**
  - `api/src/routes/upload-document.ts` — Admin upload endpoint, 10 MB cap line 26, error built dynamically line 57.
  - `frontend/assets/js/document-manager.js` — Doc-manager UI, 10 MB cap line 3103, Hebrew toast line 3123.
  - `api/src/lib/inbound/attachment-utils.ts` — Drive smart-link fetch, 25 MB cap line 124 (used by `fetchDriveAttachment`).
  - `frontend/document-manager.html:569` — `<script src="assets/js/document-manager.js?v=412">` cache-bust version.
- **Existing Patterns:** Two-sided validation (client UX + server enforcement) — already in place; we just adjust both numbers. Inbound `fetchAttachments` (regular MS Graph attachment list) has **no internal cap** — only Exchange Online's transport rules apply.
- **Alignment with Research:** Codebase matches the research-verdict approach. No deviation.
- **Dependencies:** Cloudflare Workers runtime, MS Graph API, Exchange Online inbound, OneDrive Business storage.

## 5. Technical Constraints & Risks

- **Security:** None. Larger files don't expand attack surface; auth + ext allowlist + filename sanitization remain identical.
- **Operational Risks:**
  - Single-PUT to Graph at 30-50 MB on a slow connection may time out. Microsoft recommends upload sessions >10 MiB — accepted; office is on a stable connection, escalate to a follow-up DL if real failures appear.
  - Worker memory: 50 MB raw `ArrayBuffer` + base64 decode + sha256 ≈ ~120 MB working set. Within Pro plan's 128 MB cap but tight. Inbound batches with multiple large attachments may OOM — watch the logs.
- **Breaking Changes:** None. Smaller files keep working identically. Existing 60+ MB rejections move from "the cap" to "the new cap" — same UX, just higher.
- **Mitigations:**
  - Monitor Worker logs for 30-60m post-deploy: `node scripts/query-worker-logs.mjs --since=60m --search="upload-document"`.
  - Test with the real-world file that triggered this DL before declaring done.
  - Keep upload-session refactor as a tracked future-work item, not a blocker.

## 6. Proposed Solution

### Success Criteria

Admin uploads a 12-45 MB file via doc-manager and the document row flips to `Received` with a OneDrive `file_url`. Files over 50 MB still rejected with toast `הקובץ גדול מדי (מקסימום 50MB)`.

### Logic Flow

1. Update client UI cap (`UPLOAD_MAX_SIZE`) + Hebrew toast text in `document-manager.js`.
2. Update Worker cap (`MAX_FILE_SIZE`) in `upload-document.ts` (server is source of truth).
3. Update inbound Drive cap (`DRIVE_DEFAULT_MAX_BYTES`) in `attachment-utils.ts`.
4. Bump `?v=412` → `?v=413` on `<script>` tag in `document-manager.html`.
5. Deploy Worker via `bash .claude/workflows/deploy-worker.sh`.
6. Pages auto-deploys on push to main (DL-377 confirmed); verify via curl that new JS version serves.

### Data Structures / Schema Changes

None.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/upload-document.ts` | Modify | Line 26: `10 * 1024 * 1024` → `50 * 1024 * 1024` (comment to `// 50 MB`). |
| `frontend/assets/js/document-manager.js` | Modify | Line 3103: `10 * 1024 * 1024` → `50 * 1024 * 1024` (comment to `// 50 MB`). Line 3123: toast `10MB` → `50MB`. |
| `api/src/lib/inbound/attachment-utils.ts` | Modify | Line 124: `26_214_400` → `52_428_800` (comment to `// 50 MB`). |
| `frontend/document-manager.html` | Modify | Line 569: `?v=412` → `?v=413`. |

### Final Step

- Update DL status to `[IMPLEMENTED — NEED TESTING]`.
- Update `.agent/design-logs/INDEX.md` with DL-414 entry.
- Copy unchecked Section 7 items to `.agent/current-status.md` under Active TODOs.
- Invoke `git-ship` for commit (push to feature branch; user approves merge-to-main).

## 7. Validation Plan

- [ ] Worker build: `cd api && npx wrangler deploy --dry-run -c wrangler.toml` shows clean compile, no TS errors.
- [ ] Worker deployed: `curl -s https://annual-reports-api.liozshor1.workers.dev/health` returns 200.
- [ ] Cache-bust live: `curl -sI https://docs.moshe-atsits.com/document-manager.html | grep -o 'document-manager.js?v=[0-9]*'` → `?v=413`.
- [ ] Deployed JS reflects new constant: `curl -s https://docs.moshe-atsits.com/assets/js/document-manager.js | grep -o 'UPLOAD_MAX_SIZE = [0-9 *]*'` → shows `50 * 1024 * 1024`.
- [ ] Admin doc-manager test — upload a 12 MB file. Expect: upload succeeds, doc flips to Received, OneDrive `file_url` set.
- [ ] Admin doc-manager test — upload a 45 MB file. Expect: upload succeeds (may take 15-30 s).
- [ ] Admin doc-manager test — upload a 60 MB file. Expect: rejected with toast `הקובץ גדול מדי (מקסימום 50MB)`.
- [ ] **Specific real-world file** that triggered this DL — confirm end-to-end success.
- [ ] Inbound regression — forward a small test attachment (~2 MB) to `reports@moshe-atsits.co.il`. Expect: no regression on the Drive-link path.
- [ ] Activity log: `node scripts/query-worker-logs.mjs --since=30m --search="upload-document"` shows `doc_upload` events with new `file_size` values.

## 8. Implementation Notes

**Implemented 2026-05-14 in one commit:**

- Four constants flipped exactly per the plan; no deviations.
- `api/src/routes/upload-document.ts:26` — `MAX_FILE_SIZE` 10 MB → 50 MB (DL-414 tag). Worker error string at `:57` derives from this constant, so user-visible HTTP 400 text updates automatically without a second edit.
- `frontend/assets/js/document-manager.js:3103` — `UPLOAD_MAX_SIZE` 10 MB → 50 MB; toast at `:3123` updated `10MB` → `50MB`.
- `api/src/lib/inbound/attachment-utils.ts:124` — `DRIVE_DEFAULT_MAX_BYTES` 25 MB → 50 MB (Drive smart-link fetch path only; regular MS Graph `fetchAttachments` has no internal cap and was not touched).
- Cache-bust: `frontend/document-manager.html:569` `?v=412` → `?v=413`.
- Build check: `cd api && CLOUDFLARE_API_TOKEN="" npx wrangler deploy --dry-run -c wrangler.toml` → clean (2324 KiB upload, no TS errors).

**Research principles applied:**
- *Server is source of truth* — bumped Worker cap in same commit as client toast so the two never disagree.
- *Don't claim "no limit"* — kept an explicit 50 MB ceiling with friendly Hebrew error rather than removing the check and letting CF or Graph 413 surface raw.
- *Defer chunked uploads* — anti-pattern of building MS Graph upload sessions for a single complaint avoided; tracked as future work.

**Deferred / future work:**
- MS Graph upload sessions (chunked, resumable) if 30-50 MB single-PUTs flake on slow connections.
- Client portal upload path — separate code, not requested in this DL.
- Browser-direct upload bypassing the Worker if memory pressure becomes a problem (Workers Pro 128 MB cap is tight at 50 MB raw + working set).
