# Admin React Islands

Vite + React 18 + TypeScript strict library that mounts as islands inside the existing vanilla JS admin panel.

## Stack

- **Vite 5** (library mode) — builds into `../react-dist/`
- **React 18** + **TypeScript strict**
- **TanStack Query v5** — server state (queries + mutations + optimistic updates)
- **Vitest + React Testing Library** — unit + component tests

## Dev Commands

```bash
cd frontend/admin/react
npm install          # first time
npm run dev          # Vite dev server on localhost:5173 (uses index.html demo page)
npm run typecheck    # tsc --noEmit (strict)
npm run test         # Vitest (run once)
npm run test:watch   # Vitest (watch mode)
npm run build        # typecheck + Vite build → ../react-dist/
```

## Island Bridge Contract

The build output registers two globals on `window`:

```js
window.mountClientDetail(element, { reportId, ctx? })
window.unmountClientDetail(element)
```

**Callers:** `frontend/assets/js/client-detail-modal.js` (bridge shim — DO NOT break this API)

**Dependencies from vanilla JS** (must load before the island bundle):
- `frontend/shared/constants.js` → `window.API_BASE`, `window.ADMIN_TOKEN_KEY`
- `frontend/shared/endpoints.js` → `window.ENDPOINTS`
- Admin error-handler → `window.showConfirmDialog`, `window.showAIToast`

## Adding a New Island

1. Create `src/islands/<name>.tsx` — register `window.mount<Name>` / `window.unmount<Name>`
2. Add new entry to `vite.config.ts` `build.lib` (or use multi-entry config)
3. Add `<script>` + `<link>` tags to the host HTML page

## Architecture

This is a **Strangler Fig** incremental migration. Each island replaces one slice of `script.js` while preserving public APIs so callers are never broken. See Design Log DL-306 for rationale.
