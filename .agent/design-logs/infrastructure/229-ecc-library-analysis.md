# DL-229: everything-claude-code Library Analysis

**Source:** https://github.com/affaan-m/everything-claude-code
**Date:** 2026-03-30
**Purpose:** Extract actionable improvements for our Claude Code setup from ECC patterns

---

## Worth Adopting

### 1. Claude Code Hooks — Post-Edit Guardrails

**What:** ECC uses hooks (via `.cursor/hooks.json` + JS scripts) that fire after every file edit. Their `after-file-edit.js` chains three checks: format, typecheck, console.log warning.

**Why it helps us:** We have RULES banning `alert()`/`confirm()` and requiring SSOT compliance, but rules are advisory — Claude can ignore them under pressure. Hooks are **enforcement**. Four high-value hooks for our system:

#### Hook A: Hebrew Encoding Corruption (post-edit)
```
Trigger: PostToolUse on Edit/Write
Match: files containing Hebrew characters (*.js, *.html, *.md in github/)
Check: grep for ×, Ã, ï¿½, replacement chars (U+FFFD)
Action: BLOCK edit + error message
```
Our CLAUDE.md already says "STOP immediately" on garbled Hebrew, but a hook would catch it before the damage propagates.

#### Hook B: SSOT Violation Detection (post-edit)
```
Trigger: PostToolUse on Edit/Write
Match: ssot-document-generator.js, document-service Code nodes
Check: grep for hardcoded Hebrew doc titles NOT wrapped in SSOT template calls
Action: WARN (stderr message, don't block)
```
This catches the #1 recurring bug in our system — hardcoded doc names bypassing SSOT.

#### Hook C: Banned Patterns in Frontend (post-edit)
```
Trigger: PostToolUse on Edit/Write
Match: github/annual-reports-client-portal/**/*.{js,html}
Check: grep for confirm(, alert(, console.log(
Action: BLOCK with "Use showConfirmDialog/showModal/showAIToast instead"
```
Rules say don't use these, but we've had violations. A hook makes it impossible.

#### Hook D: Sensitive File Read Warning (pre-read)
```
Trigger: PreToolUse on Read
Match: .env, *.pem, *credentials*, *secret*
Action: WARN "Reading sensitive file — do not include contents in responses"
```
ECC does this. Low effort, prevents accidental secret leakage.

**Implementation plan:**
1. Create `~/.claude/hooks/` directory with 4 JS scripts
2. Add hook config to `.claude/settings.local.json` (Claude Code uses `hooks` key, not a separate hooks.json)
3. Each hook reads stdin JSON `{tool_name, tool_input}`, checks patterns, exits 0 (pass) or 2 (block)
4. Test with a deliberate violation in a scratch file
5. Estimated effort: 2-3 hours total

---

### 2. Hook Profiles (minimal/standard/strict)

**What:** ECC's `adapter.js` has a `hookEnabled(hookName, profiles)` function. Hooks are gated by `ECC_HOOK_PROFILE` env var — you can run in `minimal` (nothing blocks), `standard` (key guards), or `strict` (everything enforced).

**Why it helps us:** Some hooks (Hebrew corruption) should ALWAYS block. Others (console.log warning) are annoying during rapid prototyping. A profile system lets us dial enforcement up/down without editing hook configs.

**Implementation plan:**
- Add `CLAUDE_HOOK_PROFILE` env var check to each hook script
- Hebrew corruption + SSOT violation: always enabled
- console.log/alert ban: standard + strict only
- Sensitive file warning: standard + strict only
- Default: `standard`

---

### 3. Stop Hook — Final Audit on Session End

**What:** ECC's `stop.js` hook fires when Claude Code stops, auditing all modified files one final time.

