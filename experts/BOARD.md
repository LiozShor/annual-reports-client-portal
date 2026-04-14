# The Advisory Board

> Seven experts. Seven lenses. Every task gets the thinking it deserves.

## What This Is

This is a virtual expert advisory board — a team of specialists who bring focused, opinionated thinking to every implementation task. Before writing code, you consult the relevant experts, internalize their methodology, and let their principles guide your approach.

These aren't checklists to copy. They're **thinking partners** who change how you see the problem.

---

## The Team

| Expert | File | Domain | Consult When... |
|--------|------|--------|-----------------|
| **Yuki Tanaka** | `yuki.md` | Visual Design & Aesthetics | Anything visual — colors, spacing, typography, layout polish, "it looks off" |
| **Amara Osei** | `amara.md` | UX & Interaction Design | User flows, forms, error messages, empty states, accessibility, mobile |
| **Renzo Cardoso** | `renzo.md` | Frontend Engineering | HTML/CSS/JS architecture, performance, responsive, RTL, layout |
| **Kofi Mensah** | `kofi.md` | Resilience & Reliability | External calls, retries, error handling, idempotency, failure modes |
| **Priya Chakraborty** | `priya.md` | Data Architecture | APIs, schemas, data flow, state management, SSOT, integrations |
| **Tomás Reyes** | `tomas.md` | Debugging & Quality | Bug investigation, root cause analysis, testing, edge cases |
| **Noa Kadouri** | `noa.md` | Content & Voice | Microcopy, bilingual UI, RTL text, tone, error message wording |
| **Zara Petrov** | `zara.md` | Security & Trust | Input validation, auth, XSS, tokens, webhook verification, data privacy |

---

## The Protocol

Every task follows this flow:

### 1. Read this file (BOARD.md)
Orient yourself. Remind yourself of who's available.

### 2. Assess the task
What kind of work is this? Use the routing rules below to pick experts.

### 3. Pick 2-3 relevant experts
Most tasks need at least two lenses. A frontend feature needs both Renzo (engineering) and Yuki (design). An API endpoint needs both Priya (data) and Kofi (resilience). Don't over-consult — pick the 2-3 whose thinking is most relevant.

### 4. Read their files
Read the actual `.md` files. Don't rely on memory summaries. The methodologies have specific steps you should follow.

### 5. Follow their methodology
Each expert has a step-by-step process. Apply the relevant steps to your task. If Yuki says "do the squint test," do the squint test. If Kofi says "draw the failure map," draw the failure map.

### 6. Research their bookshelf (when deep expertise is needed)
For complex or unfamiliar problems, look up the key concepts from the expert's recommended books. You don't need to do this for every task — but when you're unsure about the right approach, the bookshelf points you toward battle-tested thinking.

### 7. Brief the user
Before implementing, briefly share:
- Which experts you consulted
- Key recommendations (2-3 bullets)
- Any tensions between experts and how you resolved them

### 8. Implement
Now write the code, informed by expert thinking.

---

## Routing Rules

### By Task Type

| Task Type | Primary Expert(s) | Supporting Expert(s) |
|-----------|--------------------|----------------------|
| **New UI component** | Yuki + Renzo | Amara (if interactive), Noa (if text-heavy) |
| **New page/layout** | Renzo + Yuki | Amara (user flow), Noa (content) |
| **Form design** | Amara + Noa | Renzo (implementation), Zara (input validation) |
| **API endpoint** | Priya + Kofi | Zara (auth/validation) |
| **Webhook handler** | Kofi + Priya | Zara (verification) |
| **Bug fix** | Tomás (always lead) | + domain expert based on where the bug is |
| **Error handling** | Kofi + Amara | Noa (error message wording) |
| **Email template** | Yuki + Noa | Renzo (HTML), Amara (flow context) |
| **Data model change** | Priya | Kofi (if affects reliability) |
| **Performance fix** | Renzo | Priya (if data-related) |
| **Security review** | Zara | + domain expert for context |
| **Bilingual/RTL work** | Noa + Renzo | Yuki (visual balance) |
| **Refactoring** | Priya (if data), Renzo (if frontend) | Tomás (regression risks) |
| **Loading/skeleton states** | Renzo + Amara | Yuki (visual design) |

### By File Type

| Touching... | Consult |
|-------------|---------|
| `.html` / `.css` | Renzo + Yuki |
| `.js` (frontend) | Renzo, + Zara if handling input |
| `.js` (n8n Code node) | Priya + Kofi |
| Email HTML generation | Yuki + Noa + Renzo |
| Airtable schema | Priya |
| API/webhook endpoints | Priya + Kofi + Zara |
| Error messages/UI text | Noa + Amara |

### Solo Consultations

Some tasks are clearly in one expert's domain:
- Pure visual polish → **Yuki alone**
- Pure CSS layout fix → **Renzo alone**
- Pure bug investigation → **Tomás alone**
- Pure data mapping → **Priya alone**
- Pure copy review → **Noa alone**
- Pure security audit → **Zara alone**

---

## Conflict Resolution

Experts will sometimes disagree. Here's how to handle it:

### Yuki vs. Renzo — "Beautiful but heavy"
Yuki wants a subtle animation. Renzo says it's 50KB of JavaScript for a cosmetic effect.
**Resolution:** Performance wins on load-critical paths. Aesthetics can win on secondary interactions IF it can be done with CSS only. Ask: "Can Renzo achieve what Yuki wants with pure CSS?" If yes, do it. If no, Renzo's concern takes priority.

### Amara vs. Yuki — "Accessible but ugly"
Amara requires a visible focus ring. Yuki says it clashes with the design.
**Resolution:** Accessibility ALWAYS wins. Period. But Yuki can style the focus indicator — it just can't be invisible. There's always a beautiful way to meet accessibility requirements. The answer is never "remove the focus ring."

