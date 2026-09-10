<script>
  import { onDestroy, tick } from "svelte";
  import { chatCommands, chatInterrupt } from "../lib/api.js";
  import { gateway } from "../lib/base.js";
  import { settings, update } from "../lib/settings.js";
  import { METOR_COMMANDS, slashParts, matchingCommands, exactCommand } from "../lib/commands.js";
  export let bot, harnessLabel, status, text = "", onCommand, focusInput, hasAttachments = false;
  export let expanded = false, activeOption = undefined;
  let capabilities = { commands: [], models: [] }, error = "", loading = false;
  let selectedId = null, index = 0, dismissed = null, menuEl, generation = 0, requestId = 0;
  let lastBot, timer;
  $: context = `${$gateway?.origin ?? ""}/${bot}`;
  $: if (context !== lastBot) reset(context);
  function reset(next) {
    lastBot = next; generation++; requestId++; capabilities = { commands: [], models: [] };
    selectedId = null; error = ""; dismissed = null;
    clearInterval(timer); refresh(); timer = setInterval(refresh, 3000);
  }
  async function refresh() {
    const gen = generation, request = ++requestId, target = bot;
    loading = true;
    try {
      const result = await chatCommands(target);
      if (gen === generation && request === requestId) capabilities = result;
    } catch (e) {
      if (gen === generation && request === requestId) { capabilities = { commands: [], models: [] }; error = e.message; }
    } finally { if (gen === generation && request === requestId) loading = false; }
  }
  onDestroy(() => { generation++; clearInterval(timer); });
  $: commands = [...(["idle", "busy"].includes(status) ? capabilities.commands ?? [] : []), ...METOR_COMMANDS];
  $: parts = slashParts(text);
  $: exact = exactCommand(commands, text, selectedId);
  $: modelArgs = (parts?.argument ?? "").trim().split(/\s+/);
  $: chosenModel = exact?.action === "model" ? capabilities.models?.find((m) => m.id === modelArgs[0]) : null;
  $: choosingEffort = !!chosenModel?.reasoningEfforts?.length && /\s/.test(parts?.argument ?? "");
  $: choosingModel = exact?.action === "model" && parts?.argument !== null;
  $: options = choosingEffort
    ? chosenModel.reasoningEfforts.filter((e) => e.id.startsWith(modelArgs[1] ?? "")).map((e) => ({ ...e, effort: true, origin: "harness", label: e.label + (e.id === chosenModel.defaultReasoningEffort ? " (default)" : "") }))
    : choosingModel
    ? (capabilities.models ?? []).filter((m) => `${m.id} ${m.label}`.toLowerCase().includes((parts?.argument ?? "").toLowerCase())).map((m) => ({ ...m, model: true, origin: "harness", description: m.id }))
    : matchingCommands(commands, text);
  $: text, (index = 0), (error = "");
  $: if (dismissed !== null && dismissed !== text) dismissed = null;
  $: visible = parts && dismissed !== text && (choosingModel || parts.argument === null);
  $: if (index >= options.length) index = 0;
  $: expanded = !!visible;
  $: activeOption = visible && options.length ? `slash-option-${index}` : undefined;
  async function choose(option) {
    if (!option) return;
    if (option.effort) { text = `/${exact.name} ${chosenModel.id} ${option.id}`; dismissed = text; }
    else if (option.model) { text = `/${exact.name} ${option.id}${option.reasoningEfforts?.length ? " " : ""}`; dismissed = option.reasoningEfforts?.length ? null : text; }
    else { selectedId = option.id; text = `/${option.name} `; dismissed = option.action === "model" ? null : text; }
    await tick(); focusInput?.();
  }
  export function handleKey(e) {
    if (e.isComposing) return false;
    if (e.key === "Escape" && visible) { dismissed = text; e.preventDefault(); return true; }
    if (!visible || !options.length) return false;
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault(); index = (index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      tick().then(() => menuEl?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }));
      return true;
    }
    if ((e.key === "Tab" && !e.shiftKey) || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); choose(options[index]); return true; }
    return false;
  }
  // Called by Send too, so typing a whole command has exactly the same routing as picking it.
  export async function submit() {
    if (!slashParts(text.trim())) return false;
    const command = exactCommand(commands, text, selectedId);
    if (!command) { dismissed = null; error = "Choose an available command and its origin from the list."; return true; }
    if (hasAttachments) { error = "Send attachments in a separate message."; return true; }
    const argument = slashParts(text.trim())?.argument?.trim() ?? "";
    if (command.action === "model" && !chosenModel) {
      text = `/${command.name} `; selectedId = command.id; dismissed = null; return true;
    }
    if (command.action === "model" && chosenModel.reasoningEfforts?.length &&
        (modelArgs.length !== 2 || !chosenModel.reasoningEfforts.some((e) => e.id === modelArgs[1]))) {
      text = `/${command.name} ${chosenModel.id} `; dismissed = null; return true;
    }
    if (command.origin === "metor") {
      if (argument) { error = `/${command.name} does not take arguments.`; return true; }
      try {
        if (command.action === "steps") update({ showSteps: !$settings.showSteps });
        else if (command.action === "stop") await chatInterrupt(bot);
        text = ""; selectedId = null;
      } catch (e) { error = e.message; }
    } else await onCommand(command.id);
    return true;
  }
</script>

{#if visible}
  <div class="mx-3 mb-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg md:mx-4">
    <div class="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500">
      <span>{choosingEffort ? `Reasoning effort · ${chosenModel.label}` : choosingModel ? `Choose model${capabilities.currentModel ? ` · ${capabilities.currentModel}` : ''}` : 'Commands'}</span>
      <span>↑ ↓ · Tab · Enter · Esc</span>
    </div>
    <div id="chat-slash-options" role="listbox" aria-label={choosingEffort ? "Reasoning effort" : choosingModel ? "Models" : "Commands"} class="max-h-60 overflow-y-auto p-1" bind:this={menuEl}>
      {#each options as option, i (option.id)}
        <button type="button" role="option" aria-selected={index === i} data-index={i} id={`slash-option-${i}`}
          class="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-100 {index === i ? 'bg-zinc-100' : ''}"
          on:click={() => choose(option)}>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-zinc-900">{(option.model || option.effort) ? option.label : `/${option.name}`}{option.model && option.id === capabilities.currentModel ? ' ✓' : ''}</span>
            <span class="block text-xs text-zinc-500">{option.description}</span>
          </span>
          <span class="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium {option.origin === 'metor' ? 'bg-teal-50 text-teal-800' : 'bg-violet-50 text-violet-800'}">{option.origin === 'metor' ? 'metor' : harnessLabel ?? 'Runtime'}</span>
        </button>
      {/each}
      {#if !options.length}<p class="px-3 py-3 text-sm text-zinc-500">{loading ? 'Loading…' : 'No matching commands or models.'}</p>{/if}
    </div>
  </div>
{/if}
{#if error && parts}<p role="alert" class="mx-4 mb-2 text-sm text-red-700">{error}</p>{/if}
