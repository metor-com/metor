// Where the gateway is. In a browser the interface is served by the gateway itself, so every URL
// is relative. Inside the desktop app (ADR-0015) the interface is bundled and runs on the app's
// own origin; the preload API `window.metor` names the computer, and the app itself adds the
// session token to every request that goes there (the renderer never sees it).
export const app = globalThis.metor ?? null;                       // desktop app API, null in a browser
export const origin = app?.gateway?.signedIn && app.gateway.reachable !== false ? app.gateway.origin : "";
export const url = (path) => origin + path;
// The session is gone (401): a browser gets the gateway's sign-in page, the app its connect screen
export function signedOut() { if (app) app.signedOut(); else location.href = "/bots/"; }
