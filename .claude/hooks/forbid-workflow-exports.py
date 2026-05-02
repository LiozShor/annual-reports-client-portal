#!/usr/bin/env python3
"""Pre-commit hook: hard-block any attempt to commit n8n workflow exports.

These files (e.g. `*-backup-*.json`, `*-export-*.json`, `*.workflow.json`,
`*n8n-export*.json`) historically contain plaintext Code-node secrets. Reference
incident: `docs/wf05-backup-pre-migration-2026-03-26.json` (DL-194 cleanup, 2026-05-02
rotation).

Even if the file is gitignored, `git add -f` could still stage it; this hook is
the second line of defense.
"""
import sys, fnmatch

PATTERNS = ['*-backup-*.json', '*-export-*.json', '*.workflow.json',
            '*n8n-export*.json', '*workflow-backup*.json']

hits = [f for f in sys.argv[1:]
        if any(fnmatch.fnmatch(f.lower(), p.lower()) for p in PATTERNS)]
if hits:
    print('❌ Workflow export files block — these contain plaintext secrets:',
          file=sys.stderr)
    for h in hits:
        print(f'   {h}', file=sys.stderr)
    print('If you really need to commit, redact secrets first and rename the file.',
          file=sys.stderr)
    sys.exit(1)
sys.exit(0)
