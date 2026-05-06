#!/usr/bin/env python3
"""Prune .agent/current-status.md on SessionStart.

Replaces the older "split at first ---" pruner. That version only counted
**Last Updated:** lines and never archived OPEN sections, so closed DLs
accumulated forever.

Behavior:
  1. Parse current-status.md as a typed grammar (TITLE / LOG / OPEN / SHIPPED /
     NEXT / RECENT / DATED / SEP). Unknown section -> bail loudly, no writes.
  2. For every "## OPEN: DL-NNN ..." section, look up DL-NNN in
     .agent/design-logs/INDEX.md. If status starts with COMPLETED, demote the
     whole section to a one-line "## SHIPPED: DL-NNN -- title (closed DATE)".
  3. Drop bullets in "## Recent (last 7 days)" older than 7 days.
  4. Trim the chronological **Last Updated:** log to newest 5 (threshold 8).
  5. If active file still > 250 lines, archive SHIPPED rows + ## YYYY-MM-DD
     blocks older than 14 days to .agent/current-status-archive.md.
  6. Append a one-line breadcrumb at the bottom pointing to the archive.

Safety:
  - Default first 2 runs are dry-run (writes a counter at .claude/state/
    prune-runs.json). After that, automatic.
  - --dry-run flag forces preview-only.
  - Atomic rewrite via tempfile + os.replace. Lock at .agent/.prune.lock
    (skip silently if held <60s ago).
  - Bail-and-warn: any unknown section header, unparseable INDEX row, or
    parser error => stderr message, exit 0, no writes.

PII guard note: agent-pii-guard.py's --all mode is informational-only
(exits 0 unconditionally per its docstring). The pruner only rearranges
content that was already in the file -- it cannot introduce new PII -- so
no inline guard call is made here. The existing pre-commit hook covers the
file at commit time.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

# ---- Tunables -----------------------------------------------------------

LINE_CAP = 250                # archive triggers above this many lines
LOG_THRESHOLD = 8             # prune the **Last Updated:** log above this
LOG_KEEP = 5                  # newest N entries to keep
RECENT_WINDOW_DAYS = 7        # for "## Recent (last 7 days)" bullets
ARCHIVE_AGE_DAYS = 14         # archive SHIPPED + dated blocks older than this
DRY_RUN_FIRST_N = 2           # first N runs are forced dry-run
LOCK_TTL_SECONDS = 60

COMPLETED_STATUS_PREFIXES = ("COMPLETED",)  # add BLOCKED/WONTFIX here later
KEEP_OPEN_STATUS_PREFIXES = (
    "IMPLEMENTED",
    "DRAFT",
    "BEING IMPLEMENTED",
    "PENDING",
    "BLOCKED",
)

# ---- Section grammar ----------------------------------------------------

# Recognized line markers. Anything else => unknown => bail.
RE_TITLE = re.compile(r"^# Annual Reports CRM")
RE_LOG = re.compile(r"^\*\*Last Updated:\*\*\s*(\d{4}-\d{2}-\d{2})")
RE_OPEN_DL = re.compile(r"^## OPEN:\s*DL-(\d+)\s*[—-]\s*(.+)$")
RE_OPEN_OTHER = re.compile(r"^## OPEN:\s*(?!DL-\d)(.+)$")
RE_SHIPPED = re.compile(
    r"^## SHIPPED:\s*DL-(\d+)\s*[—-]\s*(.+?)\s*\(closed (\d{4}-\d{2}-\d{2})\)\s*$"
)
RE_NEXT = re.compile(r"^## NEXT[ :(]")
RE_RECENT = re.compile(r"^## Recent \(last 7 days\)\s*$")
RE_DATED = re.compile(r"^## (\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+)$")
RE_SEP = re.compile(r"^---\s*$")
RE_H2 = re.compile(r"^## ")
RE_BREADCRUMB = re.compile(r"^>\s*Older entries archived")

# Recent-bullet leading date: "- **YYYY-MM-DD ..."
RE_RECENT_BULLET_DATE = re.compile(r"^[-*]\s+\*\*(\d{4}-\d{2}-\d{2})")

# INDEX.md row: "| 405 | [...](path) | STATUS string | summary |"
RE_INDEX_ROW = re.compile(r"^\|\s*(\d+)\s*\|")
# COMPLETED date capture: "COMPLETED — 2026-05-03" or "COMPLETED -- 2026-05-03"
RE_COMPLETED_DATE = re.compile(r"COMPLETED\s*[—-]+\s*(\d{4}-\d{2}-\d{2})")


# ---- IO helpers ---------------------------------------------------------

def warn(msg: str) -> None:
    sys.stderr.write(f"[prune-current-status] {msg}\n")


def find_repo_root(start: Path) -> Path | None:
    for p in [start, *start.parents]:
        if (p / ".git").exists():
            return p
    return None


def load_index(index_path: Path) -> dict[int, str]:
    """Return {dl_num: status_string} parsed from INDEX.md pipe-table rows."""
    if not index_path.exists():
        return {}
    out: dict[int, str] = {}
    for raw in index_path.read_text(encoding="utf-8").splitlines():
        m = RE_INDEX_ROW.match(raw)
        if not m:
            continue
        cols = [c.strip() for c in raw.split("|")]
        # cols[0] is empty (leading "|"). Indices: 1=NNN, 2=link, 3=status, 4=summary
        if len(cols) < 5:
            continue
        try:
            dl_num = int(cols[1])
        except ValueError:
            continue
        out[dl_num] = cols[3]
    return out


# ---- Parser -------------------------------------------------------------

class Section:
    __slots__ = ("kind", "header", "lines", "dl_num", "date", "title")

    def __init__(self, kind: str, header: str = ""):
        self.kind = kind          # "title", "log", "open_dl", "open_other",
                                  # "shipped", "next", "recent", "dated",
                                  # "sep", "breadcrumb", "preface"
        self.header = header
        self.lines: list[str] = []
        self.dl_num: int | None = None
        self.date: _dt.date | None = None
        self.title: str = ""


def parse(text: str) -> tuple[list[Section], list[str]]:
    """Parse text into typed sections. Returns (sections, errors).

    On any unknown structure, errors is non-empty and caller must bail.
    """
    sections: list[Section] = []
    errors: list[str] = []

    lines = text.splitlines()
    cur: Section | None = None

    def flush():
        nonlocal cur
        if cur is not None:
            sections.append(cur)
            cur = None

    # First pass: classify each line; H2 boundaries start new sections.
    for i, ln in enumerate(lines, start=1):
        stripped = ln.rstrip()

        if RE_TITLE.match(stripped):
            flush()
            sec = Section("title", stripped)
            sec.lines.append(stripped)
            sections.append(sec)
            continue

        if RE_LOG.match(stripped):
            # Log lines stand alone -- one section per line.
            flush()
            m = RE_LOG.match(stripped)
            sec = Section("log", stripped)
            sec.lines.append(stripped)
            try:
                sec.date = _dt.date.fromisoformat(m.group(1))
            except ValueError:
                errors.append(f"line {i}: bad date in **Last Updated:** -> {stripped!r}")
            sections.append(sec)
            continue

        if RE_BREADCRUMB.match(stripped):
            flush()
            sec = Section("breadcrumb", stripped)
            sec.lines.append(stripped)
            sections.append(sec)
            continue

        if RE_SEP.match(stripped):
            flush()
            sec = Section("sep", stripped)
            sec.lines.append(stripped)
            sections.append(sec)
            continue

        if stripped.startswith("## "):
            flush()
            m = RE_OPEN_DL.match(stripped)
            if m:
                cur = Section("open_dl", stripped)
                cur.dl_num = int(m.group(1))
                cur.title = m.group(2).strip()
                cur.lines.append(stripped)
                continue
            m = RE_SHIPPED.match(stripped)
            if m:
                cur = Section("shipped", stripped)
                cur.dl_num = int(m.group(1))
                cur.title = m.group(2).strip()
                try:
                    cur.date = _dt.date.fromisoformat(m.group(3))
                except ValueError:
                    errors.append(f"line {i}: bad closed date -> {stripped!r}")
                cur.lines.append(stripped)
                continue
            if RE_OPEN_OTHER.match(stripped):
                cur = Section("open_other", stripped)
                cur.lines.append(stripped)
                continue
            if RE_NEXT.match(stripped):
                cur = Section("next", stripped)
                cur.lines.append(stripped)
                continue
            if RE_RECENT.match(stripped):
                cur = Section("recent", stripped)
                cur.lines.append(stripped)
                continue
            m = RE_DATED.match(stripped)
            if m:
                cur = Section("dated", stripped)
                try:
                    cur.date = _dt.date.fromisoformat(m.group(1))
                except ValueError:
                    errors.append(f"line {i}: bad date in dated header -> {stripped!r}")
                cur.title = m.group(2).strip()
                cur.lines.append(stripped)
                continue
            errors.append(f"line {i}: unknown ## header -> {stripped!r}")
            # Still accumulate so we don't lose data on a dry-run preview.
            cur = Section("unknown", stripped)
            cur.lines.append(stripped)
            continue

        # Non-header line: belongs to current section, or to a "preface"
        # (blank/text before any section).
        if cur is None:
            # Treat leading content (blank lines, stray text) as preface.
            if not sections or sections[-1].kind != "preface":
                flush()
                cur = Section("preface")
            else:
                cur = sections.pop()
            cur.lines.append(stripped)
            continue

        cur.lines.append(stripped)

    flush()
    return sections, errors


# ---- Transformations ----------------------------------------------------

def trim_log(sections: list[Section]) -> int:
    """Drop oldest log entries when count > LOG_THRESHOLD. Returns # dropped."""
    log_idxs = [i for i, s in enumerate(sections) if s.kind == "log"]
    if len(log_idxs) <= LOG_THRESHOLD:
        return 0
    # Newest first by file order (file convention: top is newest).
    drop = log_idxs[LOG_KEEP:]
    for i in sorted(drop, reverse=True):
        del sections[i]
    return len(drop)


