import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

// metor web UI: Svelte + Vite, no SvelteKit.
// The gateway serves the build (dist/) under /bots/ – hence base '/bots/'.
export default defineConfig({
  base: "/bots/",
  plugins: [svelte(), tailwindcss()],
  build: { sourcemap: false }, // repo rule: no source maps in releases
  server: {
    proxy: {
      // Dev against the running box: API/SSE, sign-in and bot desktops (noVNC incl. WebSocket) go to the
      // gateway. Vite's own paths (@vite, @id, @fs, src/, node_modules/) must not – the gateway would answer
      // them with its page, and the browser then refuses the "module" (verified 2026-09-07).
      "^/bots/(?!src/|node_modules/|@)[a-z0-9][a-z0-9-]*/": { target: "http://127.0.0.1:6010", changeOrigin: true, ws: true },
    },
  },
});
