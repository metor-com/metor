// Per-device preferences (Settings → Appearance / Behaviour), kept in localStorage – they describe
// how THIS device shows the interface, like a messenger's settings. Missing storage (private
// window, blocked site data) simply means defaults.
import { writable } from "svelte/store";

const KEY = "metor.settings";
export const DEFAULTS = {
  sortByActivity: false,   // bot list: newest message first (messenger style) instead of alphabetical
  compactList: false,      // bot list: one line per bot, without the last message
  textSize: "default",     // small | default | large
  defaultView: "split",    // a bot opens with the computer shown ("split") or chat only ("chat"); desktop only
  syncScreenClipboard: true, // desktop only; while the screen has focus
  autoResizeScreen: true,  // adapt the remote screen to this device’s panel; off keeps its current resolution
  splitRatio: 0.5,         // share of the width the chat takes when the computer is shown (the divider is draggable)
  quota: "always",         // Claude quota bar in the bot list: always | threshold | never
  quotaThreshold: 80,      // with "threshold": show it from this usage (%) of the 5-hour or weekly window
  showSteps: false,       // chat: every step a bot took as a card (Show steps in the chat's ⋮ menu) instead of one folded line per run
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
