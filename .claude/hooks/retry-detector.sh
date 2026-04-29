#!/usr/bin/env bash
# Logs each Bash invocation to .claude/telemetry/bash-log.ndjson
# Warns if the same command failed (non-zero exit) twice in a row.
set -u

cmd="${CLAUDE_TOOL_ARG_command:-}"
ec="${CLAUDE_TOOL_RESULT_exit_code:-}"

# Bail silently if no command (some PostToolUse calls have empty args)
[ -z "$cmd" ] && exit 0

# Resolve repo root; bail silently if not in a git repo
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$repo" ] && exit 0

log_dir="$repo/.claude/telemetry"
log_file="$log_dir/bash-log.ndjson"
mkdir -p "$log_dir" 2>/dev/null || exit 0

# Escape command for JSON: use printf to iterate char by char
# (simpler than sed/awk and avoids shell escaping issues on MSYS)
esc_cmd=""
i=0
while [ $i -lt ${#cmd} ]; do
    c="${cmd:$i:1}"
    case "$c" in
        '\\') esc_cmd="${esc_cmd}\\\\" ;;
        '"') esc_cmd="${esc_cmd}\\\"" ;;
        *) esc_cmd="${esc_cmd}${c}" ;;
    esac
    i=$((i + 1))
done
# Remove control chars
esc_cmd=$(printf '%s\n' "$esc_cmd" | tr -d '\000-\037')

# Append NDJSON entry
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"ts":"%s","cmd":"%s","ec":"%s"}\n' "$ts" "$esc_cmd" "$ec" >> "$log_file" 2>/dev/null || exit 0

# Only check for retry pattern if the current command failed (ec != 0 and ec != "")
if [ -n "$ec" ] && [ "$ec" != "0" ]; then
    # Count consecutive failures of THIS exact command at the tail of the log
    # Look at last 2 entries; check if last 2 are the same failed command
    last_two=$(tail -2 "$log_file" 2>/dev/null)
    n=$(printf '%s\n' "$last_two" | grep -c -F "\"cmd\":\"$esc_cmd\"" 2>/dev/null | tr -d '\n' || echo 0)
    # Both of last 2 entries must be this command AND both failed
    if [ "$n" = "2" ]; then
        # Confirm both failed (ec != "0")
        zero_count=$(printf '%s\n' "$last_two" | grep -c -F '"ec":"0"' 2>/dev/null | tr -d '\n' || echo 0)
        if [ "$zero_count" = "0" ]; then
            echo "[retry-trap] Command failed twice — invoke failure postmortem before retrying." >&2
            echo "[retry-trap] Last command: $cmd" >&2
        fi
    fi
fi

exit 0
