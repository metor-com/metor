#!/usr/bin/env node
// The runtimes the box carries – Claude Agent SDK, Codex CLI, Gemini CLI – are pinned in
// backend/box/Dockerfile. Their protocols are verified per version (knowledge/harness/), so a
// bump is a deliberate step, but a forgotten one holds back new models (Codex's model list is the
// CLI's own catalogue). This prints pinned against npm's latest, and rewrites the pins on request:
//   node scripts/runtime-versions.mjs          the table
//   node scripts/runtime-versions.mjs --bump   rewrite the pins, print what changed
// .github/workflows/runtimes.yml runs it weekly and opens a pull request with the bump.
import { readFileSync, writeFileSync } from "node:fs";
const FILE = new URL("../backend/box/Dockerfile", import.meta.url);
const PACKAGES = { "@anthropic-ai/claude-agent-sdk": "Claude Agent SDK", "@openai/codex": "Codex CLI", "@google/gemini-cli": "Gemini CLI" };
let text = readFileSync(FILE, "utf8");
const pinned = (pkg) => text.match(new RegExp(`${pkg.replace(/[/.]/g, "\\$&")}@([0-9][\\w.+-]*)`))?.[1] ?? null;
async function latest(pkg) {
  const r = await fetch(`https://registry.npmjs.org/${pkg}/latest`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${pkg}: HTTP ${r.status} from npm`);
  return (await r.json()).version;
}
const bump = process.argv.includes("--bump"), changes = [];
for (const [pkg, label] of Object.entries(PACKAGES)) {
  const cur = pinned(pkg), next = await latest(pkg);
  console.log(`${label.padEnd(17)} ${pkg.padEnd(33)} pinned ${String(cur).padEnd(9)} latest ${next.padEnd(9)} ${!cur ? "unpinned" : cur === next ? "current" : "behind"}`);
  if (bump && cur && cur !== next) { text = text.replace(`${pkg}@${cur}`, `${pkg}@${next}`); changes.push(`${label} ${cur} → ${next}`); }
}
if (bump) { writeFileSync(FILE, text); console.log(changes.length ? `bumped: ${changes.join(", ")}` : "nothing to bump"); }
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changes=${changes.join(", ")}\n`, { flag: "a" });
