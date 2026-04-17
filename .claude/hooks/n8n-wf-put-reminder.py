"""
PostToolUse hook (Bash matcher) — DL-296.

Detects when Claude runs a command that PUT-mutates an n8n workflow via the
public REST API. The public API's settings whitelist silently strips
`availableInMCP`, flipping it to false and breaking future MCP reads of that
workflow. There is no public endpoint to flip it back; the only remedy is a
manual toggle in the n8n UI.

This hook can't auto-fix, but it guarantees a visible reminder so the step
is never silently skipped.
"""
import json
import re
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cmd = ((data.get("tool_input") or {}).get("command") or "")

# Heuristics: catch direct curl PUTs, known patch-script filenames, and
# any future "patch-n8n-workflow*" style helper.
PATTERNS = [
    r"api/v1/workflows.*(-X\s*)?PUT",
    r"(-X\s*)?PUT\s+.*api/v1/workflows",
    r"dl\d+-patch-wf",
    r"patch-wf\d+\.py",
    r"patch-n8n-workflow",
]

if any(re.search(p, cmd, re.IGNORECASE) for p in PATTERNS):
    msg = (
        "\u26a0\ufe0f n8n REST PUT on workflow detected \u2014 availableInMCP "
        "was reset to false. Toggle it back ON in n8n UI "
        "(Workflow Settings \u2192 Available in MCP) before the next MCP read "
        "of this workflow."
    )
    print(json.dumps({"systemMessage": msg}))
