#!/usr/bin/env python3
"""Prune .agent/current-status.md when "Last Updated" history grows too long.

Runs on SessionStart. Idempotent; silent when nothing to do.

Behavior:
- Splits the file at the first standalone `---` separator.
- HEADER = title + chronological "**Last Updated:**" lines (one per line, in file order).
- BODY  = everything from `---` onward (OPEN/SHIPPED state sections — preserved verbatim).
- Keeps the newest KEEP entries in HEADER. Older entries are prepended (newest-first)
  to .agent/current-status-archive.md under a dated section.
- Triggers only when entry count > THRESHOLD.
"""
from __future__ import annotations
import datetime as _dt
import re
import sys
from pathlib import Path

THRESHOLD = 15   # prune when more than this many entries
KEEP = 10        # keep this many newest entries after pruning

ENTRY_RE = re.compile(r"^\*\*Last Updated:\*\*", re.MULTILINE)


def find_repo_root(start: Path) -> Path | None:
    for p in [start, *start.parents]:
        if (p / ".git").exists():
            return p
    return None


def main() -> int:
    here = Path(__file__).resolve()
    root = find_repo_root(here)
    if root is None:
        return 0
    status = root / ".agent" / "current-status.md"
    if not status.exists():
        return 0

    text = status.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=False)

    # Find separator line index (first standalone '---' after the title).
    sep_idx = None
    for i, ln in enumerate(lines):
        if ln.strip() == "---" and i > 0:
            sep_idx = i
            break

    header_lines = lines[:sep_idx] if sep_idx is not None else lines[:]
    body_lines = lines[sep_idx:] if sep_idx is not None else []

    # Collect entry line indices within header.
    entry_idxs = [i for i, ln in enumerate(header_lines) if ln.startswith("**Last Updated:**")]
    if len(entry_idxs) <= THRESHOLD:
        return 0  # nothing to do

    # Newest entries are at the top of the file (file convention).
    keep_idxs = set(entry_idxs[:KEEP])
    archive_idxs = [i for i in entry_idxs if i not in keep_idxs]

    archived_lines = [header_lines[i] for i in archive_idxs]
    new_header = [ln for i, ln in enumerate(header_lines) if i not in set(archive_idxs)]

    # Rewrite current-status.md (header + separator + body).
    out = "\n".join(new_header).rstrip() + "\n"
    if body_lines:
        out += "\n" + "\n".join(body_lines).rstrip() + "\n"
    status.write_text(out, encoding="utf-8")

    # Append-archive (newest-first within section, sections newest at top).
    archive = root / ".agent" / "current-status-archive.md"
    today = _dt.date.today().isoformat()
    section = [f"## Pruned {today} ({len(archived_lines)} entries)", ""]
    section.extend(archived_lines)
    section.append("")
    new_section = "\n".join(section) + "\n"

    if archive.exists():
        existing = archive.read_text(encoding="utf-8")
        archive.write_text(new_section + existing, encoding="utf-8")
    else:
        archive.write_text(
            "# Current Status — Archived Entries\n\n"
            "Auto-pruned from `current-status.md` by `.claude/hooks/prune-current-status.py`.\n\n"
            + new_section,
            encoding="utf-8",
        )

    sys.stderr.write(
        f"[prune-current-status] archived {len(archived_lines)} entries "
        f"(kept newest {KEEP})\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
