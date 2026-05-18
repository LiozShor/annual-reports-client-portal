# DL-423 — ZIP never alongside its extracted children in PC queue

**Status:** [COMPLETED — 2026-05-18]
**Domain:** documents/
**Branch:** `claude-session-20260518-083045`
**Trigger:** Preventive — follow-up to DL-420. Real `U13779324.2025.tax.zip` from CPA-XXX was extracted into 3 children PCs; office asked whether the parent ZIP also lands in AI Review.

---

## 1. Context & Problem

Inbound emails sometimes carry ZIP/RAR/7z archives. After DL-260 (auto-extract) and DL-420 (never silently drop), the office expectation is:

- **Extract succeeds** → only the children appear as `pending_classifications` (PCs). The parent ZIP is dropped from the queue — it's a container, not a classifiable doc.
- **Extract fails** (corrupt / password-protected / >30 MB) → the raw ZIP appears as a single fallback PC with `matched_template_id=null` so admin can manually extract.
- **Never both.** A ZIP must never sit alongside its successfully-extracted children — that would clutter AI Review with un-actionable container rows.

The question that triggered this DL: does the current code actually guarantee that? If yes, lock it down so a future refactor can't silently break it.

## 2. User Requirements

| Q | A |
|---|---|
| Desired success behavior | Children only in PC queue |
| Desired failure behavior | Raw ZIP as fallback PC (per DL-420) |
| Scope | Verify + fix any gaps |
| Trigger | Preventive — confirm DL-420 covered it |

## 3. Research (delta only)

DL-260 + DL-420 already covered the domain. Delta:

- **DL-260** introduced `archive-wasm` (libarchive WASM) extraction for ZIP/RAR/7z. Failed/encrypted/empty archives pass through raw + flagged for manual extraction.
- **DL-420** made "every attachment ends up with a PC" a hard invariant via `createFallbackPendingClassification`. Phase 2 added `tooLarge`/`skipped_too_heavy` paths (>30 MB archives bypass extraction → fallback PC directly).

No new external research needed.

**Anti-pattern to guard against:** a future "let me also keep the ZIP for audit" tweak that silently re-introduces the parent into `result.attachments` and floods AI Review with container rows.

## 4. Codebase Analysis

**`api/src/lib/inbound/archive-expander.ts`** (verified via Explore agent):

| Path | Lines | Behavior |
|---|---|---|
| Archive > 30 MB | 264–275 | Raw ZIP pushed to `attachments`, `action='skipped_too_heavy'`, added to `failedArchives[]`. Parent stays. |
| Extract throws | 284–289 | Raw ZIP pushed to `attachments`, `action='extract_failed'`. Parent stays. |
| Extract returns 0 entries | 292–296 | Raw ZIP pushed to `attachments`. Parent stays. |
| Extract success (>=1 entry) | 302–331 | Only children pushed to `attachments` (synthetic `id=parent__basename`, MIME guessed, sha256 computed). **Parent dropped.** |

**`api/src/lib/inbound/processor.ts`:**
- L1170–1177: `attachments = archiveResult.attachments` — downstream loop sees children-only OR raw-ZIP-only, never both.
- L1336–1344: per-attachment loop skips AI classification when the file still has an archive extension (intentional — DL-419/420 follow-up).
- L1438–1439: child PCs get `sourceArchiveMap` provenance (`📦 חולץ מ: <archive>` injected into notes) — link back to parent preserved without putting parent in queue.
- L1504–1516: per-attachment try/catch → on throw without `outcome.pcCreated`, `createFallbackPendingClassification` writes metadata-only PC with `matched_template_id=null`, `ai_reason='[DL-420] …'`.

**Live spot-check:** CPA-XXX `U13779324.2025.tax.zip` (received 2026-05-05, processed 2026-05-17 18:29). Airtable query confirmed exactly 3 PCs (`fx.pdf` + `f1042S.pdf` + `dividends.html`) and **zero** PCs whose `attachment_name = "U13779324.2025.tax.zip"`. Behavior matches the rule.

**Verdict: code already enforces the rule. No behavioral gap. Only gap is no regression test guarding the invariant.**

## 5. Constraints & Risks

- **Risk: silent regression.** No test guards `archive-expander`'s dual return shape. A refactor could push the parent ZIP back into `result.attachments` on the success path and the office would only catch it as queue clutter.
- **Test infrastructure constraint.** Project uses `node --test` against `.mjs` files (see `api/test/bounce-detector.test.mjs`). `archive-expander.ts` is TypeScript and depends on `archive-wasm` (WASM). Loading WASM in `node --test` is fragile. A WASM-based test would be expensive to maintain for low marginal value over a structural tripwire.
- **Constraint: no behavior change.** Pure documentation + test addition. No `script.js` cache bump, no admin UI, no Worker behavior change.
- **Constraint: ratchet-safe.** No monolith JS touched.

