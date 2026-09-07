// The app's data layer: which bot is selected (mirrored in the URL hash), the bot list, the live
// connection (one SSE stream) and the selected bot's chat entries and streaming text. Components
// read the stores and call the functions; App.svelte only wires layout and view state.
import { writable, derived, get } from "svelte/store";
import { listAgents, chatHistory, agentAction, chatInterrupt, chatRead, fileUrl } from "./api.js";
import { openEvents } from "./events.js";
import { settings } from "./settings.js";
import { app } from "./base.js";

// The hash: `#/<bot>` is the selected bot, `#/computers` the overview of the connected computers
// (native clients with several of them, knowledge/design/several-computers.md), `#/connect…` the
// connect screen opened from the shell to add a computer. The two views are history entries, so the
// back gesture on a phone returns from them; they leave the selected bot alone (on the desktop the
// chat stays next to the overview).
// `#/<bot>?doc=<path>` opens that bot with one of its files in the document pane (a link to a file)
const parseHash = () => {
  const [h, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  return { bot: h === "computers" || h.startsWith("connect") ? undefined : h || null, computers: h === "computers", connect: h.startsWith("connect"),
    doc: new URLSearchParams(query).get("doc") };
};
const readHash = () => { const h = parseHash(); return h.bot === undefined ? null : h.bot; };

export const agents = writable([]);
export const pending = writable([]);          // just-created bots, until the agents event delivers them
export const selected = writable(readHash());
export const computersOpen = writable(parseHash().computers);   // the overview of the computers instead of the bot list
export const connectOpen = writable(parseHash().connect);       // the connect screen over the shell ("Connect a bots' computer…")
// The computers this app is connected to (window.metor.gateways(); a browser knows only its own and
// gets an empty list). Loaded at start for the head of the bot list, probed by the overview.
export const computers = writable([]);
export async function loadComputers(opts = null) {
  if (!app?.gateways) return [];
  try { const list = (await app.gateways(opts ?? undefined)) ?? []; computers.set(list); return list; } catch { return get(computers); }
}
app?.onComputers?.((list) => { if (Array.isArray(list)) computers.set(list); });   // desktop: live counts from the app's own watch
export function openComputers() { location.hash = "#/computers"; }
export function openConnect(step = null) { location.hash = step ? `#/connect/${step}` : "#/connect"; }
// Leave the overview or the connect screen: back to the selected bot (desktop) or the list (phone),
// without touching the selection – a plain hash change would deselect the bot
export function closeView() {
  const name = get(selected);
  history.replaceState(null, "", name ? `#/${name}` : location.pathname + location.search);
  computersOpen.set(false); connectOpen.set(false);
}
// A file a bot made, shown next to the chat (App.svelte's document pane) instead of a new tab: in the
// desktop app a new tab would be the system browser, which has no session. { url, name, bot }
export const shownDocument = writable(null);
export function openDocument(url, name) { shownDocument.set({ url, name: name || url.split("/").pop(), bot: get(selected) }); }
const openDocumentFromHash = (h) => { if (h.doc && h.bot) openDocument(fileUrl(h.bot, h.doc), h.doc.split("/").pop()); };
export function closeDocument() { shownDocument.set(null); }
export const entries = writable([]);          // chat history of the selected bot, patches folded in
export const partial = writable(null);        // streaming text of the running answer

export const shown = derived([agents, pending, settings], ([a, p, s]) => {
  const list = [...a, ...p.filter((x) => !a.some((y) => y.name === x.name))];
  // Messenger order (Settings → Behaviour): newest chat activity first; otherwise the gateway's alphabetical order
  return s.sortByActivity ? [...list].sort((x, y) => (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0) || x.name.localeCompare(y.name)) : list;
});
export const current = derived([shown, selected], ([s, n]) => s.find((a) => a.name === n) ?? null);
export const quota = derived(shown, (s) => s.find((a) => a.quota)?.quota ?? null);   // identical account-wide – the first value is enough

let closeEvents = null, inBackground = false;

export async function refresh() { try { agents.set(await listAgents()); } catch {} }
async function loadHistory(name) {
  try { const h = await chatHistory(name); if (get(selected) === name) entries.set(h); } catch {}
}
// Desktop app: the gateway's notifications (approval needed, reply finished, unexpected stop) arrive
// on the stream as well and become native notifications – unless this window shows that chat right now.
// In the background the app keeps a stream with only that topic, so the gateway does not count it as
// a viewer (the phone still gets its push) while the desktop still gets told.
const onNotify = app ? (n) => { if (document.hasFocus() && document.visibilityState === "visible" && n.bot === get(selected)) return; app.notify(n); } : null;
function reconnect(background = false) {
  closeEvents?.();
  const name = get(selected);
  inBackground = background;
  closeEvents = openEvents({
    topics: background ? ["notify"] : ["agents", ...(name ? [`chat:${name}`] : []), ...(app ? ["notify"] : [])],
    onAgents: (list) => { agents.set(list); pending.update((p) => p.filter((x) => !list.some((a) => a.name === x.name))); },
    onChat: ({ bot, entry }) => { if (bot === get(selected)) { applyEntry(entry); if (entry.role === "assistant") markRead(bot); } },
    onNotify,
    onOpen: background ? null : () => { refresh(); const n = get(selected); if (n) loadHistory(n); },
  });
}
// Read marks (unread badge in the bot list): the open chat counts as read whenever the page is
// visible – on selection, on every new entry, on return to the foreground. Optimistic locally,
// the gateway confirms through the next agents event.
let readTimer = null;
function markRead(name) {
  if (!name || document.visibilityState === "hidden") return;
  agents.update((list) => list.map((a) => (a.name === name && a.unread ? { ...a, unread: 0 } : a)));
  clearTimeout(readTimer);
  readTimer = setTimeout(() => { chatRead(name).catch(() => {}); }, 300);
}
function activate(name) {
  selected.set(name);
  entries.set([]);
  partial.set(null);
  reconnect();
  if (name) { loadHistory(name); markRead(name); }
}
// Select a bot (null = overview); the hash makes it a history entry for the back gesture on mobile
export function select(name) {
  location.hash = name ? `#/${name}` : "";
  activate(name);
}
// Apply a live event or a locally produced entry (ChatView adds the user's own message this way)
export function applyEntry(entry) {
  if (entry.type === "partial") { partial.set(entry.text); return; }
  if (entry.type === "status") {
    entries.update((list) => list.map((e) => (e.id === entry.ref ? { ...e, status: entry.status, error: entry.error } : e)));
  } else if (entry.type === "patch") {
    entries.update((list) => list.map((e) => (e.id === entry.ref
      ? { ...e,
          ...(entry.permission ? { permission: { ...e.permission, ...entry.permission } } : {}),
          ...(entry.tool ? { tool: { ...e.tool, ...entry.tool } } : {}) }
      : e)));
  } else {
    entries.update((list) => (list.some((e) => e.id === entry.id) ? list : [...list, entry]));
  }
}
export function created(name, title) { pending.update((p) => [...p, { name, title: title ?? name, role: "", status: "setting up" }]); select(name); }
export const act = (action) => agentAction(get(selected), action);   // start | stop
export async function remove() { await agentAction(get(selected), "rm"); select(null); }
export const interrupt = () => chatInterrupt(get(selected));

// Start the live connection and follow the hash (back gesture/button on mobile); returns the stop function
export function connect() {
  refresh(); reconnect(); loadComputers(); const n = get(selected); if (n) loadHistory(n);
  openDocumentFromHash(parseHash());
  const onHash = () => {
    const h = parseHash(); computersOpen.set(h.computers); connectOpen.set(h.connect);
    if (h.bot !== undefined && h.bot !== get(selected)) activate(h.bot);
    openDocumentFromHash(h);
  };
  window.addEventListener("hashchange", onHash);
  // App in the background (phone in the pocket, other tab): no stream. The gateway then knows this
  // device is not looking and sends push notifications instead; on return the stream reconnects and refetches.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") { if (app) reconnect(true); else { closeEvents?.(); closeEvents = null; } }
    else { if (!closeEvents || inBackground) reconnect(); markRead(get(selected)); }
  };
  document.addEventListener("visibilitychange", onVisibility);
  app?.onOpenBot((bot) => { if (bot && bot !== get(selected)) select(bot); });   // a tap on a native notification
  return () => { closeEvents?.(); closeEvents = null; window.removeEventListener("hashchange", onHash); document.removeEventListener("visibilitychange", onVisibility); };
}
