#!/usr/bin/env bash
# PostToolUse hook: after an agent writes or edits a `{basename}-overview.json`
# sidecar, conform it to the Obsidian plugin's strict schema and pin it, so the
# ```visual-notes``` fence renders the agent's graph. The hook event JSON on
# stdin is passed straight to regenerate.py, which reads tool_input.file_path
# and decides whether the file is in scope.
#
# Off switch: the plugin's `visual_notes_enabled` option (Claude Code passes it
# as CLAUDE_PLUGIN_OPTION_VISUAL_NOTES_ENABLED). Unset means enabled, so manual
# runs and clients without plugin options still work.

set -euo pipefail

if [[ "${CLAUDE_PLUGIN_OPTION_VISUAL_NOTES_ENABLED:-true}" != "true" ]]; then
  exit 0
fi

PYTHON_CMD="${PYTHON:-$(command -v py 2>/dev/null || command -v python3 2>/dev/null || command -v python 2>/dev/null || true)}"
if [[ -z "${PYTHON_CMD}" ]]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"visual-notes conform: no python interpreter found on PATH"}}'
  exit 0
fi

# The script ships next to this hook in the same plugin.
REGEN_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/skills/visual-notes/scripts/regenerate.py"

exec "$PYTHON_CMD" "$REGEN_SCRIPT"
