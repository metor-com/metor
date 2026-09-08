// Pictures and files behind the sign-in when the interface runs inside the phone app (ADR-0015).
// There the interface sits on the app's own origin and the computer is a foreign site: the session
// travels as a bearer token that the app adds to fetch – but an <img> or a link is a load the
// WebView makes by itself, without the token, and it withholds the session cookie from such
// cross-site loads too (client/mobile/README.md, "Pictures and files"). So the app says
// `fetchMedia`: the interface fetches pictures itself (the app's fetch carries the token) and shows
// the blob, and a file is handed to the app, which downloads it with the token and opens it with
// the system viewer. In a browser and in the desktop app (its main process adds the token to every
// request) nothing changes: the URL goes into the picture, the link opens as before.
import { app } from "./base.js";
import { openDocument } from "./session.js";

const fetched = !!app?.fetchMedia;
const cache = new Map();   // picture URL → promise of an object URL, kept for the session (the newest 300)
// The pictures survive a reload of the interface (the switch to another computer) as data URLs in
// sessionStorage, so the list that slides in and the page that follows show them at first paint
const STORE = "metor:pictures", KEEP = 40, MAX_BYTES = 150_000;
let stored = {}; try { stored = JSON.parse(sessionStorage.getItem(STORE) || "{}"); } catch {}
for (const [u, d] of Object.entries(stored)) cache.set(u, Promise.resolve(d));
function keep(url, blob) {
  if (!fetched || blob.size > MAX_BYTES) return;
  const r = new FileReader();
  r.onload = () => {
    stored[url] = r.result; const keys = Object.keys(stored); while (keys.length > KEEP) delete stored[keys.shift()];
    try { sessionStorage.setItem(STORE, JSON.stringify(stored)); } catch { stored = { [url]: r.result }; try { sessionStorage.setItem(STORE, JSON.stringify(stored)); } catch {} }
  };
  r.readAsDataURL(blob);
}
function objectUrl(url) {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((b) => { keep(url, b); return URL.createObjectURL(b); });
    cache.set(url, p);
    p.catch(() => cache.delete(url));   // the next render tries again
    if (cache.size > 300) { const [old, q] = cache.entries().next().value; cache.delete(old); q.then((o) => URL.revokeObjectURL(o)).catch(() => {}); }
  }
  return p;
}

// Svelte action for a picture: `<img use:picture={url}>` – the URL itself, or the fetched blob inside the app
export function picture(img, url) {
  let want = null;
  const apply = (u) => {
    want = u;
    if (!u) { img.removeAttribute("src"); return; }
    if (!fetched) { img.src = u; return; }
    objectUrl(u).then((o) => { if (want === u) img.src = o; }).catch(() => { if (want === u) img.removeAttribute("src"); });
  };
  apply(url);
  return { update: apply, destroy: () => { want = null; } };
}

// A link to a file: inside the phone app the tap goes to the app (download with the token, system
// viewer); in a browser and in the desktop app the file opens in the document pane next to the chat
// (session.js). A middle click or "open in new tab" still gets the link itself.
export function openFile(e, url, name) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  if (app?.openFile) return app.openFile(url, name).catch((err) => alert(`Could not open ${name}: ${err?.message ?? err}`));
  openDocument(url, name);
}
