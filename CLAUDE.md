# metor - working context for Claude Code sessions

## What this is

**metor**: an agent platform - delegable bots with their own computer (browser, shell, files),
built on official coding-agent harnesses - Claude Code and Codex, called "runtimes" in the UI - and
the user's own subscriptions. A bot = a directory `/workspace/bots/<name>/`
inside the computer (a Docker container, the "box") + a host process that drives its runtime
session. Product and brand name: metor (ADR-0007 with its addendum; the units are "bots").
Repository `metor-com/metor`, box image `ghcr.io/metor-com/metor-box`.

## Structure (mono-repo, ADR-0001 rev.)

- `backend/` - the code: `box/Dockerfile` (computer image), `harness/bin/metor` (host wrapper,
  Bash: box build/up/down/…, forwards `bot …` into the container), `harness/bin/metor.mjs` (CLI
  inside the computer) with `metor-store.mjs` (bot.json), `metor-desktop.mjs` (desktop chain),
  `metor-lifecycle.mjs` (create/start/stop/rm), `metor-supervise.mjs` (PID 1),
  `harness/bin/metor-gateway.mjs` (port 6010: UI, JSON API + SSE, noVNC and terminal
  proxies) with `metor-auth.mjs` (sign-in by device pairing, ADR-0012),
  `harness/bin/metor-harness.mjs` (runtime registry), `metor-agent-host.mjs` +
  `metor-host-core.mjs` + `metor-host-claude.mjs` / `metor-host-codex.mjs` (bot hosts),
  `metor-routines*.mjs` (routines), `harness/hooks/`, `harness/templates/` (bot instructions).
- `frontend/` - the UI (ADR-0008): Svelte + Vite, **without SvelteKit**; the gateway serves the
  build under `/bots/` (multi-stage Docker build, **build context = repo root**).
  Dev: `cd frontend && npm run dev` (proxied to the running box).
- `knowledge/` - **read first**: `README.md` (index), `GLOSSARY.md` (binding terms),
  `decisions/` (ADRs), `harness/claude-code-facts.md` and `harness/codex-facts.md` (verified
  harness facts), `design/` (drafts for upcoming work).
- Internal analyses live in a private companion repository (ADR-0006).
- `deploy/` - compose, Caddy template, `.env.example`, installer; `docs/` - user documentation.

## Environments

- **Development:** local, any Docker; on macOS **Colima** instead of Docker Desktop (verified
  drop-in: `brew install colima docker`, then `colima start --cpu 4 --memory 8`; after a reboot
  `colima start` again, the container comes back by itself thanks to `--restart unless-stopped`).
  `export PATH=$PWD/backend/harness/bin:$PATH`, `metor box build`, `metor box up`,
  `metor auth link` (open the link once in the browser), in the UI sign in to a runtime ("New bot" →
  Sign in; or `docker exec -it metor-box claude auth login`), then create bots in the UI at
  http://127.0.0.1:6010/bots/ or with `metor bot create <name> --role "..."`.
- **Production:** servers run the prebuilt image via compose (see `INSTALL.md`); never develop
  inside the box. Production/deployment specifics of the maintainer live in the untracked
  `CLAUDE.local.md`.

## Rules

- Terms follow `knowledge/GLOSSARY.md`: UI "bot" / "computer", code `agent` / `box` - code terms do
  not change when marketing renames things.
- Harnesses run as processes with their official login (Agent SDK session for Claude Code,
  `codex app-server` for Codex); never token extraction (ADR-0004, ADR-0006,
  `knowledge/harness/subscription-auth-rules.md`).
- Inside the box everything is allowed; approvals only at the boundary (ADR-0004). The bot ID is
  part of every path and tool call (ADR-0002).
- No source maps in releases, no silent uploads, no secrets in the repository.
- Never copy third-party material into this repository; before anything is made public, run the
  check from ADR-0006.
- Changes to `metor*.mjs`: `node --check` before committing; image changes: rebuild and run
  `scripts/smoke.sh` against the running box.
- Verified facts and pitfalls -> `knowledge/harness/`; decisions -> a new ADR; finished user-visible
  features -> one or two lines in `CHANGELOG.md` (ideas and open items -> `BACKLOG.md`).
- Write new documentation in English; no personal names, hostnames or addresses in tracked files.
- `git pull` before changing anything (several sessions work on the same tree).

## Current state

Version 0.1.0 works end-to-end: bots with their own desktop, browser and terminal; chat with
streaming, tool cards and approvals; attachments both ways; routines; two runtimes (Claude Code,
Codex) with model choice and a setup wizard; server installation via image + compose. What is
missing lives in `BACKLOG.md`, what exists per feature in `CHANGELOG.md` (maintain both there, not
here). The original build order was ADR-0003.
