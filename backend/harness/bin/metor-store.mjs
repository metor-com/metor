// metor-store – the bot store: one directory per bot under BOTS_DIR with a bot.json (name, role,
// harness, model, display, watchToken, autostart, …). Shared by the CLI, the desktop chain, the
// supervisor and the gateway; errors are thrown (the CLI turns them into exit messages).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const BOTS_DIR = process.env.METOR_BOTS_DIR ?? "/workspace/bots";
// Templates: next to the code in the image, in the repository when run from a checkout
export const TEMPLATES = process.env.METOR_TEMPLATES_DIR
  ?? (process.env.METOR_INSIDE_BOX === "1" ? "/usr/local/lib/metor/templates" : join(dirname(fileURLToPath(import.meta.url)), "..", "templates"));
// Gateway routes /bots/api/… and /bots/assets/… must never be shadowed by a bot
export const RESERVED_NAMES = new Set(["api", "assets"]);
export const isValidName = (n) => typeof n === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(n) && !RESERVED_NAMES.has(n);

export function botDir(name) {
  if (!isValidName(name)) throw new Error(`invalid bot name: ${name} (a-z, 0-9, -; reserved: ${[...RESERVED_NAMES].join(", ")})`);
  return join(BOTS_DIR, name);
}
export function readBot(name) {
  const p = join(botDir(name), "bot.json");
  if (!existsSync(p)) throw new Error(`Bot ${name} does not exist`);
  return JSON.parse(readFileSync(p, "utf8"));
}
export function writeBot(bot) { writeFileSync(join(botDir(bot.name), "bot.json"), JSON.stringify(bot, null, 2) + "\n"); }
// Tolerant: a half-written or broken bot.json must not take down list, supervisor or gateway
export function allBots() {
  if (!existsSync(BOTS_DIR)) return [];
  return readdirSync(BOTS_DIR).flatMap((n) => { try { return isValidName(n) ? [readBot(n)] : []; } catch { return []; } });
}