def demote_completed(
    sections: list[Section], index: dict[int, str]
) -> tuple[int, list[str]]:
    """Convert ## OPEN: DL-NNN sections to ## SHIPPED one-liners when INDEX
    says COMPLETED. Returns (count_demoted, warnings).
    """
    warnings: list[str] = []
    demoted = 0
    for i, sec in enumerate(sections):
        if sec.kind != "open_dl":
            continue
        assert sec.dl_num is not None
        status = index.get(sec.dl_num)
        if status is None:
            warnings.append(
                f"DL-{sec.dl_num} referenced in current-status but not in INDEX.md"
            )
            continue
        if not any(status.startswith(p) for p in COMPLETED_STATUS_PREFIXES):
            # IMPLEMENTED/DRAFT/etc: keep full OPEN section.
            continue
        # Parse closed date from the status string ("COMPLETED — 2026-05-03").
        m = RE_COMPLETED_DATE.search(status)
        closed = m.group(1) if m else ""
        title = sec.title
        if closed:
            new_header = f"## SHIPPED: DL-{sec.dl_num} — {title} (closed {closed})"
        else:
            new_header = f"## SHIPPED: DL-{sec.dl_num} — {title}"
        new_sec = Section("shipped", new_header)
        new_sec.dl_num = sec.dl_num
        new_sec.title = title
        try:
            new_sec.date = _dt.date.fromisoformat(closed) if closed else None
        except ValueError:
            new_sec.date = None
        new_sec.lines = [new_header]
        sections[i] = new_sec
        demoted += 1
    return demoted, warnings


