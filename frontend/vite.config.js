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
      // Dev against the running box: API/SSE and bot desktops (noVNC incl. WebSocket) go to the gateway.
      // Bot names can never be 'api'/'assets' (reserved); the Vite paths (@vite, src) do not match.
      "^/bots/[a-z0-9][a-z0-9-]*/": { target: "http://127.0.0.1:6010", changeOrigin: true, ws: true },
    },
  },
});
