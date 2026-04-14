# DL-123: Contextual Action Menu UX Research

**Date:** 2026-03-08
**Type:** UX Research
**Status:** Complete

---

## Sources

### Source 1: Nielsen Norman Group — "Designing Effective Contextual Menus: 10 Guidelines"
**URL:** https://www.nngroup.com/articles/contextual-menus-guidelines/

**Key Takeaways:**
1. **Reserve contextual menus for secondary, non-critical actions** that users need occasionally. Primary, high-frequency actions should remain visible in the UI — never hidden behind a kebab/meatball menu.
2. **Use kebab (vertical dots) for item-specific actions; hamburger for global navigation.** Never mix these — it breaks user mental models. Use the same icon consistently across the entire product.
3. **Never create single-item menus.** If there are only 1-2 actions, show them directly in the row. A menu adds a click for no benefit.
4. **Add clarifying labels** — instead of a generic three-dot icon, consider labels like "Actions" or tooltips. These icons have inherently low information scent.
5. **Group related actions only** — mixing unrelated functions in one menu increases cognitive load and reduces findability.

---

### Source 2: Nielsen Norman Group — "Confirmation Dialogs Can Prevent User Errors (If Not Overused)"
**URL:** https://www.nngroup.com/articles/confirmation-dialog/

**Key Takeaways:**
1. **Confirmation dialogs only work for high-stakes, irreversible actions.** Overuse causes "dialog fatigue" — users develop automated "click Yes" responses and stop reading the content entirely.
2. **Specificity is critical.** Vague "Are you sure?" dialogs fail. Effective dialogs name the specific item and consequence (e.g., "Delete report for Moshe Cohen — 2025? This cannot be undone.").
3. **Use action-oriented button labels** — "Delete file" / "Keep file" instead of "Yes" / "No" or "OK" / "Cancel".
4. **Prefer undo over confirmation** for reversible actions. Undo catches errors after they happen with less friction. Only use confirmation when there is no undo path.
5. **For truly critical operations, require non-standard input** — e.g., typing "DELETE" (Mailchimp pattern) to prevent automated clicking.

---

### Source 3: Smashing Magazine — "How To Manage Dangerous Actions In User Interfaces"
**URL:** https://www.smashingmagazine.com/2024/09/how-manage-dangerous-actions-user-interfaces/

**Key Takeaways:**
1. **Severity ladder for confirmation patterns:**
   - **Low risk, reversible:** No confirmation needed — use undo/snackbar (e.g., archiving)
   - **Medium risk:** Inline guard — button label changes on first click, requires second click to confirm
   - **High risk, irreversible:** Modal confirmation dialog with specific consequences stated
   - **Critical/financial:** Two-factor or second-person approval
2. **Visual distinction for destructive actions:** Red backgrounds/borders, warning icons, AND specific verb+noun labels ("Delete Project X" not "Confirm"). Color alone is insufficient — colorblind users need icon + text redundancy.
3. **Danger Zones pattern:** Group all irreversible actions in a visually distinct section with red borders and warning icons. Consider a dedicated settings page if many dangerous actions exist.
4. **Psychological barriers** to confirmation effectiveness: cognitive inertia (users repeat familiar clicks), availability heuristic, cognitive miser tendency, banner blindness. This is why undo is often more effective than asking permission.

---

### Source 4: Smashing Magazine — "Hidden vs. Disabled In UX"
**URL:** https://www.smashingmagazine.com/2024/05/hidden-vs-disabled-ux/

