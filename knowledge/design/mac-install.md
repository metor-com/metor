# Design sketch: metor on a local Mac

Status: **draft** (2026-09-03) · spike done, implementation open · related: ADR-0002 (one
computer per user), ADR-0012 (sign-in), BACKLOG "metor on the Mac".

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

## Plan

1. **Multi-arch image** on ghcr (amd64 + arm64; GitHub's arm64 runners or QEMU) – BACKLOG "arm64
   variant". Without it the Mac runs the amd64 image under emulation.
2. **Entrypoint that owns its mount points** (see problem 1) – small Dockerfile change, benefits
   every non-Docker runtime.
3. **Second backend in the wrapper** (`metor`): `container` beside `docker` – run, exec, stop,
   logs, volumes; auto-detected. The gateway proxies noVNC and ttyd itself, so only port 6010
   needs publishing (the 6011–6049 range in the Docker wrapper is legacy and can go).
4. **`metor setup`**: runtime detection and installation hints (brew), start, wait, setup link,
   `open`. On Intel Macs: Colima or Docker Desktop through the same wrapper.
5. **Homebrew tap** `metor-com/homebrew-tap` with the wrapper as a formula; `container` as an
   optional dependency.
6. Later: the Electron desktop app (ADR-0015) with a menu-bar item around the same commands –
   start/stop, open, update, bot status; phone access to the local box via Cloudflare Tunnel or
   Tailscale.
