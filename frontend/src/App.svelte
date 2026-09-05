<script>
  // App shell: layout and view state only. Data (bot list, selection, live connection, chat
  // entries) lives in lib/session.js; the header, chat, computer panel and routines are components.
  import { onMount } from "svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Header from "./components/Header.svelte";
  import RoutinesPanel from "./components/RoutinesPanel.svelte";
  import ChatView from "./components/ChatView.svelte";
  import ComputerPanel from "./components/ComputerPanel.svelte";
  import Connect from "./components/Connect.svelte";
  import { app } from "./lib/base.js";
  import { shown, current, quota, selected, entries, partial, select, created, applyEntry, act, remove, interrupt, connect } from "./lib/session.js";
  import { isDesktop } from "./lib/viewport.js";
  import { initPush } from "./lib/push.js";
  import { settings, ZOOM, update as updateSettings } from "./lib/settings.js";

  // The pane next to the chat: the bot's computer or its routines (one at a time), toggled from the
  // header. Settings → Behaviour decides whether a bot opens with the computer on desktop.
  let pane = $isDesktop && $settings.defaultView !== "chat" ? "computer" : null;
  const toggle = (which) => (pane = pane === which ? null : which);
  $: if (!$isDesktop && $selected) pane = null;   // a phone opens every bot with the chat; the header buttons bring computer or routines
  $: zoom = ZOOM[$settings.textSize] ?? 1;   // Settings → Appearance → text size

  // Desktop: chat and computer side by side, the divider between them is draggable (share kept per
  // device). Phone: no room for both – the computer replaces the chat while it is shown.
  let ratio = $settings.splitRatio ?? 0.5, dragging = false, paneEl = null;
  function startDrag(e) {
    dragging = true; e.currentTarget.setPointerCapture(e.pointerId);
    const box = paneEl.getBoundingClientRect();
    const move = (ev) => { ratio = Math.min(0.75, Math.max(0.25, (ev.clientX - box.left) / box.width)); };
    const stop = () => { dragging = false; updateSettings({ splitRatio: Math.round(ratio * 100) / 100 }); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  }

  async function onAct(action) {
    if (action === "rm" && !confirm(`Really remove bot "${$current?.title ?? $selected}"? Its directory and history will be deleted.`)) return;
    try { await (action === "rm" ? remove() : act(action)); } catch (e) { alert(e.message); }
  }
  // Desktop app (ADR-0015) without a computer, or signed out of it: the connect screen instead of the shell
  const needsConnect = !!app && (!app.gateway?.signedIn || app.gateway.reachable === false);
  onMount(() => { if (needsConnect) return; initPush(); return connect(); });
</script>

{#if needsConnect}
<Connect />
{:else}

<!-- Fixed app shell: the page itself NEVER scrolls (no horizontal drifting of the sidebar).
     Mobile: list OR bot view (messenger pattern, back arrow + back gesture via hash);
     desktop (md:) shows both side by side as before. Installed as an app (viewport-fit=cover),
     the safe-area insets keep the header below the notch and the composer above the home indicator. -->
<!-- Text size = CSS zoom on the shell; height and insets are divided by it so the shell still fills exactly the viewport -->
<div class="flex overflow-hidden bg-zinc-100 font-sans text-[15px] text-zinc-900 antialiased"
  style="zoom: {zoom}; height: calc(100dvh / {zoom}); padding-top: calc(env(safe-area-inset-top) / {zoom}); padding-bottom: calc(env(safe-area-inset-bottom) / {zoom}); padding-left: calc(env(safe-area-inset-left) / {zoom}); padding-right: calc(env(safe-area-inset-right) / {zoom})">
  <Sidebar agents={$shown} selected={$selected} quota={$quota} hiddenOnMobile={!!$selected} onSelect={select} onCreated={created} />

  <main class="{$selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col">
    {#if $current}
      <Header agent={$current} {pane}
        onToggleComputer={() => toggle("computer")} onToggleRoutines={() => toggle("routines")} onBack={() => select(null)}
        {onAct} onInterrupt={() => interrupt().catch((e) => alert(e.message))} />
      <section class="flex min-h-0 min-w-0 flex-1 {dragging ? 'select-none [&_iframe]:pointer-events-none' : ''}" bind:this={paneEl}>
        {#if $isDesktop || !pane}
          <div class="flex min-h-0 min-w-0 flex-col" style={$isDesktop && pane ? `flex: 0 0 ${ratio * 100}%` : "flex: 1 1 0%"}>
            <ChatView bot={$selected} title={$current.title ?? $selected} entries={$entries} partial={$partial} onLocalEntry={applyEntry} />
          </div>
        {/if}
        {#if $isDesktop && pane}
          <div class="group relative w-1.5 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-zinc-400 {dragging ? 'bg-zinc-500' : ''}" role="separator" aria-orientation="vertical" aria-label="Drag to resize the chat and the pane"
            on:pointerdown|preventDefault={startDrag}></div>
        {/if}
        {#if pane === "computer"}<ComputerPanel bot={$selected} />
        {:else if pane === "routines"}{#key $selected}<RoutinesPanel bot={$selected} title={$current.title ?? $selected} />{/key}{/if}
      </section>
    {:else}
      <div class="m-auto max-w-sm px-6 text-center text-zinc-500">
        <h2 class="mb-2 text-xl font-bold text-zinc-900">metor</h2>
        <p>Pick a bot on the left or create one with the + button. The bot's chat and computer will appear here.</p>
        <button class="mt-4 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 md:hidden" on:click={() => select(null)}>Back to bots</button>
      </div>
    {/if}
  </main>
</div>
{/if}
