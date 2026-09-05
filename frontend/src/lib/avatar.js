// The bot's picture: an uploaded image (served by the bot's computer, cache-busted by its stamp) or,
// by default, initials on a colour. Initials come from the title, the colour from the name – both
// can be chosen when the bot is created and changed later by clicking the picture in the header.
import { url } from "./base.js";
export const PALETTE = ["#ff6b4a", "#ffb020", "#7cb342", "#1bc2b8", "#3b82f6", "#8b5cf6", "#e0459b", "#f43f5e"];
// First letter of up to three words: "Chief of Staff" → "COS", "Scout" → "S"
export function initialsOf(title) {
  const words = String(title ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 3).map((w) => [...w][0].toUpperCase()).join("");
}
export function colorFor(name) {
  let h = 0; for (const c of String(name ?? "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
// Dark text on light colours, white on dark ones
export function textOn(hex) {
  const n = parseInt(String(hex ?? "#000000").slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#18181b" : "#ffffff";
}
export const imageUrl = (a) => (a?.avatarAt ? url(`/bots/api/agents/${a.name}/avatar?v=${a.avatarAt}`) : null);
export const lookOf = (a) => ({ initials: a?.avatar?.initials || initialsOf(a?.title ?? a?.name) || "?", color: a?.avatar?.color || colorFor(a?.name ?? a?.title) });
