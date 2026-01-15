#!/bin/bash
# Log file edits to docs/edit-history
# Called by Claude Code PostToolUse hook

set -e

# Get the date for the log file
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M:%S)
LOG_DIR="$(dirname "$0")/../docs/edit-history"
LOG_FILE="$LOG_DIR/$DATE-session.md"

# Get file path from environment (set by Claude Code hook)
FILE_PATH="${CLAUDE_FILE_PATHS:-$1}"
TOOL_NAME="${CLAUDE_TOOL_NAME:-Edit}"

# Skip if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# If log file doesn't exist, create with header
if [ ! -f "$LOG_FILE" ]; then
  cat > "$LOG_FILE" << EOF
# Edit History - $(date +"%B %d, %Y")

## Session Summary

_Session in progress..._

---

## Changes Log

| Time | Action | File |
|------|--------|------|
EOF
fi

# Append the edit entry
echo "| $TIME | $TOOL_NAME | \`$FILE_PATH\` |" >> "$LOG_FILE"
