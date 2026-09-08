<script>
  // The overview of the bots' computers this app is connected to (knowledge/design/several-computers.md,
  // the mailbox pattern): the root screen behind the back arrow of the bot list. One row per computer
  // with its unread count, a tap opens that computer's bot list (the app loads its interface); below the
  // rows "Add new computer" (the connect screen); the computer opened last is not marked – the overview
  // is the root, not a switch. The ⋮ menu at the top opens the Settings. Renaming
  // and removing a computer live in its own ⋮ menu (Sidebar.svelte). A browser never gets here.
  import { app } from "../lib/base.js";
  import { computers, loadComputers } from "../lib/session.js";
  import Settings from "./Settings.svelte";
  export let onBack;                   // a tap on the computer shown: back to its bot list
  export let onOpen;                   // (computer) → another computer: its list slides in, then the interface loads anew
  export let onConnect;                // (step) → the connect screen
  const currentId = app?.gateway?.id ?? null;
  let probing = false, menuOpen = false, showSettings = false;
  // The stored list at once, then every computer asked for its bot list (unread count, does it answer)
  async function probe() { probing = true; await loadComputers({ probe: true }); probing = false; }
  probe();
  const state = (c) => (!c.signedIn ? { text: "signed out", cls: "text-zinc-400" } : c.reachable === false ? { text: "does not answer", cls: "text-amber-700" } : null);
  function open(c) {
    if (c.id === currentId) return onBack();
    if (!c.signedIn) { if (c.local && app?.local) { app.local.run("setup", c.id); return; } return onConnect("remote"); }
    onOpen(c);   // a computer that does not answer lands on the connect screen, which offers Try again (and Start for a local one)
  }
  const row = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left";
</script>

<svelte:window on:click={() => (menuOpen = false)} />
<aside class="flex h-full w-full flex-col bg-white">
  <div class="flex shrink-0 items-center justify-between gap-2 py-3 pl-4 pr-3">
    <span class="text-2xl font-bold tracking-tight text-zinc-900">metor</span>
    <div class="relative">
      <button type="button" class="flex size-10 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100" aria-label="Menu" title="Menu"
        on:click|stopPropagation={() => (menuOpen = !menuOpen)}>
        <svg class="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
      </button>
      {#if menuOpen}
        <div class="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
          <button type="button" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={() => { menuOpen = false; showSettings = true; }}>Settings</button>
        </div>
      {/if}
    </div>
  </div>
  <p class="px-4 pb-2 text-[13px] text-zinc-500">Your bots' computers{#if probing} · checking…{/if}</p>
  <ul class="min-h-0 flex-1 overflow-y-auto p-2">
    {#each $computers as c (c.id)}
      {@const s = state(c)}
      <li>
        <button type="button" class="{row} hover:bg-zinc-50" on:click={() => open(c)} title={c.origin}>
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full {c.signedIn && c.reachable !== false ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-500'}">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v11H3zM8 21h8M12 16v5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-[15px] font-semibold">{c.short ?? c.name}</strong>
            {#if s}<span class="block truncate text-[13px] {s.cls}">{s.text}</span>{/if}
          </span>
          {#if c.unread}<span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[11px] font-semibold text-white">{c.unread > 99 ? "99+" : c.unread}</span>{/if}
        </button>
      </li>
    {/each}
    {#if !$computers.length}<li class="p-3 text-sm text-zinc-400">no computer connected</li>{/if}
    <li class="my-2 border-t border-zinc-100" role="separator"></li>
    <li>
      <button type="button" class="{row} text-zinc-700 hover:bg-zinc-50" on:click={() => onConnect(null)}>
        <span class="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-400">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </span>
        <span class="text-[15px]">Add new computer</span>
      </button>
    </li>
  </ul>
  {#if showSettings}
    <Settings onDone={() => (showSettings = false)} />
  {/if}
</aside>
