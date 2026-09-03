#!/usr/bin/env bash
# metor – one-shot server installation (see INSTALL.md).
#   curl -fsSL https://www.metor.com/install.sh | sudo bash
# Creates /opt/metor (or $METOR_DIR) with compose.yml, Caddyfile and .env, pulls the
# prebuilt box image from ghcr.io and starts everything. Needs: Linux, Bash, internet.
# The script is self-contained (no repo access needed) and idempotent.
set -euo pipefail

IMAGE_DEFAULT="ghcr.io/metor-com/metor-box:latest"
DIR="${METOR_DIR:-/opt/metor}"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Everything runs inside main(): with `curl … | bash` the script itself arrives on stdin, so bash
# must read the whole body before anything executes (a half-downloaded script does nothing), and
# main runs with stdin closed so that no command (docker exec, for one) can swallow the rest of
# the script. Questions read /dev/tty explicitly.
main() {
say "metor – server installation"

# ---------- Privileges ----------
# Setup needs root (Docker installation, /opt/metor); at runtime everything is containerized
# and runs inside the box as an unprivileged user. curl|bash cannot re-launch itself via sudo –
# so state clearly what the correct invocation is.
if [ "$(id -u)" -ne 0 ]; then
  if ! docker info >/dev/null 2>&1 || [ ! -w "$(dirname "$DIR")" ]; then
    echo "Please run as root:  curl -fsSL https://www.metor.com/install.sh | sudo bash"
    exit 1
  fi
fi

# ---------- Unattended mode ----------
# Every question can be answered up front through the environment (INSTALL.md, "Unattended"):
#   METOR_DOMAIN (unset = <public-ip>.sslip.io; "local" or empty = this machine only),
#   METOR_INSTALL_DOCKER=no (do not install Docker),
#   METOR_GHCR_USER + METOR_GHCR_TOKEN (while the image package is private).
# There is no user/password: the interface signs devices in by link and QR code (ADR-0012).
# Whatever is missing is asked on the terminal; without a terminal the script stops with a hint.
have_tty() { [ -r /dev/tty ] && ( : </dev/tty ) 2>/dev/null; }
ask() {   # ask <variable> <prompt> [-s]: read from the terminal into the variable (-s = hidden)
  have_tty || { echo "No terminal for the question \"$2\" – set $1 in the environment (INSTALL.md, unattended install)."; exit 1; }
  if [ "${3:-}" = "-s" ]; then printf '%s' "$2" >/dev/tty; read -r -s "$1" </dev/tty; printf '\n' >/dev/tty
  else read -r -p "$2" "$1" </dev/tty; fi
}

# ---------- Docker ----------
# Missing Docker (or Docker without the compose plugin) is installed via Docker's official script
# without asking – whoever runs this as root expects the installer to bring its prerequisites.
# METOR_INSTALL_DOCKER=no stops instead, for hosts where Docker is managed by hand.
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  case "${METOR_INSTALL_DOCKER:-yes}" in
    n|N|no) echo "Docker (with the compose plugin) is missing – please install it, or run without METOR_INSTALL_DOCKER=no."; exit 1 ;;
  esac
  say "Installing Docker via get.docker.com"
  curl -fsSL https://get.docker.com | sh
  docker compose version >/dev/null 2>&1 || { echo "docker compose is still missing – please install the compose plugin."; exit 1; }
fi

# ---------- Domain ----------
# Default: the server's public IPv4 as <a-b-c-d>.sslip.io – a name that resolves to this server
# without owning a domain, so TLS works out of the box. "local" = localhost only, no TLS.
PUBIP=$(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
case "$PUBIP" in *[!0-9.]*|"") PUBIP="" ;; esac
DEFAULT_DOMAIN="${PUBIP:+$(printf '%s' "$PUBIP" | tr . -).sslip.io}"
if [ -n "${METOR_DOMAIN+x}" ]; then DOMAIN="$METOR_DOMAIN"
elif have_tty; then
  say "Where should metor be reachable?"
  echo "You will open metor in a browser – on this computer, your laptop, your phone. For that the"
  echo "server needs a web address with HTTPS. If you own a domain that already points to this"
  echo "server, type it (for example bots.example.com)."
  if [ -n "$DEFAULT_DOMAIN" ]; then
    echo "No domain? Just press Enter: the address below is this server's IP written as a name; it"
    echo "works right away, needs no setup, and can be swapped for a real domain any time."
  fi
  echo "Type 'local' if metor should only be reachable from this machine (no HTTPS)."
  echo
  ask DOMAIN "Address${DEFAULT_DOMAIN:+ [$DEFAULT_DOMAIN]}: "
  [ -n "$DOMAIN" ] || DOMAIN="$DEFAULT_DOMAIN"
else
  [ -n "$DEFAULT_DOMAIN" ] || { echo "Could not determine the public IP for a default name – set METOR_DOMAIN."; exit 1; }
  DOMAIN="$DEFAULT_DOMAIN"; echo "No METOR_DOMAIN given – using $DOMAIN"
fi
[ "$DOMAIN" = local ] && DOMAIN=""
IMAGE="${METOR_IMAGE:-$IMAGE_DEFAULT}"

