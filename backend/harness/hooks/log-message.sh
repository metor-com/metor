#!/bin/sh
# PreToolUse hook for SendMessage: every outgoing bot message lands as JSONL in the bus log
# (audit + basis for replay). Stdin: hook JSON from Claude Code. Never blocks (exit 0).
BUS="${METOR_BUS_DIR:-/workspace/bus}"; mkdir -p "$BUS" 2>/dev/null || exit 0
# id: unique per line (nanoseconds + PID) – dedupe anchor for the gateway tail (cursor replay)
jq -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg from "$(basename "$PWD")" --arg id "$(date +%s%N)-$$" \
  '{id:$id, ts:$ts, from:$from, session:.session_id, to:.tool_input.to, text:.tool_input.message, priority:(.tool_input.priority // false)}' \
  >> "$BUS/messages.jsonl" 2>/dev/null
exit 0
