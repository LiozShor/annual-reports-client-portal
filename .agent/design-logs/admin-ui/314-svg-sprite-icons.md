# Design Log 314: SVG Sprite Migration for Admin Panel Icons
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-20
**Related Logs:** DL-311 (admin perf profile — identified Lucide as bottleneck), DL-306 (React island), DL-132 (script.js monolith risk)

## 1. Context & Problem
DL-311 shipped 5 surgical perf fixes and cut `setTimeout handler` violations roughly in half (1958ms → ~900ms) but missed the sub-200ms target. Profile data (`dl311:*` measures) made the root cause unambiguous:

```
dl311:safeCreateIcons:full-doc  166.3ms
dl311:safeCreateIcons:full-doc  118.8ms
dl311:safeCreateIcons:full-doc  116.9ms
dl311:safeCreateIcons:full-doc   86.4ms
dl311:safeCreateIcons:full-doc   62.6ms
… (many more)
```

Every top offender is Lucide's `createIcons()` runtime DOM scan-and-replace. Scoping the default root to `.tab-content.active` broke nav icons (reverted).

**Lucide approach is fundamentally the wrong primitive** for a 10k-line vanilla admin panel that re-renders tables on every tab switch. Industry best practice for high-perf icon systems is an SVG sprite + `<use>` references (Cloud Four stress test, lucide-static docs, oliverjam).

## 2. User Requirements
1. **Q:** Scope — admin panel only or all frontend?
   **A:** Admin panel only. Client portal / doc-manager / view-documents keep Lucide runtime.
2. **Q:** Build pipeline — hand-maintained / npm script / runtime fetch?
   **A:** Hand-maintained static SVG file, committed. One-off regeneration script.
3. **Q:** Dynamic icons in JS template literals?
   **A:** Template-literal `<svg><use href="#icon-${name}"/></svg>` — same pattern for static + dynamic. Delete `safeCreateIcons()` calls.
4. **Q:** Rollout?
   **A:** All at once — one PR, single test cycle.
5. **Q:** Success bar?
   **A:** Chrome violations gone + `dl311:safeCreateIcons:*` measures disappear from profile.
6. **Q:** Sprite size?
   **A:** ~25-40KB acceptable (neutral vs removed Lucide CDN ~35KB).

## 3. Research
### Domain
Web Performance — SVG rendering, icon system architecture.

