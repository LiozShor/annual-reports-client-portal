# Design Log 075: AI Review — Master-Detail Document Preview
**Status:** [IMPLEMENTED]
**Date:** 2026-03-02
**Related Logs:** 045 (Document Manager File Actions — CSP research), 035 (WF05 AI Classification + OneDrive), 051 (OneDrive Persistent File Links)

## 1. Context & Problem

The AI Review tab in the admin panel shows classified document cards. When staff review AI classifications, they often need to see the actual document to verify the AI's classification is correct. Currently, the only option is "פתח בקובץ" which opens the file in a new tab — breaking the review flow and requiring constant tab-switching.

An inline preview would let staff glance at the document without leaving the review interface, making classification decisions faster and more accurate.

## 2. User Requirements

1. **Q:** Where should the preview appear?
   **A:** Inside the card (inline) — expand the card to show the iframe preview below the classification info.

2. **Q:** Is the SharePoint embed URL already stored in Airtable?
   **A:** The `onedrive_item_id` exists in Airtable. The embed URL needs to be generated via MS Graph API.

3. **Q:** Should the preview be visible by default or toggled?
   **A:** Toggle button — "תצוגה מקדימה" (Preview). Saves bandwidth and screen space.

4. **Q:** Have you tested embed.aspx on GitHub Pages?
   **A:** Not tested yet, but research confirmed it won't work (CSP blocks it).

5. **Q:** How to handle the CSP blocker?
   **A:** Use Microsoft Graph API `POST /driveItem/preview` endpoint for short-lived embeddable URLs.

6. **Q:** Layout preference — inline card expand or split-view?
   **A:** Master-detail split-view. Right column (~450px) = scrollable card list. Left column (~60-70%) = sticky preview panel. Full screen utilization, no empty white space.

7. **Q:** Mobile behavior?
   **A:** Hide preview panel on mobile. Cards only with "open in new tab" fallback.

8. **Q:** Stats/filter bar placement?
   **A:** Above the split (full width, spanning both columns).

## 3. Research

### Domain
Document Preview UX, iframe Embedding, Microsoft Graph API, Progressive Disclosure

### Sources Consulted
1. **Microsoft Learn — driveItem: preview API** — POST /drives/{driveId}/items/{itemId}/preview returns a short-lived `getUrl` for embeddable previews. Works cross-origin. Requires `Files.Read` permission.
2. **Microsoft Learn — CSP/X-Frame-Options** — SharePoint embed.aspx has `X-Frame-Options: SAMEORIGIN` on all .aspx pages. Cannot be changed. Confirmed "by design."
3. **"Don't Make Me Think" — Steve Krug** — Progressive disclosure: show only essential info upfront, reveal more on explicit user action. Cards should be collapsed by default.
4. **Nielsen Norman Group — Progressive Disclosure** — Must correctly split primary vs. secondary content. The preview trigger must be visually obvious with a clear label.
5. **Nielsen Norman Group — Accordions on Desktop** — Accordions work well when sections are independent. In high-volume review, minimize interaction cost with fast expand/collapse.
6. **Nielsen Norman Group — Skeleton Screens** — Use skeleton screen (gray placeholder matching content shape) for 2-10 second loads. Must match final content shape.
7. **"Every Layout" — Heydon Pickering** — Use `aspect-ratio: 3/4` for A4 portrait documents with `width: 100%`. Modern CSS replaces the padding-top hack.
8. **Real-world product patterns** — Notion, GitHub, Monday.com all converge on: collapsed list → one-click inline preview → optional full-view escape hatch.

### Key Principles Extracted
- **Master-detail is the dominant pattern**: Linear, GitHub, email clients all use list + detail panel for review workflows. Best for sequential item processing where users need to see content alongside metadata (NN/G).
- **Sticky detail panel**: The preview must remain visible while scrolling the card list. `position: sticky` keeps it anchored without losing context.
- **Skeleton loading**: Show a full-height skeleton while iframe loads, not a generic spinner (NN/G).
- **Active card indicator**: Visually highlight which card's document is currently previewed. Reduces cognitive load (Krug).
- **Escape hatch**: Keep "open in new tab" as secondary action in the preview header bar.

### Patterns to Use
- **Split-view / master-detail**: CSS Grid with fixed-width card column + fluid preview column. Sticky preview panel.
- **Lazy iframe loading**: Only set `src` after user clicks a card. Preview panel shows placeholder until first selection.
- **Graph API preview proxy**: n8n webhook calls Graph API, returns short-lived URL to frontend.

### Anti-Patterns to Avoid
- **Inline expand in cards**: User explicitly rejected. Wastes screen width. Accordion interaction cost compounds with 500+ clients.
- **Direct embed.aspx**: Blocked by CSP on non-Microsoft domains.
- **Auto-loading all previews**: Only load the selected card's document.
- **Caching preview URLs**: They're short-lived (5-15 min). Fetch fresh on each card selection.

### Research Verdict
Master-detail split-view layout: card list (~450px) on the right (RTL start), sticky preview panel (~60-70%) on the left. Microsoft Graph API `POST /me/drive/items/{itemId}/preview` via n8n webhook proxy for embeddable URLs. DL-045 was correct about CSP. Mobile: hide preview, cards only.

## 4. Codebase Analysis

