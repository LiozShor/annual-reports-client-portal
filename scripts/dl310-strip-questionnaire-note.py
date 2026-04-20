"""
DL-310: Strip legacy `[תשובה מהשאלון] <raw>` lines from bookkeepers_notes on
the documents table (tblcwptR63skeODPn).

Context:
  DL-296 appended the raw client questionnaire answer to each doc's
  bookkeepers_notes field so the admin could see it on the PA card. DL-310
  removed the producer (extract-issuer-names.ts no longer writes it) — this
  script is the one-shot backfill that cleans up existing rows.

Usage:
  # dry-run (default) — prints what WOULD change
  AIRTABLE_API_KEY=pat... AIRTABLE_BASE_ID=app... python3 scripts/dl310-strip-questionnaire-note.py

  # apply the changes
  AIRTABLE_API_KEY=pat... AIRTABLE_BASE_ID=app... python3 scripts/dl310-strip-questionnaire-note.py --apply

Idempotent: safe to re-run; a second run after --apply finds 0 matches.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

try:
    from pyairtable import Api
except ImportError:
    sys.stderr.write("pyairtable is required. Install with: pip install pyairtable\n")
    sys.exit(2)

DOCUMENTS_TABLE = 'tblcwptR63skeODPn'
NOTE_PREFIX = '[תשובה מהשאלון]'

# Matches the tag line plus any continuation lines until the next [tag] or EOF.
# Leading newlines are consumed so the preceding paragraph stays tight after strip.
STRIP_PATTERN = re.compile(
    r'\n*\[תשובה מהשאלון\][^\n]*(?:\n(?!\[)[^\n]*)*',
    re.MULTILINE,
)


def strip_note(notes: str) -> str:
    cleaned = STRIP_PATTERN.sub('', notes)
    # Collapse triple+ newlines introduced by the strip
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()


def preview(before: str, after: str, maxlen: int = 140) -> str:
    def short(s: str) -> str:
        s = s.replace('\n', ' ⏎ ')
        return (s[:maxlen] + '…') if len(s) > maxlen else s
    return f"BEFORE: {short(before)}\nAFTER : {short(after)}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Actually PATCH records (default: dry-run)')
    parser.add_argument('--limit', type=int, default=0, help='Max records to process (0 = all)')
    args = parser.parse_args()

    api_key = os.environ.get('AIRTABLE_API_KEY') or os.environ.get('AIRTABLE_PAT')
    base_id = os.environ.get('AIRTABLE_BASE_ID')
    if not api_key or not base_id:
        sys.stderr.write("AIRTABLE_API_KEY (or AIRTABLE_PAT) and AIRTABLE_BASE_ID required\n")
        return 2

    api = Api(api_key)
    table = api.table(base_id, DOCUMENTS_TABLE)

    print(f"Scanning {DOCUMENTS_TABLE} for records with '{NOTE_PREFIX}' in bookkeepers_notes…")
    records = table.all(
        fields=['bookkeepers_notes'],
        formula=f"FIND('{NOTE_PREFIX}', {{bookkeepers_notes}})",
    )
    print(f"Found {len(records)} candidate records.")

    planned: list[dict] = []
    for rec in records:
        before = (rec.get('fields', {}).get('bookkeepers_notes') or '')
        after = strip_note(before)
        if after == before:
            continue  # regex didn't actually change anything — log & skip
        planned.append({'id': rec['id'], 'before': before, 'after': after})

    if args.limit:
        planned = planned[:args.limit]

    print(f"\n{len(planned)} records will be updated.\n")
    for item in planned[:5]:
        print(f"--- {item['id']} ---")
        print(preview(item['before'], item['after']))
        print()

    if not planned:
        print("Nothing to do.")
        return 0

    if not args.apply:
        print(f"\nDRY-RUN — no changes written. Re-run with --apply to commit.")
        return 0

    # Batch update, 10 per chunk (pyairtable default cap)
    print(f"Applying {len(planned)} updates…")
    to_update = [
        {'id': item['id'], 'fields': {'bookkeepers_notes': item['after']}}
        for item in planned
    ]
    table.batch_update(to_update)
    print(f"Done. Updated {len(to_update)} records.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
