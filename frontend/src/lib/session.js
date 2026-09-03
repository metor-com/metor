// The app's data layer: which bot is selected (mirrored in the URL hash), the bot list, the live
// connection (one SSE stream) and the selected bot's chat entries and streaming text. Components
// read the stores and call the functions; App.svelte only wires layout and view state.
import { writable, derived, get } from "svelte/store";
import { listAgents, chatHistory, agentAction, chatInterrupt } from "./api.js";
import { openEvents } from "./events.js";

const readHash = () => location.hash.replace(/^#\/?/, "") || null;

export const agents = writable([]);
export const pending = writable([]);          // just-created bots, until the agents event delivers them
export const selected = writable(readHash());
export const entries = writable([]);          // chat history of the selected bot, patches folded in
export const partial = writable(null);        // streaming text of the running answer

export const shown = derived([agents, pending], ([a, p]) => [...a, ...p.filter((x) => !a.some((y) => y.name === x.name))]);
export const current = derived([shown, selected], ([s, n]) => s.find((a) => a.name === n) ?? null);
export const quota = derived(shown, (s) => s.find((a) => a.quota)?.quota ?? null);   // identical account-wide – the first value is enough

let closeEvents = null;

export async function refresh() { try { agents.set(await listAgents()); } catch {} }
async function loadHistory(name) {
  try { const h = await chatHistory(name); if (get(selected) === name) entries.set(h); } catch {}
}
function reconnect() {
  closeEvents?.();
  const name = get(selected);
  closeEvents = openEvents({
    topics: ["agents", ...(name ? [`chat:${name}`] : [])],
    onAgents: (list) => { agents.set(list); pending.update((p) => p.filter((x) => !list.some((a) => a.name === x.name))); },
    onChat: ({ bot, entry }) => { if (bot === get(selected)) applyEntry(entry); },
    onOpen: () => { refresh(); const n = get(selected); if (n) loadHistory(n); },
  });
}
function activate(name) {
  selected.set(name);
  entries.set([]);
  partial.set(null);
  reconnect();
  if (name) loadHistory(name);
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
export function created(name) { pending.update((p) => [...p, { name, role: "", status: "setting up" }]); select(name); }
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
  const onVisibility = () => { if (document.visibilityState === "hidden") { closeEvents?.(); closeEvents = null; } else if (!closeEvents) reconnect(); };
  document.addEventListener("visibilitychange", onVisibility);
  return () => { closeEvents?.(); closeEvents = null; window.removeEventListener("hashchange", onHash); document.removeEventListener("visibilitychange", onVisibility); };
}
