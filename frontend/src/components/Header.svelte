<script>
  // Header of the bot view: name, status, runtime · model, the computer toggle, stop button and the
  // actions (pause/start, remove) in a ⋮ menu at the far right.
  import { statusLabel } from "../lib/status.js";
  export let agent;                // the selected bot (from the agents list)
  export let pane = null;          // what is shown next to the chat (instead of it on a phone): "computer" | "routines" | null
  export let onToggleComputer;
  export let onBack;               // mobile: back to the bot list
  export let onToggleRoutines;
  export let onAct;                // ("start" | "stop" | "rm") => void
  export let onPicture;            // () => void – opens the picture dialog (initials, colour, image)
  import Avatar from "./Avatar.svelte";
  export let onInterrupt;          // stop the running turn

  let menuOpen = false;
  const viaMenu = (fn) => () => { menuOpen = false; fn(); };
</script>

<svelte:window on:click={() => (menuOpen = false)} />
<header class="flex shrink-0 items-center gap-x-2 border-b border-zinc-200 bg-white px-2.5 py-2.5 md:flex-wrap md:gap-x-4 md:gap-y-2 md:px-4">
  <button class="-my-1 shrink-0 rounded-lg px-2 py-1 text-xl text-zinc-500 hover:text-zinc-900 md:hidden"
    on:click={onBack} aria-label="Back to bots">←</button>
  <button type="button" class="shrink-0 rounded-full outline-none ring-zinc-400 hover:ring-2" title="Change the picture" aria-label="Change the picture" on:click={onPicture}><Avatar {agent} size={32} /></button>
  <div class="flex min-w-0 flex-1 items-baseline gap-2">
    <strong class="truncate text-base" title="id: {agent.name}">{agent.title ?? agent.name}</strong>
    <span class="hidden shrink-0 text-[13px] text-zinc-500 sm:inline">{statusLabel(agent.status)}</span>
    <span class="hidden shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500 md:inline" title="Runtime and model of this bot">{agent.harnessLabel ?? "Claude Code"} · {agent.modelLabel ?? "Default model"}</span>
  </div>
  <!-- The pane next to the chat: the bot's computer or its routines (one at a time) -->
  <div class="flex shrink-0 gap-1">
    <button type="button" class="flex size-9 items-center justify-center rounded-lg transition-colors {pane === 'computer' ? 'bg-zinc-900 text-white' : 'border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50'}"
      aria-label={pane === "computer" ? "Hide the bot's computer" : "Show the bot's computer"} aria-pressed={pane === "computer"} title={pane === "computer" ? "Hide the bot's computer" : "Show the bot's computer"} on:click={onToggleComputer}>
      <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
    </button>
    <button type="button" class="flex size-9 items-center justify-center rounded-lg transition-colors {pane === 'routines' ? 'bg-zinc-900 text-white' : 'border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50'}"
      aria-label={pane === "routines" ? "Hide the routines" : "Show the routines"} aria-pressed={pane === "routines"} title={pane === "routines" ? "Hide the routines" : "Show the routines"} on:click={onToggleRoutines}>
      <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><circle cx="16.5" cy="16.5" r="3" /><path d="M16.5 15v1.5l1 1" /></svg>
    </button>
  </div>
  {#if agent.status === "busy"}
    <button class="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 md:px-3.5" on:click={onInterrupt}>■ Stop</button>
  {/if}
  <!-- Bot actions (pause/start, remove) in the ⋮ menu at the far right, on every width -->
  <div class="relative shrink-0">
    <button type="button" class="flex size-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100" aria-label="More actions" title="More actions"
      on:click|stopPropagation={() => (menuOpen = !menuOpen)}>
      <svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
    </button>
    {#if menuOpen}
      <div class="absolute right-0 top-full z-20 mt-1.5 w-44 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
        {#if agent.status === "stopped"}
          <button class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={viaMenu(() => onAct("start"))}>Start</button>
        {:else}
          <button class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={viaMenu(() => onAct("stop"))}>Pause</button>
        {/if}
        <button class="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50" on:click={viaMenu(() => onAct("rm"))}>Remove</button>
      </div>
    {/if}
  </div>
</header>
