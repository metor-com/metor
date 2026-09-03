# Third-party components

metor itself is licensed under Apache-2.0 (see [LICENSE](LICENSE)). The container image
built from `backend/box/Dockerfile` bundles the following components **unmodified**, installed
from their official distribution channels. Their licenses apply to those components.

## Installed from Debian packages (bookworm)

| Component | Purpose in the box | License |
|---|---|---|
| Chromium | the bot's browser (driven via CDP) | BSD-3-Clause |
| Xvfb, x11-xserver-utils, xdotool | virtual display per bot | MIT/X11 |
| openbox | window manager | GPL-2.0 |
| tint2 | desktop dock | GPL-2.0 |
| xterm | terminal window on the desktop | MIT/X11 |
| x11vnc | VNC server per desktop | GPL-2.0 |
| websockify | WebSocket bridge for noVNC | LGPL-3.0 |
| noVNC | browser VNC client (screen panel) | MPL-2.0 |
| fonts-liberation, fonts-noto-color-emoji, fonts-dejavu-core | fonts | SIL OFL 1.1 / Bitstream Vera |
| ripgrep, jq, curl, git, python3, tini, unzip, tzdata, procps, less | tooling | MIT / Apache-2.0 / BSD / GPL-2.0 (tini: MIT) |

GPL/LGPL components are used as separate programs (no linking, no modification); their source is
available from Debian (`apt source <package>`).

## Downloaded release binaries and npm packages

| Component | Source | License |
|---|---|---|
| ttyd 1.7.7 | GitHub release binary (SHA-256 pinned in the Dockerfile) – terminal tab | MIT |
| @playwright/mcp | npm – browser tools for the bots (MCP) | Apache-2.0 |
| @openai/codex | npm – Codex CLI (Codex runtime) | Apache-2.0 |
| @anthropic-ai/claude-agent-sdk | npm – Claude Agent SDK (Claude Code runtime) | Anthropic Commercial Terms of Service |
| Claude Code | official installer (`claude.ai/install.sh`) – Claude Code runtime | Anthropic Commercial Terms of Service (proprietary) |

**Note on Claude Code and the Agent SDK:** both are proprietary Anthropic software installed
into the image from Anthropic's official channels at build time. They are not part of this
project and are not relicensed by it; using them requires an Anthropic account and acceptance of
Anthropic's terms. If redistributing prebuilt images is a concern for you, build the image
yourself (`metor box build`) – the Dockerfile only automates the official installers.

## Frontend dependencies (bundled into the static UI build)

| Package | License |
|---|---|
| svelte, @sveltejs/vite-plugin-svelte, vite | MIT |
| tailwindcss, @tailwindcss/vite, @tailwindcss/typography | MIT |
| marked | MIT |
| dompurify | Apache-2.0 OR MPL-2.0 |

## Base images

| Image | License |
|---|---|
| node:22-bookworm-slim | MIT (Node.js) on Debian (various DFSG-compliant licenses) |
| caddy:2 (deployment profile "caddy") | Apache-2.0 |
