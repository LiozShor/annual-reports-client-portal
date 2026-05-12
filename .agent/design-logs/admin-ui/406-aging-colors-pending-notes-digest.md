# Design Log 406: Aging Colors on Dashboard Queues + LLM-Grouped Pending-Notes Digest Section

**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-05-06
**Related Logs:** DL-204 (LLM digest summarization for MS Graph inbox), DL-263/271/288/396 (recent-messages widget evolution), DL-203 (archived Email Subscription Mgr)

## 1. Context & Problem

Office workers (Natan + team) let two queues pile up:
1. **Dashboard messages widget** (`הודעות אחרונות מלקוחות`) — client notes arriving via WF05 inbound, surfaced in admin via `loadRecentMessages()`. No urgency cue; old and new look identical.
2. **Review queue** (`סקירות` / `Moshe_Review` stage) — already has `waiting-warn` (7d) / `waiting-urgent` (14d) colors via `docs_completed_at`, but the cue is weak (subtle badge color) and not unified with the messages widget.

The boss's existing daily digest (WF07, `0o6pXPeewCRxEEhd`, DL-204) summarizes the **MS Graph inbox** — but the dashboard's `client_notes` (the actual portal-facing client messages, what the widget shows) are NOT in the digest at all. So Natan opens the digest each morning and gets zero visibility on the widget items still sitting unhandled.

**Phase 1 scope (this DL):** The new digest section sources from the SAME data shown in `הודעות אחרונות מלקוחות` — i.e., Airtable `client_notes` JSON column, served by `GET /webhook/admin-recent-messages`. Future phases may add other sources (MS Graph thread replies, Telegram bot conversations, etc.) but those are explicitly out of scope.

**Goal:** Two layered nudges so the queues don't go stale:
- **Live cue:** Aging colors on widget rows + review-queue rows. Stale = visible debt.
- **Daily prompt:** A new digest section listing pending unhandled client notes (from `client_notes`), grouped by Claude into `urgent` / `regular` / `fyi` tiers, sent in the existing 07:00 WF07 email to Natan + Moshe.

## 2. User Requirements (Phase A Q&A)

