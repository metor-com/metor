// metor-store – the bot store: one directory per bot under BOTS_DIR with a bot.json (name, role,
// harness, model, display, watchToken, autostart, …). Shared by the CLI, the desktop chain, the
// supervisor and the gateway; errors are thrown (the CLI turns them into exit messages).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const BOTS_DIR = process.env.METOR_BOTS_DIR ?? "/workspace/bots";
// Templates: next to the code in the image, in the repository when run from a checkout
export const TEMPLATES = process.env.METOR_TEMPLATES_DIR
  ?? (process.env.METOR_INSIDE_BOX === "1" ? "/usr/local/lib/metor/templates" : join(dirname(fileURLToPath(import.meta.url)), "..", "templates"));
// Gateway routes /bots/api/… and /bots/assets/… must never be shadowed by a bot
export const RESERVED_NAMES = new Set(["api", "assets"]);
export const isValidName = (n) => typeof n === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(n) && !RESERVED_NAMES.has(n);
// The title is what people see (sidebar, header, notifications, the bot's own instructions);
// the name is the id behind it (directory, API paths, addressing between bots)
export const isValidTitle = (t) => typeof t === "string" && t.trim().length >= 1 && t.trim().length <= 60 && !/\p{Cc}/u.test(t);
const TRANSLIT = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "æ": "ae", "ø": "oe", "å": "aa" };
// Title → id: DNS-label rules (RFC 1123 – the same class of names Docker and Kubernetes use), like
// the "slugify" of Django or WordPress: lower case, German umlauts transliterated the German way,
// other accents stripped, every other run of characters a hyphen, at most 40 characters.
// Mirrored in frontend/src/lib/slug.js. idFor() adds the two edge cases: an empty result (an
// emoji-only title) gets a random id, a reserved word is an error – "api" must not silently become bot-1a2b.
export function slugify(title) {
  let s = String(title ?? "").toLowerCase().replace(/[äöüßæøå]/g, (c) => TRANSLIT[c]);
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}
export function idFor(title) {
  const s = slugify(title);
  if (RESERVED_NAMES.has(s)) throw new Error(`"${s}" is reserved (${[...RESERVED_NAMES].join(", ")}) – choose another name`);
  return s || `bot-${randomBytes(2).toString("hex")}`;
}

export function botDir(name) {
  if (!isValidName(name)) throw new Error(`invalid bot id: ${name} (a-z, 0-9, -; reserved: ${[...RESERVED_NAMES].join(", ")})`);
  return join(BOTS_DIR, name);
}
export function readBot(name) {
  const p = join(botDir(name), "bot.json");
  if (!existsSync(p)) throw new Error(`Bot ${name} does not exist`);
  const b = JSON.parse(readFileSync(p, "utf8"));
  b.title ??= b.name;   // bots created before titles existed
  return b;
}
export function writeBot(bot) { writeFileSync(join(botDir(bot.name), "bot.json"), JSON.stringify(bot, null, 2) + "\n"); }
// Tolerant: a half-written or broken bot.json must not take down list, supervisor or gateway
export function allBots() {
  if (!existsSync(BOTS_DIR)) return [];
  return readdirSync(BOTS_DIR).flatMap((n) => { try { return isValidName(n) ? [readBot(n)] : []; } catch { return []; } });
}
