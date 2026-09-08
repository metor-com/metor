<script>
  // The overview of the bots' computers this app is connected to (knowledge/design/several-computers.md,
  // the mailbox pattern): the root screen behind the back arrow of the bot list. One row per computer
  // with its unread count, a tap opens that computer's bot list (the app loads its interface); below the
  // rows "Add new computer" (the connect screen) and "Manage computers" (a dialog: rename, order, start
  // or stop the one on this machine, forget – Computers.svelte). A browser never gets here.
  import { app } from "../lib/base.js";
  import { computers, loadComputers } from "../lib/session.js";
  import Computers from "./Computers.svelte";
  export let onBack;                   // a tap on the computer shown: back to its bot list
  export let onConnect;                // (step) → the connect screen
  export let hiddenOnMobile = false;
  const currentId = app?.gateway?.id ?? null;
  let probing = false, manageOpen = false;
  // The stored list at once, then every computer asked for its bot list (unread count, does it answer)
  async function probe() { probing = true; await loadComputers({ probe: true }); probing = false; }
  probe();
  const state = (c) => (!c.signedIn ? { text: "signed out", cls: "text-zinc-400" } : c.reachable === false ? { text: "does not answer", cls: "text-amber-700" } : null);
  function open(c) {
    if (c.id === currentId) return onBack();
    if (!c.signedIn) { if (c.local && app?.local) { app.local.run("setup", c.id); return; } return onConnect("remote"); }
    app.use(c.id);   // a computer that does not answer lands on the connect screen, which offers Try again (and Start for a local one)
  }
  const row = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left";
</script>

<aside class="{hiddenOnMobile ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col bg-white md:w-72 md:border-r md:border-zinc-200">
  <div class="flex shrink-0 items-center px-4 py-3">
    <span class="text-2xl font-bold tracking-tight text-zinc-900">metor</span>
  </div>
  <p class="px-4 pb-2 text-[13px] text-zinc-500">Your bots' computers{#if probing} · checking…{/if}</p>
  <ul class="min-h-0 flex-1 overflow-y-auto p-2">
    {#each $computers as c (c.id)}
      {@const s = state(c)}
      <li>
        <button type="button" class="{row} {c.id === currentId ? 'bg-zinc-100' : 'hover:bg-zinc-50'}" on:click={() => open(c)} title={c.origin}>
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full {c.signedIn && c.reachable !== false ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-500'}">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v11H3zM8 21h8M12 16v5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-[15px] font-semibold">{c.short ?? c.name}</strong>
            {#if s}<span class="block truncate text-[13px] {s.cls}">{s.text}</span>{/if}
          </span>
          {#if c.id === currentId}<span class="shrink-0 text-zinc-400" aria-label="shown now">✓</span>
          {:else if c.unread}<span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[11px] font-semibold text-white">{c.unread > 99 ? "99+" : c.unread}</span>{/if}
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
    <li>
      <button type="button" class="{row} text-zinc-700 hover:bg-zinc-50" on:click={() => (manageOpen = true)}>
        <span class="flex size-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-500">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1M15 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg>
        </span>
        <span class="text-[15px]">Manage computers</span>
      </button>
    </li>
  </ul>
  {#if manageOpen}
    <!-- Manage computers: rename, order, start or stop the local one, forget -->
    <div class="fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-3 sm:p-8" role="presentation" on:click={() => (manageOpen = false)}>
      <div class="flex max-h-[40rem] w-[30rem] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl" role="dialog" on:click|stopPropagation>
        <header class="flex items-center gap-3 border-b border-zinc-100 px-5 py-4">
          <div class="min-w-0 flex-1"><h2 class="text-lg font-bold">Manage computers</h2><p class="text-[13px] text-zinc-500">Tap one to open it; its menu renames, orders, starts or forgets it.</p></div>
          <button type="button" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50" on:click={() => (manageOpen = false)}>Close</button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <Computers onDone={() => { manageOpen = false; onBack(); }} onConnect={(step) => { manageOpen = false; onConnect(step); }} />
        </div>
      </div>
    </div>
  {/if}
</aside>
