# Design Log 332: AI Review Pane 1 Density Redesign
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-23
**Related Logs:** DL-330 (3-pane rework — parent; Phase 1 of broader cockpit plan), DL-306 (PA-banner deep-link — `?client=X` contract preserved), DL-278 (scroll-into-view — untouched), DL-053 (silent refresh — preserved)

## 1. Context & Problem

Shipped in DL-330, pane 1 renders each client as a ~70–80px row: border + `user` icon + folder-open icon + name + "X/Y [reviewed-label]" subtitle + full pill badge ("N [pending-label]" green or "✓ [done-label]" green). At 1080p only 5–6 clients fit per viewport, so reviewers scroll constantly. Pane 1 is the navigation surface for the whole tab — its density is the single biggest lever on "how many clients can I see at a glance."

Goal: double the number of clients visible without losing information. Standalone visual win. Independent of the broader cockpit rework (pane 2 / pane 3 / actions panel, which will be logged separately).

## 2. User Requirements
1. **Q:** Row chrome — keep per-row borders?
   **A:** No. Drop per-row border. Keep the existing 1px bottom separator.
2. **Q:** Person icon retained?
   **A:** No — drop it. Icon density in pane 1 doesn't need the person glyph.
3. **Q:** Folder icon position?
   **A:** **Stays on start side (visual-right in RTL), exactly where it is today.** Not relocated next to the pending number.
4. **Q:** Pending count rendering?
   **A:** Amber number only (no pill background). Use `font-weight: 500` so weight carries signal alongside color (colorblind-safety). On selected row, demote to `--gray-700` to not fight the brand-50 highlight.
5. **Q:** Zero-pending rendering?
   **A:** **Render nothing** in the pending slot. Absence of the amber number is the "done" signal; fewer glyphs per row is the point. Fall back to muted ✓ only if testing shows empty slot reads as broken.
6. **Q:** Target row height?
   **A:** 40–44px preferred, 46–48px acceptable if two-line content cramps. Legibility wins over hitting the lower bound.
7. **Q:** Scope?
   **A:** Desktop only. Mobile unchanged (mobile uses a different code path — legacy grouped-accordion render).

## 3. Research

### Domain
List density / dashboard navigation UX; RTL typography; colorblind-safe color-only indicators.

### Sources Consulted
1. **DL-330 research base** — reused Outlook / Gmail / Cloudscape master-detail precedents. Cockpit is just the dense-list extension of that pattern.
2. **NN/g — "How to Design Data Tables and Lists for High Density"** — for navigation lists used for repeated scanning (which reviewers do dozens of times per session), reduce per-row chrome in this order: icons → borders → background fills. Reserve color + weight for the one signal that matters (here: pending count).
3. **WCAG 2.2 SC 1.4.1 Use of Color** — color alone cannot convey information. Pairing amber (hue) with `font-weight: 500` (weight) gives two independent visual channels → safe under protanopia/deuteranopia simulators.
4. **Linear changelog on compact mode** — explicit removal of pill backgrounds on list rows; numbers-only for counts. Same logic applied here.

### Key Principles Extracted
- **Shed chrome before shrinking content.** Drop the icons and pill backgrounds first; only then lean on padding reductions. Protects legibility of name + subtitle.
- **Two-channel signaling for any color-coded count.** Hue + weight (never hue + hue or hue alone).
- **Absence is signal.** In a dense scan-list, "nothing here" reads faster than a muted glyph — provided the empty state doesn't look broken.