### Relevant Files
- `admin/js/script.js` — `renderAICard()` (line 1611) generates card HTML. `aiClassificationsData` array holds all items. Uses `fetchWithTimeout()`, `API_BASE`, `authToken` patterns.
- `admin/css/style.css` — `.ai-review-card`, `.ai-card-top`, `.ai-card-body`, `.ai-card-actions` (lines 1337-1830)
- `assets/css/design-system.css` — `.skeleton`, `.skeleton-block` (line 486) with shimmer animation
- n8n `[API] Get Pending Classifications` (`kdcWwkCQohEvABX0`) — "Build Response" node includes `onedrive_item_id` but "Apply Fresh URLs" node deletes it before response reaches frontend
- n8n credential `GcLQZwzH2xj41sV7` — MS Graph OAuth2, used by all OneDrive/email operations

### Existing Patterns
- Existing batch URL resolution uses `/me/drive/items/{id}` pattern — no explicit driveId needed
- All admin webhooks: `GET ${API_BASE}/{path}?token=${authToken}`, response `{ ok: true, data: ... }`
- Token verification: HMAC-SHA256 with shared secret `QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_`
- Lucide icons: `<i data-lucide="eye">` + `lucide.createIcons()` after DOM updates

### Alignment with Research
- Existing card structure (top/body/actions) naturally supports inserting a preview section between body and actions
- Design system has skeleton classes ready to use
- `max-height` transition pattern already used in design-system.css collapsible components

### Dependencies
- Airtable `pending_classifications.onedrive_item_id` field (exists, populated by WF05)
- MS Graph API OAuth2 credential (exists, working)
- n8n webhook infrastructure (proven pattern)

## 5. Technical Constraints & Risks

* **Security:** Preview URLs are short-lived and scoped to the OAuth app's permissions. No PII exposure beyond what the admin already has access to.
* **Risks:**
  - Preview URL expiration: If user leaves preview open for >15 min, iframe may stop working. Mitigation: close/reopen to get fresh URL.
  - `onedrive_item_id` may be null for older classifications uploaded before WF05 started storing it. Preview button only renders when field is truthy.
  - MS Graph rate limiting: preview endpoint has standard throttling. With one-at-a-time behavior, this is a non-issue.
* **Breaking Changes:** None. Adding a new div and button is purely additive. Existing "open in new tab" behavior unchanged.

## 6. Proposed Solution (The Blueprint)

### Layout
```
┌────────────────────────────────────────────────────┐
│  Stats Bar (full width)                            │
├────────────────────────────────────────────────────┤
│  Filter Bar (full width)                           │
├──────────────────────────────┬─────────────────────┤
│  Preview Panel (sticky)      │  Card List (scroll) │
│  flex: 1 (~60-70%)           │  ~450px fixed       │
│  position: sticky; top: 80px │  Scrollable master  │
│  [iframe or placeholder]     │  [accordion cards]  │
└──────────────────────────────┴─────────────────────┘
          LEFT (end in RTL)         RIGHT (start in RTL)
```

CSS Grid: `grid-template-columns: 450px 1fr` — in RTL, 450px lands on the right (card list), 1fr on the left (preview).

### Logic Flow
1. AI Review tab opens with split layout: cards on right, empty preview placeholder on left
2. Staff clicks any AI review card → card gets `.preview-active` highlight
3. Frontend shows skeleton loading in preview panel
4. Frontend calls `GET /get-preview-url?token=...&itemId=...` (n8n webhook)
5. n8n verifies token → calls `POST /me/drive/items/{itemId}/preview` via Graph API
6. n8n returns `{ ok: true, previewUrl: "https://..." }`
7. Frontend sets iframe `src` to the preview URL
8. Preview header bar shows filename + "open in new tab" link
9. Staff reviews document in preview panel while approving/rejecting cards in the list
10. Clicking a different card → updates preview, moves active highlight

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| n8n `kdcWwkCQohEvABX0` "Apply Fresh URLs" | Modify | Remove `delete item.onedrive_item_id` line |
| n8n (new workflow) | Create | `[API] Get Preview URL` — webhook + Graph API preview |
| `admin/index.html` | Modify | Restructure AI review tab: wrap cards + empty state in `.ai-review-split` grid with `.ai-review-master` + `.ai-review-detail` |
| `admin/css/style.css` | Modify | Add split-view grid, preview panel (sticky, elevated), preview placeholder/skeleton/error states, card active highlight, mobile hide |
| `admin/js/script.js` | Modify | Add `activePreviewItemId` state, `getDocPreviewUrl()`, `loadDocPreview()`, card click handler, reset on reload |

## 7. Validation Plan
* [ ] cURL test: `GET /get-preview-url?token=...&itemId=...` returns valid `previewUrl`
* [ ] `onedrive_item_id` visible in network tab response from `get-pending-classifications`
* [ ] Split-view layout: cards on right (~450px), preview panel on left (remaining width)
* [ ] Preview panel shows placeholder state before any card is clicked
* [ ] Clicking a card: card gets active highlight, preview loads document (skeleton → iframe)
* [ ] Clicking different card: previous deselects, new document loads in preview
* [ ] Preview header bar shows filename + "open in new tab" link
* [ ] Sticky behavior: scroll through cards → preview panel stays fixed
* [ ] Error state: card without `onedrive_item_id` → shows error in preview panel
* [ ] Mobile (<768px): preview panel hidden, cards full width, "open in new tab" still works
* [ ] Existing approve/reject/reassign buttons still work independently of preview
* [ ] No regression in card rendering for cards without `onedrive_item_id`

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
