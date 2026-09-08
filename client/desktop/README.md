# metor desktop

The desktop app for macOS, Windows and Linux ([ADR-0015](../../knowledge/decisions/0015-native-clients.md)):
an Electron shell around the unchanged interface from `frontend/`. The app serves the interface
from its own origin (`app://metor`), connects to one or more computers by setup link, pairing link
or pairing code, and keeps each session in the OS keychain. Native parts: tray and menus,
notifications while the app runs, screen capture for the bots, the `metor://` link, the updater.

## Files a bot made

A click on an attachment or on a file in the file browser opens it in the pane next to the chat
(`DocumentPanel.svelte`): the main process adds the token to the frame's request as it does for
the bot's screen and terminal, and *Download* goes through `window.metor.download` to Chromium's
download with Electron's save dialog (a plain download link would navigate instead, the origins
differ). Links to a connected computer open in a plain window of the app (`openLink` in
`main.mjs`), every other link in the system browser – which has no session, so it must never
get a link to the computer. `--open=<bot>?doc=<file>` starts with that document open.

## Several computers

The head of the bot list names the computer shown and its back arrow leads to the overview of all
connected computers (`#/computers`, knowledge/design/several-computers.md): one row per computer
with its unread count, a tap loads that computer's interface; below the rows *Add new computer*
(the connect screen); the ⋮ menu of the overview opens the Settings. Inside a computer the ⋮ menu
renames it (a name kept in the app) or removes it (the app signs out of it). The main process
keeps an event stream to every signed-in computer: the counts stay live, and a computer no window
shows still gets heard – its notifications carry its name, a click brings the bot to the front in
the focused window (or the window that shows that computer). `gateways()` carries each computer's last bot
list (`agents`), which fills the sidebar the moment the interface switches; `use(id)` marks the
window as showing that computer and answers with its state instead of reloading – the interface
carries on (a warm switch).

## Development

```sh
cd client/desktop
npm install
npm start            # builds frontend/ and copies it to ui/, then runs Electron
npm run dev          # Electron only (ui/ must exist)
```

The bots' computer on this machine: the app carries the `metor` host command (copied to `resources/` by
`npm run ui`, the checkout's copy in development; `METOR_CLI` or a Homebrew install override it).
The connect screen offers *Set up the bots' computer on this Mac* – it runs `metor setup` with
the output shown live and connects with the printed link – and *Start* for a stopped one; the menu
*Computers → Bots' computer on this Mac* has the same plus *Stop* and *Start automatically when the app opens*
(on by default: Apple's runtime has no restart policy, so the app brings the computer back).

Useful flags (also for a packaged app): `--connect-screen` (start on the connect screen, like the
menu *Connect a bots' computer…*; with `--open=connect/local` or `connect/remote` on that step;
`--also-connect-screen` with `--open2=…` adds a second such window for tests),
`--local=setup|up|down` (run that host command at start), `--connect=<setup or pairing link>`,
`--user-data-dir=<dir>` (a separate profile), `--open=<bot>` (start with that bot's chat; `--open=computers` with the overview),
`--trace-requests` (log every request to a computer and every notification),
`--snapshot=<file.png>` with `--snapshot-delay=<ms>` (capture the window after loading and quit),
`--window=<W>x<H>` (the window size, for snapshots of small windows).
Together they make a headless check possible: connect, open a bot, capture, compare.

## Packaging

```sh
npm run dist         # every target of the current platform into dist/
```

Signing and notarization need the accounts named in `electron-builder.yml`; without them the
builds are unsigned (fine for local use, not for distribution). Releases are built by the
`desktop` workflow in `.github/workflows/` and published to GitHub Releases, which is also where the
updater looks.
