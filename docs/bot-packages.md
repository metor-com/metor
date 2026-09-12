# Export, import and duplicate bots

Bot packages work through the Space API on both local and remote Spaces.

1. Pause the source bot in its **More actions** menu.
2. Choose **Export Bot…**. **Include bot files** is enabled by default: all transferable
   workspace files, images and directories are included, with no individual file picker.
   Turn it off to export just the bot profile and optional context/routines.
3. Optionally include routines, conversation text and a handoff note. Download the
   `.metor-bot.zip` file.
4. Open the destination Space and choose **Import Bot…** from its menu. Click **Choose file…**, select the ZIP
   and choose an unused bot name. Import never overwrites another bot.
5. Review the bot and routines, sign in to its runtime in the destination Space if
   necessary, then start the bot and enable the routines you want.

**Duplicate Bot…** uses the same options and creates an independent copy in the current
Space. Each copy has a new identity and runtime session. Changes are not merged back
into the original, and migrating does not delete the original.

The standard ZIP contains `manifest.json` (profile, routines and context file references), optional
`conversation.jsonl` and `handoff.md`, and
`files/` (ordinary binary files and directories, including empty directories). Files are
compressed directly, without Base64 in the archive. The bot's role, runtime, model and
initials/colour are included; uploaded avatar images are not included in this version.

Packages exclude internal harness sessions and credentials, browser profiles, hidden
folders, linked files, MCP configuration, dependencies under `node_modules`, Space
settings and device access. The target Space supplies its own sign-ins and connectors.
Known credential filenames/extensions are excluded; arbitrary user-written secrets
cannot be detected. Review workspace contents, role text, prompts and conversations
before sharing: packages are **not encrypted**. Store them securely.

Conversation export uses the same JSON Lines structure as metor's `.metor/chat.jsonl`:
one JSON message per line, with ID, timestamp, sender, text and display metadata. Import
restores these messages to the visible chat and references a workspace copy for the
new runtime's context. Attachment metadata is retained only for included files. Pending
commands, permission requests, tool payloads and runtime internals are not replayed;
imported messages are treated as delivered history. Missing timestamps stay unknown.
The optional handoff is `handoff.md`. Existing conflicting workspace documents receive
no overwrite; the context copy gets a unique suffix. Earlier test archive formats are
not supported. This restores the visible conversation, not an internal harness session.

After saving in the desktop app, the export dialog closes. Cancelling the save picker
keeps it open. In a browser it closes when the download is handed to the browser.

Limits: 1,000 files and 1,000 directories, 25 MiB of file data, 40 MiB compressed archive,
2,000 conversation messages and 2 MiB of conversation text. Oversized/deep workspaces
fail explicitly rather than producing a partial export. Exporting chat logs larger
than 20 MiB requires omitting conversation text. ZIP imports enforce expanded-size
limits, validate paths and reject symbolic links, duplicates and unsupported entries
before any bot is created. File permissions are reset; executables may need `chmod +x`.
Git history, hidden configuration and runtime-managed memory are excluded; keep portable
notes in ordinary workspace files. Review paths in imported instructions after moving.

The file picker can be reopened after cancellation, including for the same file.
While the Space checks a package, **Choose file…** and **Close** remain available.
Checks time out after 30 seconds so a stalled request cannot leave the dialog blocked.