### Sources Consulted
1. **[Cloud Four — SVG Icon Stress Test](https://cloudfour.com/thinks/svg-icon-stress-test/)** — Inline SVG sprites via `<use href="sprite.svg#name">` is the most performant approach for rendering many icons. Inline SVGs without sprites bloat the DOM.
2. **[Lucide Static docs](https://lucide.dev/guide/packages/lucide-static)** — Lucide publishes a static package with individual SVG files and a sprite format. Pattern: `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><use href="sprite.svg#icon-name"/></svg>`.
3. **[oliverjam — Simple icon systems using SVG sprites](https://oliverjam.es/articles/svg-sprites)** — `<symbol>` elements inside one SVG file, referenced by fragment ID, get cached once and referenced cheaply everywhere. Browser-native.

### Key Principles Extracted
- **Runtime DOM replacement is expensive at scale** — every `createIcons()` call walks the document; each call costs proportional to DOM size.
- **`<use href="#id">` is a browser primitive** — zero JS cost. Sprite parsed once; each `<use>` is a reference, not a clone.
- **`currentColor` on root SVG** — inherits CSS `color` for coloring. Preserves all existing contextual colour rules (`.reminder-stat-item .icon-sm { color: var(--warning-500) }` etc.) without any CSS changes.

### Patterns to Use
- **Inline sprite** at top of admin/index.html (single HTML file, GH Pages-friendly). Avoids second HTTP request, avoids race between sprite-load and first render.
- **`icon(name, sizeClass)` helper** in script.js for dynamic template literals. Literal strings in HTML get the expanded SVG directly.
- **`stroke="currentColor"`** on root SVG so existing CSS color rules keep working.

### Anti-Patterns Avoided
- **External sprite URL + `<use href="/icons.svg#name">`** — requires an HTTP fetch that may race; FOUC on first render. We inline for simplicity.
- **One `<svg>` per icon inlined** — triples HTML size vs sprite. Sprite references = 80 bytes each vs ~500 bytes raw.
- **Keeping Lucide JS loaded** — defeats the purpose. Delete the `<script>` tag.

### Research Verdict
Inline sprite at top of admin/index.html. Generate from Lucide upstream (fetch individual SVGs → wrap each in `<symbol id="icon-NAME">`). All `<i data-lucide="X" class="icon-sm">` → `<svg class="icon icon-sm" …><use href="#icon-X"/></svg>`. Delete `lucide.createIcons()` / `safeCreateIcons()` calls.

## 4. Codebase Analysis

| Location | Finding |
|----------|---------|
| `frontend/admin/index.html:14` | Lucide CDN `<script>` tag — to be removed |
| `frontend/admin/index.html` | 136 static `data-lucide="..."` tags |
| `frontend/admin/js/script.js` | 175 dynamic `data-lucide` occurrences inside template literals; 89 `safeCreateIcons()`/`lucide.createIcons()` call sites |
| `frontend/admin/css/style.css:7368` | One hand-crafted rule targeting `[data-lucide="info"]` — will need to switch selector to `use[href="#icon-info"]` or just drop (only a 20px sizing tweak) |
| `frontend/assets/css/design-system.css:590-616` | `.icon`, `.icon-sm/md/lg/xl/2xl` size classes already exist — just apply to the new `<svg>` tag |
| `frontend/admin/react/` | React island uses no Lucide — untouched |
| `frontend/shared/*.js` | No `data-lucide` emissions — untouched |
| Other HTML files (view-documents, document-manager, approve-confirm, landing) | Keep Lucide runtime — out of scope |

**Existing Solutions Found:** `.icon*` CSS classes already set width/height. `stroke="currentColor"` on the new SVG inherits color from existing `.reminder-stat-item .icon-sm { color: var(--warning-500) }` style rules — no CSS churn needed.

**Reuse Decision:** Add only one JS helper (`icon(name, sizeClass)`). Delete `safeCreateIcons` body; keep as no-op shim for one release to catch stragglers, then drop.

## 5. Technical Constraints & Risks
- **Security:** Sprite is static asset; no auth implications.
- **Risks:**
  - **Icon regression:** if any `data-lucide="foo"` name is missing from the sprite, the icon won't render. Mitigated by generating the icon list from `grep -hoE 'data-lucide="[a-z0-9-]+"'` over admin files → list is exhaustive by construction.
  - **CSS coloring regression:** CSS rules like `.ai-stat-item .icon-sm { color: var(--brand-500) }` depend on `stroke="currentColor"` on the SVG element. New markup sets that attribute on every SVG, so inheritance works.
  - **Sizing regression:** `.icon-sm { width: 16px; height: 16px }` applies to `<svg>` the same as `<i>` — just need to include `class="icon icon-sm"` on the `<svg>`.
  - **Dynamic icons in reaction to stage enum** (e.g., `STAGES[client.stage].icon` is a Lucide name): now becomes `<use href="#icon-${STAGES[client.stage].icon}">` — identical flow, just different markup.
- **Breaking Changes:** None for users. For devs: adding a new icon means appending to `scripts/icon-list.txt` + rerunning `node scripts/build-icon-sprite.mjs`.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Chrome console shows no `setTimeout handler took >200ms` violations during admin init or tab switching. `dl311:safeCreateIcons:*` measures are absent (code deleted). Dashboard feels noticeably faster.

### Files to Change
| File | Action | Notes |
|------|--------|-------|
| `scripts/icon-list.txt` | Create | 86 unique admin icon names (sorted) |
| `scripts/build-icon-sprite.mjs` | Create | Node 22 script, fetches Lucide SVGs, writes sprite |
| `frontend/assets/icons/icons.svg` | Create | Generated, committed (17.8 KB, 86 symbols) |
| `frontend/admin/index.html` | Modify | Remove Lucide `<script>`; inline sprite at top of `<body>`; replace 136 `<i data-lucide>` tags; bump `script.js?v=271` |
| `frontend/admin/js/script.js` | Modify | Add `icon()` helper; replace 175 template-literal occurrences; neuter `safeCreateIcons` to no-op shim |
| `.agent/design-logs/admin-ui/314-svg-sprite-icons.md` | Create | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-314 row |
| `.agent/current-status.md` | Modify | Test checklist |

### Logic Flow
1. Sprite bundled inline in admin/index.html (~18KB) — parsed once, all icons available as `#icon-NAME` fragments.
2. Every static `<i data-lucide="NAME" class="icon-sm">` → `<svg class="icon icon-sm" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><use href="#icon-NAME"/></svg>`.
3. Every dynamic template literal `<i data-lucide="${name}" class="icon-sm">` → `${icon(name, 'icon-sm')}` via helper.
4. `safeCreateIcons` becomes no-op shim — existing call sites no-op without code change; can be deleted in a follow-up.
5. No Lucide runtime loaded → zero DOM walk cost on every render.

### Final Step (Always)
Housekeeping — update status, copy Section 7 to current-status.md, bump cache-bust.

## 7. Validation Plan
* [ ] Build sprite: `node scripts/build-icon-sprite.mjs` → 86 symbols written, ~18KB
* [ ] Local smoke: open admin/index.html via local server, all nav + stat-card icons render
* [ ] Login flow — admin → dashboard → every row action icon, stage badge icon, filter icon, stat-card icons render
* [ ] All 5 tabs (dashboard, PA queue, AI review, reminders, questionnaires) — icons render
* [ ] Document Manager icons render (note: doc-manager.html is NOT migrated this round — verify admin's embedded doc-manager link still works but doc-manager page itself keeps Lucide)
* [ ] Every row menu (⋮) dropdown shows its icons
* [ ] Every popover / modal (confirm dialog, stage dropdown, docs popover, recent-messages inline reply) shows icons
* [ ] Perf — `localStorage.ADMIN_PERF='1'; location.reload()` → click tabs → `performance.getEntriesByType('measure').filter(m=>m.name.startsWith('dl311:safeCreateIcons'))` returns empty array
* [ ] Chrome Violations — flag OFF, tab-switching reproduces DL-311 baseline → no `setTimeout handler took >200ms` warnings
* [ ] No regression on client portal (view-documents.html, document-manager.html) — still uses Lucide runtime

## 8. Implementation Notes (Post-Code)
*To be filled during/after implementation.*

### Baseline (from DL-311 profile)
- `dl311:safeCreateIcons:full-doc` top values: 166.3, 118.8, 116.9, 86.4, 62.6, 57.7, 36.2 ms
- Chrome `setTimeout handler took ...ms` max: ~901ms
- DL-311 success bar (sub-200ms) not yet met

### After sprite migration
*Pending user re-test (run perf flag, paste numbers).*

### Implementation summary
- Sprite generated: 86 symbols, 17.8 KB at `frontend/assets/icons/icons.svg`. Inlined into `admin/index.html` at top of `<body>`.
- `admin/index.html`: 136 `<i data-lucide>` → `<svg><use href>` replacements; Lucide CDN `<script>` removed; cache-bust bumped to `v=271`.
- `script.js`: 175 template-literal occurrences → `${icon(name, sizeClass)}` helper calls. `safeCreateIcons` neutered to no-op shim (89 call sites become free no-ops). 3 stray `setAttribute('data-lucide', ...)` calls also converted (toast icon × 2 + chevron toggle). 15 single-quoted `.innerHTML='<i data-lucide>'` strings converted to template literals to make the `${icon()}` interpolation work.
- Spec validation: `grep -c 'data-lucide'` returns 0 in both files; 136 `<use>` refs in HTML; 175 `${icon(` calls in JS; `node --check` passes.
- Sprite build script: `scripts/build-icon-sprite.mjs` is committed and idempotent. To add a new icon: append name to `scripts/icon-list.txt`, rerun `node scripts/build-icon-sprite.mjs`, commit both. No npm dep — uses native `fetch()` to pull from unpkg.

### Deviations from plan
- **Skipped `lucide-static` npm dep** — no root package.json in this repo. Build script uses native `fetch()` to grab Lucide SVGs directly from unpkg. Cleaner, no lockfile churn.
- **DL number 312 → 314** — main had DL-313 (hover tab dropdowns) land concurrently; bumped to avoid collision.