**Key Takeaways:**
1. **Decision framework for state-dependent actions:**
   - **Will this user EVER be able to use this action?** No → Hide it (permission-based, role-based)
   - **Is this action temporarily unavailable?** Yes → Disable it with explanation
   - **Is this action irrelevant in current context?** → Hide it (don't pollute the menu)
2. **Disabled items MUST include explanations** — why it's disabled and what the user needs to do to enable it. Use tooltips on hover of the disabled item.
3. **Never auto-remove items users have seen before** — this causes confusion ("where did that option go?"). If toggling visibility, preserve layout stability to prevent disorientation.
4. **Default to disabled over hidden** when the item teaches the user about available features. Default to hidden when the item would only confuse the user in the current context.

---

### Source 5: Linear App — "Invisible Details: Building Contextual Menus"
**URL:** https://linear.app/now/invisible-details

**Key Takeaways:**
1. **Comprehensive action coverage from one menu.** Linear puts nearly every issue action in the context menu: status changes, priority, assignment, estimates, blocking relationships, duplicates, cycle management, archival. Users rarely need to navigate elsewhere.
2. **Context menu as onboarding tool.** Every action shows its keyboard shortcut alongside the label. Users learn shortcuts organically by seeing them repeatedly while using the mouse.
3. **Triangle submenu pattern** — when hovering toward a submenu, Linear draws an invisible CSS `clip-path` triangle between the cursor and the submenu bounds. This prevents the submenu from closing during diagonal mouse movement (a 40-line React component solving a problem most web apps ignore).
4. **Right-click OR Cmd+K** — both open contextual actions. The command palette (`Cmd+K`) provides the same actions with search, making the menu accessible via keyboard-first workflows.

---

### Source 6: PatternFly Design System — Menu Component Guidelines
**URL:** https://www.patternfly.org/components/menus/menu/design-guidelines/

**Key Takeaways:**
1. **Group actions with headings and/or separators.** Use titled groups when categories are meaningful; use separators alone when grouping is obvious from context.
2. **Destructive items must be visually separated** — use a divider line above destructive actions AND apply danger text styling (red text). This is a two-layer visual signal.
3. **Icons only when they add recognition value** — never decorative. Best paired with brief verb-based labels ("Save", "Delete", "Archive"). If some items have icons and others don't, the inconsistency looks broken — either all items get icons or none do.
4. **Disabled items with tooltips** — when an action is unavailable due to unmet prerequisites, disable it and show a tooltip explaining what the user needs to do. If the action is impossible due to product constraints, hide it entirely.

---

### Source 7: Dell Design System — Action Menu Component
**URL:** https://www.delldesignsystem.com/components/action-menu

**Key Takeaways:**
1. **Destructive actions always at the bottom**, visually separated by a divider. This is the most universally agreed-upon convention across design systems.
2. **Inactive (disabled) state for context-dependent items** — if an action doesn't apply to the current state, disable it rather than hide it (preserves menu structure and teaches available features).
3. **Avoid ambiguous trigger icons** — don't use gear or menu-closed icons for action menus. Use the overflow icon (three dots) exclusively. Labels should be "clear, concise, and consistent."

---

### Source 8: Pencil & Paper — "Data Table Design UX Patterns & Best Practices"
**URL:** https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables

**Key Takeaways:**
1. **Tables are inherently dense — don't overload rows with buttons.** Use progressive disclosure: show a three-dot menu icon per row, reveal actions on click. Only the most frequent 1-2 actions (e.g., "Edit") should be visible without a menu.
2. **Row hover reveals action affordances** — cursor changes (pointer for clickable, text cursor for editable) signal interaction type without cluttering the default view.
3. **Bulk actions appear only when rows are selected** — showing a contextual action bar above the table when checkboxes are active. This prevents UI from showing irrelevant controls when no selection exists.

---

## Consolidated Patterns for Our Admin Panel

### Action Organization (by frequency/importance)

| Tier | Visibility | Examples |
|------|-----------|----------|
| **Primary (most frequent)** | Always visible as inline buttons/links in the row | Edit, View |
| **Secondary (occasional)** | Inside kebab/three-dot action menu | Change stage, Send email, Assign |
| **Destructive (rare)** | Bottom of action menu, separated by divider, red text | Delete, Deactivate |

### When to Use Confirm Dialogs vs. Immediate Actions

| Action Type | Pattern | Example |
|-------------|---------|---------|
| **Reversible, low risk** | Immediate action + undo snackbar | Archive client, Mark as read |
| **State change, medium risk** | Immediate action + toast notification | Change stage, Send reminder |
| **Irreversible, high risk** | Confirmation dialog with specific consequences | Delete report, Deactivate client |
| **Bulk destructive** | Confirmation dialog showing count + specific items | "Delete 5 selected reports?" |

### Icon + Label Conventions

- **Normal actions:** Neutral-color icon + verb label ("Edit", "Send Email", "Change Stage")
- **Destructive actions:** Red icon + red verb label ("Delete", "Deactivate"), separated by divider at bottom of menu
- **Disabled actions:** Grayed-out text + tooltip explaining why disabled and how to enable
- **All items in a menu should either ALL have icons or NONE have icons** — inconsistency looks broken

### State-Dependent / Contextual Actions

| Pattern | When to Use | Example |
|---------|------------|---------|
| **Hide** | Action is impossible / irrelevant for this state | "Send questionnaire" hidden for stage 5+ |
| **Disable + tooltip** | Action exists but prerequisites unmet | "Approve" disabled with "Upload documents first" |
| **Show conditionally** | Action only makes sense in specific states | "Mark complete" only for stage 6 |
| **Change label** | Same action, different wording by state | "Resend" vs. "Send" depending on history |
