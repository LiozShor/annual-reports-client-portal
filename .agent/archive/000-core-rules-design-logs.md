# Design Log Methodology - Core Rules & Protocol

**⚠️ DOCUMENT GENERATION SSOT:**
ALL required document title generation MUST follow:
→ `SSOT_required_documents_from_Tally_input.md` (project root)
→ Implementation: `github/annual-reports-client-portal/n8n/ssot-document-generator.js`

**NEVER hallucinate document names. ALWAYS use SSOT templates!**

---

## 1. The Core Philosophy
**"Code is the easy part. Understanding is the hard part."**
We do not write code or build workflows based on assumptions. We build based on **researched, documented, agreed-upon designs**. This folder is the "Brain" of the project.

**Research-First Principle:** Before writing a single line of code, research the domain. The best solutions come from understanding how experts and top-tier products solve the same problem.

---

## 2. When to Create a Design Log
You must create or update a Design Log for **ANY** of the following triggers:
1.  **New Feature:** Adding a new workflow, page, or automation capability.
2.  **Bug Fix:** Fixing a logic error, runtime failure, or edge case.
3.  **Refactoring:** Changing the structure of an existing workflow without changing output.
4.  **Schema Change:** Modifying Airtable fields, JSON structures, or API contracts.

*Exception: Only purely cosmetic updates (e.g., fixing a typo in a comment) are exempt.*

---

## 3. The "Stop & Think" Protocol
Before writing a single line of code or modifying an n8n node, you must follow this sequence:

### Phase A: Discovery (The 5 Questions)
1.  **Stop.** Do not implement.
2.  **Check Context:** Read existing design-logs to understand dependencies. Check for prior research on the same domain.
3.  **Ask:** Generate at least **5 specific clarifying questions** to narrow down the requirement.
    * *Bad:* "How do you want this?"
    * *Good:* "Should the automation trigger on 'Status Changed' or on a scheduled interval? If 'Status Changed', what happens if the status changes back?"

### Phase B: Research (Mandatory)

**After user answers questions, BEFORE exploring codebase.**

1.  **Identify the Domain:** What technical/UX/architectural domain does this request fall into? (e.g., Resilience Engineering, Search UX, Concurrency, Form Design, Email Patterns, Workflow Orchestration)

2.  **Research Sources (3+ minimum):**
    - **Tier 1 — Books:** Find the 1-2 most respected books in the domain. Search for core concepts, chapter summaries, key takeaways.
    - **Tier 2 — Authoritative Articles:** Nielsen Norman Group, Web.dev, MDN, Smashing Magazine, official docs of relevant tools.
    - **Tier 3 — Case Studies:** How do Stripe, Linear, Notion, GitHub, Vercel solve this? Engineering blog posts, postmortems.

3.  **Extract Findings:** Synthesize into actionable principles, patterns to use, and anti-patterns to avoid — all specific to our context.

4.  **Cumulative Knowledge:** If the same domain was researched in a previous log, reference it and add only incremental findings.

5.  **Time-box:** 5-10 minutes of tool calls. Quality over quantity.

### Phase C: Explore & Document (The Log)
0. **Update Context**: Update existing design logs if related to the current work.
1.  **Enter Plan Mode** to explore the codebase.
2.  **Create File:** Create a new file in the appropriate **domain subfolder** following the naming convention: `NNN-kebab-case-description.md` (Increment the number from the last file).
    **Design Logs Location:**
    - **Base path:** `.agent/design-logs/` (from project root)
    - **MUST place in a subfolder** based on the primary domain:
      | Subfolder | Domain |
      |-----------|--------|
      | `admin-ui/` | Admin panel UI, dashboard, client management |
      | `ai-review/` | AI classification, document review workflows |
      | `capital-statements/` | Capital statements filing type |
      | `client-portal/` | Client-facing portal, questionnaires, landing pages |
      | `documents/` | Document generation, OneDrive, file operations |
      | `email/` | Email templates, sending, notifications |
      | `infrastructure/` | n8n workflows, Cloudflare Workers, deployment, monitoring |
      | `reminders/` | Reminder scheduling, alerts |
      | `research/` | Domain research, feasibility studies |
      | `security/` | Auth, tokens, compliance, security |
    - **NEVER place logs directly in the root** `.agent/design-logs/` — always use a subfolder
    - If a log spans multiple domains, pick the **primary** one (the system being changed most)
3.  **Draft Content:** Use the **Standard Template** (see Section 6 below). Include research findings in Section 3.
4.  **Exit Plan Mode:** Present the draft for approval. **Do not proceed until approved.**

### Phase D: Implementation
1.  **Build:** Implement the solution strictly according to the "Proposed Solution" in the log.
2.  **Validate:** Run any validation steps that can be verified immediately (e.g., build passes, workflow deploys, no errors in logs).
3.  **Reference Research:** Add code comments linking back to research principles where relevant (e.g., `// Pattern: Circuit Breaker — see design-log NNN`).
4.  **Update:** If you hit a roadblock, update the log's "Implementation Notes" section.

### Phase E: Test Handoff
After implementation, persist outstanding test items so nothing gets lost between sessions.

