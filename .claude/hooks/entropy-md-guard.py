#!/usr/bin/env python3
"""Pre-commit hook: flag high-entropy values inside backticks in Markdown.
Catches novel/custom keys (e.g. HMAC secrets) that don't match known prefix regex.

Default mode scans only ADDED lines from `git diff --cached` so existing baseline
content is grandfathered. Use --all to scan whole files (informational, exit 0).
"""
import math, re, subprocess, sys
from collections import Counter

ENTROPY_THRESHOLD = 4.5  # bits/char — random hex/base64 lands ~3.7-4.0; mixed-charset
                         # symbols-included secrets land ~4.5+. Tune per false-positives.
MIN_LEN = 20
MAX_LEN = 120

ALLOWLIST_PREFIXES = ('http', '/', '#', 'data:', 'sha256:', '[REDACTED-', 'tbl', 'app',
                      'fld', 'rec', 'CPA-', 'DL-', 'wf', 'WF', 'usr', 'pat')  # paths,
                      # IDs, redacted markers, schema refs

# Real secrets are continuous alphanumeric / base64-style sequences. Anything
# containing prose-or-code punctuation is almost certainly a code snippet,
# function call, JSON fragment, or commit message — skip it.
SECRET_SHAPE_RE = re.compile(r'^[A-Za-z0-9+/=_\-]+$')

def shannon(s: str) -> float:
    if not s: return 0.0
    counts = Counter(s)
    total = len(s)
    return -sum((c/total) * math.log2(c/total) for c in counts.values())

def check_line(path: str, lineno: int, line: str) -> int:
    hits = 0
    for m in re.finditer(r'`([^`\s][^`]{18,118}[^`\s])`', line):
        v = m.group(1)
        if any(v.startswith(p) for p in ALLOWLIST_PREFIXES):
            continue
        if not SECRET_SHAPE_RE.match(v):
            continue  # has code/prose punctuation — not a secret shape
        if MIN_LEN <= len(v) <= MAX_LEN and shannon(v) >= ENTROPY_THRESHOLD:
            print(f"{path}:{lineno}: high-entropy backtick value "
                  f"(len={len(v)}, H={shannon(v):.2f}): "
                  f"`{v[:6]}…{v[-2:]}` — review",
                  file=sys.stderr)
            hits += 1
    return hits


def scan_full(path: str) -> int:
    if not path.endswith('.md'):
        return 0
    hits = 0
    try:
        with open(path, encoding='utf-8') as f:
            for lineno, line in enumerate(f, 1):
                hits += check_line(path, lineno, line)
    except (OSError, UnicodeDecodeError):
        return 0
    return hits


def scan_diff(paths) -> int:
    """Scan only added lines (+lines) from `git diff --cached`."""
    hits = 0
    for path in paths:
        if not path.endswith('.md'):
            continue
        try:
            result = subprocess.run(
                ['git', 'diff', '--cached', '-U0', '--', path],
                capture_output=True, text=True, encoding='utf-8', errors='ignore'
            )
        except OSError:
            continue
        dest_lineno = 0
        for raw in result.stdout.splitlines():
            if raw.startswith('@@'):
                m = re.search(r'\+(\d+)', raw)
                if m:
                    dest_lineno = int(m.group(1)) - 1
                continue
            if raw.startswith('+++') or raw.startswith('---'):
                continue
            if raw.startswith('+'):
                dest_lineno += 1
                hits += check_line(path, dest_lineno, raw[1:])
            elif raw.startswith(' '):
                dest_lineno += 1
    return hits


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--all' in args:
        paths = [a for a in args if not a.startswith('--')]
        total = sum(scan_full(p) for p in paths)
        sys.exit(0)  # informational
    paths = [a for a in args if not a.startswith('--')]
    total = scan_diff(paths)
    sys.exit(1 if total else 0)
