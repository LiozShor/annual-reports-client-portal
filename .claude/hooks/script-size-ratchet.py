#!/usr/bin/env python3
"""Size-ratchet guard for monolithic JS files.

Hard rule: the baseline in `.claude/script-size-baseline.json` is
APPEND-ONLY-DOWN. Numbers can only decrease, never increase. There is
no override knob. If a file needs more code, extract it into a module
under `frontend/admin/js/modules/` or build it as a React island
under `frontend/admin/react/`.

Two checks:
  1. Current line count must not exceed the committed baseline.
  2. The baseline file itself, if modified in the working tree, must
     not contain any number larger than its committed counterpart.
     (Closes the "agent bumps the baseline to make the error go away" loop.)

Shrinks auto-ratchet the baseline DOWN and re-stage it.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BASELINE_REL = ".claude/script-size-baseline.json"
BASELINE = REPO / BASELINE_REL


def line_count(path: Path) -> int:
    with path.open("rb") as f:
        return sum(1 for _ in f)


def committed_baseline() -> dict[str, int] | None:
    """Read the baseline as it exists in HEAD (last commit)."""
    try:
        out = subprocess.run(
            ["git", "show", f"HEAD:{BASELINE_REL}"],
            cwd=REPO,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout
        return json.loads(out)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None


def main() -> int:
    if not BASELINE.exists():
        return 0

    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))

    # --- Check 1: baseline file itself was not bumped upward ---
    head_baseline = committed_baseline()
    if head_baseline is not None:
        bumped: list[tuple[str, int, int]] = []
        for rel, current_limit in baseline.items():
            old_limit = head_baseline.get(rel)
            if old_limit is not None and current_limit > old_limit:
                bumped.append((rel, old_limit, current_limit))
        if bumped:
            print(
                "\n[size-ratchet] BLOCKED — baseline was bumped UP. "
                "This is not allowed.",
                file=sys.stderr,
            )
            for rel, was, now in bumped:
                print(f"  {rel}: {was} -> {now} (+{now - was})", file=sys.stderr)
            print(
                "\nThe baseline is APPEND-ONLY-DOWN. It can only shrink.\n"
                "There is no override. Do NOT ask the user to bump it —\n"
                "that option does not exist.\n\n"
                "Fix: revert the baseline change, then extract the new code\n"
                "into `frontend/admin/js/modules/<feature>.js` (export +\n"
                "import) or build it as a React island under\n"
                "`frontend/admin/react/`. The monolith does not grow.",
                file=sys.stderr,
            )
            return 1

    # --- Check 2: tracked files have not exceeded their baseline ---
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
            "\nThis file is on a one-way ratchet. It can only shrink.\n"
            "There is no override. Do NOT bump the baseline. Do NOT ask\n"
            "the user to bump the baseline — that option does not exist.\n\n"
            "Fix: extract the new code into\n"
            "`frontend/admin/js/modules/<feature>.js` and import it from\n"
            "the monolith, or build it as a React island under\n"
            "`frontend/admin/react/`. If you genuinely cannot proceed\n"
            "without growing the file, STOP and report the situation to\n"
            "the user — do not propose a baseline bump as the solution.",
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
