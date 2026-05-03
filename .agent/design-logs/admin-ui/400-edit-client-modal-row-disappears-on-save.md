# DL-400: Edit-Client Modal — Row Disappears After Save

**Status:** [COMPLETED — 2026-05-03]
**Branch:** `claude-session-20260503-165625`
**Date:** 2026-05-03
**Domain:** admin-ui

---

## 1. Context & Problem

After saving the "edit client details" modal on the admin dashboard, the edited client's row disappears from the list and only reappears on a manual page refresh. Violates project rule **P6 — Silent UI Refresh After DB Mutation** (CLAUDE.md / MEMORY.md).

## 2. User Requirements (Q&A)

- **Repro:** "When I use the edit dialog in dashboard and save the new data — the client is gone until I need to refresh to see it again." User will re-test post-fix.
- **Surface:** Main dashboard client list.
- **Fix scope:** Minimal — only assign defined fields. Out of scope: passing `prev` from React, list-level cache invalidation.

## 3. Research

Local cumulative knowledge — no external sources needed.

- **Principle applied (P6 Silent Refresh):** every mutation must trigger an in-place refetch / state update so the UI shows up-to-date data; never instruct the user to reload.
- **Pattern used:** delta-payload mutation in TanStack Query (`useUpdateClient`), with vanilla `clientsData` array as the dashboard's render source.
- **Anti-pattern violated:** unconditional field copy from a delta payload — if the payload omits a field, the destination field is wiped to `undefined` and the row's identity-bearing fields (name/email) become unrenderable.
- **Prior log:** DL-371 (`371-edit-client-modal-ux-polish.md`) added the React island and the optimistic cache write in `useClient.ts`, but the dashboard-side bridge in `script.js` was not updated to handle delta semantics.

## 4. Codebase Analysis

| Path | Role |
|------|------|
| `frontend/admin/react/src/components/ClientDetailModal.tsx:115-121` | Builds the **delta payload** — unchanged fields are sent as `undefined`. |
| `frontend/admin/react/src/hooks/useClient.ts:38-45` | Mutation forwards `variables` (the delta payload) as `updated` to `onSaved`; invalidates the per-client query. |
| `frontend/admin/js/script.js:13912-13944` | Dashboard wrapper. **Bug here:** unconditionally writes every field back into `clientsData`. |
| `filterClients()` (script.js) | Re-renders the row list; can't render a row with `undefined` name/email. |

## 5. Constraints & Risks

- Must not regress the React modal contract (which intentionally sends only changed fields).
- Must not require a React rebuild (kept to a vanilla-JS edit).
- Must remain compliant with the script.js Monolith Size Ratchet — net-zero or negative line delta. The fix replaces 4 lines with 4 lines (no growth).

## 6. Proposed Solution

Single-file fix in the `onSaved` callback inside `openClientDetailModal` (`frontend/admin/js/script.js` ~line 13919):

```js
onSaved: (updated, prev) => {
    const client = clientsData.find(c => c.report_id === updated.reportId);
    if (client) {
        for (const k of ['name', 'email', 'cc_email', 'phone']) {
            if (updated[k] !== undefined) client[k] = updated[k];
        }
        filterClients();
    }
    // ... unchanged below
}
```

Cache-bust: `frontend/admin/index.html` `script.js?v=406 → 407`.

## 7. Validation Plan

- [ ] Edit only `phone` on a real client → row stays visible, name/email/cc_email unchanged.
- [ ] Edit only `name` → row stays visible, other fields preserved.
- [ ] Edit only `email` → row stays visible, other fields preserved.
- [ ] Edit only `cc_email` → row stays visible, other fields preserved.
- [ ] Edit two fields at once → both update, row visible.
- [ ] Active search term during save → row remains in filtered view if still matches.
- [ ] Hard reload after save → values match Airtable (server write succeeded).
- [ ] Cancel button → no change to local state.

## 8. Implementation Notes

- Applied at `frontend/admin/js/script.js:13919-13931` (`openClientDetailModal` onSaved). Loop over the 4 mutable fields and skip `undefined` so untouched fields preserve their pre-edit values from the initial `clientsData` load. Net line delta: +1.
- Cache-bust: `frontend/admin/index.html` `script.js?v=406 → 407`.
- No React rebuild — bug was on the vanilla side of the bridge. React island contract (delta payload) is correct as designed.
- **Out of scope (deferred):** `prev` is still `undefined` in the dashboard `onSaved` because `ClientDetailModal.tsx:73` passes only `(updated)` to `onSaved`. Effect: `buildClientDetailChanges` always treats every defined field as a change, so the toast lists fields even when their value didn't change. Tracked separately.