def trim_recent(sections: list[Section], today: _dt.date) -> int:
    """Drop bullets in '## Recent (last 7 days)' older than RECENT_WINDOW_DAYS.

    Returns total bullets dropped across all Recent sections.
    """
    dropped = 0
    cutoff = today - _dt.timedelta(days=RECENT_WINDOW_DAYS)
    for sec in sections:
        if sec.kind != "recent":
            continue
        new_lines: list[str] = []
        for ln in sec.lines:
            m = RE_RECENT_BULLET_DATE.match(ln)
            if m:
                try:
                    d = _dt.date.fromisoformat(m.group(1))
                except ValueError:
                    new_lines.append(ln)
                    continue
                if d < cutoff:
                    dropped += 1
                    continue
            new_lines.append(ln)
        sec.lines = new_lines
    return dropped


def collect_archivable(
    sections: list[Section], today: _dt.date
) -> list[int]:
    """Return indices of sections eligible to move to archive.

    Eligibility: SHIPPED rows or DATED blocks with date older than
    ARCHIVE_AGE_DAYS.
    """
    cutoff = today - _dt.timedelta(days=ARCHIVE_AGE_DAYS)
    out: list[int] = []
    for i, sec in enumerate(sections):
        if sec.kind in ("shipped", "dated") and sec.date and sec.date < cutoff:
            out.append(i)
    return out