1.  **Collect:** Gather all unchecked items from the log's **Section 7 (Validation Plan)** — these are the tests that still need manual verification or end-to-end testing.
2.  **Write to `current-status.md`:** Add a test entry under **"Next Session TODO"** with this format:
    ```
    N. **Test DL-NNN: [Feature Name]** — [1-line summary of what to verify]
       - [ ] [Test item 1 from Section 7]
       - [ ] [Test item 2 from Section 7]
       - [ ] ...
       Design log: `.agent/design-logs/NNN-feature-name.md`
    ```
    * Place it right after the implementation TODO it relates to (same priority number).
    * If the design log is now `[IMPLEMENTED]` or `[COMPLETED]`, the test entry is what keeps it on the radar.
3.  **Mark the log:** Update the design log status to `[IMPLEMENTED — TESTING]` if tests are pending, or `[COMPLETED]` if all tests passed in-session.

**Rule:** A design log is NOT `[COMPLETED]` until all Section 7 items are checked off. `[IMPLEMENTED]` means code is deployed but tests are outstanding.

---

## 4. Naming Conventions (Strict)
* **Format:** `NNN-description.md`
* **Numbering:** Sequential (001, 002, 003...). Check the folder to find the next number.
* **Casing:** Lowercase with hyphens.
* **Language:** Content must be **English**.

**Examples:**
* `005-fix-airtable-duplication.md`
* `006-add-whatsapp-notification.md`

---

## 5. Log Statuses
Every log file must have a status at the top:
* `[DRAFT]` - Waiting for user answers or approval. (NO CODING ALLOWED)
* `[APPROVED]` - User confirmed. Implementation in progress.
* `[IMPLEMENTED — TESTING]` - Code deployed, but Section 7 test items are still outstanding. Test checklist written to `current-status.md`.
* `[COMPLETED]` - Implemented, ALL Section 7 tests passed, and merged.
* `[DEPRECATED]` - Feature removed or superseded by a newer log.

---

## 6. The Standard Template
Copy and use this template for every new log:

```markdown
# Design Log NNN: [Feature Name]
**Status:** [DRAFT]
**Date:** YYYY-MM-DD
**Related Logs:** [Links to previous related logs if any]

## 1. Context & Problem
*Why are we doing this? What is broken or missing?*

## 2. User Requirements
*Q&A from discovery phase:*
1.  **Q:** [Question]
    **A:** [User Answer]
2.  **Q:** ...
    **A:** ...

## 3. Research
### Domain
[What technical/UX/architectural domain this falls under]

### Sources Consulted
1. **[Book/Source Name]** — [Key takeaway in 1-2 sentences]
2. **[Book/Source Name]** — [Key takeaway in 1-2 sentences]
3. **[Article/Source Name]** — [Key takeaway in 1-2 sentences]

### Key Principles Extracted
- [Principle 1 — and how it applies to our specific case]
- [Principle 2 — and how it applies to our specific case]
- [Principle 3 — and how it applies to our specific case]

### Patterns to Use
- **[Pattern name]:** [Brief description of how we'll apply it]

### Anti-Patterns to Avoid
- **[Anti-pattern]:** [Why it's tempting but wrong for our case]

### Research Verdict
[What approach we're taking based on the research, and why]

## 4. Codebase Analysis
*Findings from plan mode exploration:*
* **Relevant Files:** [files examined and why]
* **Existing Patterns:** [how similar things are done in the codebase]
* **Alignment with Research:** [where codebase matches best practices vs. where it diverges]
* **Dependencies:** (e.g., Airtable Table X, n8n Node Y)

## 5. Technical Constraints & Risks
* **Security:** (e.g., Auth tokens, PII data)
* **Risks:** (e.g., "Changing this might break the Tally webhook")
* **Breaking Changes:** [any backwards-compatibility concerns]

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1.  Step 1...
2.  Step 2...

### Data Structures / Schema Changes
* JSON / Airtable Field updates...

### n8n Architecture
* **New Nodes:** ...
* **Modified Nodes:** ...

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| path/to/file | Create/Modify/Delete | What changes |

## 7. Validation Plan
* [ ] Test Case 1: ...
* [ ] Test Case 2: ...
* [ ] Verify no regression in Workflow ID: ...

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
* *Research principles applied: ...*
```

---

## 7. Research Rules

1. **No skipping.** Even if the task seems simple or familiar, do the research. Better approaches often surface.
2. **Quality over quantity.** 3 excellent sources read deeply > 10 sources skimmed.
3. **Be specific to our context.** Don't quote generic advice — explain how each principle applies to our specific feature/bug.
4. **Time-box it.** 5-10 minutes of tool calls. Search smart, read relevant sections, move on.
5. **Cumulative knowledge.** If domain was researched before, reference the prior log and add only new findings.
6. **Disagree with books when warranted.** If a recommendation doesn't fit our constraints (static hosting, n8n limitations, etc.), note it AND why we're deviating.

---

## 8. Pre-Session Analysis Rule

At the start of every new chat session, you must:

1. Scan the design logs folder:
   - **Absolute path:** `C:\Users\liozm\Desktop\moshe\annual-reports\.agent\design-logs\`
   - **Relative path:** `.agent/design-logs/` (from project root)
2. Identify the last 3 logs to understand the immediate context.
3. Check if there are any logs marked `[APPROVED]` but not `[COMPLETED]` (unfinished work).
4. Note domains already researched (for cumulative knowledge — avoid repeating research).
