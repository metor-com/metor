// Session capabilities, shared by the hosts and gateway. No terminal command catalogue.
export function nativeCommands(list = []) {
  return [...new Map(list.flatMap((c) => [c, ...(Array.isArray(c?.aliases) ? c.aliases.map((name) => ({ ...c, name, aliases: [] })) : [])]).filter((c) => typeof c?.name === "string" && /^[\w:.-]+$/.test(c.name.replace(/^\//, "")))
    .map((c) => {
      const name = c.name.replace(/^\//, "");
      return [name, { id: `harness:${name}`, name, origin: "harness", action: "prompt",
        description: String(c.description ?? "Runtime command").slice(0, 500),
        hint: String(c.input?.hint ?? c.argumentHint ?? "").slice(0, 200) }];
    })).values()];
}
export function commandCatalogue(commands, models) {
  const out = nativeCommands(commands);
  if (models?.length) {
    // Keep the advertised spelling, including /models. The adapter owns the picker action.
    const names = out.filter((c) => ["model", "models"].includes(c.name)).map((c) => c.name);
    for (const name of names.length ? names : ["model"]) {
      const at = out.findIndex((c) => c.name === name);
      const entry = { id: `harness:${name}`, name, origin: "harness", action: "model", description: "Choose the model for subsequent messages", hint: "model" };
      if (at >= 0) out[at] = entry; else out.unshift(entry);
    }
  }
  return out;
}
export function resolveCommand(capabilities, id, text) {
  const command = capabilities?.commands?.find((c) => c.id === id);
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(String(text).trim());
  if (!command || !match || match[1] !== command.name) throw new Error("This command is no longer available. Reopen the command list.");
  const argument = (match[2] ?? "").trim();
  if (command.action === "model") {
    const [modelId, requestedEffort, ...extra] = argument.split(/\s+/);
    const model = capabilities.models?.find((m) => m.id === modelId);
    if (!model) throw new Error("Choose a model from this session’s list.");
    const efforts = model.reasoningEfforts ?? [];
    if (extra.length || (requestedEffort && !efforts.some((e) => e.id === requestedEffort))) throw new Error("Choose a reasoning effort supported by this model.");
    const effort = requestedEffort ?? model.defaultReasoningEffort ?? null;
    return { ...command, argument: modelId, effort };
  }
  return { ...command, argument };
}

// ACP v1 configOptions supersede the older models field; accept both from the actual session.
export function acpModelConfig(result) {
  const option = result?.configOptions?.find((o) => o.type === "select" && (o.category === "model" || o.id === "model"));
  if (option) return { configId: option.id, current: option.currentValue,
    models: (option.options ?? []).flatMap((o) => o.options ?? [o]).filter((o) => typeof o.value === "string").map((o) => ({ id: o.value, label: o.name ?? o.value })) };
  if (result?.models) return { configId: null, current: result.models.currentModelId,
    models: (result.models.availableModels ?? []).map((m) => ({ id: m.modelId, label: m.name ?? m.modelId })) };
  return null;
}
export function attachAcpCommands(core, send, session) {
  let commands = [], config = null;
  const publish = () => core.setCapabilities(commands, config?.models ?? [], config?.current);
  return {
    update(u) {
      if (u?.sessionUpdate === "available_commands_update") { commands = u.availableCommands ?? []; publish(); return true; }
      if (u?.sessionUpdate === "config_option_update") { config = acpModelConfig(u); publish(); return true; }
      if (u?.sessionUpdate === "current_model_update") { if (config) config.current = u.currentModelId; publish(); return true; }
      return false;
    },
    init(result) { config = acpModelConfig(result) ?? config; publish(); },
    async setModel(model) {
      const res = await send(config.configId ? "session/set_config_option" : "session/set_model", {
        sessionId: session(), ...(config.configId ? { configId: config.configId, value: model } : { modelId: model }),
      });
      if (res.error) throw new Error(res.error.message ?? "Model change failed");
      const next = acpModelConfig(res.result);
      if (next && next.current !== model) throw new Error("The runtime did not accept the selected model.");
      config = next ?? { ...config, current: model }; publish();
    },
  };
}
