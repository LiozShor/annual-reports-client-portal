---
name: DL-306 — React + Vite + TS First Slice (Client Detail Modal)
description: Introduce a Vite-bundled React+TypeScript island into the admin panel to replace the client detail modal. Unlocks DL-132's prerequisite (bundler), teaches modern frontend stack, proves Strangler Fig incremental modernization pattern.
type: design-log
---

# Design Log 306: React + Vite + TypeScript First Slice — Client Detail Modal

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-20
**Related Logs:** DL-132 (god component risk analysis — explicitly names Vite as prerequisite), DL-133 (shared constants extraction), DL-106 (client detail modal + phone field), DL-293 (extracted `client-detail-modal.js`)
**Branch:** `claude-session-20260420-171332` (will rename to `DL-306-react-vite-first-slice` on approval)

---

## 1. Context & Problem

### The system problem
`frontend/admin/js/script.js` is an **11,275-line vanilla JS monolith** loaded via `<script>` tags with no module system. DL-132's risk analysis concluded:

> "Don't split script.js yet. Prerequisite: **Add a bundler (Vite) or switch to ES modules** — eliminates the global state sharing problem."

DL-133 completed the "safe wins" (shared constants/endpoints/utils). The next prerequisite — **introducing a bundler + module system** — is still open. Every future refactor of `script.js` is blocked on it.

### The learning problem
Lioz (junior developer) wants resume-worthy skills. The project currently uses zero of the most-asked junior-frontend technologies: React, TypeScript, a module bundler, a testing framework, a server-state library. One well-scoped migration can introduce **all five** simultaneously.

### Why the client detail modal is the right slice
- **Self-contained:** DL-293 already extracted a shared entry point (`frontend/assets/js/client-detail-modal.js`, 144 LOC) reused by dashboard + doc-manager.
- **Clear I/O:** Takes `reportId` + `ctx`; writes back via `EDIT_CLIENT`/`ADMIN_UPDATE_CLIENT` endpoints.
- **Medium blast radius:** Breaking it blocks inline edit of email/phone/cc_email but doesn't take down the admin panel.
- **Bilingual-light:** Hebrew-only in admin UI (office staff), matches current behavior → no i18n scope creep.
- **Touches enough surface to teach:** form state, optimistic updates, cache invalidation, dirty-check dialog, error toasts.

---

## 2. User Requirements

| # | Question | Answer |
|---|----------|--------|
| 1 | Which admin slice? | **Client detail modal** (shared by dashboard + doc-manager, ~medium surface) |
| 2 | Coexistence strategy? | **React island inside existing HTML** (Strangler Fig). Vite library mode → `window.mountClientDetail(props)` bridge |
| 3 | Styling? | **Reuse existing design-system CSS** (`frontend/admin/css/*.css`) — visual parity, no design drift |
| 4 | Data layer? | **TanStack Query v5** for server state (GET + mutation + cache invalidation) |
| 5 | Build/deploy? | **Commit built artifacts** to `frontend/admin/react-dist/` (Cloudflare Pages serves statically) |
| 6 | TS strictness? | **Strict mode ON** (matches `api/` Workers config) |
| 7 | Bilingual? | **Hebrew-only** day 1 (matches current admin); defer i18n to slice #2 |
| 8 | Tests? | **Vitest + React Testing Library** — 2–3 tests for the new component, establishes infrastructure |

**Explicit learning requirement:** Lioz asked that the implementation produce real learning, not just a ceremonial migration.

---

## 3. Research

### Domain
Frontend modernization / Strangler Fig pattern / React island architecture / modern React server-state patterns.

### Sources Consulted

