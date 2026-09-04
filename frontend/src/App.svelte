<script>
  // App shell: layout and view state only. Data (bot list, selection, live connection, chat
  // entries) lives in lib/session.js; the header, chat, computer panel and routines are components.
  import { onMount } from "svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Header from "./components/Header.svelte";
  import RoutinesPanel from "./components/RoutinesPanel.svelte";
  import ChatView from "./components/ChatView.svelte";
  import ComputerPanel from "./components/ComputerPanel.svelte";
  import { shown, current, quota, selected, entries, partial, select, created, applyEntry, act, remove, interrupt, connect } from "./lib/session.js";
  import { isDesktop } from "./lib/viewport.js";
  import { initPush } from "./lib/push.js";

  let view = "split";         // chat | computer | split
  let showRoutines = false;
  // Mobile (<768px): no room for "Side by side" – split behaves like chat there
  $: effView = !$isDesktop && view === "split" ? "chat" : view;
  $: $selected, (showRoutines = false);   // a new selection closes the routines panel

  async function onAct(action) {
    if (action === "rm" && !confirm(`Really remove bot "${$current?.title ?? $selected}"? Its directory and history will be deleted.`)) return;
    try { await (action === "rm" ? remove() : act(action)); } catch (e) { alert(e.message); }
  }
  onMount(() => { initPush(); return connect(); });
</script>

<!-- Fixed app shell: the page itself NEVER scrolls (no horizontal drifting of the sidebar).
     Mobile: list OR bot view (messenger pattern, back arrow + back gesture via hash);
     desktop (md:) shows both side by side as before. Installed as an app (viewport-fit=cover),
     the safe-area insets keep the header below the notch and the composer above the home indicator. -->
<div class="flex h-dvh overflow-hidden bg-zinc-100 font-sans text-[15px] text-zinc-900 antialiased"
  style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right)">
  <Sidebar agents={$shown} selected={$selected} quota={$quota} hiddenOnMobile={!!$selected} onSelect={select} onCreated={created} />

  <main class="{$selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col">
    {#if $current}
      <Header agent={$current} view={effView} {showRoutines}
        onView={(v) => (view = v)} onBack={() => select(null)} onToggleRoutines={() => (showRoutines = !showRoutines)}
        {onAct} onInterrupt={() => interrupt().catch((e) => alert(e.message))} />
      {#if showRoutines}<RoutinesPanel bot={$selected} title={$current.title ?? $selected} />{/if}
      <section class="flex min-h-0 min-w-0 flex-1">
        {#if effView !== "computer"}<ChatView bot={$selected} title={$current.title ?? $selected} entries={$entries} partial={$partial} onLocalEntry={applyEntry} />{/if}
        {#if effView === "split"}<div class="w-px shrink-0 bg-zinc-200"></div>{/if}
        {#if effView !== "chat"}<ComputerPanel bot={$selected} />{/if}
      </section>
    {:else}
      <div class="m-auto max-w-sm px-6 text-center text-zinc-500">
        <h2 class="mb-2 text-xl font-bold text-zinc-900">metor</h2>
        <p>Pick a bot on the left or create a new one. The bot's chat and computer will appear here.</p>
        <button class="mt-4 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 md:hidden" on:click={() => select(null)}>Back to bots</button>
      </div>
    {/if}
  </main>
</div>
