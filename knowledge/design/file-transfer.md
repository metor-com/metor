# Design sketch: whole directories in and out of a bot's directory

Status: **draft, not decided** (2026-09-08) · becomes an ADR when started · related: ADR-0002 (the
bot id in every path), ADR-0004 (approvals at the boundary), ADR-0012 (device sessions), ADR-0015
(native clients), ADR-0018 (ownership of a bot's files), design/several-computers.md.

## Starting point

A bot's directory `/workspace/bots/<name>/` is where its work lives. Material gets in as a chat
attachment, one file at a time through the gateway, and out the same way or through the file
browser, one file at a time. For gigabytes – a photo archive, a data set, a code base – that is no
way, and the ways that exist today are for operators:

- **Local, Apple `container`:** the workspace is an ext4 disk image mounted as a block device, not
  a folder on the Mac; `container cp <dir> metor-box:/workspace/bots/<bot>/data` copies into it
  (then `chown -R box:box` inside). A folder of the Mac could be bind-mounted, but a mount is fixed
  when the container starts, and it opens a window from the bots' computer onto the Mac.
- **Remote:** SSH to the host, then `rsync` and `docker cp`, or a tar stream through
  `docker exec -i`. Root on the server, a key, a shell – nothing the app or the phone can do.

The user's expectation is simpler: from the bot's chat, choose a folder here and a folder there,
press Download or Upload, watch the progress, cancel if needed – on the Mac against the local
computer and against a server alike, without SSH and without another port.

## Decision of this sketch

Transfers go **through the gateway over the connection every client already has** (HTTPS with the
device session), as whole-directory streams, with a transfer list in the client that shows
progress and lets the user cancel. SSH stays the operator's shortcut and is documented, not built
on. The bot pulling material itself from a link or a bucket stays the third way and is often the
fastest for a server.

## The API (gateway)

- `GET /bots/api/agents/<bot>/files/archive?path=<dir>&format=zip|tar` – the directory as one
  stream. `zip` (stored, no compression – the streaming writer needs no library) for browsers and
  phones, where the system opens it; `tar` for the CLI and the desktop app, which extract it.
  `x-metor-bytes` and `x-metor-files` carry the totals (one walk of the tree before the stream),
  so a client can show progress although the stream has no `content-length`.
- `POST /bots/api/agents/<bot>/files/upload?path=<dir>` – body `application/x-tar`, extracted
  while it streams into `<dir>/.metor-upload-<id>/`, moved into place when the stream ends
  cleanly, deleted when it does not (a cancel, a broken connection). Entries with absolute paths,
  `..`, dot paths at the top (`.metor`, `.browser`, `.desktop`, `.claude`) or symbolic links are
  refused; the existing file rules of the gateway apply (dot paths are never served or written).
  The response reports files and bytes written; `?replace=1` empties the target first, without it
  files are added and same-named ones overwritten.
- Both behind the sign-in, both per bot – the bot id is part of the path (ADR-0002). Ownership:
  today the gateway runs as `box` and writes as `box`; under ADR-0018 the gateway becomes `metor`
  and a bot's files stay `box`, so the extraction must then run through the bot's host process or
  a group-writable bot directory. To settle when ADR-0018 is built.
- **Later, resume:** `POST …/files/manifest?path=` with the client's list of `{ path, size,
  mtime }`; the gateway answers which entries are missing or differ, the client sends only those
  as a tar. Hashes optional (`sha256`, expensive on gigabytes at the client). This makes a
  transfer over a shaky Wi-Fi restartable and a second run cheap – rsync's idea, HTTP's transport.

## The clients

- **Where it starts:** the ⋮ menu of a bot's chat gets *Download files…* and *Upload files…*; the
  file browser gets a download button per folder and a drop zone. The CLI gets `metor bot pull
  <bot> <path> [<dir>]` and `metor bot push <bot> <dir> [<path>]` – on the Mac against the local
  computer, and with `--computer <name>` against any computer the desktop app knows (the wrapper
  reads the app's store for address and session).
- **Desktop app:** the dialog picks the bot's folder (a tree from the files API) and a folder on
  this machine (the native picker through the preload, `chooseFolder`). The transfer runs in the
  main process: it streams tar with the token, extracts or packs with Node's `zlib`/tar code (no
  dependency; the wrapper's own tar for `push`), survives navigation inside the app and warns on
  quit while transfers run. Progress and cancel go through the preload (`transfers`,
  `onTransfer`, `cancelTransfer`).
- **Browser and PWA:** download = the zip to the browser's download folder (no local choice);
  upload = the folder picker (`webkitdirectory`) or files, packed to tar in the page and streamed
  with `fetch`; the tab has to stay open. Progress from the bytes sent; cancel by
  `AbortController`.
- **Phone app:** download = the zip through the app (as files today: fetched with the token, then
  Files or the share sheet); upload = files from the picker, packed in the page; folders later, if
  iOS's document picker in folder mode proves usable. Gigabytes over the phone stay unrealistic;
  the phone's job is the small case and watching a transfer that runs elsewhere – which it cannot,
  transfers are per client (see open questions).
- **The transfer list:** a strip at the bottom of the bot list, above the quota bar, one row per
  running transfer – bot, direction, path, files and bytes done of the total, a cancel ×. A row
  disappears a few seconds after it finishes; a failed one stays until dismissed and says why. The
  file browser of that bot refreshes when a transfer ends.

## What the user does

1. In the chat of the bot: ⋮ → *Upload files…*, pick `Documents/Archive` on the Mac and `data/` at
   the bot, *Upload*. The strip shows "Archive → gtest/data · 1.2 of 3.4 GB", the × cancels.
2. Later, ⋮ → *Download files…*, pick `out/` at the bot and a folder on the Mac, *Download*.
3. On a server the same; on the phone the download lands in Files, the upload takes files.

## Order of work

1. Download a folder as zip: the gateway's archive route, the button in the file browser, `metor
   bot pull` (tar).
2. Upload as tar: the gateway's upload route, `metor bot push`, the desktop dialog with the folder
   picker, the transfer strip with progress and cancel, the browser's folder picker.
3. Resume by manifest.
4. Phone: download to Files, upload of files; folders if the picker allows.

## Open questions

- Transfers are per client. A transfer started on the Mac is not visible on the phone; a
  server-side job list would make it so, at the cost of the gateway holding the local end – not
  for the first version.
- Limits: none planned beyond disk space; the gateway should refuse an upload that would not fit
  and say so.
- Zip's 4 GB limit for single entries (zip64 needed beyond) – the stored-zip writer must write
  zip64 or refuse; tar has no such limit.
