# 0033 — Portable bot packages

Date: 2026-09-12 · Status: accepted

## Decision

Export/import is scoped to a bot, not an entire Space. Local and remote Spaces use the
same authenticated gateway API. Versioned ZIP packages contain an allowlisted profile,
all transferable workspace files (or none), optional visible conversation text, a handoff note
and routine definitions. Runtime sessions, credentials, browser state, Space access and
MCP configuration are excluded. Imported bots have a new identity, fresh runtime session,
autostart disabled and paused routines with new IDs. Duplication uses the same format.

Exports require a paused bot. Validate package paths, encoding, count and size before
writing; stage imports in a hidden directory and rename into place, without replacing
existing directories. Copying executes no imported code. Import uses target runtime
scaffolding and target Space sign-ins/connectors. This is portable context, not a full
snapshot or a branch with merge semantics. The original is retained.

## Consequences

Python’s standard ZIP implementation reads and writes archives without extracting
entries to disk. A version 4 manifest and ordinary compressed files avoid Base64
overhead on disk and on the wire. Expanded-size and entry-count limits precede reads;
paths are validated before staged import. Large workspaces, hidden files, executable permissions and uploaded
avatars remain outside this implementation. Workspace content can contain secrets; the UI explicitly
states this and the format is not encrypted. Conversation JSONL and handoff notes are separate files at the ZIP root. Visible messages
retain IDs, timestamps, roles, text and safe attachment metadata, and populate the
imported bot's chat history. No inbox, tool actions or pending approvals are imported.
Imported turns are delivered history and do not execute. The runtime reads the same
conversation as context, while starting a fresh harness session. Only version 4 ZIP
packages are supported. The desktop save picker reports completion/cancellation so
export closes only after a successful save; browsers close after dispatching download.

The UI offers one enabled-by-default “Include bot files” toggle, not individual file
selection. Limits cause an explicit failure, never silent omission of oversized files.
