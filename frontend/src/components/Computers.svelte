<script>
  // The bots' computers this app is connected to (knowledge/design/several-computers.md), on the connect
  // screen – where the overview cannot be reached: one row per computer with its state and unread
  // count. A tap opens it (the app loads its interface); the row's actions rename it, start or stop the
  // one on this machine, or forget it. A browser never gets here – it is served by one computer.
  import { app } from "../lib/base.js";
  import { computers, loadComputers } from "../lib/session.js";
  export let onDone = null;            // a tap on the computer shown already (the dialog closes)
  export let onConnect = null;         // sign in again to a computer the app was signed out of
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
    : c.id === currentId ? { text: "shown now", cls: "text-zinc-400" }
    : null;
  function open(c) {
    if (c.id === currentId && onDone) return onDone();
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
  const action = "rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50";
</script>

<svelte:window on:click={() => (menuFor = null)} />
<ul class="flex flex-col">
  {#each $computers as c (c.id)}
    {@const s = state(c)}
    <li class="flex flex-col rounded-xl {c.id === currentId ? 'bg-zinc-100' : 'hover:bg-zinc-50'}">
      <div class="flex items-center">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left" on:click={() => open(c)}>
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full {c.signedIn && c.reachable !== false && !stopped(c) ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-500'}">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v11H3zM8 21h8M12 16v5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-[15px] font-semibold" title={c.origin}>{c.short ?? c.name}</strong>
            {#if s}<span class="block truncate text-[13px] {s.cls}">{s.text}</span>{:else}<span class="block truncate text-[13px] text-zinc-400">{c.origin}</span>{/if}
          </span>
          {#if stopped(c) && !busy}<span class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1 text-xs">Start</span>
          {:else if c.unread}<span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[11px] font-semibold text-white">{c.unread > 99 ? "99+" : c.unread}</span>{/if}
        </button>
        <button type="button" class="mr-1 flex size-8 shrink-0 items-center justify-center rounded-full {menuFor === c.id ? 'bg-zinc-200 text-zinc-700' : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700'}" aria-label="Actions for {c.name}" aria-expanded={menuFor === c.id}
          on:click|stopPropagation={() => (menuFor = menuFor === c.id ? null : c.id)}>
          <svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
        </button>
      </div>
      {#if menuFor === c.id}
        <!-- The actions, unfolded below the row (a floating menu would be cut off by the dialog's scroll area) -->
        <div class="flex flex-wrap gap-1.5 px-3 pb-2.5" role="group" on:click|stopPropagation>
          <button type="button" class={action} on:click={() => menu(rename)(c)}>Rename</button>
          {#if c.local && app?.local && local?.computer?.id === c.id}
            {#if local.state === "running"}<button type="button" class={action} on:click={() => menu((x) => run("down", x.id))(c)}>Stop</button>
            {:else if local.state === "stopped"}<button type="button" class={action} on:click={() => menu((x) => run("up", x.id))(c)}>Start</button>{/if}
          {/if}
          <button type="button" class="{action} text-red-600" on:click={() => menu(forget)(c)}>Forget</button>
        </div>
      {/if}
    </li>
  {/each}
  {#if !$computers.length}<li class="p-3 text-sm text-zinc-400">no computer connected</li>{/if}
</ul>
{#if probing}<p class="px-3 pt-2 text-xs text-zinc-400">checking…</p>{/if}
{#if error}<p class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>{/if}
