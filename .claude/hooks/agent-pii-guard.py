#!/usr/bin/env python3
"""
Pre-commit hook: blocks commits of .agent/ files containing CPA-IDs,
Hebrew text (client names/values from live records), or raw API tokens.

Default mode: scans only ADDED lines in the staged diff (grandfathers existing content).
--all flag:    full-file scan of all tracked files (informational, always exits 0).

Exit 0 = clean. Exit 1 = blocked (prints offending lines + line numbers).
"""
import re
import subprocess
import sys

PATTERNS = [
    (re.compile(r'\bCPA-\d+\b'), "CPA client ID"),
    (re.compile(r'[\u0590-\u05FF]{4,}'), "Hebrew text (possible client data)"),
    # Airtable PAT: starts with 'pat' followed by 14+ base62 chars, then a dot + 64 hex chars
    (re.compile(r'\bpat[A-Za-z0-9]{14,}\.[a-f0-9]{64}\b'), "Airtable PAT token"),
]

# Lines that are clearly documenting past incidents — allow them through
ALLOWLIST_PATTERNS = [
    re.compile(r'Leaked token `pat'),        # incident post-mortem reference
    re.compile(r'rotated.*token'),
    re.compile(r'#\s*(CPA-\d+)'),           # markdown comment references are usually ok
    re.compile(r'toast\s+["\u201c]'),        # UI toast message strings in test checklists
    re.compile(r'נשמר בהצלחה'),              # "saved successfully" toast — not client PII
]


def is_allowlisted(line):
    return any(p.search(line) for p in ALLOWLIST_PATTERNS)


def scan_diff(paths):
    """
    Scan only added lines (+lines) from the staged diff for the given paths.
    Returns list of (path, lineno, label, line) tuples for violations.
    """
    found = []
    for path in paths:
        try:
            result = subprocess.run(
                ["git", "diff", "--cached", "-U0", "--", path],
                capture_output=True, text=True, encoding="utf-8", errors="ignore"
            )
        except OSError:
            continue

        # Track the destination line number from hunk headers
        dest_lineno = 0
        added_count = 0

        for raw_line in result.stdout.splitlines():
            # @@ -old_start,old_count +new_start,new_count @@ ...
            if raw_line.startswith("@@"):
                # parse +new_start out of the hunk header
                m = re.search(r'\+(\d+)', raw_line)
                if m:
                    dest_lineno = int(m.group(1)) - 1  # will be incremented on first +line
                    added_count = 0
                continue

            if raw_line.startswith("+++") or raw_line.startswith("---"):
                continue  # file header lines

            if raw_line.startswith("+"):
                added_count += 1
                dest_lineno += 1
                line = raw_line[1:]  # strip leading '+'
                if is_allowlisted(line):
                    continue
                for pattern, label in PATTERNS:
                    if pattern.search(line):
                        found.append((path, dest_lineno, label, line.rstrip()[:120]))
                        break
            elif raw_line.startswith(" "):
                dest_lineno += 1  # context line advances destination

    return found


def scan_all(paths):
    """
    Full-file scan of given paths. Always exits 0 — informational audit only.
    """
    found = []
    for path in paths:
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                for lineno, line in enumerate(f, 1):
                    if is_allowlisted(line):
                        continue
                    for pattern, label in PATTERNS:
                        if pattern.search(line):
                            found.append((path, lineno, label, line.rstrip()[:120]))
                            break
        except OSError:
            pass
    return found


def main():
    args = sys.argv[1:]
    audit_mode = "--all" in args
    paths = [a for a in args if not a.startswith("--")]

    if audit_mode:
        # Informational: scan full files, always exit 0
        if not paths:
            # Default: scan all tracked .agent/ files
            result = subprocess.run(
                ["git", "ls-files", ".agent/"],
                capture_output=True, text=True, encoding="utf-8"
            )
            paths = [p for p in result.stdout.splitlines() if p]

        found = scan_all(paths)
        if found:
            print(f"agent-pii-guard --all: {len(found)} existing matches (informational, not blocking):\n")
            for path, lineno, label, line in found:
                print(f"  {path}:{lineno} [{label}]: {line}")
        else:
            print("agent-pii-guard --all: no matches found.")
        sys.exit(0)

    # Default pre-commit hook mode: diff-only scan
    found = scan_diff(paths)

    if found:
        print("agent-pii-guard: potential PII/secrets in NEW lines of .agent/ files:\n")
        for path, lineno, label, line in found:
            print(f"  {path}:{lineno} [{label}]: {line}")
        print(
            "\nTo fix: replace real IDs with placeholders (e.g. CPA-XXX), "
            "remove Hebrew client data, rotate any live tokens.\n"
            "If a match is a false positive, add it to ALLOWLIST_PATTERNS in "
            ".claude/hooks/agent-pii-guard.py"
        )
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
