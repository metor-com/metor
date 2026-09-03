# 0005 – Access to the computer: Tailscale now, relay for the product

**Date:** 2026-08-29 · **Status:** revised on 2026-08-29 (evening): access via Caddy login instead of Tailscale

## Context

The computer runs on a public VPS (only SSH open). The user wants to operate bots from Claude Desktop
and from the iPhone and, in exceptional cases (login, 2FA, captcha), see and take over a bot's browser
live. Hosted agent products solve this with an authenticated relay in the vendor's cloud: a broker
hands the client a VNC URL plus a token, the stream runs through an authenticated proxy and is
embedded in the vendor's own app via noVNC.

## Decision

| Tier | Access |
|---|---|
| A – own computer (now) | **Tailscale on the host** (not in the container); `tailscale serve --set-path=/<bot>` turns `127.0.0.1:60NN` into a tailnet HTTPS URL. iPhone: Tailscale app + Safari |
| B – small team | Tailscale (shared nodes) or Cloudflare Tunnel + Access |
| C – product for third parties | Own relay with account login and token per box, embedded in our own UI (slice 5) |

Regardless of the tier, inside the container: noVNC published only on the host's loopback, one port
and one **token per bot** in the watch URL, the bot knows its URL only as a configuration value.

## Consequences

Tailscale is the final solution for tier A, not a stopgap. Moving to C only replaces the edge (host),
not the box. SSH tunnels were rejected (impractical on the iPhone).

## Terms

- **VNC**: protocol for viewing/controlling a screen remotely. **noVNC**: VNC client in the browser (JavaScript),
  needs **websockify** as a bridge. **Xvfb**: virtual monitor in memory. **x11vnc**: VNC server for an
  X display.

## Implementation 2026-08-29

- Tailscale on the VPS, hostname `<host>` → `<host>.<tailnet>.ts.net`; operator = `<user>`
  (`sudo tailscale set --operator=<user> --hostname=<host>`); MagicDNS + HTTPS enabled in the admin console;
  first certificate fetched via `tailscale cert <host>.<tailnet>.ts.net` (files deleted afterwards).
- **One HTTPS port per bot**: `tailscale serve --bg --https=60NN http://127.0.0.1:60NN` (`metor box serve`).
  Watch link `https://<host>.<tailnet>.ts.net:60NN/<bot>/vnc.html?autoconnect=1&resize=scale&password=<token>`.
  Verified from the VPS itself: vnc.html 200, assets 200 over TLS.
- Container start with `METOR_WATCH_BASE=https://<host>.<tailnet>.ts.net`; bots know their links.

## Pitfalls (Tailscale 1.102.3)

- **Path mounts** (`--set-path=/<bot>` or `/<bot>/` on 443 or 80) answer 404, the backend is never
  reached (echo-server test) – root mounts per port work. Hence ports instead of paths.
- **443 with path handlers**: the TLS handshake aborts with "tlsv1 alert internal error" although the certificate
  exists; on ports 6011/6012 TLS works immediately.
- Serve routes by hostname: access via the Tailscale IP (`100.x`) returns 404 – always use the DNS name.
- noVNC lives under `/<bot>/` (websockify web root with symlink `<bot>/ → /usr/share/novnc`); the
  WebSocket upgrade works regardless of path. Over TLS test only with HTTP/1.1 (curl `--http1.1`);
  there is no upgrade in HTTP/2.

## Alternative: Caddy as reverse proxy (for third parties)

Caddy (already present on this host) can do the same with a public domain and Let's Encrypt:
`handle_path /<bot>/* { reverse_proxy 127.0.0.1:60NN }` – path mounts work there. The difference is
not technology but **exposure**: Caddy makes noVNC publicly reachable and therefore needs its own
authentication (basic auth is not enough for permanent operation; `forward_auth` against an identity
provider), Tailscale keeps everything in the private network without a public port. For "easy to set up
for others", Caddy + domain + login is the tier B/C option; planned as `metor box serve --caddy`, not implemented.

## Status 2026-08-29 (evening)

From the VPS, HTTPS port links and the IP fallback (`http://<tailscale-ip>:70NN/<bot>/…`, HTTP without
DNS) work. From the user's iPhone/laptop no connection could be established (laptop not in the tailnet,
Firefox with its own DNS). Decision: do not pursue Tailscale for now; watching via SSH port forward until
further notice (`ssh -L 6011:127.0.0.1:6011 …`, then `http://localhost:6011/<bot>/vnc.html?…`).

## Revision 2026-08-29 (evening): Caddy instead of Tailscale

Tailscale and SSH tunnels failed in practice on the client side (DNS, browser, handling). But the VPS
already serves `www.metor.com` via Caddy with Let's Encrypt and `basic_auth` – i.e. the same
model (public HTTPS relay + login + token), self-hosted. Implementation:

- **Gateway inside the computer** (`metor-gateway.mjs`, port 6010): `/bots/` overview page (mini frontend),
  `/bots/<name>/…` → the bot's noVNC (HTTP + WebSocket upgrade). One port for all bots, Caddy needs
  a single block: `handle /bots* { basic_auth { … } reverse_proxy 127.0.0.1:6010 }`.
- Watch link: `https://www.metor.com/bots/<name>/vnc.html?…&password=<token>` – basic auth is the
  login, the token the second factor. Works on any device without app, VPN or tunnel.
- Tailscale stays installed, is not used; serve entries removed.

This covers tiers A and B; tier C (customers) would need an account login (`forward_auth`) instead of
basic auth and its own tokens per user – gateway and container stay the same.

**Addendum 2026-09-03:** the login moved from Caddy (`basic_auth`) into the gateway – sessions by
device pairing, see [ADR-0012](0012-device-pairing.md). Caddy only terminates TLS now; the WebSocket
exception and the watch cookie described above are no longer needed for the login.

**Pitfall (2026-08-30, verified locally):** by default noVNC connects its WebSocket to
`ws://<host>/websockify` at the **root** – behind the gateway that lands outside `/bots/<name>/`
and is cut off ("Failed to connect to server", code 1006). Fix: include `path=bots/<name>/websockify`
in the watch link (in `watchPath`/`watchUrl`); websockify accepts the upgrade on any path.
