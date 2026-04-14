# Security Implementation Rules

1. For CSP changes: audit ALL resource origins (fonts, iframes, scripts, connect-src, inline handlers) BEFORE writing any directive. Do not iterate blindly.
2. For security fixes across n8n: check for duplicate/renamed workflows — the active version may not be the one you found first.

**CORS Rules:** See `docs/cors-rules.md` — required when adding n8n Respond to Webhook nodes. Session 78 baseline: 27 nodes across 12 workflows.

## Active Hooks
- **Hebrew encoding check** (PreToolUse) — blocks edits introducing garbled Hebrew chars. Always active.
- **SSOT violation check** (PreToolUse) — warns on hardcoded doc titles in generator files. Standard+ only.
- **Banned frontend patterns** (PreToolUse) — blocks confirm()/alert()/console.log(). Standard+ only.
- **Sensitive file warning** (PreToolUse) — warns when reading .env or credential files. Standard+ only.
- **Stop audit** (Stop) — final safety check on modified files. Always active.

Profile control: set `CLAUDE_HOOK_PROFILE=minimal|standard|strict` (default: standard)
