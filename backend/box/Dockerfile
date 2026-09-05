# metor – computer ("box"): one environment per user, all bots run inside it.
# Linux + Node + Claude Code + Codex + Gemini CLI + metor CLI; one desktop per bot (Xvfb, Chromium, x11vnc, noVNC) + Playwright MCP.
# The interface (frontend/, Svelte) is built in a multi-stage build – the build context is the REPO ROOT.

# ---------- Stage 1: build the interface (no Node build needed on the server) ----------
FROM node:22-bookworm-slim AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: the computer ----------
FROM node:22-bookworm-slim

ARG BOX_UID=1000
ENV DEBIAN_FRONTEND=noninteractive
LABEL org.opencontainers.image.title="metor box" \
      org.opencontainers.image.description="One computer for all your bots: desktops, browsers, terminals and the metor gateway" \
      org.opencontainers.image.source="https://github.com/metor-com/metor" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git python3 ripgrep procps tini less jq unzip tzdata \
      chromium fonts-liberation fonts-noto-color-emoji \
      xvfb x11vnc websockify novnc openbox xdotool xterm tint2 fonts-dejavu-core x11-xserver-utils \
    && rm -rf /var/lib/apt/lists/*

# ttyd (Terminal tab of the interface, ships its own xterm.js): not in the Debian repos –
# official static release binary, pinned by SHA-256 (amd64 = ghcr/server, arm64 = local Colima)
ARG TARGETARCH
RUN set -e; arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$arch" in \
      amd64) file=ttyd.x86_64;  sum=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55;; \
      arm64) file=ttyd.aarch64; sum=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165;; \
      *) echo "ttyd: architecture $arch not supported" >&2; exit 1;; \
    esac; \
    curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/$file"; \
    echo "$sum  /usr/local/bin/ttyd" | sha256sum -c -; \
    chmod +x /usr/local/bin/ttyd

# Playwright MCP (browser tools) + Agent SDK (stream harness, ADR-0009 – knowledge/decisions/0009-stream-harness.md;
# version coupled to CLI 2.1.x) + Codex CLI (second runtime, ADR-0011 – knowledge/decisions/0011-multi-harness.md;
# pinned – the release train ships daily, the adapter carries the version-specific knowledge).
# Installed globally: /usr/local/lib/node_modules is on the parent walk of /usr/local/lib/metor/*.mjs
RUN npm install -g @playwright/mcp @anthropic-ai/claude-agent-sdk@0.3.251 @openai/codex@0.152.0 @google/gemini-cli@0.58.0 qrcode@1.5.4 web-push@3.6.7 && which playwright-mcp && codex --version && gemini --version

# Non-root user "box" with uid 1000 (replaces the node user of the base image)
RUN (userdel -r node || true) \
    && useradd -m -u ${BOX_UID} -s /bin/bash box \
    && mkdir -p /workspace /home/box/.claude /home/box/.codex /home/box/.gemini \
    && chown -R box:box /workspace /home/box

RUN printf '#!/bin/sh\nexec node /usr/local/lib/metor/metor.mjs "$@"\n' > /usr/local/bin/metor && chmod +x /usr/local/bin/metor

USER box
WORKDIR /workspace
ENV HOME=/home/box \
    PATH=/home/box/.local/bin:$PATH \
    CLAUDE_CONFIG_DIR=/home/box/.claude \
    METOR_INSIDE_BOX=1 \
    METOR_BOTS_DIR=/workspace/bots \
    TZ=Europe/Berlin

# Claude Code (native build) – login data lives in the CLAUDE_CONFIG_DIR volume
RUN curl -fsSL https://claude.ai/install.sh | bash && claude --version

# metor CLI + gateway + interface – AFTER the Claude install, so that code changes
# do not invalidate the expensive install layer (COPY runs as root, files are world-readable)
COPY VERSION /usr/local/lib/metor/VERSION
COPY backend/harness/bin/metor.mjs /usr/local/lib/metor/metor.mjs
COPY backend/harness/bin/metor-store.mjs /usr/local/lib/metor/metor-store.mjs
COPY backend/harness/bin/metor-auth.mjs /usr/local/lib/metor/metor-auth.mjs
COPY backend/harness/bin/metor-push.mjs /usr/local/lib/metor/metor-push.mjs
COPY backend/harness/bin/metor-connectors.mjs /usr/local/lib/metor/metor-connectors.mjs
COPY backend/harness/bin/metor-desktop.mjs /usr/local/lib/metor/metor-desktop.mjs
COPY backend/harness/bin/metor-lifecycle.mjs /usr/local/lib/metor/metor-lifecycle.mjs
COPY backend/harness/bin/metor-supervise.mjs /usr/local/lib/metor/metor-supervise.mjs
COPY backend/harness/bin/metor-harness.mjs /usr/local/lib/metor/metor-harness.mjs
COPY backend/harness/bin/metor-host-core.mjs /usr/local/lib/metor/metor-host-core.mjs
COPY backend/harness/bin/metor-host-claude.mjs /usr/local/lib/metor/metor-host-claude.mjs
COPY backend/harness/bin/metor-host-codex.mjs /usr/local/lib/metor/metor-host-codex.mjs
COPY backend/harness/bin/metor-host-gemini.mjs /usr/local/lib/metor/metor-host-gemini.mjs
COPY backend/harness/bin/metor-setup.mjs /usr/local/lib/metor/metor-setup.mjs
COPY backend/harness/bin/metor-gateway.mjs /usr/local/lib/metor/metor-gateway.mjs
COPY backend/harness/bin/metor-chat-stream.mjs /usr/local/lib/metor/metor-chat-stream.mjs
COPY backend/harness/bin/metor-agent-host.mjs /usr/local/lib/metor/metor-agent-host.mjs
COPY backend/harness/bin/metor-routines.mjs /usr/local/lib/metor/metor-routines.mjs
COPY backend/harness/bin/metor-routines-mcp.mjs /usr/local/lib/metor/metor-routines-mcp.mjs
COPY backend/harness/templates /usr/local/lib/metor/templates
COPY backend/harness/hooks /usr/local/lib/metor/hooks
COPY --from=frontend /fe/dist /usr/local/lib/metor/frontend

# noVNC ports of the bot desktops (display 11..49 → port 6011..6049), publish only on the host's loopback
EXPOSE 6010 6011-6049
VOLUME ["/workspace", "/home/box/.claude", "/home/box/.codex", "/home/box/.gemini"]
ENTRYPOINT ["tini", "--", "metor", "supervise"]
