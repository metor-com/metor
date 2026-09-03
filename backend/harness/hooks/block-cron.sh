#!/bin/sh
# PreToolUse hook on CronCreate: in-session crons are bound to the session, run for at most 7 days and
# are Claude-specific – in metor, routines run via the MCP tool (restart-safe, permanent,
# harness-neutral, visible in the dock). The deny reason explains the right way to the model.
cat > /dev/null
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Please create routines with the tool mcp__routines__add_task (name, cron with 5 fields in box local time, prompt). Overview: mcp__routines__list_tasks, delete: mcp__routines__remove_task. CronCreate is disabled in metor because such crons expire after 7 days and are not visible in the UI."}}'
exit 0
