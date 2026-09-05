# Design sketch: metor on a local Mac

Status: **implemented 2026-09-05** (wrapper backend, `metor setup`, multi-arch image workflow,
formula template, app menu) · related: ADR-0002 (one computer per user), ADR-0012 (sign-in),
ADR-0015 (desktop app), BACKLOG "metor on the Mac".

## Goal

Two commands, no server, no Docker Desktop:

```sh
brew install metor-com/tap/metor
metor setup
```

`metor setup` detects a container runtime (Apple `container` on Apple silicon with macOS 26,
otherwise OrbStack, Docker Desktop or Colima), starts the box from the ghcr image, waits for the
gateway, mints the setup link and opens it in the browser. Sign-in to a runtime then happens in
the interface as everywhere else.

## Spike 2026-09-03: the box under Apple `container` 1.3.1 (macOS 26.6, Apple silicon)

Verified with the locally built arm64 image:

| Check | Result |
|---|---|
| `container image load` of a `docker save` tarball | works (1.0 GB tar, 3.6 GB image) |
| `container run -d --memory 4g --cpus 4 --shm-size 1g -v <volume>:/…` | works; `--ulimit` and `--shm-size` exist, the Docker-era workarounds (nofile limit) are not needed – the guest showed nofile 1048576 and a 1 GiB /dev/shm by default |
| Gateway, sign-in (setup link, session cookie), API | works on the container IP (`container ls` shows it, 192.168.64.x) |
| `metor bot create` → desktop chain (Xvfb, openbox, tint2, Chromium with CDP, x11vnc, websockify, ttyd, xterm) + host process | works; the whole start took 2 s instead of the ~30 s seen under Colima |
| Screen and terminal through the gateway (noVNC, ttyd) in the browser | works |
| Memory with one bot | 1.5 GiB of the 4 GiB machine |

Two problems, both outside metor's code:

1. **Named volumes are mounted root-owned.** Docker copies the ownership of the image directory
   into a fresh volume; Apple's runtime does not, so the box (user `box`) failed with `EACCES` on
   `mkdir /workspace/bots`. Workaround in the spike: a one-off `container run --user 0:0
   --entrypoint sh … chown -R box:box /workspace /home/box/.claude /home/box/.codex`. Proper fix
   (image, works for every runtime incl. Kubernetes): start as root, an entrypoint step takes
   ownership of the three mount points, then drops to `box` (`setpriv` from util-linux is in the
   image already) before `tini -- metor supervise`.
   Pitfall met on the way: the image's entrypoint is `tini -- metor supervise`, so a one-off
   command must pass `--entrypoint`; otherwise the supervisor runs (as root) and never exits.
2. **Publishing a port to localhost does not forward.** `-p 127.0.0.1:6060:6010` binds the port on
   the host, but connections are reset; the runtime helper logs `connect failed … No route to
   host (errno 65)`. Reproduced with a plain `python -m http.server` container, with and without a
   host IP, same or different port numbers – so it is the runtime, not metor. Matches the open
   upstream report apple/container#919 (macOS 26.x: container IP reachable, localhost forward
   dead). The macOS application firewall was off. Most likely the runtime helper (a launchd agent)
   lacks the *Local Network* privacy permission – to be checked in System Settings → Privacy &
   Security → Local Network. Until resolved, the wrapper can use the container IP (`container
   inspect`) for the setup link and the browser; the session cookie is then bound to that IP.

## Verified 2026-09-05 (container 1.3.1, macOS 26.6.2, Apple silicon)

- **Publishing a port to localhost works** (`-p 127.0.0.1:6110:6010` answered at once, also with a
  throwaway `python -m http.server` container) – problem 2 above did not reproduce; the setup
  therefore uses `127.0.0.1:<port>` like Docker, the container IP is not needed.
- **Fresh named volumes are still root-owned** (uid 1000 gets `EACCES`); a root one-off
  `chown 1000:1000` of the three mount points before the first start fixes it. Done by the
  wrapper for this runtime instead of an image entrypoint: an image that starts as root would make
  `docker exec` root as well and break `claude auth login`, `bash` and the CLI for everyone.
- `container run` has no `--hostname` (the hostname is the container name) and no restart policy;
  after a reboot the computer is started by `metor box up` or the app. Named volumes must be
  created with `container volume create`; `container exec` runs as the image's user (`box`).
- `container build` builds the image natively from the repository's Dockerfile (about 12 minutes
  the first time). Timing on an M-series Mac: `metor setup` 2.7 s from a present image to a
  working interface, a bot with a complete desktop 2.2 s, `box down` + `box up` 3 s.
- On a Mac that also runs the Docker box, ports 6011–6049 are taken by that box's legacy noVNC
  publishing; a second computer needs `METOR_PORT` outside that range. Browsers share cookies
  across ports of `127.0.0.1`, so two local computers in one browser sign each other out – the
  desktop app (bearer tokens) does not have that problem.

## Done (2026-09-05)

1. **Multi-arch image**: `.github/workflows/box-image.yml` builds amd64 and arm64 natively
   (`ubuntu-24.04-arm`, free for the public repository) and joins them under one tag.
2. **Ownership of the mount points**: the wrapper's `container` backend (see above).
3. **Second backend in the wrapper**: `docker` and `container` behind the same commands; the
   runtime is detected (`METOR_RUNTIME`, the remembered one, the one holding the computer, Docker
   where installed, else Apple's) and remembered in `~/.config/metor/runtime`. Docker first because
   a stopped Docker cannot say whether it holds the computer - on a Mac with both, choosing Apple's
   silently would create a second, empty computer. A stopped Colima or Docker Desktop is started by
   the wrapper (`need_runtime`), so the app's Start works after a reboot on Docker too. Only port 6010 is
   published for `container`; the Docker command keeps its legacy range for now.
4. **`metor setup [--no-open]`**: hints when no runtime exists, start of Apple's service, image
   (a local `metor-box:dev`, else the published one), start, wait for the interface, setup link,
   `open`.
5. **Homebrew formula**: `deploy/homebrew/metor.rb` (source of truth; the tap repository
   `metor-com/homebrew-tap` still has to be created and gets a copy with the release's sha256).
6. **Desktop app**: the host command travels with the app (`resources/metor`, copied by the build;
   the checkout's copy in development, `METOR_CLI` or a Homebrew install override). The connect
   screen has a card *The bots' computer on this Mac*: runtime found or not (with install links), the
   state, and one button whose job follows the state – *Set up* (runs `metor setup` with the output
   shown live and connects with the printed link), *Start*, or *Open*. The menu *Computer → Local
   computer* offers the same plus *Stop* and *Start automatically when the app opens* (on by
   default: the app starts a stopped local computer at launch, the interface reconnects on its own).

Open: phone access to the local computer (Cloudflare Tunnel or Tailscale), an update command
(`metor box update`: pull + restart), the legacy port range in the Docker command.
