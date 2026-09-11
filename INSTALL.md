# Installing metor

Four ways, from the most convenient to the most manual. The prebuilt box image comes from the GitHub
Container Registry: **`ghcr.io/metor-com/metor-box`** (tags `latest` = main, `0.4.0` etc. for
releases, plus a short commit sha), built by `.github/workflows/box-image.yml` for `linux/amd64`
and `linux/arm64`.

## Security first

Whoever gets into the interface can read every chat, drive every bot and open every bot's terminal.
The gateway inside the box (port 6010) therefore signs devices in itself
([ADR-0012](knowledge/decisions/0012-device-pairing.md)): no passwords - the first browser gets in
with a one-time **setup link**, every further phone or browser is linked by QR code or pairing code
from a device that is already signed in, and every device can be removed again. Still:

- `deploy/compose.yml` and the `metor` wrapper bind the port to `127.0.0.1` on purpose. Publish the
  interface only through a reverse proxy with TLS (the bundled Caddy profile, your own Caddy or
  nginx) - the session cookie is marked `Secure` behind HTTPS.
- The chat's live updates use server-sent events: the proxy must not buffer them (`flush_interval -1`
  in Caddy, `proxy_buffering off` in nginx). WebSockets (screen, terminal) need no special treatment
  any more - the session cookie travels with the handshake.
- A second login layer in front (Basic Auth, SSO) is optional. If you add one, remember that
  browsers do not send Basic Auth on WebSocket handshakes, and set `METOR_AUTH=off` only if that
  layer covers *everything* under `/bots`.
- A device's session ends after a year, and removing a device closes its open screens, terminals
  and live updates at once. Writes with the session cookie must come from the interface's own
  origin: the gateway compares the browser's `Origin` with the `Host` it sees (or with
  `METOR_WATCH_BASE`) - a proxy of your own must pass the `Host` header through (Caddy does, nginx
  needs `proxy_set_header Host $host`).
- Files a bot writes are served behind the sign-in, and pages or SVGs among them run sandboxed:
  their scripts cannot reach the session or the API.
- What the sign-in does not do: separate the bots from the management. Everything inside the box
  runs as one user today, so a bot under prompt injection can reach the sign-in's files; do not
  give bots accounts you would not give the whole computer
  ([ADR-0018](knowledge/decisions/0018-management-plane.md) is the planned separation).

## Desktop app: set up an existing VPS

Choose **Connect a Space → On a server → Set up an existing server**. Enter the server
IP/hostname and SSH port, compare the displayed ED25519 fingerprint with the provider
console, then enter a domain pointing to the server and choose **Password** or **SSH key** for root login. The app checks
the server before offering **Install and connect**. It keeps the SSH connection for ten
minutes while you review; passwords and key passphrases are never saved. If the provider requires changing
the initial password, do that in its console first.

Use a fresh Ubuntu 22.04/24.04/26.04 or Debian 12/13 server, x86-64 or ARM64, with at least
2 vCPUs, 4 GB RAM and 12 GiB free disk (16 GB RAM / 40 GB disk recommended). Allow inbound
SSH plus TCP 80 and 443. Both A and AAAA DNS records, when present, must point to this
server. The chosen SSH login method must be enabled. For **SSH key**, choose your local private
key file (not its `.pub` file), then enter its passphrase if encrypted. The matching
public key must already be installed for root; the private key stays on your device. The app installs Docker, the matching metor
release and Caddy, then pairs itself once HTTPS is reachable. Keep it open during setup.

Existing installations and other Docker workloads are rejected. Failed app installations
can be retried with the same domain; volumes and the Space RAM allocation are retained.
Nothing is automatically uninstalled on failure. Non-root users and custom
reverse proxies are not supported by this app flow. The first Hetzner installation and subsequent use were confirmed by the user on
2026-09-11. Automated local tests now cover actual installer process termination at four stages,
using a Docker test double, plus real SSH connections for passwords, private keys and
connection loss. Full recovery with real Docker and other providers still needs live
validation.

