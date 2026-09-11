#!/usr/bin/env bash
# Read-only checks shared by inspection and installation. Inputs are shell-quoted by the app.
set -euo pipefail
fail() { printf 'METOR_ERROR:%s\n' "$1"; exit 1; }
[ "$(id -u)" = 0 ] || fail 'Sign in as root to set up this server.'
[ -r /etc/os-release ] || fail 'This server does not expose its Linux version.'
. /etc/os-release
case "$ID:${VERSION_ID:-}" in ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;; *) fail 'Use Ubuntu 22.04, 24.04, 26.04 or Debian 12/13.' ;; esac
case "$(uname -m)" in x86_64|aarch64) ;; *) fail 'The server needs an x86-64 or ARM64 processor.' ;; esac
for cmd in curl ss flock; do command -v "$cmd" >/dev/null || fail "Missing server prerequisite: $cmd."; done
cpus=$(getconf _NPROCESSORS_ONLN)
ram=$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)
free_disk=$(df -Pm /opt | awk 'NR==2 {print $4}')
[ "$cpus" -ge 2 ] || fail 'At least 2 vCPUs are required.'
[ "$ram" -ge 3500 ] || fail 'At least 4 GB of server RAM is required; 16 GB is recommended.'
[ "$free_disk" -ge 12288 ] || fail 'At least 12 GiB of free disk space is required; a 40 GB disk is recommended.'
# Only a directory owned by an earlier app attempt is eligible for a retry.
owned=no
if [ -e /opt/metor ]; then
  [ ! -L /opt/metor ] && [ -f /opt/metor/.desktop-install ] || fail 'An existing /opt/metor installation needs manual review. It will not be overwritten.'
  [ "$(cat /opt/metor/.desktop-install)" = "$METOR_DOMAIN" ] || fail 'This installation belongs to another domain. Use the original domain to retry.'
  owned=yes
fi
if command -v docker >/dev/null; then
  docker info >/dev/null 2>&1 || fail 'Docker is installed but unavailable. Start or repair it before retrying.'
  if [ "$owned" = no ]; then
    [ -z "$(docker ps -aq)" ] || fail 'Existing Docker containers were found. Use a fresh server.'
    [ -z "$(docker volume ls -q)" ] || fail 'Existing Docker volumes were found. Use a fresh server.'
  else
    [ -z "$(docker ps -a --format '{{.Names}}' | grep -Ev '^(metor-box|metor-caddy-1)$' || true)" ] || fail 'Other Docker containers were found. Review the server before retrying.'
  fi
fi
for port in 80 443 6010; do
  if ss -Hltn "sport = :$port" | grep -q .; then
    [ "$owned" = yes ] && command -v docker >/dev/null || fail "Port $port is already in use. Use a fresh server."
    # Fail closed if the port is not published by our own Compose service.
    docker ps --format '{{.Names}} {{.Ports}}' | grep -E "^(metor-box|metor-caddy-1) .*:$port->" >/dev/null || fail "Port $port is used by another service."
  fi
done
reserve=$((ram / 5)); [ "$reserve" -ge 1024 ] || reserve=1024
memory=$(((ram - reserve) / 256 * 256)); [ "$memory" -le 8192 ] || memory=8192
# Retain the allocation of a previous app attempt.
if [ "$owned" = yes ] && [ -f /opt/metor/.env ]; then
  saved=$(sed -n 's/^METOR_MEMORY=\([0-9]*\)M$/\1/p' /opt/metor/.env)
  if [ -n "$saved" ]; then
    case "$saved" in *[!0-9]*) fail 'The saved RAM allocation needs manual review.' ;; esac
    [ "$saved" -ge 1024 ] && [ "$saved" -le "$((ram - reserve))" ] || fail 'The saved RAM allocation does not fit this server. Review it before retrying.'
    memory=$saved
  fi
fi
printf 'METOR_SERVER:%s %s|%s|%s|%s|%s\n' "$ID" "$VERSION_ID" "$cpus" "$ram" "$free_disk" "$memory"

if [ "$owned" = yes ]; then
  phase=unknown
  if [ -f /opt/metor/.desktop-phase ]; then phase=$(cat /opt/metor/.desktop-phase); fi
  case "$phase" in docker|image|files|start|gateway|ready) ;; *) phase=unknown ;; esac
  printf 'METOR_RESUME:%s\n' "$phase"
fi

printf "METOR_ADDRESSES:%s\n" "$(hostname -I 2>/dev/null || true)"
