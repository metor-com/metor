#!/usr/bin/env node
// metor-agent-host – THE host process of a bot (one per bot, ADR-0009/0011).
// Since ADR-0011 only entry point + dispatcher: the neutral core (metor-host-core.mjs)
// owns the file IPC (inbox/chat/harness/partial), the registry (metor-harness.mjs)
// supplies the matching adapter (Claude Agent SDK, Codex app-server, …).
// IMPORTANT: script name + bot name on the command line are the liveness proof for
// hostAlive()/double-start protection – this script therefore remains the only entry point.
import { createCore } from "./metor-host-core.mjs";
import { HARNESSES } from "./metor-harness.mjs";

const name = process.argv[2];
if (!name) { console.error("metor-agent-host <bot>"); process.exit(1); }

const core = createCore(name);
const harness = core.bot.harness ?? "claude-stream";
const desc = HARNESSES[harness];
if (!desc) core.fail(new Error(`unknown harness "${harness}" – no host adapter in the registry`));

const { run } = await import(desc.adapterModule);
run(core).catch((e) => core.fail(e));
