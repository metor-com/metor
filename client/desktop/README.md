# metor desktop

The desktop app for macOS, Windows and Linux ([ADR-0015](../../knowledge/decisions/0015-native-clients.md)):
an Electron shell around the unchanged interface from `frontend/`. The app serves the interface
from its own origin (`app://metor`), connects to one or more computers by setup link, pairing link
or pairing code, and keeps each session in the OS keychain. Native parts: tray and menus,
notifications while the app runs, screen capture for the bots, the `metor://` link, the updater.

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
`--user-data-dir=<dir>` (a separate profile), `--open=<bot>` (start with that bot's chat),
`--trace-requests` (log every request to a computer and every notification),
`--snapshot=<file.png>` with `--snapshot-delay=<ms>` (capture the window after loading and quit).
Together they make a headless check possible: connect, open a bot, capture, compare.

## Packaging

```sh
npm run dist         # every target of the current platform into dist/
```

Signing and notarization need the accounts named in `electron-builder.yml`; without them the
builds are unsigned (fine for local use, not for distribution). Releases are built by the
`desktop` workflow in `.github/workflows/` and published to GitHub Releases, which is also where the
updater looks.
