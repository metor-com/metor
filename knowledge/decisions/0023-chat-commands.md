# ADR-0023: Session-aware slash commands in the chat

Status: accepted, 2026-09-10.

## Decision

The chat offers slash completion from two sources. Runtime commands carry a violet badge
with the runtime's name; interface actions carry a teal `metor` badge. Text labels accompany
colour. Origin is part of the command identity, so equal names remain separate choices.
The first interface actions are `/steps` (toggle step visibility) and `/stop` (interrupt).

Each host publishes a capability snapshot in `harness.json`. Claude uses the SDK's
`supportedCommands()` and `supportedModels()`, plus `commands_changed` updates. Gemini and
Copilot use ACP's `available_commands_update` and the session's `configOptions` or older
`models` field. Codex exposes `/model` using app-server `model/list` and `turn/start.model`.
This is not an import of a terminal's complete command menu: terminal-only commands are
not guessed. Original command names and aliases are retained when advertised.

`/model` (or advertised `/models`) opens a picker containing the running session's choices.
The source remains the runtime even when metor executes the operation through an API.
Commands carry their identity beside the text through the authenticated chat endpoint.
The gateway validates them, and the host revalidates when processing the queue. A removed
command or invalid model fails visibly rather than reaching the model as a prompt.

Model changes and messages share an ordered inbox. Commands wait for a running turn to
finish. Claude calls `setModel`, ACP calls `session/set_config_option` (or the older
`session/set_model`), and Codex supplies the chosen model on subsequent `turn/start` calls.
The session is retained and the selection is saved in `bot.json` without replacing other
fields. Codex acceptance of the actual inference request still occurs on the next turn.
No new auth mechanism or provider token handling is involved.

## Interaction

`/` opens the list; a prefix filters it. Arrow keys highlight, Tab/Enter insert a command
or model, Escape dismisses. Send/Enter then executes the complete command. Unknown or
ambiguous command-shaped input asks for a list selection. Attachments are sent separately.
The picker refreshes while open chats live, discards responses from earlier bots/Spaces,
and exposes its selection to assistive technology. Ordinary messages are unchanged.

## Sources and validation

- Claude Agent SDK 0.3.263 `sdk.d.ts`: `Query.setModel`, `supportedCommands`,
  `supportedModels`, `SDKCommandsChangedMessage`, `SlashCommand.aliases`.
- [Codex app-server](https://learn.chatgpt.com/docs/app-server): `model/list`, `turn/start`.
- [ACP slash commands](https://agentclientprotocol.com/protocol/v1/slash-commands).
- [ACP config options](https://agentclientprotocol.com/protocol/v1/session-config-options).
- `backend/harness/test/commands*.test.mjs`: ordering, persistence, failed switches,
  origin collisions, removed commands, modern and legacy ACP model requests.

Availability and account policy are still decided by each runtime. The create-bot dialog's
fallback model registry is deliberately not used for this session picker.

## Codex reasoning effort (2026-09-10)

After choosing a Codex model, the picker offers only its `supportedReasoningEfforts`
from `model/list`, marking `defaultReasoningEffort`. `/model <id> <effort>` is validated
both when accepted and when dequeued. Model and `reasoningEffort` are saved together in
`bot.json`; subsequent `turn/start` requests carry `effort`, including after restart.
A model-only request uses the new model's advertised default, clearing an old selection
when none is available. Other runtimes retain their existing model picker.
