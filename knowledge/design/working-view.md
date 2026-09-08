# Design sketch: what the chat shows while a bot works

Status: **draft, not decided** (2026-09-08) · becomes an ADR when started · related: ADR-0008
(the interface), ADR-0011 (runtimes), ADR-0015 (native clients), GLOSSARY ("Bot", "Runtime").

## Starting point

A question to a bot that has to look things up produces a dozen steps before the reply, and the
chat shows every one of them as a line: the tool's name and its raw input – `ToolSearch
{"query":"select:WebSearch"}`, `WebSearch {"query":"…"}`, `WebFetch {"url":"…","prompt":"…"}`.
Three things are wrong with that for someone who delegated a task and wants the result:

- The steps drown the conversation. A reply of three lines sits under twelve lines of machinery.
- The lines are in English and in the runtime's vocabulary (`ToolSearch`, `WebFetch`, JSON),
  whatever language the user writes in.
- There is no sign of life in between: the three dots appear only once the reply's text streams;
  during the minutes of work the last step is all that moves.

What Claude Code itself shows in the user's language is what the *model* writes – its texts
between the steps and the one-line descriptions of commands – because its language setting is a
sentence in the system prompt. The fixed lines of the harness stay English there too. The
model's thinking is not shown in metor at all (`metor-host-claude.mjs`: "thinking etc. stay
invisible"); what the user sees are the tool entries, and those are kept in the history
(`chat.jsonl`, `kind: "tool"` with `tool.name`, `tool.detail`, and the result as a patch).

## Shape

**Compact is the view, not a mode.** Nothing to switch on. Every step is still recorded exactly
as today; the interface only hides it, so every old chat gets the same treatment.

1. **While the bot works:** a bubble with the three dots (`Typing.svelte`, the same as in the
   bot list) and under it one line naming the current step in the device's language – *Searching
   the web for "current ISS crew…"*, *Reading example.org*, *Running `ls -la`*. The line changes
   with each step; it is the sign of life. When the reply's text starts streaming, the bubble
   becomes the reply as today.
2. **When the reply is there:** the steps that led to it fold into one gray line where the
   cards were – *14 steps* – and a tap unfolds them into today's cards (name, input, result).
   Folding is a rendering rule over the entries, so it applies to every chat, also to the ones
   written before this change.
3. **Groups:** consecutive tool entries between two visible entries form one group; visible are
   the user's messages, the bot's texts, approvals and errors. Approvals and errors are never
   hidden and split a group – the user must see what the bot asked and what went wrong.
4. **The detailed view on demand:** the chat's ⋮ menu (next to *Pause* and *Remove*) gets
   *Show steps* / *Hide steps*. It unfolds every group in every chat and is remembered per
   device (the settings store in `localStorage`, next to the sort order), but it is a menu entry
   in context, not a card in the Settings dialog. Unfolding one group with a tap is independent
   of it.

### The line in the user's language

The interface cannot translate a tool name, but it can say what a step *does*. Each host
describes a step with a small structured summary next to the raw detail:

```
tool: { name: "WebSearch", detail: "…", step: { kind: "web-search", subject: "current ISS crew" } }
```

`kind` comes from a short list that is the same for every runtime – `command`, `read-file`,
`edit-file`, `search-files`, `web-search`, `read-page`, `delegate`, `connector`, `other` –
and `subject` is the one thing worth naming: the command, the file's name, the query, the
page's host, the sub-task's description, the connector and tool. The interface holds a
dictionary per language and renders *verb + subject*:

| kind | English | German |
|---|---|---|
| command | Running `…` | Führt `…` aus |
| read-file | Reading *name* | Liest *name* |
| edit-file | Editing *name* | Ändert *name* |
| search-files | Searching files for "…" | Sucht in Dateien nach „…" |
| web-search | Searching the web for "…" | Sucht im Web nach „…" |
| read-page | Reading *host* | Liest *host* |
| delegate | Delegating: … | Delegiert: … |
| connector | *server*: *tool* | *server*: *tool* |
| other | *name* | *name* |

The subject stays in the language it is in – a bot searching English sources searches in
English, and the command is the command. Entries without `step` (older history, unknown tools)
fall back to today's line, name and detail. The device's language comes from the browser or the
app (`navigator.language`); German and English to begin with, everything else English.

This is the first translated text in the interface, on purpose limited to these lines and the
few status words around them (*typing…*, *14 steps*). Translating the whole interface is a
separate item for the backlog; it should not hold this up.

### The model's own words

One sentence in `CHAT_HOWTO` (`metor-host-core.mjs`), which every runtime gets appended to its
system prompt:

> Write everything the user reads in the language the user writes in – your replies, your
> texts between steps, and the one-line descriptions of commands.

With it the texts between steps and Claude Code's command descriptions arrive in the user's
language, the way Claude Code's own language setting works. An explicit language choice on the
computer is not planned; only if a user writes to bots in one language and wants the interface's
lines in another would it be needed, and that can wait for a request.

### Thinking

Stays out of the history: it is large, worthless once the reply is there, and the runtimes give
it as a stream, not as a record. With *Show steps* on, the working bubble shows it live as gray
text under the current step, capped to the last lines; with steps hidden, the bubble shows only
the dots and the step. Per runtime: Claude Code streams `thinking_delta` events (needs the
model's extended thinking on), Codex sends reasoning items, Gemini CLI and Copilot deliver
thought chunks through their protocol – each host forwards them into the partial stream under a
separate key, to be verified per host when it is built.

## Order of work

1. Grouping, folding, the live line and *Show steps* in the interface – works with today's
   entries (name and detail), no host change.
2. `step` in the four hosts (`metor-host-claude.mjs`, `-codex`, `-gemini`, `-copilot`) and the
   dictionary in the interface.
3. The sentence in `CHAT_HOWTO`.
4. Thinking in the working bubble.

## Open questions

- Does the folded line name the kinds (*14 steps · web, files, 3 commands*) or only the count?
  Start with the count; the kinds are one dictionary lookup away if the count proves too mute.
- The live line after the last step: keep it until the reply streams, or let the dots stand
  alone? Keep it – the last step is still what the bot is doing.
- Routine runs produce steps without a user message in front of them; the group then ends at
  the run's reply. The same rule, one boundary less.
- A duration on the folded line (*14 steps · 2 min*) is cheap from the timestamps; decide when
  it is in front of us.
