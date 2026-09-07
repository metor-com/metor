<script>
  // The overview of the bots' computers this app is connected to (knowledge/design/several-computers.md,
  // the mailbox pattern): one row per computer with its unread count, a tap opens that computer's bot
  // list (the app loads its interface), the row's menu renames, stops a local one or forgets it. Shown
  // in place of the bot list when the app knows two or more computers, and from the connect screen.
  // A browser never gets here – it is served by one computer and knows no other.
  import { app } from "../lib/base.js";
  import { computers, loadComputers } from "../lib/session.js";
  export let onBack;                   // a tap on the computer shown: back to its bot list (or to the connect screen this came from)
  export let onConnect = null;         // (step, origin) → the connect screen, to add a computer or sign in again
  export let standalone = false;       // shown on its own (from the connect screen), not as the sidebar
  export let hiddenOnMobile = false;
  const currentId = app?.gateway?.id ?? null;
  let probing = false, menuFor = null, error = null, local = null, busy = null;
  // The stored list at once, then every computer asked for its bot list (unread count, does it answer)
  async function probe() { probing = true; await loadComputers({ probe: true }); probing = false; }
  probe();
  async function loadLocal() { if (!app?.local) return; try { local = await app.local.status(); } catch {} }
  loadLocal();
  app?.local?.onProgress?.((p) => { if (p.done) { busy = null; if (!p.ok) error = p.error ?? "failed"; loadLocal(); probe(); } });
  const stopped = (c) => c.local && local?.computer?.id === c.id && local.state === "stopped";
  const state = (c) => busy && c.local ? { text: { up: "starting…", down: "stopping…", setup: "setting up…" }[busy] ?? "working…", cls: "text-zinc-500" }
    : !c.signedIn ? { text: "signed out", cls: "text-zinc-400" }
    : stopped(c) ? { text: "stopped", cls: "text-zinc-400" }
    : c.reachable === false ? { text: "does not answer", cls: "text-amber-700" }
    : null;
  function open(c) {
    if (c.id === currentId && !standalone) return onBack?.();   // the computer shown already: its list, no reload
    if (!c.signedIn) { if (c.local && app?.local) return run("setup", c.id); return onConnect?.("remote", c.origin); }
    if (stopped(c)) return run("up", c.id);
    app.use(c.id);
  }
  async function run(action, id) {
    busy = action; error = null;
    try { const r = await app.local.run(action, id); if (!r?.ok) { error = r?.error ?? "failed"; busy = null; } } catch (e) { error = e.message; busy = null; }
  }
  async function rename(c) {
    const name = prompt("Name of this computer", c.name); if (name == null) return;
    try { await app.rename(c.id, name.trim()); await loadComputers(); } catch (e) { error = e.message; }
  }
  async function forget(c) {
    if (!confirm(`Forget "${c.name}"? The app signs out of it.`)) return;
    try { await app.forget(c.id); await loadComputers(); } catch (e) { error = e.message; }
  }
  const menu = (fn) => (c) => { menuFor = null; fn(c); };
  const rowMenu = "block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50";
</script>

<svelte:window on:click={() => (menuFor = null)} />
<aside class="{hiddenOnMobile ? 'hidden md:flex' : 'flex'} {standalone ? 'mx-auto h-dvh w-full max-w-md' : 'w-full shrink-0 md:w-72 md:border-r md:border-zinc-200'} flex-col bg-white">
  <!-- The root screen: nothing leads further up, a tap on a computer leads down into its bot list -->
  <div class="flex shrink-0 items-center px-4 py-3">
    <span class="text-2xl font-bold tracking-tight text-zinc-900">metor</span>
  </div>
  <p class="px-4 pb-2 text-[13px] text-zinc-500">Your bots' computers{#if probing} · checking…{/if}</p>
  <ul class="min-h-0 flex-1 overflow-y-auto p-2">
    {#each $computers as c (c.id)}
      {@const s = state(c)}
      <li class="relative flex items-center rounded-xl {c.id === currentId ? 'bg-zinc-100' : 'hover:bg-zinc-50'}">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left" on:click={() => open(c)}>
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full {c.signedIn && c.reachable !== false && !stopped(c) ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-500'}">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v11H3zM8 21h8M12 16v5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-[15px] font-semibold" title={c.origin}>{c.short ?? c.name}</strong>
            {#if s}<span class="block truncate text-[13px] {s.cls}">{s.text}</span>{/if}
          </span>
          {#if stopped(c) && !busy}<span class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1 text-xs">Start</span>
          {:else if c.unread}<span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[11px] font-semibold text-white">{c.unread > 99 ? "99+" : c.unread}</span>{/if}
        </button>
        <button type="button" class="mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700" aria-label="Menu for {c.name}"
          on:click|stopPropagation={() => (menuFor = menuFor === c.id ? null : c.id)}>
          <svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
        </button>
        {#if menuFor === c.id}
          <div class="absolute right-2 top-full z-20 mt-1 w-40 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg" role="menu">
            <button type="button" class={rowMenu} on:click={() => menu(rename)(c)}>Rename</button>
            {#if c.local && app?.local && local?.computer?.id === c.id}
              {#if local.state === "running"}<button type="button" class={rowMenu} on:click={() => menu((x) => run("down", x.id))(c)}>Stop</button>
              {:else if local.state === "stopped"}<button type="button" class={rowMenu} on:click={() => menu((x) => run("up", x.id))(c)}>Start</button>{/if}
            {/if}
            <button type="button" class="{rowMenu} text-red-600" on:click={() => menu(forget)(c)}>Forget</button>
          </div>
        {/if}
      </li>
    {/each}
    {#if !$computers.length}<li class="p-3 text-sm text-zinc-400">no computer connected</li>{/if}
    {#if onConnect}
      <li class="sticky -bottom-2 -mx-2 bg-white px-2 pb-2 pt-1">   <!-- below the last computer, at the bottom edge once the list is long -->
        <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-zinc-600 hover:bg-zinc-50" on:click={() => onConnect(null)}>
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-400">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <span class="text-[15px]">Connect a bots' computer…</span>
        </button>
      </li>
    {/if}
  </ul>
  {#if error}<p class="m-3 shrink-0 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>{/if}
</aside>
