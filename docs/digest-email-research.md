# Daily Digest Email — Research Findings

**Date:** 2026-03-26
**Purpose:** Best practices for daily digest/summary emails for admin notifications

---

## 1. Rolling Time-Window Digests

### How Products Handle Per-Recipient Timing

**Three core strategies** (from Novu's digest framework):

| Strategy | How It Works | Best For |
|----------|-------------|----------|
| **Regular** | Fixed window starts from first event. All events in window get batched. | Informational, non-urgent updates |
| **Back-off** | Two intervals: digest window + lookback. If no activity in lookback, sends immediately instead of digesting. | Activity-driven alerts (social, CRM) |
| **Scheduled** | Clock-aligned intervals (daily at 9AM, weekly Monday). Predictable delivery. | **Our use case** — daily admin summary |

**GitHub:** Groups notifications by repository. Offers weekly security digest for up to 10 repos. No per-user time window — fixed schedule.

**Jira (Email Notifications Digest plugin):** Three modes:
1. **Instant** — per-change (default)
2. **Issue Digest** — waits for inactivity period on a single issue, then batches
3. **Summary Digest** — collects updates across all issues within a day, sends on schedule or when hitting max-update threshold

**Linear/Slack:** Digest-style notifications typically aggregate by entity (project/channel) and send at user's local morning time.

### Recommendation for Our System
Use **Scheduled Digest** — fixed daily time (e.g., 7:00 AM Israel time). No per-user timing needed since there's one admin recipient (Natan). The n8n workflow fires on a cron schedule, queries Airtable for "last 24 hours" of activity, and sends one email.

---

## 2. Grouping Patterns in Digest Emails

### Best Practices from Jira, GitHub, Linear

**Primary grouping axis:** Group by entity (client/project/repository), not by time.

**GitHub pattern:**
- Group by repository → within each repo, summarize: "5 PRs merged, 2 new PRs opened, 1 PR needs review"
- Aggregate actions by author: "Sarah merged 3 PRs in payments service"

**Jira pattern:**
- Group by project → within project, list affected issues
- Priority Projects get custom configuration (promoted to top)
- Ignored Projects excluded entirely

**Recommended structure for our digest:**

```
📊 Daily Summary — March 26, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overview: 12 documents received, 3 clients completed, 2 issues flagged

── Client: יוסי כהן (2025) ──
  ✅ 3 documents received (תלוש שכר, טופס 106, אישור ניכוי מס)
  📋 Status: 8/12 documents collected

── Client: שרה לוי (2025) ──
  ⚠️ Document requires fix: אישור ניכוי מס במקור
  📋 Status: 5/10 documents collected

── Stage Changes ──
  • 3 clients moved to "Review" stage
  • 1 client moved to "Completed"
```

### Grouping Anti-Patterns
- DO NOT list every individual event chronologically (creates wall of text)
- DO NOT group by event type across all clients (hard to scan per-client)
- DO NOT mix urgent items into the middle — surface them at top

---

## 3. Email Digest UX (Nielsen Norman Group)

### Key Findings from NN/G Research

**Information Density:**
- "Processing email is stressful" — users want it done quickly
- Include ONLY essential info: summary, status changes, action items
- Web content brevity guidelines apply "even briefer" to email
- Front-load critical information — users scan only initial words

**Subject Line:**
- Be specific: "Daily Report: 12 docs received, 2 issues" beats "Daily Summary"
- 20-25 characters for From field (truncated beyond that)
- Use preheader text for additional context visible in inbox list

**Message Sequence:**
- Keep total email count minimal — additional messages cause confusion
- One daily digest beats multiple status emails throughout the day

**Trust & Design:**
- Poor email design decreased trust ratings by up to 2 points (1-7 scale)
- Missing contact info, excessive frequency, unclear messaging erode credibility

**Notification Channel Selection:**
- Email for detailed, non-urgent summaries (perfect for daily digest)
- SMS/push for time-sensitive, requires-action items
- Never duplicate the same info across multiple channels

### Design Principles for Our Digest
1. **Lead with numbers** — total docs received, clients progressing, issues
2. **Group by client** — each client is a scannable section
3. **Flag exceptions** — surface problems/blockers at the top
4. **Keep it under 1 screen** — if more than ~15 clients had activity, summarize the rest as "and 8 more clients with routine updates"
5. **No marketing fluff** — purely utilitarian

---

## 4. Airtable filterByFormula Date Filtering

### Filtering "Records from Last 24 Hours"

**Primary pattern — IS_AFTER + DATEADD:**
```
IS_AFTER({Last Modified}, DATEADD(NOW(), -24, 'hours'))
```

**Alternative — IS_AFTER + TODAY minus 1 day:**
```
IS_AFTER({Last Modified}, DATEADD(TODAY(), -1, 'days'))
```

**For a specific date range (between two timestamps):**
```
AND(
  IS_AFTER({Date Field}, '2026-03-25T00:00:00.000Z'),
  IS_BEFORE({Date Field}, '2026-03-26T00:00:00.000Z')
)
```

**Using DATETIME_DIFF for relative filtering:**
```
DATETIME_DIFF(NOW(), {Last Modified}, 'hours') <= 24
```

### Critical Caveats

| Issue | Details |
|-------|---------|
| **NOW() staleness** | `NOW()` can be off by 5 min to 1 hour if the base isn't open or record isn't in view. For API calls this is less of an issue. |
| **TODAY() vs NOW()** | `TODAY()` returns midnight — no time precision. Use `NOW()` for hour-level filtering. |
| **Timezone** | Airtable stores dates in UTC. Use `SET_TIMEZONE(NOW(), 'Asia/Jerusalem')` if timezone-aware comparison needed. |
| **IS_AFTER with timestamps** | Despite docs saying date-only, `IS_AFTER` works with full timestamps: `IS_AFTER({Modified}, '2021-01-07T14:05:09')` |
| **Performance** | For large tables, pre-filtered Airtable Views outperform `filterByFormula` on every API call. Consider creating a "Last 24h Updates" view. |

### Recommended Formula for Our Digest Workflow

**Option A — Pass timestamps from n8n (most reliable):**
```javascript
// In n8n Code node, compute the window
const now = new Date();
const yesterday = new Date(now - 24 * 60 * 60 * 1000);
const cutoff = yesterday.toISOString();

// Use in Airtable node filterByFormula:
// IS_AFTER({Last Modified}, '${cutoff}')
```

**Option B — Pure Airtable formula:**
```
IS_AFTER({Last Modified}, DATEADD(NOW(), -24, 'hours'))
```

Option A is preferred because it avoids NOW() staleness issues and makes the time window explicit and debuggable.

---

## 5. Patterns to Use

1. **Scheduled cron trigger** — daily at fixed time (7:00 AM Israel)
2. **n8n computes cutoff timestamp** — `new Date(Date.now() - 24*60*60*1000).toISOString()`
3. **Airtable query with computed cutoff** — `IS_AFTER({Last Modified}, '${cutoff}')`
4. **Group results by client** in Code node before building email
5. **Lead with overview stats**, then client-by-client sections
6. **Surface exceptions first** — fixes needed, flagged items at top
7. **Single email, single recipient** — one daily digest to admin
8. **Hebrew-first layout** — RTL, matching existing email design system

## 6. Anti-Patterns to Avoid

1. **Per-event emails** — never send individual notification per document received
2. **NOW() in filterByFormula** — staleness risk; compute timestamp in n8n instead
3. **Chronological event list** — group by client, not by time
4. **Wall of text** — cap visible detail; summarize if >15 clients
5. **Vague subject lines** — "Daily Summary" tells admin nothing; use "Daily: 12 docs received, 2 issues"
6. **Ignoring timezone** — Airtable stores UTC; Israel is UTC+2/+3
7. **No fallback for empty days** — still send a "No activity in last 24h" email (confirms system is running)
8. **One-size digest window** — if we later add more notification types, use different strategies per type (urgent = immediate, routine = digest)

---

## Sources

- [Novu — Digest Notifications Best Practices](https://novu.co/blog/digest-notifications-best-practices-example/)
- [NN/G — Transactional Notifications](https://www.nngroup.com/articles/transactional-notifications/)
- [NN/G — Transactional and Confirmation Email](https://www.nngroup.com/articles/transactional-and-confirmation-email/)
- [NN/G — The State of Transactional Email](https://www.nngroup.com/articles/state-transactional-email/)
- [Reliex — Jira Email Notification Digest](https://reliex.com/blog/whats-new-in-email-notification-digest-for-jira)
- [Courier — Reduce Notification Fatigue](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies-for-saas)
- [Airtable Community — Filter by Formula Last 1 Day](https://community.airtable.com/formulas-10/filter-by-formula-in-the-last-1-day-37315)
- [Airtable Community — filterByFormula Date Range](https://community.airtable.com/development-apis-11/filterbyformula-to-pull-specific-but-changing-date-range-3387)
- [Airtable — Working With Date Functions](https://support.airtable.com/docs/working-with-date-functions)
- [Airtable — Formula Field Reference](https://support.airtable.com/docs/formula-field-reference)
- [GitHub Docs — Configuring Notifications](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)
- [Gitmore — GitHub Activity Digest Tools](https://gitmore.io/blog/github-activity-digest-notification-tools)
