<script>
  // One line for a step a bot took: what it does in the device's language when the host summarised
  // it (tool.step, knowledge/design/working-view.md), otherwise the tool's name and its raw input
  import { stepLine } from "../lib/i18n.js";
  export let tool;               // the entry's tool: { name, detail, step? }
  export let text = "";          // the entry's text – the fallback when there is no tool
  export let showDetail = true;  // the raw input next to the name (off while the card is open)
  $: line = stepLine(tool?.step, tool?.name ?? text);
</script>

{#if line}
  <span class="min-w-0 truncate">{line.pre}<span class={line.mono ? "font-mono text-[11.5px]" : "text-zinc-500"}>{line.subject}</span>{line.post}</span>
{:else}
  <span class="shrink-0 font-semibold">{tool?.name ?? text}</span>
  {#if tool?.detail && showDetail}<span class="min-w-0 truncate font-mono text-[11.5px]">{tool.detail}</span>{/if}
{/if}
