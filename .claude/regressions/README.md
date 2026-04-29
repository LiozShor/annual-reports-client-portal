# Regression Test Scaffold

## Purpose

Each row in `cases.md` is a guard against a bug that has actually broken this project before.
If a case FAILs, a rule from memory is currently violated in the repo.

## File Format

`cases.md` uses pipe-delimited rows (one case per line):

```
<id> | <category> | <command> | <expect> | <rule_link>
```

| Field | Meaning |
|-------|---------|
| `id` | Unique code, e.g. `W01`, `G01`, `P01`. Prefix groups related cases. |
| `category` | Slug: `wrangler`, `gitignore`, `pii-guard`, `env-vars`, `admin-ui`, `n8n`, `pages`, `security` |
| `command` | POSIX shell expression run in the repo root. Exit 0 = PASS. |
| `expect` | Human-readable description of what passing means. |
| `rule_link` | Filename of the memory file this guards (or `(none)` for universal rules). |

### Conventions

- Blank lines and lines starting with `#` are ignored by the runner.
- Use ` | ` (space-pipe-space) as the delimiter — never bare `|`.
- Commands must be self-contained and runnable from the repo root with no side effects.
- Keep commands under ~200 chars. For complex checks, add a helper script and call it.
- All commands must exit 0 in a clean, passing repo state.

### PASS / FAIL semantics

- `PASS` — command exits 0
- `FAIL` — command exits non-zero
- `SKIP` — command field is empty or contains only whitespace

## Running

```bash
bash scripts/check-regressions.sh
```

Prints one line per case, then a summary. Exits non-zero if any case fails.

## Settings.json wiring (follow-up)

The script is designed to be wired into `.claude/settings.json` as a PreToolUse hook on
`Bash(git push:*)` targeting main. This is handled separately; the script runs in warn-mode
(non-zero exit is noted but does not block push) for the first month.

## Adding a new case

1. Pick the next ID in its prefix group (look at the highest existing number in that group).
2. Write the command — test it locally to confirm it exits 0 in the passing state.
3. Append the row to `cases.md`.
4. Run `bash scripts/check-regressions.sh` to confirm the new case passes before committing.
