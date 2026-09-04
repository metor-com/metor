// metor-host-claude – Claude Code adapter (Agent SDK) for the neutral host core (ADR-0011).
// Contains SDK vocabulary exclusively: query() options, canUseTool, the message types and
// the quota from rate_limit_event. All file IPC lives in the core (metor-host-core.mjs).
// SDK resume keeps session ID AND context (claude-code-facts.md) – restarts are lossless.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_HOWTO } from "./metor-host-core.mjs";
import { claudeAllowedTools } from "./metor-connectors.mjs";

export async function run(core) {
  const { name, dir, bot } = core;
  let watchUrl = ""; try { watchUrl = readFileSync(join(core.metorDir, "watch-url"), "utf8").trim(); } catch {}
  const toolDetail = (n, input) => n === "Bash" ? String(input?.command ?? "").slice(0, 200) : JSON.stringify(input ?? {}).slice(0, 200);

  async function canUseTool(toolName, input, { title, decisionReason, signal } = {}) {
    const decision = await core.askPermission(toolName, { title, reason: decisionReason, input, signal });
    return decision === "allow"
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "Denied by the user in the metor interface.", interrupt: false };
  }

  async function* sdkStream() {
    for await (const t of core.turns()) {
      yield { type: "user", message: { role: "user", content: [{ type: "text", text: t.text }] }, parent_tool_use_id: null };
    }
  }

  const q = query({
    prompt: sdkStream(),
    options: {
      cwd: dir,
      permissionMode: bot.permissionMode ?? "acceptEdits",
      includePartialMessages: true,                       // token streaming for the UI (partial.json)
      settingSources: ["user", "project", "local"],      // 'project' loads CLAUDE.md + .claude/settings.json (hooks!)
      systemPrompt: { type: "preset", preset: "claude_code", append: CHAT_HOWTO },
      title: name,
      ...(bot.model ? { model: bot.model } : {}),         // model choice per bot (ADR-0011)
      extraArgs: { name, ...(existsSync(join(dir, "mcp.json")) ? { "mcp-config": join(dir, "mcp.json") } : {}) },
      ...((a) => (a.length ? { allowedTools: a } : {}))(claudeAllowedTools(bot)),   // connectors without "ask first" (ADR-0014)
      ...(core.state.sessionId ? { resume: core.state.sessionId } : {}),
      env: { ...process.env, METOR_BOT: name, METOR_WATCH_URL: watchUrl },
      canUseTool,
    },
  });
  core.setInterruptHandler(() => q.interrupt?.());
  core.onShutdown(() => { try { q.close(); } catch {} });

  const toolEntries = new Map();   // tool_use_id → chat entry ID (for result patches)
  let lastQuota = null;            // last rate_limit state (quota display in the dock)

  core.ready();
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init") {
      if (m.session_id && m.session_id !== core.state.sessionId) core.log("Session:", m.session_id);
      if (Array.isArray(m.mcp_servers) && m.mcp_servers.length) core.log("MCP:", m.mcp_servers.map((x) => `${x.name} ${x.status}`).join(", "));
      core.saveState({ sessionId: m.session_id, status: core.state.status === "starting" ? "idle" : core.state.status });
    } else if (m.type === "stream_event") {
      const ev = m.event;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") core.partialAppend(ev.delta.text);
    } else if (m.type === "assistant") {
      for (const c of m.message?.content ?? []) {
        if (c.type === "text") core.emitText(c.text);
        else if (c.type === "tool_use") {
          const entryId = core.emitTool(c.name, toolDetail(c.name, c.input));
          toolEntries.set(c.id, entryId);
          if (toolEntries.size > 200) toolEntries.delete(toolEntries.keys().next().value);
        }
      }
    } else if (m.type === "user") {
      // Attach tool results as a patch to the tool entry (expandable details in the UI)
      for (const c of m.message?.content ?? []) {
        if (c.type !== "tool_result" || !toolEntries.has(c.tool_use_id)) continue;
        const raw = Array.isArray(c.content) ? c.content.map((x) => x?.text ?? `[${x?.type}]`).join(" ") : String(c.content ?? "");
        core.patchTool(toolEntries.get(c.tool_use_id), raw);
        toolEntries.delete(c.tool_use_id);
      }
    } else if (m.type === "rate_limit_event") {
      const w = m.rate_limit_info?.unifiedWindows ?? {};
      lastQuota = { fiveHour: w.five_hour?.utilization ?? null, sevenDay: w.seven_day?.utilization ?? null,
        resetsAt: m.rate_limit_info?.resetsAt ?? null };
    } else if (m.type === "result") {
      core.partialClear();
      core.saveState({ status: "idle", ...(lastQuota ? { quota: lastQuota } : {}) });
    }
    // thinking etc. stay invisible
  }
  core.log("Session stream ended");
  core.saveState({ status: "stopped" });
  process.exit(0);
}