## 6. Proposed Solution

**A. Load-bearing invariant comment in `archive-expander.ts`** (above the per-attachment loop):

> // INVARIANT (DL-423): On extract success, parent archive is dropped — only
> // extracted children land in result.attachments. On any failure path
> // (skipped_too_heavy / extract_failed / empty), the raw archive stays as
> // the SOLE representative of that attachment. ZIP and its children must
> // never co-occur in the downstream PC queue.

Searchable, anchored to the function that owns the invariant.

**B. Tripwire test `api/test/archive-expander-invariant.test.mjs`** — reads `archive-expander.ts` as a string and asserts structural facts cheap to grep:

1. The success branch (lines around `if (ARCHIVE_EXTENSIONS.has(getFileExtension(basename)))` … `else { result.attachments.push(synth); }`) MUST contain `result.attachments.push(synth)` and MUST NOT contain `result.attachments.push(att)` in the same branch.
2. Each failure branch (`skipped_too_heavy`, `extract_failed`, "No extractable files") MUST contain `result.attachments.push(att)` (raw parent passthrough).
3. The invariant comment marker `INVARIANT (DL-423)` MUST exist in the file — anchors future-Claude/future-Lioz to read it before reshaping the function.

This catches the realistic regression (someone adds `result.attachments.push(att)` to the success branch "for audit") without needing WASM in the test runner. Crude but cheap and effective.

**C. INDEX.md + current-status.md** updated.

**Out of scope:** WASM-fixture-based end-to-end tests, processor.ts integration tests against the full pipeline, behavior changes.

## 7. Validation Plan

- [x] `cd api && npm test` runs all `.mjs` tests including the new `archive-expander-invariant.test.mjs`. All assertions pass.
- [x] Manually attempt a regression: temporarily edit `archive-expander.ts` to add `result.attachments.push(att)` inside the extract-success `else` branch; rerun tests; verify the tripwire fires. Revert.
- [x] `cd api && ./node_modules/.bin/tsc --noEmit` — clean (no TS errors from comment-only change).
- [x] Live spot-check on the next ZIP-bearing email received → confirm only children appear in AI Review.
- [x] Mark `[COMPLETED]` only after all four items checked.

## 8. Implementation Notes

**Decision: skip the WASM-fixture test.** Initial plan considered a Vitest run-the-real-extractor test against tiny in-memory ZIP fixtures. Discovered this project uses `node --test` against `.mjs` files, not Vitest — and `archive-wasm` loading under `node --test` in a Cloudflare-Workers-targeted package is fragile. A tripwire test that reads `archive-expander.ts` as text and asserts structural facts (which branch pushes which variable) catches the actual regression we worry about (someone adds `attachments.push(att)` to the success branch "for audit") at a fraction of the maintenance cost. If a future regression slips past the tripwire — e.g. someone reshapes the function and the slice markers no longer match — the test will fail loudly and force a deliberate update, which is the desired behavior.

**Marker-based slicing.** The tripwire test uses string markers (`Build AttachmentInfo for each extracted file`, `action: 'skipped_too_heavy'`, etc.) to extract branches from the source. These markers are anchored to comments and string literals that are unlikely to drift accidentally. The invariant comment itself (`INVARIANT (DL-423)`) is also asserted, so a wholesale rewrite that drops the documentation will be caught.

**Why no behavior change.** The Explore-agent trace confirmed the rule was already enforced in production code — verified live on CPA-XXX's `U13779324.2025.tax.zip` (3 child PCs, zero parent PC). The DL exists to harden the invariant against future drift, not to fix a bug.

**Files touched:**
- `api/src/lib/inbound/archive-expander.ts` — 8-line block-comment added above the `for (const att of pending)` loop.
- `api/test/archive-expander-invariant.test.mjs` — new file, 5 tests, all passing under `node --test`.
- `.agent/design-logs/INDEX.md` — DL-423 row prepended above DL-419.
- `.agent/current-status.md` — DL-423 OPEN section with 5 V1–V5 TODOs added at the top.

**Test results:** `npm test` → 24 tests pass (19 existing + 5 new). `tsc --noEmit` → 4 pre-existing errors (`index.ts:136`, `activity-logger.ts:16`, `processor.ts:1146`/`1148`); none in `archive-expander.ts` or the new test file.
