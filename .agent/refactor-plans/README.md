# Context-Reduction & Quality Refactor — Plan Index

A token scan found ~350k tokens of LLM context overhead across ~15 files. On top of that, the two largest JS files (`script.js` 10,310 LOC, `document-manager.js` 3,925 LOC) and `style.css` (8,428 LOC) are spaghetti from years of AI-generated iteration and need genuine software-engineering cleanup — not just file splits. Plans are ordered easy→hard so each one ships cleanly before raising the stakes. Each plan runs on its own branch; **ask before push/merge** (per CLAUDE.md memory rule).

Upstream approved plan: `C:\Users\liozm\.claude\plans\wiggly-munching-moonbeam.md`

---

## Execution Order & Status

| # | Title | Tier | Status | Token Savings | Branch |
|---|-------|------|--------|---------------|--------|
| 01 | Delete wf05 backup JSON + gitignore | 🟢 Trivial | PENDING | ~116k | `refactor/backup-json-gitignore` |
| 02 | Trim SSOT blank lines | 🟢 Trivial | PENDING | ~2k | `refactor/trim-ssot-blank-lines` |
| 03 | Archive resolved design logs | 🟢 Easy | PENDING | ~5k/session | `refactor/archive-design-logs` |
| 04 | Archive current-status.md old sections | 🟡 Easy-Med | PENDING | ~25k/session | `refactor/archive-current-status` |
| 05 | Split email-html.ts | 🟡 Medium | PENDING | ~8k/edit | `refactor/split-email-html` |
| 06 | Split classifications.ts | 🟠 Med-Hard | PENDING | ~12k/edit | `refactor/split-classifications-route` |
| 07 | Split style.css | 🔴 Hard | PENDING | ~40k/edit | `refactor/split-style-css` |
| 08 | Split document-manager.js | 🔴 Hard | PENDING | ~20k/edit | `refactor/split-document-manager` |
| 09 | Split admin script.js | 🔴 Hardest | PENDING | ~60k/edit | `refactor/split-admin-script` |
| 10 | Cross-cutting quality audit | 🟠 Medium | PENDING | (informs 08+09) | `refactor/quality-audit` |

**Execution note:** Do 01→09 strictly in order. Plan 10 is read-only and can run in parallel at any time — run it early (alongside 03 or 04) so findings feed into the quality passes in 08 and 09.

---

## Critical Files To Read Per Plan

| Plan | Files to read before starting |
|------|-------------------------------|
| 01 | `docs/wf05-backup-pre-migration-2026-03-26.json`, `.gitignore` |
| 02 | `SSOT_required_documents_from_Tally_input.md` |
| 03 | `.agent/design-logs/INDEX.md`, candidate DL files (DL-035, 046, 052, 086, 093) |
| 04 | `.agent/current-status.md`, `.gitattributes` |
| 05 | `api/src/lib/email-html.ts` |
| 06 | `api/src/routes/classifications.ts` |
| 07 | `frontend/admin/css/style.css` |
| 08 | `frontend/assets/js/document-manager.js`, `frontend/assets/document-manager.html` |
| 09 | `frontend/admin/js/script.js`, `frontend/admin/index.html` |
| 10 | All frontend JS + HTML files (read-only scan) |

---

## Sub-Plan Files

- [01-backup-json-gitignore.md](01-backup-json-gitignore.md)
- [02-trim-ssot-blank-lines.md](02-trim-ssot-blank-lines.md)
- [03-archive-resolved-design-logs.md](03-archive-resolved-design-logs.md)
- [04-archive-current-status.md](04-archive-current-status.md)
- [05-split-email-html.md](05-split-email-html.md)
- [06-split-classifications-route.md](06-split-classifications-route.md)
- [07-split-style-css.md](07-split-style-css.md)
- [08-split-document-manager-js.md](08-split-document-manager-js.md)
- [09-split-admin-script-js.md](09-split-admin-script-js.md)
- [10-cross-cutting-quality-audit.md](10-cross-cutting-quality-audit.md)