The app records installation phases on the server and replaces configuration files
atomically. Retries preserve extra `.env` settings and persistent data. When setup
reached the ready stage, **Reconnect existing Space** pairs the app without downloading
an image or restarting the Space. A stopped or unhealthy completed Space needs its
container problem resolved before reconnecting.

DNS is checked before installation, including stale AAAA records. The domain must point
directly to addresses on the server; proxied DNS/NAT configurations need manual setup.
HTTPS failures distinguish DNS, port 443 reachability, certificate verification and
incorrect proxy responses. The app never disables TLS verification or changes firewall
rules automatically. Port checks show reachability; they cannot identify which firewall
or network component is responsible.

On a server originally created with an SSH key, resetting the root password may enable
only provider-console login. SSH root password login must be enabled separately before
choosing **Password** in this app flow. **SSH key** works without enabling password login. The app does not change the server’s SSH authentication policy.

## A) New server - one-liner (recommended)

```sh
curl -fsSL https://www.metor.com/install.sh | sudo bash
```

That address redirects to the installer of the newest release (the `install.sh` asset of the
[latest GitHub release](https://github.com/metor-com/metor/releases/latest)). The development
version, straight from the repository:

```sh
curl -fsSL https://raw.githubusercontent.com/metor-com/metor/main/deploy/install.sh | sudo bash
```

The installer asks for a domain (nothing else) and proposes `<public-ip>.sslip.io` as the default,
a name that resolves to the server without owning a domain (see "Without your own domain" below);
Enter takes it, `local` means this machine only without TLS. It installs Docker if it is missing,
pulls the image, writes `/opt/metor/{compose.yml, Caddyfile, .env}` (the compose file comes out of
the image, so it always matches the version that runs), starts box + Caddy (TLS via
Let's Encrypt as soon as the name resolves to the server) and prints the **setup link** for your
first device, as text and as a QR code. If something already listens on port 80 or 443, the
installer leaves its own Caddy off, names the process, and prints the block to add to that proxy
(or free the ports and run the installer again - it is idempotent). Open the link, then in the
interface click **New bot**, pick the runtime and sign in
to it - Claude Code: open the link, sign in, paste the code the page shows at the end; Codex: device
code. Further devices: **Settings → Devices → Link a device**. A new setup link at any time:

```sh
cd /opt/metor && docker compose exec box metor auth link
```

### Unattended (one `ssh` line)

Every question can be answered up front through environment variables; the script asks only for
what is missing and stops with a hint when it has no terminal for a question. Nothing in the
installation needs a person at the keyboard:

```sh
ssh root@<server> 'METOR_DOMAIN=bots.example.com bash -c "curl -fsSL https://www.metor.com/install.sh | bash"'
```

| Variable | Meaning |
|---|---|
| `METOR_DOMAIN` | Domain for the interface; unset = `<public-ip>.sslip.io`; `local` (or empty) = this machine only, without Caddy |
| `METOR_INSTALL_DOCKER` | `no` = stop instead of installing Docker (with the compose plugin) via get.docker.com when it is missing |
| `METOR_GHCR_USER`, `METOR_GHCR_TOKEN` | GitHub user + token with `read:packages`, only for a private image (a mirror via `METOR_IMAGE`); the official package is public |
| `METOR_DIR`, `METOR_IMAGE` | Install directory (default `/opt/metor`) and image (default `ghcr.io/metor-com/metor-box:latest`) |

The script ends by printing the setup link; the two manual steps that remain are opening that link
on your first device and signing in to a runtime in the interface.

### Without your own domain

HTTPS needs a host name that resolves to your server: the session cookie is the key to everything
and must never travel over plain HTTP on a public address. You do not have to buy a domain for
that; in order of preference:

- **The name your provider gave the server.** Many providers assign every server a public name
  that resolves in both directions (Netcup `v22….happysrv.de`, Hetzner Cloud
  `static.….clients.your-server.de`, Linode `li….members.linode.com`). Use it as `METOR_DOMAIN`;
  Caddy obtains the certificate like for any other domain. Not usable: AWS EC2 names (Let's Encrypt
  refuses `amazonaws.com`), Google Cloud and DigitalOcean (no public default name).
- **sslip.io / nip.io.** Public DNS services that answer `<ip-with-dashes>.sslip.io` (or
  `.nip.io`) with the address embedded in the name - `203-0-113-10.sslip.io` resolves to
  203.0.113.10, nothing to register. Works with Let's Encrypt out of the box. Caveat: the weekly
  certificate limit of Let's Encrypt (50 new certificates per registered domain) is shared by
  everybody using that service. Renewals are exempt, and Caddy falls back to ZeroSSL by itself when
  Let's Encrypt refuses, so in practice a new server occasionally needs a few minutes longer - if
  the Caddy log keeps saying "rate limited", switch the name to the other service.
- **No domain at all** (leave `METOR_DOMAIN` empty): the box listens on `127.0.0.1:6010` only and
  you reach it through an SSH tunnel - `ssh -L 6010:127.0.0.1:6010 root@<server>`, then
  `http://127.0.0.1:6010/bots/`. Safe, but every device needs the tunnel, which is awkward on a
  phone.
- **A VPN** (Tailscale, WireGuard): publish the port on the VPN interface instead of the loopback
  and put your own TLS in front; Tailscale's `tailscale cert` hands you a `ts.net` name with a
  certificate.

Whatever name you choose, the sessions are bound to it: a different name (or a new IP with
sslip.io) means every device signs in again with a fresh setup link.

## B) New server - compose by hand

Copy `deploy/compose.yml`, `deploy/Caddyfile.template` and `deploy/.env.example` to the server,
fill in `.env`, replace `@DOMAIN@/@USER@/@HASH@` in the template (hash:
`docker run --rm caddy:2 caddy hash-password`) and save it as `Caddyfile`, then:

```sh
docker compose --profile caddy up -d
```

Then sign in from the interface ("New bot") or with `docker compose exec box claude auth login`.

## C) Shared server (your own reverse proxy already runs)

Like B, but **without** the caddy profile: `docker compose up -d` - the box then listens only on
`127.0.0.1:6010` (the installer does this by itself when it finds port 80 or 443 taken). Forward
`/bots*` from your existing proxy; the sign-in is done by the gateway, the proxy only needs TLS,
WebSockets and unbuffered responses. Caddy (the block `metor box serve` prints):

```
handle /bots* {
	reverse_proxy 127.0.0.1:6010 {
		flush_interval -1
	}
}
```

nginx (inside the `server` block of your HTTPS site; `certbot --nginx` or your usual way for TLS):

```
location /bots {
	proxy_pass http://127.0.0.1:6010;
	proxy_http_version 1.1;
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-Proto $scheme;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_buffering off;
	proxy_read_timeout 1h;
}
```

Then `docker compose exec box metor auth link` for the first device.

## D) Your own Mac (no server)

On an Apple silicon Mac with macOS 26 the bots' computer runs under Apple's own `container`
runtime, no Docker needed; on other Macs Colima or Docker Desktop do the same job through the
same command.

```sh
brew install container            # Apple silicon, macOS 26 – otherwise: brew install colima docker && colima start --cpu 4 --memory 8
brew install metor-com/tap/metor  # the host command (until the tap exists: clone the repository, see the README)
metor setup                       # picks the runtime, gets the image, starts the bots' computer, opens the setup link
```

`metor setup` prints the setup link (24 h, single use) and opens it in the browser; paste it into
the desktop app instead if you use that. After a reboot, `metor box up` (or the app's menu
*Bots' computer on this Mac → Start*) starts it again; `metor box down` stops it. The interface
listens on `http://127.0.0.1:6010/bots/` (`METOR_PORT` for another port), the three volumes are
the same as on a server. Where both Docker and Apple's runtime are installed, Docker stays the
default; `METOR_RUNTIME=container metor setup` chooses Apple's once, after that the choice is
remembered in `~/.config/metor/runtime`. A stopped Docker (Colima or Docker Desktop) is started
by the command itself.

## E) Development (local, any Docker or Apple `container`)

See the [README](README.md): clone the repository, `export PATH="$PWD/backend/harness/bin:$PATH"`,
`metor box build && metor box up`, then sign in from the interface at http://127.0.0.1:6010/bots/
(or `docker exec -it metor-box claude auth login`). The image is built locally for the machine's
architecture; the ghcr image carries amd64 and arm64. `metor version` prints the version of the
checkout (`docker compose exec box metor version` prints the version inside the box).

## Runtimes

Every bot runs on one runtime; each runtime is signed in once per box and the login persists in its
volume.

- **Claude Code** - sign in from the interface: "new bot" -> runtime Claude Code -> Sign in. The
  wizard runs the official login: open the link, sign in with your Claude subscription, paste the
  code the page shows at the end. Terminal alternative: `docker compose exec box claude auth login`
  (compose) or `docker exec -it metor-box claude auth login` (development).
- **Gemini CLI** - sign in from the interface: "new bot" -> runtime Gemini CLI -> Sign in. The
  wizard asks for a Gemini API key from Google AI Studio (free tier, about 1,000 requests a day,
  no subscription), checks it with one request and keeps it inside the box
  (`/home/box/.gemini/.env`, volume `metor-gemini`). Google closed the CLI's own Google-account
  login in September 2026, so the key is the way in.
- **Codex** - sign in from the interface: "new bot" -> runtime Codex -> Sign in. The wizard shows
  the official device-code login (link + one-time code, confirmation in the browser or on the
  phone). Beforehand, enable **device code authorization** once in the ChatGPT security settings;
  without it the login fails with a red notice - enable it, then start the wizard again (the old
  code is void). Uses your ChatGPT subscription.
- **GitHub Copilot** - sign in from the interface: "new bot" -> runtime GitHub Copilot -> Sign in.
  The wizard shows GitHub's device-code login (link + one-time code); any Copilot plan works, Free
  included. The token stays inside the box (`/home/box/.copilot`, volume `metor-copilot`). If a
  Copilot bot answers "Access denied by policy settings", enable Copilot CLI and MCP servers in
  your Copilot settings - for members of an organisation its admin does that.

A runtime whose login expires stops only its own bots; the others keep running. Sign in again and
start the bots.

## Operations

- **Update:** for an app-installed VPS, use **Manage Space → Resources & updates → Manage server**
  in the desktop app. It updates both the image and its Compose definition, including new
  persistent volumes. A manually managed server must likewise update its image reference and
  review the matching `deploy/compose.yml` before recreating the box; simply pulling a pinned
  old tag does not upgrade it. Back up volumes and retain custom Compose changes. Bots,
  histories and routines survive; sessions resume with their context. On a Mac it is
  `metor box update`. The interface shows the newest release under *Manage Space → Resources & updates* (the box
  asks GitHub once a day; `METOR_UPDATE_CHECK=off` stops that), together with the runtimes'
  versions - the runtimes travel with the image, so updating metor is what brings new runtime
  versions and models.
- **Backup:** back up the volumes - `metor-workspace` (bots, histories, routines, files),
  `metor-claude` (Claude login **and sessions**; without this volume the conversation contexts are
  gone), `metor-codex` (Codex login and sessions), `metor-gemini` (Gemini login and sessions) and
  `metor-copilot` (Copilot login and sessions).
- **Bots via CLI:** `docker compose exec box metor bot list|create|start|stop|rm ...`
- **Version:** `docker compose exec box metor version`.
- **Devices and lost access:** `docker compose exec box metor auth sessions` lists the signed-in
  browsers, `… metor auth revoke <id>` signs one out, `… metor auth link` prints a new setup link
  (24 h, single use) - the way back in when no device is left.
- **Time zone:** the box runs on Europe/Berlin (routine times are box local time).

## Options (.env, see `deploy/.env.example`)

- `METOR_IMAGE` - a different box image (for example a version tag instead of `latest`).
- `METOR_WATCH_BASE` - public base URL of the interface; ends up in the watch links that bots send
  and in the pairing links (`metor auth link`).
- `METOR_UPDATE_CHECK` - `off` keeps the box from asking GitHub for the newest release.
- `METOR_BIND` - the address the wrapper publishes the interface on, default `127.0.0.1` (this
  machine only). `0.0.0.0` makes a computer on a Mac reachable in the same Wi-Fi, for the phone
  app: `METOR_BIND=0.0.0.0 METOR_WATCH_BASE=http://<the Mac's address>:6010 metor box up`. Sign-in
  by pairing still guards it; the desktops' own ports stay local.
- `METOR_DOMAIN` - only with the caddy profile: domain for TLS.
- `METOR_AUTH` - `off` switches the gateway's own sign-in off; only behind your own login layer or
  for local experiments (see "Security first").
- `METOR_PUSH_SUBJECT` - contact for the push services (a URL or a `mailto:` address) that goes
  with the box's own push notifications (Settings → Devices → Notifications on this device); default: the
  project URL. Push needs HTTPS; keys and subscriptions live in the workspace volume
  (`.metor/push.json`) - delete the file to reset them, devices then turn notifications on again.
- `METOR_NTFY_URL` - legacy: a message to an [ntfy.sh](https://ntfy.sh) topic when a bot waits for
  an approval. Superseded by the built-in push notifications, kept for one more release.
- `METOR_APP_ORIGINS` - further origins (comma-separated) that may call the API across origins
  with a bearer token; the desktop app's own origin `app://metor` is always allowed. Only needed
  for a client of your own or the interface's dev server.
- `METOR_ROUTINE_GUARD` - auto-pause: a routine pauses after this many runs without a user message
  (default 20, `0` = off).
- `METOR_MEMORY` - memory limit of the box (default `8G`; the compose file also caps the box at
  4096 processes, so a runaway bot cannot take the server down with it). A handful of bots with
  their browsers fit into 8 GB; raise it for more.


## Manage an app-installed server

In the desktop app, open **Manage Space → Resources & updates → Manage server…**.
Verify the SSH fingerprint and sign in as root with a password or private key. This is
short-lived access; passwords and passphrases are never saved. Diagnostics show the
container state, restarts, Docker OOM flag, free disk, RAM allocation and release.
The domain must match the selected Space and the installation must have been created
by the app in `/opt/metor`.

When the app is newer than the Space, **Update to …** offers its matching release.
Confirm **Update and restart Space** after saving active work and making a server backup.
The update retains volumes and RAM settings, installs the release’s matching Compose file,
restarts only the box and checks its version. Custom Compose files require a manual update.
A failed start restores the previous configuration and attempts to restart the previous
image. It does not undo data migrations. Server access closes after the update.

If an interrupted update leaves `/opt/metor/.env.before-update` or
`/opt/metor/compose.yml.before-update`, another update stops
for manual review. Inspect the running image and gateway. Once the result is understood,
keep the completed update or restore both saved configuration files and restart the box. Remove
the backup files only after confirming the Space is healthy. Do not delete the Docker volumes.

### Recovery integration test

On a Mac with Colima and Docker installed, run `node scripts/test-server.mjs`. It creates
a disposable Ubuntu VM, runs recovery, HTTPS, SSH authentication and upgrade checks, then
deletes that VM and its test data. It does not activate its Docker context, mount host
folders or forward application ports. Allow several minutes for image downloads.

`scripts/server-recovery.integration.mjs` is an opt-in Linux test for a **disposable,
empty Docker daemon**. It refuses existing containers, volumes and `/opt/metor`. It runs
the actual installer against the released image, injects SIGKILL at download/file/start/
gateway boundaries, retries and checks bot files, history, device sessions, all runtime
volumes and the enforced RAM limit. It also checks Caddy HTTPS with a trusted local CA.
Set `METOR_DISPOSABLE_DOCKER=yes` only inside the disposable VM. Never point this test
at a real Space or production Docker daemon. Public DNS/ACME/provider firewall acceptance
still requires a separate test deployment.
