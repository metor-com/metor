#!/usr/bin/env node
// metor-routines-mcp – stdio MCP server "routines" for one bot (ADR-0010).
// Deliberately without an SDK dependency: newline-delimited JSON-RPC, only initialize/tools.
// argv[2] = bot name; writes/reads .metor/routines.json via metor-routines.mjs.
import { addRoutine, readRoutines, removeRoutine, updateRoutine } from "./metor-routines.mjs";

const BOTS_DIR = process.env.METOR_BOTS_DIR ?? "/workspace/bots";
const bot = process.argv[2];
if (!bot) { console.error("metor-routines-mcp <bot>"); process.exit(1); }

const TOOLS = [
  {
    name: "add_task",
    description: "Creates a recurring routine for this bot. At the scheduled time you receive the prompt as a message prefixed with [Routine \"<name>\"]. cron is a standard cron expression with 5 fields in box local time (e.g. \"0 7 * * *\" = daily at 07:00, \"*/30 8-18 * * 1-5\" = every 30 minutes on weekdays from 8 to 18h). Routines are permanent (no expiry date) and survive restarts.",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "Short display name of the routine (max. 60 characters)" },
      cron: { type: "string", description: "Cron expression, 5 fields, box local time" },
      prompt: { type: "string", description: "The task that arrives as a message on every run" },
    }, required: ["name", "cron", "prompt"] },
  },
  {
    name: "list_tasks",
    description: "Lists all routines of this bot (id, name, cron, prompt, last/next run).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_task",
    description: "Changes a routine by its id (from list_tasks): name, cron, prompt and/or enabled. enabled=false pauses, enabled=true resumes (from the next regular time; the pause time is not caught up). Only the fields passed are changed.",
    inputSchema: { type: "object", properties: {
      id: { type: "string" },
      name: { type: "string", description: "New display name (max. 60 characters)" },
      cron: { type: "string", description: "New cron expression, 5 fields, box local time" },
      prompt: { type: "string", description: "New task text" },
      enabled: { type: "boolean", description: "false = pause, true = resume" },
    }, required: ["id"] },
  },
  {
    name: "remove_task",
    description: "Deletes a routine of this bot by its id (from list_tasks). To merely pause it, use update_task with enabled=false.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

function call(name, args) {
  if (name === "add_task") return addRoutine(BOTS_DIR, bot, args ?? {});
  if (name === "list_tasks") return { routines: readRoutines(BOTS_DIR, bot) };
  if (name === "update_task") return updateRoutine(BOTS_DIR, bot, args ?? {});
  if (name === "remove_task") return removeRoutine(BOTS_DIR, bot, args?.id);
  return { error: `unknown tool: ${name}` };
}

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const replyError = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");

let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, { protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} }, serverInfo: { name: "metor-routines", version: "1.0.0" } });
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return; // no reply to notifications
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call") {
    let out;
    try { out = call(params?.name, params?.arguments); } catch (e) { out = { error: e.message }; }
    return reply(id, { content: [{ type: "text", text: JSON.stringify(out) }], isError: !!out?.error });
  }
  if (id !== undefined) replyError(id, -32601, `Method not supported: ${method}`);
}
process.stdin.on("end", () => process.exit(0));
