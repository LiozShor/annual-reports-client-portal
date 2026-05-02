#!/usr/bin/env python3
"""Size-ratchet guard for monolithic JS files.

Fails the commit if any tracked file in `.claude/script-size-baseline.json`
has grown vs. its baseline. Auto-ratchets the baseline DOWN when files shrink
and re-stages the baseline file so the new floor is committed alongside.

Override (rare, intentional growth): edit `.claude/script-size-baseline.json`
in the same commit and explain why in the commit message.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BASELINE = REPO / ".claude" / "script-size-baseline.json"


def line_count(path: Path) -> int:
    with path.open("rb") as f:
        return sum(1 for _ in f)


def main() -> int:
    if not BASELINE.exists():
        return 0

    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    grew: list[tuple[str, int, int]] = []
    shrank = False

    for rel, baseline_lines in baseline.items():
        path = REPO / rel
        if not path.exists():
            continue
        current = line_count(path)
        if current > baseline_lines:
            grew.append((rel, baseline_lines, current))
        elif current < baseline_lines:
            baseline[rel] = current
            shrank = True

    if grew:
        print("\n[size-ratchet] BLOCKED — monolithic file grew:", file=sys.stderr)
        for rel, was, now in grew:
            print(f"  {rel}: {was} -> {now} (+{now - was} lines)", file=sys.stderr)
        print(
            "\nFix: extract the new code into a module under "
            "`frontend/admin/js/modules/` or build it as a React island\n"
            "in `frontend/admin/react/`. Do NOT add more lines to the monolith.\n\n"
            "Override (rare): bump the number in `.claude/script-size-baseline.json`\n"
            "in this same commit and explain why in the commit message.",
            file=sys.stderr,
        )
        return 1

    if shrank:
        BASELINE.write_text(
            json.dumps(baseline, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "add", str(BASELINE)], cwd=REPO, check=False)
        print("[size-ratchet] baseline ratcheted down ✓")

    return 0


if __name__ == "__main__":
    sys.exit(main())
