// Where the gateway is. In a browser the interface is served by the gateway itself, so every URL
// is relative. Inside the desktop app (ADR-0015) the interface is bundled and runs on the app's
// own origin; the preload API `window.metor` names the computer, and the app itself adds the
// session token to every request that goes there (the renderer never sees it).
import { writable } from "svelte/store";
export const app = globalThis.metor ?? null;                       // desktop app API, null in a browser
const originOf = (g) => (g?.signedIn && g.reachable !== false ? g.origin : "");
// The computer this interface talks to: in an app the one the app is connected to, and it changes with a
// warm switch (session.js switchComputer) – `origin` is a live binding the API reads on every request,
// `gateway` a store the shell follows (the connect screen when a computer is signed out or silent)
export const gateway = writable(app?.gateway ?? null);
export let origin = originOf(app?.gateway);
export const url = (path) => origin + path;
export function setGateway(g) { origin = originOf(g); gateway.set(g); }
// The session is gone (401): a browser gets the gateway's sign-in page, the app its connect screen.
// Under the Vite dev server `/bots/` is this interface again, not the gateway's page – reloading would
// loop, so there it stops with a hint: sign in by opening a setup link through the dev server.
let told = false;
export function signedOut() {
  if (app) return app.signedOut();
  if (!import.meta.env.DEV) { location.href = "/bots/"; return; }
  if (!told) { told = true; alert("Not signed in. Open a setup link through the dev server: replace the host in the link from `metor auth link` with localhost:5173, then reload."); }
}