**Why it helps us:** A stop hook could:
- Check all modified `.js` files for banned patterns one last time
- Verify no `.env` or credential files were accidentally staged
- Remind to update `.agent/current-status.md` (which we're supposed to do per CLAUDE.md but often forget)

**Implementation plan:**
- Single `stop.js` script, runs on the `Stop` event
- Checks `git diff --name-only` for risky files
- Warns on stderr (never blocks — stop hooks shouldn't prevent Claude from finishing)

---

### 4. Agent Metadata: `allowedTools` Field

**What:** ECC's agents (`.kiro/agents/`) use YAML frontmatter with `name`, `description`, and `allowedTools` fields. Our agents have markdown headers but no structured metadata.

**Why it helps us:** Adding `allowedTools` to our agents would:
- Limit `security-auditor` to read-only (currently unrestricted)
- Limit `code-reviewer` to read + grep (no edits during review)
- Make agent capabilities explicit and auditable

**Implementation plan:**
- Add YAML frontmatter to `security-auditor.md` and `code-reviewer.md`:
  ```yaml
  ---
  name: security-auditor
  description: Security audit specialist for Israeli privacy law compliance
  allowedTools: [Read, Grep, Glob, Bash(grep:*), Bash(git:*)]
  ---
  ```
- Note: Claude Code may not enforce `allowedTools` natively yet, but the metadata serves as documentation and could be enforced via a PreToolUse hook in the future

---

### 5. Confidence Threshold in Code Reviewer

**What:** ECC's code-reviewer has an explicit rule: "only report issues I'm >80% certain about." Also: "Filter noise — skip stylistic preferences unless they violate project conventions."

**Why it helps us:** Our code-reviewer flags everything equally. Adding confidence filtering would reduce noise, especially for Hebrew encoding issues where false positives are common.

**Implementation plan:**
- Add to `.claude/agents/code-reviewer.md`:
  ```
  ## Confidence Rule
  Only flag issues you are >80% certain about. For uncertain findings,
  note them under "Possible Issues" with lower priority.
  Skip stylistic preferences unless they violate the UI design system.
  ```

---

## Interesting But Not Now

### 6. Dynamic Context Modes (dev/review/research)

**What:** ECC has `.kiro/steering/dev-mode.md`, `review-mode.md`, `research-mode.md` — activated via `#dev-mode` command to load different behavioral contexts.

**Assessment:** We already have this implicitly:
- `/consult` = review/advisory mode
- `/design-log` = research mode
- Default = dev mode

Formalizing into explicit modes would add clarity but isn't worth the setup cost right now. Our commands already serve this purpose.

**When to reconsider:** If we add more team members who need consistent mode-switching.

### 7. Skill Metadata: "When to Use / How It Works / Examples" Template

**What:** ECC skills follow a rigid 3-section template. Our skills (`n8n-mcp`, `ssot-verify`, `design-log`) have custom structures.

**Assessment:** The template is nice for discoverability but our skills are specialized and used by one person (Lioz). The current free-form works fine. Would matter more with a team.

### 8. Architecture Decision Records (ADRs)

**What:** ECC's architect agent creates formal ADR documents with Context/Decision/Consequences/Alternatives/Status sections.

**Assessment:** Our design logs already serve this purpose with a lighter format. ADRs are more formal than we need for a single-developer project. Design logs capture the same information (decision rationale, trade-offs) with less overhead.

### 9. Pre-Shell Hook: Dangerous Command Blocking

**What:** ECC's `before-shell-execution.js` blocks dev server starts outside tmux and warns on `git push`.

**Assessment:** We already have a robust `deny` list in `settings.local.json` that blocks destructive commands (`rm -rf`, `git push --force`, etc.). A pre-shell hook would be redundant with our deny list. Our deny list approach is actually more reliable since it's enforced at the permission level, not the hook level.

### 10. Session Start/End Hooks for Context Persistence

**What:** ECC has `session-start.js` (loads previous context) and `session-end.js` (persists state).

**Assessment:** We have `.agent/current-status.md` for this purpose. Auto-updating it via hooks would be nice but it's a "nice to have" — the manual reminder in CLAUDE.md works well enough. The risk is that auto-generated status updates would be less useful than manually curated ones.

---

## Not Relevant

### 11. Multi-IDE Support (.cursor/, .kiro/, .codex/, .agents/, .opencode/)

ECC maintains parallel configs for 6+ IDE/agent harnesses. We only use Claude Code — maintaining Cursor/Kiro/Codex adapters would be pure overhead.

### 12. Language-Specific Rule Files (golang, python, swift, kotlin, php)

ECC has per-language rule sets. Our codebase is JS/TS only (Workers + frontend). The TypeScript-specific rules could theoretically apply, but our existing `CLAUDE.md` + `rules/security.md` already cover our TS patterns adequately.

### 13. Plugin/Marketplace System (.claude-plugin/, .codex-plugin/)

ECC's plugin system is designed for distributing configs to other projects. We have exactly one project. Not applicable.

### 14. Team Configuration (.claude/team/)

ECC has team sync configs. We're a solo developer with occasional stakeholder review. No team to sync with.

### 15. Enterprise Controls (.claude/enterprise/controls.md)

Approval workflows, audit posture, escalation policies. Our system is managed by one developer for one CPA firm. Enterprise governance would be overhead without benefit.

### 16. Homunculus/Instincts System (.claude/homunculus/)

ECC's "instinct" layer for behavioral conditioning across sessions. Interesting concept, but our auto-memory system already handles this — feedback memories persist behavioral corrections across conversations. The instinct system is solving the same problem with more complexity.

### 17. Cross-Harness Skill Copies

ECC copies each skill into `.agents/skills/`, `.cursor/skills/`, `.kiro/skills/`. We use one tool. Zero value.

### 18. Auto-Generated Guardrails from Repo History

ECC's `everything-claude-code-guardrails.md` is auto-generated from commit analysis. Cool but our `CLAUDE.md` + `docs/common-mistakes.md` serve the same purpose with more specificity. Auto-generation would likely produce generic rules less useful than our hand-curated ones.

---

## Summary & Priority Order

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| **P0** | Hook C: Banned frontend patterns | 30 min | Prevents recurring UI violations |
| **P0** | Hook A: Hebrew encoding corruption | 45 min | Prevents data corruption |
| **P1** | Hook B: SSOT violation detection | 1 hour | Catches #1 bug category |
| **P1** | Hook D: Sensitive file warning | 15 min | Low effort, prevents leaks |
| **P1** | Stop hook: final audit | 30 min | Safety net |
| **P2** | Hook profiles (minimal/standard/strict) | 30 min | Quality of life |
| **P2** | Agent metadata (allowedTools) | 15 min | Documentation + future enforcement |
| **P2** | Code reviewer confidence threshold | 5 min | Reduces noise |

**Total estimated effort for all P0+P1 items: ~3 hours**