1. **[LogRocket — Implementing React Islands in Static Web Applications](https://blog.logrocket.com/implementing-react-islands-static-web-applications/)** — React islands let you introduce React incrementally, focusing on the areas that need it while leaving the rest of the application intact. This minimizes risk and disruption.
2. **[Strangler Fig Pattern — Gart Solutions](https://gartsolutions.com/strangler-fig-pattern/)** — Migrate incrementally, stay in production the entire time, let the new system grow around the old one until the legacy code can be safely removed. Each migration step is a self-contained unit with its own rollback path.
3. **[Vite Library Mode — DEV Community](https://dev.to/receter/how-to-create-a-react-component-library-using-vites-library-mode-4lma)** — Use `build.lib` config option to build a library exposing a mount function. CSS ships separately and must be explicitly imported.
4. **[GitHub Discussion: Vite for widgets / multiple mount points](https://github.com/vitejs/vite/discussions/4443)** — Pattern for gradually migrating a traditional MVC app to React: build as library, expose `window.mount(el, props)` and `window.unmount(el)`.
5. **[TanStack Query v5 Complete Guide — Pratik Jadhav, Medium](https://medium.com/@pratikjadhav6632/tanstack-query-react-query-v5-the-complete-guide-for-building-smarter-react-applications-8fdf482212e5)** — Never create QueryClient inside a component; module-level instance wrapped in `QueryClientProvider`. Query keys must be arrays, include all inputs.
6. **[TanStack Query Best Practices — DEV Community](https://dev.to/rajat128/from-beginner-to-pro-mastering-state-management-with-tanstack-query-v5-3hp6)** — `staleTime` governs cache freshness; `gcTime` governs unmounted-cache eviction; always invalidate after mutations; install Devtools.

### Key Principles Extracted

- **Island boundary = contract.** The vanilla JS side knows ONLY `window.mountClientDetail(element, props)` + `window.unmountClientDetail(element)`. Nothing else crosses. React internals can change freely.
- **Strangler Fig = one-way door per slice.** Once the client detail modal is React, the legacy `openClientDetailModalShared` function is DELETED. No dual-mode code paths.
- **Server state ≠ client state.** Use TanStack Query for anything from the Workers API. Use React `useState` for form drafts / dirty flags. Don't mix.
- **Strict TS catches Airtable drift.** Typing the `EDIT_CLIENT` payload as `ClientUpdatePayload` forces the compiler to flag the next time someone adds a field server-side that the client forgets to send.
- **Tests are the spec.** The 2–3 Vitest tests codify: modal opens, email edit saves, dirty close → confirm dialog. These are behaviors hard to re-derive after the legacy code is deleted.

### Patterns to Use

- **React island via Vite library mode** — `build.lib.entry = src/islands/client-detail.tsx`, outputs `frontend/admin/react-dist/client-detail.js` + `.css`. Loaded with plain `<script src>` in `admin/index.html` and `document-manager.html`.
- **Bridge layer** — Island exposes `window.mountClientDetail(el, props)` and `window.unmountClientDetail(el)`. The existing `openClientDetailModalShared()` is replaced by a thin shim that creates the root `<div>` and calls the bridge.
- **QueryClient singleton** — Module-level; shared across ALL future islands (future-proofing for slice #2).
- **Mutation + optimistic update + invalidate** — Canonical TanStack Query pattern. Edit email → `onMutate` snapshot → `onError` rollback → `onSettled` invalidate `['client', reportId]`.
- **Dirty-check on close** — React state (`isDirty`) gates the close handler; calls back into existing `showConfirmDialog()` (design-system UI stays in vanilla JS).

### Anti-Patterns to Avoid

- **Don't build a React SPA wrapper around script.js.** The "React everywhere" temptation doubles surface without delivering value. Island only.
- **Don't re-implement `showConfirmDialog` / `showAIToast` in React.** Per CLAUDE.md: use the existing AI modal system. React code calls `window.showConfirmDialog(...)` — keeps UX uniform.
- **Don't fetch inside `useEffect` with manual state.** That's what TanStack Query replaces. Use `useQuery` from day 1 — otherwise the learning objective evaporates.
- **Don't commit `node_modules/` or skip `.gitattributes` for the dist bundle.** Mark `react-dist/*` as `linguist-generated=true` + `binary` for clean diffs.
- **Don't enable React StrictMode double-rendering without understanding effects.** For an island talking to a Workers API with idempotent GETs, StrictMode is fine and teaches effect cleanup.

### Research Verdict

The plan — Vite library mode + React 18 + TS strict + TanStack Query v5 + Vitest + design-system CSS reuse — maps 1:1 onto the Strangler Fig / React-islands playbook. No deviations from best practice. The one intentional "deviation" is keeping modals/toasts/confirmation in the existing vanilla design system rather than porting to a React UI library — this is **correct** for a first slice (reduces scope, preserves visual parity) and matches CLAUDE.md's UI-uniformity rule.

---

## 4. Codebase Analysis

### Existing Solutions Found (from Phase A pre-scan)

- `frontend/assets/js/client-detail-modal.js` (144 LOC) — DL-293's shared wrapper with `openClientDetailModalShared(reportId, ctx)`, `closeClientDetailModal(skipDirtyCheck)`, dirty-check dialog integration via `showConfirmDialog`.
- `frontend/shared/constants.js` — `API_BASE`, `ADMIN_TOKEN_KEY`, stage maps. Importable from React via a thin TS declaration file.
- `frontend/shared/endpoints.js` — `ENDPOINTS.editClient`, `ENDPOINTS.adminUpdateClient`, etc. React code references via global `window.ENDPOINTS` (typed with `declare global`).
- `frontend/shared/utils.js` — `sanitizeDocHtml()`. May or may not be needed for the modal slice.

### Reuse Decision

- **Reuse:** All three shared modules (`constants.js`, `endpoints.js`, `utils.js`) via `declare global` TS ambient types. No re-implementation.
- **Reuse:** Design-system CSS (`frontend/admin/css/ai-modal.css`, `buttons.css`, form styles). Imported as side-effect in the island entry.
- **Reuse:** `window.showConfirmDialog`, `window.showAIToast`, `window.showModal` from existing vanilla JS.
- **Replace:** Contents of `client-detail-modal.js` — the body becomes a 10-line shim that creates a root element and calls `window.mountClientDetail(el, { reportId, onClose })`.
- **Build from scratch:** The React component itself (`ClientDetail.tsx`), the Vite config, the TS config, the Vitest setup, the QueryClient provider.

### Relevant Files (examined)

| Path | Relevance |
|------|-----------|
| `frontend/admin/index.html` | Add `<script src="react-dist/client-detail.js">` + `<link rel="stylesheet" href="react-dist/client-detail.css">` |
| `frontend/document-manager.html` | Same as above |
| `frontend/admin/js/script.js` (11,275 LOC) | Currently calls `openClientDetailModalShared` from dashboard row actions — unchanged; shim preserves the API |
| `frontend/assets/js/client-detail-modal.js` | Replaced by bridge shim |
| `frontend/shared/*.js` | Unchanged — consumed via ambient TS types |
| `api/src/routes/*.ts` (various) | Unchanged — React slice talks to existing Workers endpoints |

### Existing Patterns Alignment

- Project already has strict TS on the backend (`api/tsconfig.json`). Matching it on the frontend is natural.
- Project already uses `error-handler.js` + `resilient-fetch.js` in vanilla. The React slice will wrap `fetch` in a thin `apiClient.ts` that adds the admin auth token — similar shape, stricter types.
- Design-system rule (`docs/ui-design-system.md`) already prohibits native `confirm()`/`alert()`; the React slice inherits this by delegating to `window.showConfirmDialog`.

### Dependencies

- **New npm deps:** `react@18`, `react-dom@18`, `@tanstack/react-query@5`, `@tanstack/react-query-devtools@5`, `vite@5`, `@vitejs/plugin-react`, `typescript@5`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- **Project structure:** New `frontend/admin/react/` source folder (not deployed). Built output: `frontend/admin/react-dist/` (committed, deployed).

---

## 5. Technical Constraints & Risks

### Security
- **No new endpoints.** Island uses existing `ENDPOINTS.editClient` (auth via `Authorization: Bearer <admin-token>`, read from `localStorage[ADMIN_TOKEN_KEY]`).
- **No new secrets.** All secrets stay in Workers env.
- **Bundle size:** React 18 + React-DOM + TanStack Query ≈ 45 KB gzipped. Loaded only on admin pages. Admin panel is staff-only (5-10 concurrent users), not client-facing — size is not a concern but documented.

### Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bridge API leaks React internals → future refactors break callers | Medium | Contract: only `mount/unmount`, documented in `react/README.md` |
| Cloudflare Pages serves stale bundle after commit | Low | Cache-bust via filename hash: `client-detail.[hash].js` + HTML references the hashed name (Vite does this by default with `manifest: true`) |
| Dirty-check dialog flow diverges between React and vanilla | Medium | Delegate to `window.showConfirmDialog` — single source |
| Vitest jsdom mocks `window.showConfirmDialog` inconsistently | Low | Test setup file (`vitest.setup.ts`) provides typed stubs |
| TypeScript ambient types for `window.ENDPOINTS` drift from `endpoints.js` | Medium | Generate `endpoints.d.ts` from `endpoints.js` via a small build-time script OR keep hand-written; revisit when slice #2 lands |
| `react-dist/` commits balloon repo size | Low | `.gitattributes`: `react-dist/** linguist-generated=true -diff`; bundle is ~50KB gzipped |

### Breaking Changes
- **None** to external APIs, Airtable, or n8n.
- **Internal:** `openClientDetailModalShared` signature is preserved; callers inside `script.js` do not need changes. If signature drift occurs, it fails loudly at page load.

---

## 6. Proposed Solution (The Blueprint)

### Success Criteria

> The client detail modal opens identically to today, inline email/cc_email/phone edits save via TanStack Query mutation with optimistic update + toast, dirty-close prompts the existing confirm dialog — all served from a Vite-built React + TypeScript bundle committed to `frontend/admin/react-dist/`, with 2+ Vitest tests passing.

### 🎓 Explicit Learning Objectives (user request)

By end of this slice, Lioz will have shipped production code using:

1. **Vite** (config, library mode, dev server, build output, asset hashing)
2. **React 18** (function components, `useState`, `useEffect` cleanup, controlled inputs, event handling, StrictMode)
3. **TypeScript strict** (interfaces for API payloads, `as const`, discriminated unions for form state, `declare global` for ambient `window.*`)
4. **TanStack Query v5** (`QueryClient`, `useQuery`, `useMutation`, query keys, `staleTime`/`gcTime`, optimistic updates, cache invalidation, Devtools)
5. **Vitest + React Testing Library** (`render`, `screen`, `userEvent`, `vi.fn()` mocks, `setup.ts` config, `beforeEach` cleanup)
6. **Strangler Fig / island architecture** (bridge pattern, boundary contracts, incremental migration principles)

Each of these is a bullet point on a junior resume.

### Logic Flow

1. **Dev time:** Run `npm run dev` in `frontend/admin/react/` → Vite dev server with HMR on a demo page.
2. **Build time:** `npm run build` → emits `frontend/admin/react-dist/client-detail.[hash].js` + `.css` + `manifest.json`.
3. **Runtime (host page):**
    - `admin/index.html` loads `react-dist/client-detail.js` after existing shared scripts.
    - Bundle self-registers `window.mountClientDetail` + `window.unmountClientDetail` on load.
    - Existing row-menu click fires `openClientDetailModalShared(reportId, ctx)` → now a shim that creates `<div id="react-root-client-detail">`, calls `window.mountClientDetail(el, { reportId, ctx, onClose })`.
    - React component mounts inside a `<QueryClientProvider>`.
    - `useQuery(['client', reportId], fetchClient)` runs (cached 60s).
    - User edits email input → local `useState` draft + `isDirty=true`.
    - User clicks Save → `useMutation` with optimistic update → `onSuccess` invalidates `['client', reportId]` + `['clients']` → `showAIToast('נשמר', 'success')`.
    - User clicks ✕ with dirty state → `window.showConfirmDialog('יש שינויים…', doClose, 'סגור בלי לשמור', true)`.
    - Close → `window.unmountClientDetail(el)` → React root unmounted, DOM node removed.

### Data Structures / Schema Changes

**None** in Airtable or Workers. Internal TS types only:

```ts
// react/src/types/client.ts
export interface ClientDetail {
  reportId: string;
  clientName: string;
  email: string;
  ccEmail: string | null;
  phone: string | null;
  spouseName: string | null;
  stage: StageKey;
}
export interface ClientUpdatePayload {
  reportId: string;
  email?: string;
  cc_email?: string | null;
  phone?: string | null;
}
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/react/package.json` | Create | npm manifest, scripts: `dev`, `build`, `test`, `typecheck` |
| `frontend/admin/react/tsconfig.json` | Create | Strict TS, target ES2020, jsx react-jsx |
| `frontend/admin/react/vite.config.ts` | Create | Library mode entry, output → `../react-dist/`, asset hashing, manifest |
| `frontend/admin/react/vitest.config.ts` | Create | Extends Vite config, jsdom environment |
| `frontend/admin/react/vitest.setup.ts` | Create | Mock `window.showConfirmDialog`, `window.showAIToast`, `window.ENDPOINTS` |
| `frontend/admin/react/src/islands/client-detail.tsx` | Create | Island entry: registers `window.mountClientDetail` / `window.unmountClientDetail` |
| `frontend/admin/react/src/components/ClientDetailModal.tsx` | Create | Main component (~200 LOC) |
| `frontend/admin/react/src/lib/queryClient.ts` | Create | Module-level `QueryClient` singleton |
| `frontend/admin/react/src/lib/apiClient.ts` | Create | Typed `fetch` wrapper with admin token + error handling |
| `frontend/admin/react/src/hooks/useClient.ts` | Create | `useClient(reportId)` + `useUpdateClient()` hooks |
| `frontend/admin/react/src/types/globals.d.ts` | Create | Ambient types for `window.ENDPOINTS`, `window.showConfirmDialog`, etc. |
| `frontend/admin/react/src/types/client.ts` | Create | `ClientDetail`, `ClientUpdatePayload` |
| `frontend/admin/react/__tests__/ClientDetailModal.test.tsx` | Create | 3 tests: renders client data, saves email edit, dirty close prompts confirm |
| `frontend/admin/react/README.md` | Create | Local dev, build, test commands + island contract doc |
| `frontend/admin/react-dist/` | Create (git-tracked) | Built output (auto-generated; `.gitattributes` marks as generated) |
| `frontend/.gitattributes` | Modify | Add `admin/react-dist/** linguist-generated=true -diff` |
| `.gitignore` | Modify | Add `frontend/admin/react/node_modules/`, `frontend/admin/react/dist/` (local dev build) |
| `frontend/admin/index.html` | Modify | Add 2 tags pointing at hashed bundle (read from `manifest.json` OR use a fixed filename pattern) |
| `frontend/document-manager.html` | Modify | Same as above |
| `frontend/assets/js/client-detail-modal.js` | Modify | Replace body with 10-line bridge shim calling `window.mountClientDetail` |
| `CLAUDE.md` | Modify | Add pointer: "React islands live at `frontend/admin/react/`. See `frontend/admin/react/README.md`." |

### Final Step (Always)
- Update design log status → `[IMPLEMENTED — NEED TESTING]`
- Copy all unchecked Section 7 items to `.agent/current-status.md` under "Active TODOs"
- Update `.agent/design-logs/INDEX.md` (add DL-306 row)
- Commit feature branch + push; **do not merge to main** until Lioz confirms live test.

---

## 7. Validation Plan

**Automated:**
- [ ] `npm run typecheck` (tsc --noEmit) passes with strict mode
- [ ] `npm run test` (Vitest) — 3/3 tests pass:
    - [ ] `renders client name, email, phone from query response`
    - [ ] `typing new email + clicking save fires mutation with correct payload`
    - [ ] `closing with dirty state triggers window.showConfirmDialog`
- [ ] `npm run build` produces `react-dist/client-detail.[hash].js` + `.css` + `manifest.json`

**Manual (browser, admin panel):**
- [ ] Open admin dashboard — no console errors, React Devtools shows `<ClientDetailModal>` tree
- [ ] Click a client row → modal opens with correct data (name, email, phone, cc_email)
- [ ] Edit email → click Save → toast "נשמר" appears → Airtable record updated (verify via `gws` or Airtable UI)
- [ ] Edit phone → close ✕ → confirm dialog shown → cancel → modal stays → save → works
- [ ] TanStack Query Devtools (dev mode only) visible and shows the cached query
- [ ] Open same client in doc-manager page — modal works there too (second mount point)
- [ ] Network tab: only ONE GET per open (no duplicate fetches)
- [ ] Network tab: editing without changing anything does NOT fire a mutation

**Regression (existing flows):**
- [ ] Dashboard row menus, stage changes, bulk send — all still work (unaffected)
- [ ] Doc-manager pencil edit button still opens the modal
- [ ] Mobile view — modal still usable

**Learning verification (for Lioz):**
- [ ] Can explain: what is a query key, why it must be an array
- [ ] Can explain: why QueryClient lives at module level, not inside a component
- [ ] Can explain: what Strangler Fig means and what the "bridge" contract is in this codebase

---

## 8. Implementation Notes (Post-Code)
*(to be filled during implementation — log deviations, research principles applied, any gotchas)*
