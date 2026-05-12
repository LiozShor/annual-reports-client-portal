# Design Log 403: Bot — active-only search default + Hebrew pluralization
**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-05-05
**Related Logs:** DL-402 (parent — Telegram ops bot M1).

## 1. Context & Problem

Two small follow-ups from DL-402's deferred list, surfaced during M1 live testing on 2026-05-05:

1. `search_clients_by_name` returns inactive clients alongside active ones. The DL-402 live test surfaced an inactive twin alongside an active record sharing the same name; technically correct but operationally noisy — most searches mean "find me the client we're working with," not "find me everyone who's ever been named that."
2. `formatDocProgress` always renders plural ("מסמכים") even when the count is 1. Reads slightly awkward: "1 of 49 <plural_docs>" should be "<singular_doc> one of 49" — Hebrew pluralizes singular vs plural the same way English does, but singular vs plural noun form is the noun form.

Neither is a bug; both are polish that makes the bot feel less mechanical.

## 2. Scope

Exactly these two changes. Nothing else.

- **Active-only default in search:** Add `include_inactive: boolean = false` to `search_clients_by_name`'s input schema. The tool filters out `is_active === false` entries unless the flag is set true. Description string instructs the model to set it true only when the user explicitly asks for inactive clients ("גם לקוחות לא פעילים", "include archived", etc.).
- **Pluralization fix:** Update `formatDocProgress` in `api/src/lib/stage-translations.ts`:
  - `received === 1`: "<singular_doc> one of N"
  - `received > 1`: "X of N <plural_docs>"
  - `received === 0`: "0 of N <plural_docs>" (current behavior)
  - Edge case: `total === 0` → return `null` (current behavior).

## 3. Files to change

| File | Action |
|------|--------|
| `api/src/lib/telegram-bot/tools.ts` | Add `include_inactive` to `searchClientsByNameTool` input schema + filter logic. |
| `api/src/lib/stage-translations.ts` | Update `formatDocProgress` with the singular branch. |

Optional: a small unit test for `formatDocProgress` covering the three count buckets — written as a `.test.mjs` against an inline reference implementation if the dual-source pattern hasn't been extracted yet.

## 4. Verification

- **Active-only default:** ask the bot in Hebrew "is there a client named X?" using the same query that surfaced the bug in DL-402 — should return only the active record (1 match, not 2). Then re-ask with an explicit "include inactive" qualifier — should return both (2 matches).
- **Pluralization:** find any active client with exactly 1 received document. Ask "how many docs does X have?" — bot should reply using the singular Hebrew noun form, not the plural.

## 5. Out of scope

- No refactor of adjacent code.
- No starting on the agent memory layer (Phase 3 of `docs/agent-roadmap.md`) — separate session.
- No tool namespacing (`crm.*` rename, Phase 2) — separate session.

## 6. Estimated effort

30 minutes. Single commit, single deploy.
