# Installing metor

Four ways, from the most convenient to the most manual. The prebuilt box image comes from the GitHub
Container Registry: **`ghcr.io/metor-com/metor-box`** (tags `latest` = main, `0.1.0` etc. for
releases, plus a short commit sha), built by `.github/workflows/box-image.yml` for `linux/amd64`.

## Security first

Whoever gets into the interface can read every chat, drive every bot and open every bot's terminal.
The gateway inside the box (port 6010) therefore signs devices in itself
([ADR-0012](knowledge/decisions/0012-device-pairing.md)): no passwords - the first browser gets in
with a one-time **setup link**, every further phone or computer is linked by QR code or pairing code
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

## A) New server - one-liner (recommended)

```sh
curl -fsSL https://www.metor.com/install.sh | sudo bash
```

The same script from the repository:

```sh
curl -fsSL https://raw.githubusercontent.com/metor-com/metor/main/deploy/install.sh | sudo bash
```

The installer asks for a domain (nothing else) and proposes `<public-ip>.sslip.io` as the default,
a name that resolves to the server without owning a domain (see "Without your own domain" below);
Enter takes it, `local` means this machine only without TLS. It installs Docker if it is missing,
writes `/opt/metor/{compose.yml, Caddyfile, .env}`, pulls the image, starts box + Caddy (TLS via
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

On an Apple silicon Mac with macOS 26 the computer runs under Apple's own `container` runtime, no
Docker needed; on other Macs Colima or Docker Desktop do the same job through the same command.

```sh
brew install container            # Apple silicon, macOS 26 – otherwise: brew install colima docker && colima start --cpu 4 --memory 8
brew install metor-com/tap/metor  # the host command (until the tap exists: clone the repository, see the README)
metor setup                       # picks the runtime, gets the image, starts the computer, opens the setup link
```

`metor setup` prints the setup link (24 h, single use) and opens it in the browser; paste it into
the desktop app instead if you use that. After a reboot, `metor box up` (or the app's menu
*Local computer → Start*) starts the computer again; `metor box down` stops it. The interface
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
- **Codex** - sign in from the interface: "new bot" -> runtime Codex -> Sign in. The wizard shows
  the official device-code login (link + one-time code, confirmation in the browser or on the
  phone). Beforehand, enable **device code authorization** once in the ChatGPT security settings;
  without it the login fails with a red notice - enable it, then start the wizard again (the old
  code is void). Uses your ChatGPT subscription.

A runtime whose login expires stops only its own bots; the others keep running. Sign in again and
start the bots.

## Operations

- **Update:** `docker compose pull && docker compose up -d` (add the profile if you use it). Bots,
  histories and routines survive; sessions resume with their context.
- **Backup:** back up the three volumes - `metor-workspace` (bots, histories, routines, files),
  `metor-claude` (Claude login **and sessions**; without this volume the conversation contexts are
  gone) and `metor-codex` (Codex login and sessions).
- **Bots via CLI:** `docker compose exec box metor bot list|create|start|stop|rm ...`
- **Version:** `docker compose exec box metor version`.
- **Devices and lost access:** `docker compose exec box metor auth sessions` lists the signed-in
  browsers, `… metor auth revoke <id>` signs one out, `… metor auth link` prints a new setup link
  (24 h, single use) - the way back in when no device is left.
- **Time zone:** the box runs on Europe/Berlin (routine times are box local time).

## Options (.env, see `deploy/.env.example`)

- `METOR_IMAGE` - a different box image (for example a version tag instead of `latest`).
- `METOR_WATCH_BASE` - public base URL of the interface; ends up in the watch links that bots send.
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