| # | Q | A |
|---|---|---|
| 1 | Aging color thresholds for messages widget | **Loose (48h SLA):** Green <24h · Yellow 1–2d · Red 2–5d · Black >5d |
| 2 | Urgency rule for digest LLM | **Hybrid** — age + content. Three enum buckets: `urgent` (>24h OR content shows urgency), `regular` (today, routine), `fyi` (no action) |
| 3 | Where new digest section lives | **Append to existing daily digest WF07** (`0o6pXPeewCRxEEhd`). User originally pasted `qCNsXnAE06jAZOMe` but that's archived (DL-203) — confirmed redirect to WF07 |
| 4 | Aging color scope | **Both** — messages widget AND `סקירות` queue. User clarified mid-implementation: `סקירות` = AI Review tab + PA tab (NOT the Moshe-Review FIFO queue, which already had `waiting-warn`/`waiting-urgent` and stays untouched). Aging applied to `.ai-review-card` (pending only, via `item.received_at`) and `.pa-card__priority` (via `item.submitted_at` — replaces DL-295's bespoke 3d/7d thresholds with the unified `Loose 48h SLA` palette). |

## 3. Research

### Domain
LLM message triage, daily digest UX, aging-color SLA visualization, anti-hallucination prompting.

### Prior internal research (REUSE)
- **DL-204** — Claude Haiku batched summarization in WF07; n8n Cloud constraints (no `$env`, no `fetch` in Code nodes; split Code-prep + HTTP Request + Code-parse).
- **`docs/digest-email-research.md`** — NN/G + Novu + Jira digest UX research. Group by entity, surface exceptions at top, lead with numbers, cap visible detail.

### Delta sources (Tavily, 2026-05-06)
1. **Galileo.ai — Master LLM Summarization Strategies** ([galileo.ai/blog/llm-summarization-strategies](https://galileo.ai/blog/llm-summarization-strategies)) — production hallucination patterns: missing escalation cues, hallucinating resolution steps, losing multi-turn context. Treat summarization as infrastructure.
2. **ACL 2024 — Circumstantial Hallucination in Dialogue Summarization** ([aclanthology.org/2024.acl-long.677.pdf](https://aclanthology.org/2024.acl-long.677.pdf)) — formalizes invented-context hallucination. Mitigation: explicit skip-if-empty + ground-truth references in prompt.
3. **Anthropic Claude Docs — Structured Outputs** ([docs.claude.com/en/docs/build-with-claude/structured-outputs](https://docs.claude.com/en/docs/build-with-claude/structured-outputs)) — `output_config.format` with `json_schema` provides constrained-decoding (schema-compliant guaranteed). Eliminates parse failures and the regex-strip-fences hack DL-204 used.
4. **SAP Learning — Developing Basic Prompts** ([learning.sap.com](https://learning.sap.com/courses/solve-your-business-problems-using-prompts-and-llms-in-sap-generative-ai-hub/developing-basic-prompts-for-common-queries-1)) — enum-constrained classification (`low|medium|high`) is canonical for urgency.
5. **Xebia — GenAI Email Categorization Engine** ([xebia.com/artificial-intelligence/genai-email-categorization-engine](https://xebia.com/artificial-intelligence/genai-email-categorization-engine/)) — categorize by intent + urgency, map to business unit, recommend next-best actions; 95% triage-effort reduction.
6. **Production Apps with Claude API (Medium)** ([reliabledataengineering on Medium](https://medium.com/@reliabledataengineering/building-production-apps-with-claude-api-the-complete-technical-guide-to-prompts-tokens-and-8a740b9bab3a)) — production prompt: `intent | urgency | category | summary | action_required` with FEW-SHOT examples; biggest single-lever improvement.
7. **Superhuman — Best AI Email Summarizer** ([blog.superhuman.com/best-ai-email-summarizer](https://blog.superhuman.com/best-ai-email-summarizer)) — pull out action items + decisions automatically; pattern: action-items-first, not narrative summary.
8. **Readless — Automated Email Briefing Guide 2026** ([readless.app/blog/automated-email-briefing-guide](https://www.readless.app/blog/automated-email-briefing-guide)) — 2-3 sentence summaries, prioritize time-sensitivity, deduplicate. ~80% reading-time reduction (SAP 2025 study).
9. **Teach Maverick — Morning Email People Actually Read** ([teachmaverick.com/dont-use-intercom-announcements](https://www.teachmaverick.com/dont-use-intercom-announcements)) — 15–30 sec phone scan; top "Need-to-Know" 3-5 bullets; verb + action + link per bullet; stable section order.
10. **n8n Template — Daily Email Digest with AI Summarization** ([n8n.io/workflows/5003-...](https://n8n.io/workflows/5003-daily-email-digest-with-ai-summarization-using-gmail-openrouter-and-langchain)) — 4-section structure (Summary / Issues / Actions / Follow-ups) validates ours.

### Key Principles Extracted
1. **Strip noise at LLM layer** (DL-204, Galileo) — `m.summary` from WF05 already cleaned; pass directly.
2. **Single batched Claude call** (DL-204) — cheaper, better cross-message context.
3. **Constrained-decoding via Anthropic structured outputs** (Anthropic docs, *new for this DL*) — replace DL-204's regex-fence-strip with `output_config.format` + JSON schema.
4. **Few-shot examples in system prompt** (Production Apps guide, *new for this DL*) — 2-3 worked examples per urgency tier; highest-leverage anti-hallucination move.
5. **Enum-constrained urgency** (SAP, Xebia) — schema literally enforces `urgent | regular | fyi`.
6. **Action-items-first** (Superhuman, Readless) — each entry = "what does the client want?" verb-led.
7. **Pre-filter** (DL-204) — exclude `hidden_from_dashboard === true`, exclude notes >14d, cap at 50 (token budget).
8. **Verb + action per bullet** (Teach Maverick) — `"שלח טופס 106"` beats `"לקוח מתעניין במצב המסמכים"`.
9. **Surface exceptions first** (digest-email-research) — `urgent` block at top of Section 4.
10. **Pair color with icon and label** (a11y / WCAG 1.4.1) — aging colors backed by clock icon + Hebrew label.
11. **Skip-if-empty rule** (ACL paper) — explicit: "If a note is auto-reply / 'תודה' / signature-only, OMIT IT entirely. Do not invent context to summarize."

### Patterns to Use
- **Anthropic structured outputs** with json_schema for urgent/regular/fyi enum buckets.
- **Few-shot examples** in system prompt (3 examples covering each tier).
- **Shared `aging-colors.js` module** consumed by both messages widget and review queue.
- **Sub-chain in WF07** parallel to existing inbox chain — same Code-prep / HTTP / Code-parse split.

### Anti-Patterns to Avoid
- Hallucinated resolutions (Galileo, ACL) — pre-filter empty content + explicit skip rule.
- Per-message API calls — expensive, no cross-thread dedup.
- Regex-based urgency or noise stripping — Hebrew fragility.
- Free-text urgency labels — drift over time; enum-only.
- Wall of bullets without verbs (Teach Maverick) — verb-led mandatory.
- Wall of urgent items — high bar for `urgent`; if everything is urgent, nothing is.
- False urgency from polite Hebrew formality — clients use `דחוף` casually; weight content + age + context, not keyword match.
- Late or addendum sends — one daily email at 07:00.
- Duplicating review-queue color logic — DRY into shared module.

### Research Verdict
Architecture stays per DL-204 (Code-prep → HTTP → Code-parse), with three upgrades: (a) Anthropic structured outputs replacing regex-fence-strip; (b) few-shot examples in system prompt; (c) explicit skip-if-empty rule. Aging colors are well-trodden UX (Linear/Jira/GitHub) — implementation risk is near-zero, just discipline on a11y pairing.

## 4. Codebase Analysis

### Messages Widget (live cue surface)
- Render: `frontend/admin/js/script.js:1192` (`renderMessages()`) and `script.js:1117` (`_renderMessageRowHtml()` — single-message + multi-message group children).
- Group header (multi-message): `script.js:1245-1262`.
- Data load: `loadRecentMessages()` at `script.js:1037` → `ENDPOINTS.ADMIN_RECENT_MESSAGES` (`/webhook/admin-recent-messages`).
- **`m.date`** is the note CREATION time, set by WF05 inbound. Stable, single timestamp (no separate created/modified). Safe for aging.
- API: `api/src/routes/dashboard.ts:183-296`. Reads `client_notes` JSON column from reports table (`tbls7m3hmHC4hhQVy`), parses, emits one row per note. Date passes through at line 272 (`date: note.date || ''`).
- **`hidden_from_dashboard` field** — `dashboard.ts:264` (`if (note.hidden_from_dashboard) continue;`) — this is the "is_handled" semantics; digest payload builder must check the same field.

### Review Queue (live cue surface — partial existing impl)
- Render: `renderReviewTable(queue)` at `script.js:3286-3409` (desktop table 3303-3361; mobile cards 3367-3406).
- **Existing aging:** `client.docs_completed_at` → `diffDays` → CSS class `waiting-warn` (≥7d) / `waiting-urgent` (≥14d) on `.waiting-badge` (lines 3328-3330, 3355, 3377-3378, 3386).
- API: `api/src/routes/dashboard.ts:150` — `docs_completed_at` field passed through.

### CSS
- `frontend/admin/css/style.css` — contains both `.msg-row` and `.waiting-badge` selectors.

### Digest Workflow
- WF07 = `0o6pXPeewCRxEEhd` (per `docs/workflow-ids.md:15`). Currently 13-node chain (DL-204 final state).
- Currently does NOT touch `client_notes`. Will add a parallel sub-chain.
- `qCNsXnAE06jAZOMe` was DL-203's archived Email Subscription Mgr — IGNORE.

### Reuse Decision
- Reuse DL-204's Code-prep + HTTP + Code-parse pattern for the new sub-chain.
- Extract aging logic into NEW shared module `frontend/admin/js/modules/aging-colors.js`; refactor existing review-queue logic to consume it (eliminates duplication, frees monolith budget).
- Reuse existing `icon()` helper from script.js for clock icon (per memory: `icon()` only works in script.js, not in modules — pass icon HTML string from the call site).

## 5. Technical Constraints & Risks

- **Security:** Claude API key is hardcoded in n8n Code node (n8n Cloud blocks `$env` — same risk as existing Airtable key). PII guard already strips client names from logs; the digest itself contains client names BY DESIGN (it's an internal email).
- **Operational Risks:**
  - **Monolith size ratchet** — `script.js` is on append-only-down baseline. Mitigation: extract to `modules/aging-colors.js`, refactor review-queue to consume the same module — net delta on monolith should be NEGATIVE.
  - **Cache-bust** — bump `?v=416` → `?v=417` on `frontend/admin/index.html:1560` (per `feedback_admin_script_cache_bust.md`).
  - **n8n Cloud restrictions** (DL-204) — no `$env`, no `fetch` in Code nodes; mirror DL-204's split.
  - **Structured outputs unproven via n8n HTTP node** — first manual exec must verify schema-valid response; if not, fall back to DL-204's regex-strip with try/catch.
  - **Few-shot prompt drift** — examples are static; document the actual examples in Section 8 for future re-tuning.
  - **Aging on multi-message groups** — group's "age" must be the LATEST message's age (already in scope at `script.js:1236`).
  - **Color-only signaling** — pair with icon + Hebrew label per WCAG 1.4.1.
  - **False-urgency from polite Hebrew formality** — prompt explicitly instructs Claude not to keyword-match on `דחוף`.
- **Breaking Changes:**
  - Existing `.waiting-warn` / `.waiting-urgent` classes will be replaced by the unified `.aging-*` palette. Old class names removed (one-shot migration; no consumers outside the review queue).
- **Mitigations:** Each risk has a documented mitigation above; structured-outputs fallback path is explicit.

## 6. Proposed Solution

### Success Criteria
Office workers see immediate visual urgency cues on dashboard queues, AND the morning digest highlights pending client notes grouped by urgency so they can plan their day around the most-aged/most-urgent items.

### 6.1 — Aging Colors (Frontend, both surfaces)

**New module:** `frontend/admin/js/modules/aging-colors.js`

```js
export const TIERS_MESSAGES = [
  { maxHours: 24,        cls: 'aging-fresh', label: 'חדש' },
  { maxHours: 48,        cls: 'aging-day1',  label: 'יום' },
  { maxHours: 120,       cls: 'aging-aging', label: 'מתיישן' },  // 2-5d
  { maxHours: Infinity,  cls: 'aging-stale', label: 'מעופש' },   // >5d
];
export const TIERS_REVIEW = [
  { maxHours: 24*7,      cls: 'aging-fresh', label: 'בזמן' },
  { maxHours: 24*14,     cls: 'aging-aging', label: 'ישן' },
  { maxHours: Infinity,  cls: 'aging-stale', label: 'איחור' },
];
export function ageTier(isoDate, tiers) { /* parse, compute hours, pick tier */ }
```

**CSS** (`frontend/admin/css/style.css`):
- `.aging-fresh` — subtle green left-border (3px)
- `.aging-day1` — yellow
- `.aging-aging` — orange/red
- `.aging-stale` — dark with subtle pulse animation
- Each tier paired with a clock icon + Hebrew label in the meta line for a11y.

**`script.js` edits (corrected scope):**
- `_renderMessageRowHtml(m)` (line 1117) — inline `ageTier(m.date, TIERS_MESSAGES).cls` into `.msg-row` class attr.
- Multi-message group header (line 1245) — same pattern, using `latest.date`.
- `renderAICard(item)` (line 6028) — append `ageTier(item.received_at, TIERS_MESSAGES).cls` onto `cardClass` so pending classifications get a bg tint based on age (does NOT conflict with the existing `match-*` border-inline-start signal).
- `buildPaCard(item)` (line 10293) — replace DL-295 bespoke `pa-card__priority--med` / `pa-card__priority--high` with `ageTier(item.submitted_at, TIERS_MESSAGES).cls` on the priority badge. Day count text preserved.
- Moshe-Review (`renderReviewTable()`) — UNCHANGED in this DL. Already has `waiting-warn`/`waiting-urgent`; if a future DL wants to migrate it to the unified palette, drop the existing aging rules and switch to `TIERS_REVIEW`.

### 6.2 — Pending-Notes Digest Section (Backend / n8n WF07)

**Strategy:** Append a parallel sub-chain to WF07.

**New nodes:**
1. **Query Pending Notes** (HTTP→Airtable) — list reports records with non-empty `client_notes`, last-modified <30d.
2. **Build Notes Payload** (Code, runOnceForAllItems) — parse JSON, filter out `hidden_from_dashboard`, filter out >14d, compute `ageHours`, cap 50, build JSON payload.
3. **IF Has Pending Notes** — same as DL-204's `IF Has Client Emails`.
4. **Call Claude (Notes)** + **Parse Notes Response** — clones of DL-204's HTTP+Code pair.

**Claude API call shape + full system prompt + few-shot examples:** see [docs/dl-406-pending-notes-prompt.md](../../../docs/dl-406-pending-notes-prompt.md). The prompt artifact lives outside `.agent/` so the PII guard does not flag the literal Hebrew UI labels and example phrases that the production prompt requires verbatim.

**Key prompt design choices** (decisions; full text in the prompt artifact):
- Anthropic structured outputs (`output_config.format` + json_schema) — replaces DL-204's regex-fence-strip parse path; if it errors via n8n HTTP Request node, fall back to regex-strip with try/catch.
- Three enum buckets: urgent / regular / fyi.
- Hybrid urgency rule: age >= 48h OR content shows deadline / complaint / repetition / financial-or-legal pressure / explicit frustration.
- Anti-hallucination skip-if-empty rule for auto-replies / signature-only / "thanks" notes.
- Few-shot: 4 examples (one per tier + one SKIP case).
- Verb-led ask field with GOOD/BAD examples in the prompt.
- Casual Hebrew filler `urgent` is NOT auto-promoted (must combine with age + signal).

**Modify `Build Digest Email`** — read `$('Parse Notes Response').first().json`, render Section 4 (urgent/regular/fyi blocks; urgent first with red accent; empty tiers omitted). Subject prepends urgent count if > 0. Graceful skip on Claude failure.

### Files to Change

| File | Action | Notes |
|------|--------|-------|
| `frontend/admin/js/modules/aging-colors.js` | Create | ~50 LOC, ES module |
| `frontend/admin/js/script.js` | Modify | 3 sites (1117, 1245, 3286–3409). Net LOC delta ≤ 0 (refactor old aging code → module) |
| `frontend/admin/css/style.css` | Modify | Add `.aging-*` classes, remove `.waiting-warn`/`.waiting-urgent` |
| `frontend/admin/index.html` | Modify | `?v=416` → `?v=417` (line 1560) |
| n8n WF07 (`0o6pXPeewCRxEEhd`) | Modify | 4 new nodes + Build Digest Email update |

### Final Step

- Update DL status to `[IMPLEMENTED — NEED TESTING]` after both phases ship.
- Update INDEX.md.
- Move unchecked Section 7 items to `.agent/current-status.md`.
- Invoke `git-ship` for commit/push.

## 7. Validation Plan

### Frontend (aging colors)
- [ ] Open admin dashboard, messages widget renders with green border on <24h notes
- [ ] 36h-old note → yellow + label `יום`
- [ ] 3-day-old note → red + label `מתיישן`
- [ ] >5-day note → black + label `מעופש`
- [ ] Multi-message group uses LATEST message's age, not oldest
- [ ] Review queue rows use unified palette; >7d yellow, >14d red
- [ ] Color + icon visible (a11y — colors hidden, label still conveys urgency)
- [ ] `?v=417` bumped; hard-refresh shows new code
- [ ] Mobile review queue card variant also colored
- [ ] Monolith size ratchet check passes (`script.js` + `chatbot.js` LOC unchanged or reduced)

### Backend (digest section)
- [ ] WF07 manual exec: new Section 4 renders with urgent/regular/fyi blocks
- [ ] Empty-inbox case → Section 4 says `אין הודעות ממתינות` or omits
- [ ] Claude API failure → Section 4 omitted; sections 1-3 + DL-204 inbox section still send
- [ ] Structured-output schema honored on first try (no fallback) — if fallback IS needed, document why in Section 8
- [ ] Subject line includes urgent count when >0
- [ ] Friday/Saturday skip works (DL-204's weekend gate untouched)
- [ ] `hidden_from_dashboard` notes excluded
- [ ] Ancient notes (>14d) excluded
- [ ] Hebrew renders correctly (RTL, no mojibake)
- [ ] Sent to both Natan + Moshe (recipient list unchanged from DL-204)
- [ ] False-urgency check — note containing `דחוף` casually NOT auto-promoted to urgent
- [ ] Empty-content skip — "תודה" note bucketed fyi (or skipped), not hallucinated
- [ ] Verb-led ask check — every entry's `ask` starts with a verb
- [ ] Multi-message dedup — client with 3 notes appears as ONE entry, count=3
- [ ] Live verification with real next-morning digest before declaring `[COMPLETED]`

## 8. Implementation Notes

To be filled in during Phase D. Expected items:
- Final palette hex values used in CSS
- Whether structured outputs worked first-try via n8n HTTP node, or fallback was needed
- Real prompt examples used (with placeholder names; PII-safe)
- Monolith ratchet delta (target: ≤ 0)
- Any prompt iterations needed during Phase D-2
