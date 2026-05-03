#!/usr/bin/env python3
"""Pre-commit hook: warn on large additions to .md files in a single commit.
Skipped if LARGE_DOC_REVIEWED=1 is set in the environment.
"""
import os, subprocess, sys

THRESHOLD = 200
if os.environ.get('LARGE_DOC_REVIEWED') == '1':
    sys.exit(0)

files = sys.argv[1:]
bad = []
for f in files:
    if not f.endswith('.md'):
        continue
    try:
        out = subprocess.check_output(
            ['git', 'diff', '--cached', '--numstat', '--', f],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
        if not out:
            continue
        added = int(out.split()[0])
        if added > THRESHOLD:
            bad.append((f, added))
    except (subprocess.CalledProcessError, ValueError):
        continue

if bad:
    print('\n⚠ Large Markdown additions detected:', file=sys.stderr)
    for f, n in bad:
        print(f'   {f}: +{n} lines', file=sys.stderr)
    print('\nDid you READ the full content? AI-generated docs leaked secrets in',
          file=sys.stderr)
    print('docs/multi-tenant-audit.md (2026-05-02). To proceed, re-run with:',
          file=sys.stderr)
    print('    LARGE_DOC_REVIEWED=1 git commit ...', file=sys.stderr)
    sys.exit(1)
sys.exit(0)
