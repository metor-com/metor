<script>
  // Header of the bot view: name, status, runtime · model, view tabs, stop button and the
  // actions (routines, start/pause, remove) – as buttons on desktop, in a ⋯ menu on mobile.
  import { statusLabel } from "../lib/status.js";
  export let agent;                // the selected bot (from the agents list)
  export let view = "split";       // effective view: chat | computer | split
  export let showRoutines = false;
  export let onView;               // (view) => void
  export let onBack;               // mobile: back to the bot list
  export let onToggleRoutines;
  export let onAct;                // ("start" | "stop" | "rm") => void
  export let onInterrupt;          // stop the running turn

  let menuOpen = false;
  // reactive ($:), not const: the class string depends on `view`, but the template only sees `tab`
  $: tab = (v) => `rounded-lg px-3 py-1.5 text-sm transition-colors md:px-3.5 ${view === v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`;
  const viaMenu = (fn) => () => { menuOpen = false; fn(); };
</script>

<svelte:window on:click={() => (menuOpen = false)} />
<header class="flex shrink-0 items-center gap-x-2 border-b border-zinc-200 bg-white px-2.5 py-2.5 md:flex-wrap md:gap-x-4 md:gap-y-2 md:px-4">
  <button class="-my-1 shrink-0 rounded-lg px-2 py-1 text-xl text-zinc-500 hover:text-zinc-900 md:hidden"
    on:click={onBack} aria-label="Back to bots">←</button>
  <div class="flex min-w-0 flex-1 items-baseline gap-2">
    <strong class="truncate text-base" title="id: {agent.name}">{agent.title ?? agent.name}</strong>
    <span class="hidden shrink-0 text-[13px] text-zinc-500 sm:inline">{statusLabel(agent.status)}</span>
    <span class="hidden shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500 md:inline" title="Runtime and model of this bot">{agent.harnessLabel ?? "Claude Code"} · {agent.modelLabel ?? "Default model"}</span>
  </div>
  <nav class="flex shrink-0 gap-1 rounded-xl bg-zinc-100 p-1">
    <button class={tab("chat")} on:click={() => onView("chat")}>Chat</button>
    <button class={tab("computer")} on:click={() => onView("computer")}>Computer</button>
    <button class="hidden md:block {tab('split')}" on:click={() => onView("split")}>Side by side</button>
  </nav>
  {#if agent.status === "busy"}
    <button class="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 md:px-3.5" on:click={onInterrupt}>■ Stop</button>
  {/if}
  <!-- Desktop: every action as its own button -->
  <button
    class="hidden shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors md:block {showRoutines ? 'bg-zinc-900 text-white' : 'border border-zinc-300 bg-white hover:bg-zinc-50'}"
    on:click={onToggleRoutines}
  >Routines</button>
  <div class="hidden shrink-0 gap-2 md:flex">
    {#if agent.status === "stopped"}
      <button class="rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-sm hover:bg-zinc-50" on:click={() => onAct("start")}>Start</button>
    {:else}
      <button class="rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-sm hover:bg-zinc-50" on:click={() => onAct("stop")}>Pause</button>
    {/if}
    <button class="rounded-lg border border-red-200 bg-white px-3.5 py-1.5 text-sm text-red-600 hover:bg-red-50" on:click={() => onAct("rm")}>Remove</button>
  </div>
  <!-- Mobile: actions in the ⋯ menu -->
  <div class="relative shrink-0 md:hidden">
    <button class="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm hover:bg-zinc-50" aria-label="More actions"
      on:click|stopPropagation={() => (menuOpen = !menuOpen)}>⋯</button>
    {#if menuOpen}
      <div class="absolute right-0 top-full z-20 mt-1.5 w-44 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
        <button class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={viaMenu(onToggleRoutines)}>Routines</button>
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
