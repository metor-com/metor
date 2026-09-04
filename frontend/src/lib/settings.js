// Per-device preferences (Settings → Appearance / Behaviour), kept in localStorage – they describe
// how THIS device shows the interface, like a messenger's settings. Missing storage (private
// window, blocked site data) simply means defaults.
import { writable } from "svelte/store";

const KEY = "metor.settings";
export const DEFAULTS = {
  sortByActivity: false,   // bot list: newest message first (messenger style) instead of alphabetical
  compactList: false,      // bot list: one line per bot, without the last message
  textSize: "default",     // small | default | large
  defaultView: "split",    // view a bot opens with on desktop: chat | split
  quota: "always",         // Claude quota bar in the bot list: always | threshold | never
  quotaThreshold: 80,      // with "threshold": show it from this usage (%) of the 5-hour or weekly window
};
export const ZOOM = { small: 0.9, default: 1, large: 1.15 };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}
export const settings = writable(load());
export function update(patch) {
  settings.update((s) => {
    const next = { ...s, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    return next;
  });
}