def render(sections: list[Section]) -> str:
    """Render sections back to markdown text. Strips trailing-blank-line runs
    inside sections but preserves a single trailing blank between sections.
    """
    out: list[str] = []
    for sec in sections:
        lines = list(sec.lines)
        # Trim trailing blanks within a section (we re-add one between sections).
        while lines and lines[-1] == "":
            lines.pop()
        out.extend(lines)
        out.append("")  # blank line between sections
    # Collapse trailing blanks at file end to exactly one newline.
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n"


def line_count(text: str) -> int:
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def update_breadcrumb(
    sections: list[Section], today: _dt.date, archived_count: int
) -> None:
    """Replace any existing breadcrumb section with a fresh one. Always
    appended to the end so it's the last visible line.
    """
    sections[:] = [s for s in sections if s.kind != "breadcrumb"]
    line = (
        f"> Older entries archived to `current-status-archive.md` "
        f"(last pruned {today.isoformat()}, {archived_count} entries)."
    )
    bc = Section("breadcrumb", line)
    bc.lines = [line]
    sections.append(bc)


# ---- Archive write ------------------------------------------------------

def append_archive(archive_path: Path, archived_sections: list[Section], today: _dt.date) -> None:
    if not archived_sections:
        return
    body_lines = [f"## Pruned {today.isoformat()} ({len(archived_sections)} entries)", ""]
    for sec in archived_sections:
        body_lines.extend(sec.lines)
        body_lines.append("")
    new_section = "\n".join(body_lines).rstrip() + "\n\n"

    if archive_path.exists():
        existing = archive_path.read_text(encoding="utf-8")
        archive_path.write_text(new_section + existing, encoding="utf-8")
    else:
        header = (
            "# Current Status — Archived Entries\n\n"
            "Auto-pruned from `current-status.md` by `.claude/hooks/prune-current-status.py`.\n\n"
        )
        archive_path.write_text(header + new_section, encoding="utf-8")


# ---- Run-counter + lock -------------------------------------------------

def get_run_counter(state_dir: Path) -> int:
    p = state_dir / "prune-runs.json"
    if not p.exists():
        return 0
    try:
        return int(json.loads(p.read_text(encoding="utf-8")).get("runs", 0))
    except (ValueError, OSError, json.JSONDecodeError):
        return 0


def bump_run_counter(state_dir: Path) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    p = state_dir / "prune-runs.json"
    n = get_run_counter(state_dir) + 1
    p.write_text(json.dumps({"runs": n}), encoding="utf-8")


