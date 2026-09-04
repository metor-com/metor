// The app's data layer: which bot is selected (mirrored in the URL hash), the bot list, the live
// connection (one SSE stream) and the selected bot's chat entries and streaming text. Components
// read the stores and call the functions; App.svelte only wires layout and view state.
import { writable, derived, get } from "svelte/store";
import { listAgents, chatHistory, agentAction, chatInterrupt, chatRead } from "./api.js";
import { openEvents } from "./events.js";
import { settings } from "./settings.js";
import { app } from "./base.js";

const readHash = () => location.hash.replace(/^#\/?/, "") || null;

export const agents = writable([]);
export const pending = writable([]);          // just-created bots, until the agents event delivers them
export const selected = writable(readHash());
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
  refresh(); reconnect(); const n = get(selected); if (n) loadHistory(n);
  const onHash = () => { const name = readHash(); if (name !== get(selected)) activate(name); };
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