### Kofi vs. Priya — "Resilient but complex"
Kofi wants circuit breakers, retry queues, and fallback caches. Priya says the data flow is already complex enough.
**Resolution:** Match the resilience to the stakes. Payment processing? Kofi wins, add the full arsenal. A non-critical display feature? Priya wins, keep it simple with basic error handling. Ask: "What's the worst thing that happens if this fails?"

### Zara vs. Everyone — "Secure but inconvenient"
Zara wants to add authentication to a page. The team says it's just a read-only view.
**Resolution:** Zara has veto power on anything involving user data, credentials, or admin functions. For truly public, read-only, non-sensitive content, the team can override — but Zara must sign off. When in doubt, Zara wins. Security debt compounds faster than any other kind.

### Noa vs. Amara — "Well-written but verbose"
Noa wants a detailed, helpful error message. Amara says users don't read long text.
**Resolution:** Both are right. The answer is progressive disclosure: a SHORT clear message visible by default, with a "Details" expansion for Noa's full explanation. Or: tooltip/popover with the extra context.

### General Tiebreaker Rule

When experts genuinely conflict and no obvious resolution exists:
1. **Safety first** (Zara and Kofi's concerns about data loss, security, reliability)
2. **Users second** (Amara and Noa's concerns about usability and clarity)
3. **Craft third** (Yuki and Renzo's concerns about aesthetics and architecture)
4. **Simplicity fourth** (When in doubt, the simpler solution wins)

---

## Quick Consultation Mode

For small tasks where the full protocol is overkill, do the **30-second consult**:
1. Identify the 1-2 most relevant experts
2. Ask yourself their TOP principle (the first one in their philosophy section)
3. Does your implementation respect it? If yes, proceed. If no, adjust.

Example: Adding a button? Quick-consult Amara ("Does this button have a clear verb+object label?") and Renzo ("Is this a `<button>` element, not a styled `<div>`?"). If both pass, you're good.

---

## Demo: The Protocol in Action

**Task:** "I need to add a loading skeleton to the document viewer page."

### Step 1 — Assess
This is a frontend UI enhancement. It involves:
- Visual design (what does the skeleton look like?)
- Frontend engineering (how to implement skeleton screens in HTML/CSS)
- UX (what's the user experience during loading?)
- The page probably fetches data from an API (data flow consideration)

### Step 2 — Pick Experts
**Primary:** Renzo (frontend implementation) + Amara (loading UX)
**Supporting:** Yuki (visual design of the skeleton)

Priya is relevant (data loading) but the skeleton is purely a frontend concern — we're not changing the API.
Kofi is relevant (what if the load fails?) but only as a quick-check, not a full consult.

### Step 3 — Expert Recommendations

**Renzo says:**
- Use CSS `@keyframes` with a shimmer gradient — no JavaScript needed for the animation
- Build the skeleton from semantic HTML that mirrors the real content structure
- Use `content-visibility: auto` for off-screen skeleton elements
- Set explicit dimensions on the skeleton to prevent layout shift (CLS = 0) when real content loads
- The skeleton should be a CSS-only solution — no library needed
- Check: does the page render meaningful content without JS? The skeleton should be in the HTML, revealed by default, and hidden when JS loads the real data

**Amara says:**
- The skeleton should match the SHAPE of the real content (not just a generic spinner)
- If the document list has categories with headers and bullet points, the skeleton should show category-shaped blocks and line-shaped blocks
- Include subtle pulsing animation to show "something is happening" (static gray blocks feel broken, not loading)
- If loading takes more than 5 seconds, show a text message: "Still loading your documents..." — skeletons alone don't reassure beyond ~3 seconds
- Consider the error state: what happens if loading FAILS? The skeleton should gracefully transition to an error message, not just hang forever
- Don't forget: screen readers need to know the page is loading (`aria-busy="true"`, `role="status"`)

**Yuki says:**
- Skeleton color should be 1-2 shades lighter than the background — subtle, not jarring
- Use the same border-radius as the real content elements
- The shimmer animation should move left-to-right (or right-to-left for RTL!) at a calm, steady pace — not frantic
- Match the real content's spacing exactly: same padding, same gaps, same line heights
- The skeleton blocks should have slightly rounded edges and vary in width (don't make all lines the same length — real text has ragged edges)

### Step 4 — Quick-Check with Kofi
**Kofi's concern:** What if the API is slow or down? The skeleton shouldn't display forever.
**Recommendation:** Set a timeout (e.g., 10 seconds). If loading exceeds it, replace the skeleton with a friendly error message and a "Try again" button. Don't let the user stare at a pulsing skeleton indefinitely.

### Step 5 — Synthesis
Combining all expert advice, the implementation plan:

1. **HTML structure:** Mirror the real document list layout with placeholder blocks. Same heading areas, same list item shapes, same grouping. Use `aria-busy="true"` on the container.
2. **CSS:** Skeleton blocks with `background-color` slightly lighter than background. Shimmer gradient using `@keyframes` (pure CSS, no JS). All dimensions explicit. RTL-aware animation direction. Varying line widths for realism.
3. **Behavior:** Skeleton visible by default. When JS loads data, crossfade to real content. If data fails, fade to error state with retry button. If load exceeds 10s, show "Still loading..." text. Remove `aria-busy` when content arrives.
4. **No libraries:** Pure HTML + CSS skeleton. No skeleton screen library needed.

### Experts Consulted
- **Renzo** (frontend): CSS-only skeleton, no layout shift, semantic HTML
- **Amara** (UX): Content-shaped skeletons, loading timeout, error fallback, accessibility
- **Yuki** (design): Color matching, spacing consistency, natural line variation
- **Kofi** (quick-check): Loading timeout, graceful failure state
