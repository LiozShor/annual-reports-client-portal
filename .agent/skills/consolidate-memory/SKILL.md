---
name: consolidate-memory
description: Invoked by `/consolidate-memory` (or cross-referenced by monthly-insights). Surfaces duplicate, contradicting, and stale memory files for human review. Produces a proposal file under `.agent/insights-audits/` — never modifies memory files.
---

# /consolidate-memory

Triggered when the user invokes `/consolidate-memory`, or when a monthly-insights run flags the memory directory as needing a hygiene pass.

## Inputs (gather before writing)

1. **Memory files.** `C:/Users/liozm/.claude/projects/C--Users-liozm-Desktop-moshe-annual-reports/memory/*.md` (~47 files). Each carries `created:` and `last_validated:` frontmatter fields.
2. **Memory index.** `MEMORY.md` in the same directory — lists all files with one-line descriptions.
3. **Session transcripts (usage signal).** `C:/Users/liozm/.claude/projects/C--Users-liozm-Desktop-moshe-annual-reports/*.jsonl` (~170 files, NDJSON). Used to detect unreferenced basenames.

## Detection passes

### (a) Duplicates

- Group files by filename prefix (e.g. `feedback_`, `reference_`, `project_`) and by `description:` substring overlap.
- Flag pairs whose body content shares >60% trigram overlap. Use grep-able heuristics — no embeddings.
- List each candidate pair: `<file-A>` vs `<file-B>` + overlapping phrase excerpt.

### (b) Contradictions

- Scan `description:` lines for shared domain terms (e.g. "wrangler", "Airtable", "push", "merge").
- For files sharing a domain term, grep bodies for opposing imperatives: `always X` vs `never X`, `do X` vs `do not X`, `use X` vs `avoid X`.
- Heuristic only — list candidates for human review. Do NOT auto-resolve.

### (c) Stale

- For each file basename (without `.md`), run `grep -l <basename> *.jsonl` against the transcripts directory.
- Also check transcript mtimes: if no transcript referencing the file exists within the last 90 days, mark as unreferenced.
- Additionally flag files where frontmatter `last_validated:` is >90 days before today (`date +%Y-%m-%d`).
- Cap output at ~10 stale candidates per run — triage, not mass deletion.

## Outputs

Write `.agent/insights-audits/memory-consolidation-YYYY-MM-DD.md` (today's date via `date +%Y-%m-%d`).

- If the file for today already exists, append a `-NN` suffix (e.g. `-02`) rather than overwrite.
- If a current monthly-insights audit exists in `.agent/insights-audits/`, cross-link it at the top of the output.

Output structure:

```
# Memory Consolidation — YYYY-MM-DD

> Cross-ref: [monthly-insights YYYY-MM](.agent/insights-audits/YYYY-MM.md)  ← include if exists

## Duplicates
| File A | File B | Overlap excerpt | Proposed action |
|--------|--------|-----------------|-----------------|
| ...    | ...    | "..."           | merge into X    |

## Contradictions
| File A | File B | Conflict | Proposed action |
|--------|--------|----------|-----------------|
| ...    | ...    | always X vs never X | re-validate |

## Stale candidates (≤10)
| File | Last referenced in transcripts | last_validated | Proposed action |
|------|-------------------------------|----------------|-----------------|
| ...  | never / YYYY-MM-DD            | YYYY-MM-DD     | delete / re-validate |
```

Each row includes the file path, reason, and one of: `merge into <file>`, `delete`, `re-validate`.

## Constraints

- READ-ONLY on all memory files. Never modify, rename, or delete any file.
- Output filename must use today's date (`date +%Y-%m-%d`). Suffix `-NN` on collision.
- Cap stale candidates at ~10 per run. Do not propose mass deletions.
- User reviews the proposal and acts manually. This skill produces the list, nothing more.
- Do NOT run monthly-insights logic — that is a separate skill. Reference its output; do not duplicate it.
