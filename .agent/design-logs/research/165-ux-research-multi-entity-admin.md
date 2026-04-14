# DL-165: UX Research — Multi-Entity Admin Dashboard Patterns

**Status:** Research Complete
**Date:** 2026-03-19
**Context:** Hebrew RTL admin panel managing two filing types (annual reports + capital statements) in the same interface.

---

## 1. Tabbed vs. Filtered Dashboards

### Key Findings

**NNGroup — "Tabs, Used Right"** ([source](https://www.nngroup.com/articles/tabs-used-right/))
- **In-page tabs** organize related content within a single page — they are NOT navigation, they alter what's displayed in the panel.
- **Navigation tabs** navigate to different pages with dissimilar content.
- **CRITICAL: Never mix in-page and navigation tabs** in one tab control — it disorients users.
- Tabs suit **a few long sections**; accordions suit **many short sections**.

**NNGroup — "Filters vs. Facets"** ([source](https://www.nngroup.com/articles/filters-vs-facets/))
- Tabs work when there are **mutually exclusive categories** (e.g., entity types).
- Filters work when users need to **combine multiple dimensions** (status + date + assignee).
- If only one option can be selected at a time → tabs. If multi-select → filters/facets.

**Application to our case:**
- Filing type (Annual Report vs. Capital Statement) is **mutually exclusive per client** → tabs or a single toggle/filter are both valid.
- Since our admin already uses filters (stage, year, search), adding filing type as **another filter** is more consistent than introducing tabs that would duplicate the entire table.
- **Recommendation:** Add filing type as a **filter chip / dropdown** alongside existing stage filters, NOT as top-level tabs. Tabs would imply two separate dashboards with different schemas — our data shares the same schema.

**Anti-patterns to avoid:**
- Don't use tabs if the two views share >80% of the same columns — it fragments a unified view.
- Don't nest tabs inside tabs.
- Don't use tabs as a substitute for proper filtering when the user might want to see both types at once (e.g., "all clients in Review stage regardless of filing type").

---

## 2. Grouped / Expandable Table Rows

### Key Findings

**Cloudscape Design System — "Table with Expandable Rows"** ([source](https://cloudscape.design/patterns/resource-management/view/table-with-expandable-rows/))
- Use expandable rows when data has **multiple levels of hierarchy** and you need to preserve in-page context.
- Pagination applies only to **top-level rows** — child rows don't count toward page size.
- Progressive loading for parents with many children.

**Medium/Bootcamp — "Designing Nested Tables"** ([source](https://medium.com/design-bootcamp/designing-nested-tables-the-ux-of-showing-complex-data-without-creating-chaos-0b25f8bdd7d9))
- **Indent child rows** to create clear parent-child visual relationship.
- **Two levels max** (Parent > Child) is manageable. Three+ levels = redesign.
- Keyboard navigation: tab through parent/child rows, expand/collapse with Enter/Space.

**Pencil & Paper — "Enterprise Data Tables"** ([source](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables))
- Row grouping works well for **categorization** (group by status, group by type).
- Expandable rows work well for **detail-on-demand** (click row to see child records).

**Application to our case:**
- We do NOT have parent-child hierarchy between filing types — they are **sibling entities** on the same client.
- Expandable rows would be useful for showing a client's **documents** under their row, not for showing filing types.
- **Recommendation:** Keep flat table rows. If a client has both filing types, show them as **separate rows** (one per filing type) with a visual indicator linking them. Or use a client detail panel that shows both filing types.

**Anti-patterns to avoid:**
- Don't use expandable rows just to hide information that should be visible at scan level.
- Don't expand rows automatically — always user-initiated.
- Don't nest more than 2 levels deep.

---

## 3. RTL Admin Panel Design

### Key Findings

**Material Design — Bidirectionality** ([source](https://m2.material.io/design/usability/bidirectionality.html))
- Mirror the **entire layout**: navigation, buttons, padding, margins.
- Primary/secondary buttons swap positions (primary on LEFT in RTL).
- Checkboxes go to the RIGHT of text.
- Progress bars flow right-to-left.
- **Do NOT mirror:** symmetric icons, media playback controls, timestamps, phone numbers.
- LTR content (URLs, code, English text) stays LTR even inside an RTL layout.

**Material Design 3 — Bidirectionality** ([source](https://m3.material.io/foundations/layout/understanding-layout/bidirectionality-rtl))
- Layout grid, margins, and gutters all mirror.
- Navigation drawers open from the right.

**Smashing Magazine — "Right-To-Left Development"** ([source](https://www.smashingmagazine.com/2017/11/right-to-left-mobile-design/))
- Set `dir="rtl"` on the `<html>` tag as the foundation.
- Use logical CSS properties (`margin-inline-start` instead of `margin-left`).

**Application to our case:**
- Our admin panel is already Hebrew-first RTL — this is established.
- Key consideration for multi-type: filter chips and column headers must **read naturally in RTL scanning order** (right to left).
- Status badges, action buttons in row menus — already mirrored correctly.
- **Watch for:** English filing type labels ("Annual Report") embedded in Hebrew UI — they should stay LTR within the RTL flow. Use `<bdi>` or `dir="auto"` on mixed-language cells.

**Anti-patterns to avoid:**
- Don't just flip CSS with `transform: scaleX(-1)` — it breaks text rendering.
- Don't mirror icons that are universal (checkmarks, plus signs, X close).
- Don't forget to mirror table column order if adding new columns.

---

## 4. Multi-Type Bulk Import UX

### Key Findings

**Smashing Magazine — "Designing An Attractive Data Importer"** ([source](https://www.smashingmagazine.com/2020/12/designing-attractive-usable-data-importer-app/))
- Core pipeline: **File → Map → Validate → Submit** (4-step wizard).
- Auto-detect column mapping where possible, let user correct.
- Show **real-time preview** of how data will look after import.

**Smart Interface Design Patterns — "Bulk Import UX"** ([source](https://smart-interface-design-patterns.com/articles/bulk-ux/))
- For multi-type imports: define **core attributes** per type, then type-specific attributes.
- Type selector should come **before** file upload so the system knows which schema to validate against.

**OneSchema — "Building a CSV Uploader"** ([source](https://www.oneschema.co/blog/building-a-csv-uploader))
- Header validation upfront before column mapping.
- Tooltips next to fields with frequent errors.
- In-line error editing (fix errors in the UI, not by re-uploading).

**Application to our case:**
- Our existing import is for annual report clients. Adding capital statements means:
  1. Add a **type selector** (radio/toggle) as the **first step** before file upload.
  2. Validate columns against the selected type's schema.
  3. Preview should show type-specific fields highlighted.
- **Recommendation:** Simple radio button at top of import dialog: "Annual Report" / "Capital Statement". This sets the context for validation and default field mapping.

**Anti-patterns to avoid:**
- Don't try to auto-detect the filing type from CSV content — let the user declare it explicitly.
- Don't show all possible columns from both types in one mapping screen — show only columns relevant to the selected type.
- Don't allow mixed-type rows in a single CSV — one import = one type.

---

## Summary: Recommendations for Our Admin Panel

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Filing type switching | **Filter dropdown/chip**, not tabs | Same schema, same table — filter is additive, tabs are fragmenting |
| Default view | Show **all filing types** by default | Admin needs full picture; filter to narrow |
| Table structure | **Flat rows** with filing-type badge column | No parent-child relationship between types |
| Bulk import | **Type selector radio** before file upload | Set schema context upfront |
| RTL considerations | Use `<bdi>` for English type labels in Hebrew UI | Prevent BiDi text reordering |

---

## Sources

1. [Tabs, Used Right — NNGroup](https://www.nngroup.com/articles/tabs-used-right/)
2. [Filters vs. Facets — NNGroup](https://www.nngroup.com/articles/filters-vs-facets/)
3. [8 Design Guidelines for Complex Applications — NNGroup](https://www.nngroup.com/articles/complex-application-design/)
4. [Table with Expandable Rows — Cloudscape Design](https://cloudscape.design/patterns/resource-management/view/table-with-expandable-rows/)
5. [Designing Nested Tables — Medium/Bootcamp](https://medium.com/design-bootcamp/designing-nested-tables-the-ux-of-showing-complex-data-without-creating-chaos-0b25f8bdd7d9)
6. [Enterprise Data Tables — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)
7. [Bidirectionality — Material Design](https://m2.material.io/design/usability/bidirectionality.html)
8. [Bidirectionality — Material Design 3](https://m3.material.io/foundations/layout/understanding-layout/bidirectionality-rtl)
9. [Right-To-Left Development — Smashing Magazine](https://www.smashingmagazine.com/2017/11/right-to-left-mobile-design/)
10. [Designing An Attractive Data Importer — Smashing Magazine](https://www.smashingmagazine.com/2020/12/designing-attractive-usable-data-importer-app/)
11. [Bulk Import UX — Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/bulk-ux/)
12. [Building a CSV Uploader — OneSchema](https://www.oneschema.co/blog/building-a-csv-uploader)
