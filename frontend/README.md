# metor – web UI

Svelte + Vite + **Tailwind CSS v4**, deliberately **without SvelteKit** – no SSR, no
framework routing, no second Node server. The build (`dist/`) is served statically by the
gateway (`backend/harness/bin/metor-gateway.mjs`) under `/bots/`; it is built as a multi-stage
step of the Docker build (`metor box build`, context = repo root). Architecture: ADR-0008.
Bot replies are rendered as Markdown (`marked` + `DOMPurify`, see `src/lib/markdown.js` –
bot output is untrusted, always sanitize). Layout ground rules: the app shell (`App.svelte`)
is `h-dvh overflow-hidden` – the page itself never scrolls; scrolling regions (bot list, chat
history) are `overflow-y-auto` on the inside, and every flex child on the way there needs
`min-w-0`/`min-h-0`.

## Development

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173/bots/ – proxies API/SSE/noVNC to the running box (port 6010)
```

Prerequisite: the box is running (`metor box up`). The Vite dev proxy forwards `/bots/<name>/…`
and `/bots/api/…` to the gateway (including the WebSocket for noVNC).

## Structure

- `src/App.svelte` – app shell only: layout and view state (Chat | Computer | Side by side,
  routines panel open/closed); no data handling
- `src/lib/session.js` – the data layer: selected bot (mirrored in the URL hash), bot list, the
  live connection, chat entries and streaming text, actions (start/stop/remove/interrupt)
- `src/components/` – `Sidebar`, `AgentCreate`, `Header` (status, tabs, actions, ⋯ menu),
  `RoutinesPanel`, `ChatView`, `ComputerPanel` (noVNC/terminal iframes), `FilesPanel` (file
  browser), `StatusDot`
- `src/lib/` – `api.js` (JSON API), `events.js` (one SSE stream, topics `agents`, `chat:<bot>`),
  `viewport.js` (breakpoint store), `status.js` (status labels), `markdown.js` (sanitized Markdown)

Rules: the UI is English only (no i18n); UI terms follow `knowledge/GLOSSARY.md` (Bot, Computer,
Chat, History, Approval, Dock), code terms stay `agent`/`box`. No source maps in the build
(vite.config.js).