# ---------- Ports 80/443: metor's own Caddy needs them; a proxy that is already there takes over instead ----------
port_holder() { ss -Hltnp "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }
port_busy() { ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }
PROXY=own
if [ -n "$DOMAIN" ] && { port_busy 80 || port_busy 443; }; then
  PROXY=existing
  H80=$(port_holder 80); H443=$(port_holder 443)
  say "Another web server (${H80:-${H443:-unknown}}) already uses port 80/443 on this machine."
  echo "metor's own HTTPS front-end therefore stays off. Two ways forward:"
  echo "  a) You do not need that web server: stop it (e.g. systemctl disable --now ${H80:-${H443:-nginx}}) and run this"
  echo "     installer again – it then sets up HTTPS for $DOMAIN by itself."
  echo "  b) Keep it and let it forward https://$DOMAIN/bots to metor (127.0.0.1:6010) – see INSTALL.md,"
  echo "     section C, for Caddy and nginx examples (WebSockets and unbuffered responses are required)."
fi

# ---------- Image (a private package needs a GitHub login with read:packages) ----------
quiet_login() { grep -v -i "warning\|unencrypted\|credential\|docs.docker.com" || true; }   # Docker's config.json notice is noise here
if ! docker manifest inspect "$IMAGE" >/dev/null 2>&1; then
  if [ -n "${METOR_GHCR_TOKEN:-}" ]; then
    printf '%s' "$METOR_GHCR_TOKEN" | docker login ghcr.io -u "${METOR_GHCR_USER:?METOR_GHCR_USER is missing}" --password-stdin 2>&1 | quiet_login
  else
    have_tty || { echo "No access to $IMAGE and no terminal – set METOR_GHCR_USER and METOR_GHCR_TOKEN (GitHub token with read:packages)."; exit 1; }
    say "The image package needs a GitHub login (user name + token with the read:packages scope):"
    docker login ghcr.io </dev/tty 2>&1 | quiet_login
  fi
  docker manifest inspect "$IMAGE" >/dev/null 2>&1 || { echo "Still no access to $IMAGE – check user and token (scope read:packages)."; exit 1; }
  echo "The login is kept in /root/.docker/config.json for updates; 'docker logout ghcr.io' removes it once the package is public."
fi
say "Pulling $IMAGE"
docker pull -q "$IMAGE"

# ---------- Write files ----------
say "Writing $DIR"
mkdir -p "$DIR"; cd "$DIR"

cat > compose.yml <<'COMPOSE'
services:
  box:
    image: ${METOR_IMAGE:-ghcr.io/metor-com/metor-box:latest}
    container_name: metor-box
    hostname: metor
    restart: unless-stopped
    shm_size: "1g"
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
    environment:
      METOR_WATCH_BASE: ${METOR_WATCH_BASE:-}
      METOR_NTFY_URL: ${METOR_NTFY_URL:-}
      METOR_ROUTINE_GUARD: ${METOR_ROUTINE_GUARD:-}
      METOR_AUTH: ${METOR_AUTH:-}                   # "off" = no gateway sign-in (only behind your own login)
    volumes:
      - metor-workspace:/workspace
      - metor-claude:/home/box/.claude
      - metor-codex:/home/box/.codex
    ports:
      - "127.0.0.1:6010:6010"
  caddy:
    image: caddy:2
    profiles: ["caddy"]
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
volumes:
  metor-workspace: { name: metor-workspace }
  metor-claude: { name: metor-claude }
  metor-codex: { name: metor-codex }
  caddy-data: { name: metor-caddy-data }
  caddy-config: { name: metor-caddy-config }
COMPOSE

{
  echo "METOR_IMAGE=$IMAGE"
  [ -n "$DOMAIN" ] && echo "METOR_WATCH_BASE=https://$DOMAIN"
} > .env

if [ -n "$DOMAIN" ] && [ "$PROXY" = own ]; then
  # Caddy only terminates TLS; the sign-in (devices, pairing) is done by the gateway (ADR-0012)
  cat > Caddyfile <<CADDY
$DOMAIN {
	redir / /bots/ permanent
	handle /bots* {
		reverse_proxy box:6010 {
			flush_interval -1
		}
	}
	handle {
		respond "metor" 200
	}
}
CADDY
fi

# ---------- Start ----------
say "Starting metor"
if [ -n "$DOMAIN" ] && [ "$PROXY" = own ]; then
  # A Caddy container left behind by a failed earlier run (e.g. port 80 taken at that time) keeps a
  # broken network sandbox – no host ports, no DNS. Its state lives in volumes, so always recreate it.
  docker compose rm -sf caddy >/dev/null 2>&1 || true
  docker compose --profile caddy up -d
  sleep 2
  port_busy 80 && port_busy 443 || echo "Warning: Caddy did not bind ports 80/443 – check: docker compose logs caddy"
else
  docker compose up -d
fi

# ---------- First device: setup link (+ QR code) ----------
say "Waiting for the gateway…"
for _ in $(seq 1 60); do
  code=$(docker compose exec -T box curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6010/bots/api/harnesses 2>/dev/null || true)
  case "$code" in 200|401) break ;; esac; sleep 2
done
say "Done – open this link once on your first device (valid 24 hours):"
docker compose exec -T box metor auth link || echo "  (later: cd $DIR && docker compose exec box metor auth link)"
if [ -z "$DOMAIN" ]; then echo "Interface: http://127.0.0.1:6010/bots/ (this machine only; from elsewhere: ssh -L 6010:127.0.0.1:6010 root@<server>)"
elif [ "$PROXY" = own ]; then echo "Interface: https://$DOMAIN/bots/  (HTTPS is set up automatically on the first visit; give it a minute)"
else
  echo "Interface: https://$DOMAIN/bots/ as soon as your web server forwards /bots to 127.0.0.1:6010 (see above)."
  echo "Until then: ssh -L 6010:127.0.0.1:6010 root@<server> and open the link with http://127.0.0.1:6010 in place of https://$DOMAIN"
fi
echo "Then: \"+ New bot\" → pick the runtime → Sign in with your subscription. More phones/computers: Devices → Link a device."
}
main "$@" </dev/null