### Patterns to Use
- **Inline text number for counts** instead of pill/badge — matches Linear, GitHub Notifications, Gmail label counters.
- **Padding reduction via specific-selector override** — keep `.ai-accordion-header` base styling intact (it's shared with pane 2 headers); only override on `.ai-client-row`.

### Anti-Patterns Avoided
- Red-on-white danger amber — the `--warning-500` amber has higher lightness than `--danger-*`; readable at 12–14px on white AND on brand-50.
- Zero-pending `✓` on every completed row — aggregates to visual noise when several clients are done. Prefer emptiness.

### Research Verdict
Drop icons + pills first; keep padding changes conservative; use amber `font-weight: 500` for pending number. Render nothing for zero-pending clients. Fall back to muted ✓ only as a contingency.

## 4. Codebase Analysis

### Existing Solutions Found
- `buildClientListRowHtml(clientName, clientItems, isActive)` — `script.js:4095`. Introduced in DL-330. Rewrote this in place.
- `.ai-client-row` CSS block — `style.css:3537–3554`. Introduced in DL-330. Extended.
- `--warning-500` / `--warning-700` + no `--warning-600` — verified in `frontend/assets/css/design-system.css`. Used `--warning-500` (pure amber, #F59E0B) for the pending number.
- `.ai-accordion-header` base (`style.css:1671`) and `.ai-accordion-stat-badge` variants (`style.css:2258`) — LEFT UNTOUCHED. Pane 2 doc-headers + doc-level badges use these.

### Reuse Decision
Extend existing DL-330 function + CSS selector. No new helpers, no module split, no token additions.

### Relevant Files
- `frontend/admin/js/script.js:4095` — `buildClientListRowHtml` (rewrote)
- `frontend/admin/js/script.js:4159` — `selectClient` (contract preserved)
- `frontend/admin/js/script.js:4315` — `buildClientListRowHtml` call site (3-arg signature unchanged)
- `frontend/admin/css/style.css:3537` — `.ai-client-row` (extended with padding override)
- `frontend/admin/css/style.css:3563` — `.ai-client-pending-num` (new rule)
- `frontend/admin/index.html:13,1518` — cache-bust bumped 293→294, 297→298

### Alignment with Research
Codebase pattern already matched the "extend CSS tokens, don't hardcode" principle (DL-330 only used design tokens). DL-332 continues that. No divergence.

### Dependencies
None beyond the existing design-system.css tokens.

## 5. Technical Constraints & Risks
- **Mobile path must not render via `buildClientListRowHtml`.** Verified in `script.js` at `renderAICards` dispatch — mobile branch calls `buildClientAccordionHtml`, not `buildClientListRowHtml`. Zero mobile impact.
- **DL-306 deep-link contract** — `?client=X` matches against `[data-client="…"]`. Attribute preserved.
- **DL-053 silent-refresh** — idempotent rewrite across polls. Function is pure over its 3 args; safe.
- **DL-278 scroll-into-view** — targets `.ai-client-row.active`. Class chain preserved.
- **Colorblind users** — amber `--warning-500` + `font-weight: 500` gives two channels. Verified against WCAG 1.4.1.
- **Breaking changes:** none. DOM signatures and event hooks unchanged.

## 6. Proposed Solution

### Success Criteria
12+ clients visible on 1080p laptop (vs. ~6 today). No loss of information. No regressions in DL-330/306/053/278.

### Visual Spec

Row layout (RTL), target height 40–44px (acceptable: 46–48px):
```
[folder-open — start/visual-right]  [name 14px/500]   [pending# amber 14px/500 — end/visual-left]
                                     [X/Y [reviewed-label] 12px muted]
```

- No per-row border beyond the 1px bottom separator.
- No `user` icon.
- Selected row: `--brand-50` fill + 3px `--brand-500` inline-start border; pending number demoted to `--gray-700`; subtitle demoted to `--gray-600`.
- Zero-pending clients: render nothing in the pending slot.
- Amber pending number: `--warning-500`, `font-weight: 500`, `padding-inline: --sp-2`. Hebrew tooltip "N [pending-label]" on hover for screen readers.

### Data Structures / Schema Changes
None.

### Files Changed

| File | Action | Description |
|---|---|---|
| `frontend/admin/js/script.js` | Modified | `buildClientListRowHtml` (4095–4132): drop user icon, drop pill badges, inline `.ai-client-pending-num` for pending > 0, empty string for zero-pending, reorder DOM to actions→title→stats, `flex: 1` + `font-weight: 500` on title |
| `frontend/admin/css/style.css` | Modified | `.ai-client-row` (3537): padding override `--sp-2/--sp-3`, `min-height: 0`. `.ai-client-progress` (3554): added `.active` override → `--gray-600`. New `.ai-client-pending-num` (3563): `--text-sm`, `fw-500`, `--warning-500`, active→`--gray-700` |
| `frontend/admin/index.html` | Modified | `style.css?v=293 → 294`, `script.js?v=297 → 298` |
| `.agent/design-logs/ai-review/332-ai-review-pane1-density.md` | Created | This log |
| `.agent/design-logs/INDEX.md` | Modified | Added DL-332 row |
| `.agent/current-status.md` | Modified | Added DL-332 section + Active TODOs |

### Final Step (Always)
Update DL status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 items to `current-status.md` Active TODOs. Commit on `DL-332-ai-review-pane1-density`, push feature branch, pause for merge approval.

## 7. Validation Plan
- [ ] 12+ clients visible on 1920×1080 at standard zoom.
- [ ] 9+ clients visible on 1366×768.
- [ ] Row height measures 40–44px via DevTools; 46–48px acceptable if subtitle cramps at lower bound.
- [ ] Subtitle "X/Y [reviewed-label]" remains legible at 12px in both default and selected-row states (eye-check at 100% zoom on 1080p).
- [ ] Pending count renders as amber number only (no pill background), `font-weight: 500`. Distinguishable under Chrome DevTools deuteranopia/protanopia simulator.
- [ ] Clients with 0 pending render nothing in the pending slot (not a ✓, not a pill). Does not read as "broken row".
- [ ] Selected row: `--brand-50` fill + `--brand-500` start border retained; pending number renders as `--gray-700` on selected.
- [ ] Hover state unchanged (`--gray-50` fill).
- [ ] User icon gone from rows; folder-open icon still on start side (visual-right in RTL), clickable without triggering row selection.
- [ ] Click row → `selectClient` fires, pane 2 re-renders, `.active` moves (DL-330 contract intact).
- [ ] Deep-link `?client=X` still auto-selects the correct row (DL-306).
- [ ] DL-053 silent-refresh tick leaves the selected row highlighted and in place.
- [ ] Mobile (<768px) layout visually unchanged — screenshot compare.
- [ ] `style.css?v=294` and `script.js?v=298` bumped; hard reload loads the new files.
- [ ] No console errors on tab open / client switch / silent-refresh tick.
- [ ] No regression on DL-075, DL-109, DL-278, DL-306, DL-330.

## 8. Implementation Notes (Post-Code)
- **Token deviation:** `--warning-600` doesn't exist in `design-system.css` — only `--warning-{50,100,500,700}`. Used `--warning-500` (pure amber). `--warning-700` reads as dark brown and would be confusing.
- **Implementation via `/subagent-driven-development`:** Workstream A (CSS) + Workstream B (JS) dispatched in parallel; both landed in one auto-commit (`34c49c9`) with a slightly mislabeled subject ("workstream B") — left as-is (per memory "never amend unless asked"). Workstream C (cache-bust + docs) ran inline as a follow-up commit.
- **Zero-pending fallback:** not built by default. Reserved for contingency if live testing shows blank slot reads as broken. If escalated, add `.ai-client-done-mark` rule with `✓` + `--gray-400`.
- **`font-weight: 500` inline on the name div** (rather than in CSS) — kept in the JS function so the markup is self-describing without requiring CSS readers to know the weight rule lives elsewhere. Acceptable because the function has two other inline style attrs already.
