# Tabbed Multi-Report Document Views — UX & API Research

Research date: 2026-03-29
Context: Client portal needs to show multiple filing types (annual reports, capital statements) for the same client in a single page with tabs.

---

## 1. Tabbed Document Views — Data Loading Patterns

### Sources
- [Lazy Loading vs Eager Loading (LogRocket)](https://blog.logrocket.com/lazy-loading-vs-eager-loading/)
- [Lazy Tab Navigation System (meshcloud)](https://www.meshcloud.io/en/blog/how-to-implement-a-lazy-tab-navigation-system-in-angular/)
- [Inclusive Tabbed Interfaces (Heydon Pickering)](https://inclusive-components.design/tabbed-interfaces/)
- [Tabbed Interface Design Pattern (Canada.ca)](https://design.canada.ca/common-design-patterns/tabbed-interface.html)
- [High-Performance Tab Component (freeCodeCamp)](https://www.freecodecamp.org/news/build-a-high-performance-tab-component/)
- [TanStack Query Cross-Tab Cache (GitHub)](https://github.com/tannerlinsley/react-query/issues/336)
- [Dynamic Tabs with URL Params (React Router Discussion)](https://github.com/remix-run/react-router/discussions/11040)

### Key Takeaways

**Lazy loading (load on tab switch) is the recommended default** for tabs that fetch different API data:
- Reduces initial page load — only the active tab's data is fetched upfront
- Each tab fetches its data once on first activation, then caches it in memory
- Subsequent tab switches show cached data instantly (no re-fetch)
- Stale data strategy: optionally re-fetch in the background if the data could have changed

**Cache-on-first-load pattern (recommended for our case):**
```
Tab A clicked → check memory cache → miss → fetch API → store in cache → render
Tab B clicked → check memory cache → miss → fetch API → store in cache → render
Tab A clicked again → check memory cache → hit → render immediately (no fetch)
```

**When eager loading is acceptable:**
- When there are only 2-3 tabs with small payloads
- When the user will almost certainly visit all tabs in a session
- When you can fetch all tab data in a single API call (e.g., API returns all filing types at once)

**When lazy loading is mandatory:**
- 4+ tabs or large payloads
- When most users only care about one tab
- When tab data requires expensive server-side computation

### Recommended Pattern for Our Use Case

**Hybrid approach:** Since we likely have 2 filing types (annual reports + capital statements), and the client portal already fetches report data:

1. **Primary tab (annual reports):** Load immediately on page load (this is the existing behavior)
2. **Secondary tabs (capital statements, future types):** Lazy-load on first tab click, cache in a `tabDataCache` object keyed by `filing_type`
3. **Tab switch:** Check `tabDataCache[filingType]` first. If populated, render from cache. If not, show skeleton/spinner and fetch.
4. **URL state:** Encode active tab in URL hash (`#tab=capital-statements`) so direct links work and browser back button preserves tab state.

### Anti-Patterns to Avoid
- **Re-fetching on every tab switch** — wastes bandwidth, causes flickering
- **Destroying DOM on tab hide** — loses scroll position, form state, upload progress
- **No loading state on first tab load** — user sees empty content, thinks it's broken
- **Tabs that look clickable but require full page navigation** — breaks mental model
- **Eager loading all tabs when most users only need one** — unnecessary server load

---

## 2. Sibling Entity Discovery — API Design

### Sources
- [REST API Design for Sub and Nested Resources (Moesif)](https://www.moesif.com/blog/technical/api-design/REST-API-Design-Best-Practices-for-Sub-and-Nested-Resources/)
- [Nested Entities Best Practices (Medium)](https://medium.com/@bourgeoistomas/nested-entities-in-your-api-rest-response-best-practices-and-trade-offs-81260ec49b90)
- [HATEOAS Links (Neurosys)](https://neurosys.com/blog/hateoas-links)
- [REST API Best Practices (Stack Overflow)](https://stackoverflow.blog/2020/03/02/best-practices-for-rest-api-design/)
- [API Filtering Conventions (Medium)](https://medium.com/api-center/api-bites-filtering-conventions-8a1a19c03975)
- [REST API Filtering Best Practices (Speakeasy)](https://www.speakeasy.com/api-design/filtering-responses)

### The Problem
When a client accesses their annual report (entity A), the system needs to discover if they also have a capital statement (entity B). Both are children of the same client (parent).

### Three Patterns Compared

**Pattern A: Client passes parent_id, frontend discovers siblings**
```
GET /client-portal?token=abc&year=2025&filing_type=annual
→ Returns annual report data

Frontend then calls:
GET /client-reports?client_id=123
→ Returns [{filing_type: "annual", year: 2025}, {filing_type: "capital", year: 2025}]
```
- Pro: Clean separation, each call does one thing
- Con: Extra round-trip, frontend needs to know about the discovery endpoint
- Con: Client token auth complicates a second "list my reports" call

**Pattern B: API returns sibling metadata alongside primary data (RECOMMENDED)**
```
GET /client-portal?token=abc&year=2025&filing_type=annual
→ Returns {
    report: { ... annual report data ... },
    sibling_reports: [
      { filing_type: "capital_statement", year: 2025, label: "הצהרת הון", token: "xyz" }
    ]
  }
```
- Pro: Single round-trip, no extra endpoint needed
- Pro: Server already knows the client — trivial to query siblings
- Pro: Server can include pre-computed tokens/URLs for each sibling
- Con: Slightly larger response, but sibling metadata is tiny (~100 bytes each)

**Pattern C: API always returns all filing types in one response**
```
GET /client-portal?token=abc&year=2025
→ Returns {
    reports: {
      annual: { documents: [...], progress: ... },
      capital_statement: { documents: [...], progress: ... }
    }
  }
```
- Pro: Single call, all data at once
- Con: Heavy payload if client has many filing types
- Con: Can't lazy-load tabs — all data comes at once
- Con: Breaking change to existing API contract

### Recommended Pattern for Our Use Case

**Pattern B (sibling metadata in response)** is the best fit because:
1. The existing token-based auth already identifies the client — server can cheaply query siblings
2. Sibling metadata is lightweight (just type + label + token/URL per sibling)
3. Frontend uses sibling list to render tabs, then lazy-loads each tab's full data on click
4. No breaking change to existing API — add `sibling_reports` field to response
5. Each sibling report's token allows the frontend to fetch its data independently

**API flow:**
```
1. Page loads with token for annual report
2. GET /client-portal?token=abc → returns annual data + sibling_reports[]
3. Frontend renders tabs: [Annual Reports (active)] [Capital Statement]
4. User clicks Capital Statement tab
5. GET /client-portal?token=xyz (sibling's token) → returns capital statement data
6. Cache in memory, render tab content
```

### Anti-Patterns to Avoid
- **Requiring frontend to know parent_id** — leaks internal IDs, adds complexity
- **Separate "list reports" endpoint with different auth** — auth model mismatch
- **Returning full data for all siblings in one call** — defeats lazy loading
- **No sibling discovery at all** — user must navigate away to find other reports

---

## 3. Progress Tracking Across Tabs

### Sources
- [Progress Trackers in Web Design (Smashing Magazine)](https://www.smashingmagazine.com/2010/01/progress-trackers-in-web-design-examples-and-best-design-practices/)
- [Progress Bar Design Best Practices (UX Planet)](https://uxplanet.org/progress-bar-design-best-practices-526f4d0a3c30)
- [How to Design Better Progress Trackers (UXPin)](https://www.uxpin.com/studio/blog/design-progress-trackers/)
- [Progress Trackers and Indicators (UserGuiding)](https://userguiding.com/blog/progress-trackers-and-indicators)
- [Dashboard Design Best Practices (Justinmind)](https://www.justinmind.com/ui-design/dashboard-design-best-practices-ux)
- [UX Patterns for Data Dashboards (Pencil & Paper)](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards)
- [PatternFly Progress Component](https://www.patternfly.org/components/progress/design-guidelines/)

### Key Takeaways

**Two-tier progress is the standard pattern for multi-section trackers:**
1. **Global summary** — fixed position at top, shows aggregate across all sections
2. **Per-section detail** — within each tab/section, shows that section's specific progress

**Research findings:**
- Users scan in F/Z patterns — put the most important (global) metric top-left
- A single global progress bar prevents user overwhelm when multiple sections exist
- Update progress immediately when a step completes (real-time feedback)
- Fixed position for the tracker so users can always reference it
- Color coding helps distinguish complete vs in-progress vs not-started

### Recommended Pattern for Our Use Case

**Header-level aggregate + per-tab detail:**

```
┌──────────────────────────────────────────────────┐
│  Overall: 12/18 documents received (67%)  [████████░░░░] │  ← Global, always visible
├──────────────────────────────────────────────────┤
│  [Annual Reports (8/12)] [Capital Statement (4/6)]       │  ← Tab labels include counts
├──────────────────────────────────────────────────┤
│                                                          │
│  Annual Reports Progress: 8/12  [████████░░░░]           │  ← Per-tab detail
│  ... document list ...                                   │
└──────────────────────────────────────────────────┘
```

**Key design decisions:**

1. **Tab labels show per-tab counts** — e.g., "Annual Reports (8/12)" so users see status without clicking
2. **Global progress header** sums all tabs — `total_received / total_required` across all filing types
3. **Per-tab progress bar** shows within the active tab's content area
4. **Global progress updates in real-time** when documents are uploaded in any tab
5. **Color states:** Green (complete), Blue (in-progress), Gray (not started per tab)

**Computation approach:**
- Each tab's API response includes `docs_received` and `docs_total` for that filing type
- Frontend sums across all cached tab data for the global number
- If a tab hasn't been loaded yet, use sibling metadata counts (from Pattern B above) for the global sum — the sibling_reports response should include `docs_received` and `docs_total` per sibling

### Anti-Patterns to Avoid
- **Only showing progress for the active tab** — user loses sight of overall status
- **Global progress that doesn't update when tab data loads** — inconsistent numbers
- **Progress bars without numbers** — "67%" alone is less useful than "12/18 docs"
- **Hiding progress for tabs not yet loaded** — show counts from sibling metadata even before full data loads
- **Animating progress on every tab switch** — distracting, only animate on actual progress change

---

## Summary: Recommended Architecture

```
Page Load:
  1. Fetch primary report (existing token) → get report data + sibling_reports[]
  2. Render tabs from sibling_reports (each has label, type, token, doc counts)
  3. Show global progress from primary + sibling summary counts
  4. Active tab shows full document list

Tab Switch:
  1. Check tabDataCache[filingType]
  2. If cached → render immediately
  3. If not cached → show skeleton, fetch via sibling token, cache, render
  4. Update global progress with actual counts (replacing summary estimates)

Progress Display:
  - Header: "Overall: X/Y documents (Z%)" — always visible
  - Tab labels: "Filing Type (received/total)" — visible without clicking
  - Tab content: detailed progress bar + document list
```