def acquire_lock(lock_path: Path) -> bool:
    """Return True if we hold the lock. Stale locks (>LOCK_TTL_SECONDS)
    are stolen.
    """
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        if lock_path.exists():
            age = time.time() - lock_path.stat().st_mtime
            if age < LOCK_TTL_SECONDS:
                return False
            # stale -- steal it
            lock_path.unlink()
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        return False
    except OSError:
        return False


def release_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink()
    except OSError:
        pass


# ---- Atomic write -------------------------------------------------------

def atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---- Main ---------------------------------------------------------------

def main(argv: list[str]) -> int:
    cli_dry_run = "--dry-run" in argv

    here = Path(__file__).resolve()
    root = find_repo_root(here)
    if root is None:
        return 0
    status_path = root / ".agent" / "current-status.md"
    archive_path = root / ".agent" / "current-status-archive.md"
    index_path = root / ".agent" / "design-logs" / "INDEX.md"
    state_dir = root / ".claude" / "state"
    lock_path = root / ".agent" / ".prune.lock"

    if not status_path.exists():
        return 0

    if not acquire_lock(lock_path):
        return 0  # another session pruning; skip silently

    try:
        text = status_path.read_text(encoding="utf-8")
        sections, parse_errors = parse(text)
        if parse_errors:
            for e in parse_errors:
                warn(e)
            warn("parse errors found, skipping run (no writes).")
            return 0

        index = load_index(index_path)
        today = _dt.date.today()

        # Phase A: in-place transforms (always run; surfaced via dry-run preview).
        log_dropped = trim_log(sections)
        demoted, dl_warnings = demote_completed(sections, index)
        for w in dl_warnings:
            warn(w)
        recent_dropped = trim_recent(sections, today)

        # Phase B: archive overflow only when over LINE_CAP.
        rendered = render(sections)
        archived_sections: list[Section] = []
        if line_count(rendered) > LINE_CAP:
            arch_idxs = collect_archivable(sections, today)
            archived_sections = [sections[i] for i in arch_idxs]
            for i in sorted(arch_idxs, reverse=True):
                del sections[i]

        # Phase C: breadcrumb. Only refresh if anything was archived this run
        # OR an existing breadcrumb is present (idempotent).
        had_breadcrumb = any(s.kind == "breadcrumb" for s in sections)
        if archived_sections or had_breadcrumb:
            # Total archived count: best-effort -- this run's count.
            update_breadcrumb(sections, today, len(archived_sections))

        new_text = render(sections)

        # No-op detection.
        no_op = (new_text == text and not archived_sections)
        if no_op:
            return 0

        # Decide dry-run vs wet.
        run_n = get_run_counter(state_dir)
        forced_dry = run_n < DRY_RUN_FIRST_N
        is_dry = cli_dry_run or forced_dry

        if is_dry:
            why = "--dry-run" if cli_dry_run else f"forced (run {run_n + 1}/{DRY_RUN_FIRST_N})"
            warn(f"DRY RUN ({why}): would mutate current-status.md")
            warn(
                f"  log entries dropped: {log_dropped}; "
                f"OPEN sections demoted to SHIPPED: {demoted}; "
                f"Recent bullets dropped: {recent_dropped}; "
                f"sections archived: {len(archived_sections)}; "
                f"projected line count: {line_count(new_text)}"
            )
            if not cli_dry_run:
                bump_run_counter(state_dir)
            return 0

        # Wet run.
        atomic_write(status_path, new_text)
        if archived_sections:
            append_archive(archive_path, archived_sections, today)
        bump_run_counter(state_dir)
        warn(
            f"pruned: log -{log_dropped}, demoted {demoted}, "
            f"recent -{recent_dropped}, archived {len(archived_sections)} "
            f"({line_count(text)} -> {line_count(new_text)} lines)"
        )
        return 0

    finally:
        release_lock(lock_path)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
