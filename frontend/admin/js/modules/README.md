# Admin JS Modules

New admin-panel code goes here, **not** in `frontend/admin/js/script.js`.

`script.js` is on a one-way size ratchet (`.claude/hooks/script-size-ratchet.py`)
and `chatbot.js` too. They can only shrink. There is no way to grow them — the
ratchet baseline is append-only-down and any attempt to bump it is rejected by
the same hook (and by CI).

## Pattern

```js
// frontend/admin/js/modules/my-feature.js
export function doTheThing(arg) {
  // ...
}
```

```js
// frontend/admin/js/script.js — only an import + wiring
import { doTheThing } from './modules/my-feature.js';
window.doTheThing = doTheThing; // if legacy global access is needed
```

Bump `frontend/admin/index.html`'s `?v=NNN` cache-bust on any module change so
browsers don't serve stale JS (see MEMORY: `feedback_admin_script_cache_bust`).

## When to use a React island instead

If the feature involves a form with 2+ fields, data fetching + mutation, or
non-trivial UI state — go to `frontend/admin/react/` instead. See
`frontend/admin/react/README.md`. New growth = React, by default.
