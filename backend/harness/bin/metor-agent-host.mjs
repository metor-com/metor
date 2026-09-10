#!/usr/bin/env node
// metor-agent-host – THE host process of a bot (one per bot, ADR-0009/0011).
// Since ADR-0011 only entry point + dispatcher: the neutral core (metor-host-core.mjs)
// owns the file IPC (inbox/chat/harness/partial), the registry (metor-harness.mjs)
// supplies the matching adapter (Claude Agent SDK, Codex app-server, …).
// IMPORTANT: script name + bot name on the command line are the liveness proof for
// hostAlive()/double-start protection – this script therefore remains the only entry point.
import { createCore } from "./metor-host-core.mjs";
import { fileURLToPath } from "node:url";
import { manageRuntime } from "./metor-runtime-manager.mjs";
import { hostPidMatches } from "./metor-lifecycle.mjs";
import { HARNESSES } from "./metor-harness.mjs";

const name = process.argv[2];
if (!name) { console.error("metor-agent-host <bot>"); process.exit(1); }

if (process.argv[3] === "--worker") {
  const parentPid = Number(process.env.METOR_RUNTIME_PARENT);
  if (!parentPid || parentPid !== process.ppid) throw new Error("Runtime worker requires its host");
  const core = createCore(name, { parentPid });
  const desc = HARNESSES[core.bot.harness ?? "claude-stream"];
  if (!desc) core.fail(new Error("Unknown runtime"));
  const orphanCheck = setInterval(() => {
    if (!hostPidMatches({ name }, parentPid)) process.kill(process.pid, "SIGTERM");
  }, 1000);
  core.onShutdown(() => clearInterval(orphanCheck));
  const { run } = await import(desc.adapterModule);
  run(core).catch((e) => core.fail(e));
} else {
  await manageRuntime(name, fileURLToPath(import.meta.url));
}
