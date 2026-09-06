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

const fetched = !!app?.fetchMedia;
const cache = new Map();   // picture URL → promise of an object URL, kept for the session (the newest 300)
function objectUrl(url) {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((b) => URL.createObjectURL(b));
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

// A link to a file: inside the app the tap goes to the app (download with the token, system viewer);
// elsewhere the link works as it is (a new tab on the same origin, with the session cookie)
export function openFile(e, url, name) {
  if (!app?.openFile) return;
  e.preventDefault();
  app.openFile(url, name).catch((err) => alert(`Could not open ${name}: ${err?.message ?? err}`));
}
