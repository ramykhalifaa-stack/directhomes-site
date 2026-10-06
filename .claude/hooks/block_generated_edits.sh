#!/usr/bin/env bash
# PreToolUse hook: refuse edits to generated build output in docs/.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0   # fail open if jq is missing

path=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$path" ] || exit 0

# Normalize ../ segments so traversal can't dodge the match.
norm=$(realpath -m -- "$path" 2>/dev/null) || norm="$path"

case "$norm" in
  */docs/assets/*|*/docs/app/_expo/*)
    echo "Blocked: $norm is generated build output. Change the private source repo and republish instead." >&2
    exit 2
    ;;
esac
exit 0
