#!/usr/bin/env node
// Keep Playwright's own protocol and tool schemas. Its CDP connection is lazy;
// start the bot's browser immediately before the first tool call, not discovery.
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readBot } from "./metor-store.mjs";
import { resourceAlive } from "./metor-desktop.mjs";

const name = process.argv[2];
readBot(name); // Validate the bot before starting any child.
const child = spawn("playwright-mcp", process.argv.slice(3), { stdio: ["pipe", "pipe", "inherit"] });
child.stdout.pipe(process.stdout);
child.on("error", (e) => { console.error(e.message); process.exit(1); });
child.stdin.on("error", () => {});
child.on("exit", (code) => process.exit(code ?? 1));
let starting = null, ending = false;
async function ensureBrowser() {
  if (resourceAlive(readBot(name), "browser")) return Promise.resolve();
  return starting ??= (async () => {
    const deadline = Date.now() + 60_000;
    while (!ending) {
      try { await new Promise((resolve, reject) => {
    execFile(process.execPath, [fileURLToPath(new URL("./metor.mjs", import.meta.url)), "bot", "computer", name, "browser"],
      { timeout: 65_000 }, (err, out, stderr) => err ? reject(Object.assign(new Error(stderr.trim() || err.message), { code: err.code })) : resolve());
      }); return;
      } catch (e) { if (e.code !== 75 || Date.now() >= deadline) throw e; await new Promise(r => setTimeout(r, 2000)); }
    }
    throw new Error('Browser request cancelled');
  })().finally(() => { starting = null; });
}
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  let message; try { message = JSON.parse(line); } catch { child.stdin.write(line + "\n"); return; }
  if (message.method !== "tools/call") { child.stdin.write(line + "\n"); return; }
  ensureBrowser().then(() => { if (!ending) child.stdin.write(line + "\n"); }).catch((e) => {
    if (message.id != null) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id,
      result: { isError: true, content: [{ type: "text", text: `Could not start the browser: ${e.message}` }] } }) + "\n");
  });
});
function shutdown() { ending = true; child.stdin.end(); child.kill("SIGTERM"); setTimeout(() => { child.kill("SIGKILL"); process.exit(0); }, 1000).unref(); }
input.on("close", shutdown);
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
