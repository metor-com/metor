<script>
  // App shell: layout and view state only. Data (bot list, selection, live connection, chat
  // entries) lives in lib/session.js; the header, chat, computer panel and routines are components.
  import Sidebar from "./components/Sidebar.svelte";
  import Header from "./components/Header.svelte";
  import RoutinesPanel from "./components/RoutinesPanel.svelte";
  import ChatView from "./components/ChatView.svelte";
  import ComputerPanel from "./components/ComputerPanel.svelte";
  import Connect from "./components/Connect.svelte";
  import DocumentPanel from "./components/DocumentPanel.svelte";
  import ComputersOverview from "./components/ComputersOverview.svelte";
  import { app, gateway } from "./lib/base.js";
  import { shown, current, quota, selected, entries, partial, thought, select, created, applyEntry, act, remove, interrupt, connect, refresh,
    computers, computersOpen, connectOpen, openComputers, openConnect, closeView, shownDocument, closeDocument, switchComputer, disconnect, sortAgents } from "./lib/session.js";
  import AvatarDialog from "./components/AvatarDialog.svelte";
  import { isDesktop } from "./lib/viewport.js";
  import { initPush } from "./lib/push.js";
  import { settings, ZOOM, update as updateSettings } from "./lib/settings.js";
  import { swap, reducedMotion } from "./lib/transition.js";

  // The pane next to the chat: the bot's computer or its routines (one at a time), toggled from the
  // header. Settings → Behaviour decides whether a bot opens with the computer on desktop.
  let pane = $isDesktop && $settings.defaultView !== "chat" ? "computer" : null;
  const toggle = (which) => { if (pane === "document") closeDocument(); pane = pane === which ? null : which; };
  $: if (!$isDesktop && $selected) pane = null;   // a phone opens every bot with the chat; the header buttons bring computer or routines
  // A file a bot made (a click on an attachment or in the file browser) takes the pane as the document
  // view; closing it brings back whatever the pane showed before. A different bot closes it.
  let paneBefore = null;
  function onDocument(d) { if (d) { if (pane !== "document") { paneBefore = pane; pane = "document"; } } else if (pane === "document") pane = paneBefore; }
  $: onDocument($shownDocument);
  $: if ($shownDocument && $shownDocument.bot !== $selected) closeDocument();
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

  let pictureOpen = false;   // the picture dialog for the selected bot (a click on the picture in the header)
  async function onAct(action) {
    if (action === "rm" && !confirm(`Really remove bot "${$current?.title ?? $selected}"? Its directory and history will be deleted.`)) return;
    try { await (action === "rm" ? remove() : act(action)); } catch (e) { alert(e.message); }
  }
  // Desktop app (ADR-0015) without a computer, or signed out of it: the connect screen instead of the shell.
  // Follows the gateway store, because a warm switch can land on a computer that is signed out or silent.
  $: needsConnect = !!app && (!$gateway?.signedIn || $gateway.reachable === false);
  let pushReady = false;
  $: if (needsConnect) disconnect(); else { if (!pushReady) { pushReady = true; initPush(); } connect(); }
  // Native clients (knowledge/design/several-computers.md): the overview of the computers takes the sidebar's
  // place (#/computers); "Connect a Space…" shows the connect screen over the shell (#/connect…)
  const connectStep = () => (app?.local ? null : "remote");   // a phone cannot run a computer of its own: straight to "on a server"
  // The views move like on a phone (lib/transition.js): overview → bot list → chat is forward, the way back
  // is back. The level of the view shown decides the direction; on the desktop the chat stands still.
  const level = (overview, bot, desktop) => (overview ? 0 : bot && !desktop ? 2 : 1);
  let direction = "forward", prevLevel = level($computersOpen, $selected, $isDesktop);
  $: { const l = level($computersOpen, $selected, $isDesktop); if (l !== prevLevel) { direction = l > prevLevel ? "forward" : "back"; prevLevel = l; } }
  // Another computer: its bot list – known from the overview's probe, in the order the settings ask for,
  // with its pictures from that computer – slides in as the overview leaves; once it has arrived the app
  // switches without a reload (session.js switchComputer) and the same list becomes the real one
  let switching = null;   // { name, agents } while the target's list stands in for the real one
  async function switchTo(c) {
    const list = sortAgents((c.agents ?? []).map((a) => ({ ...a, origin: c.origin })), $settings);
    if (reducedMotion() || !c.agents) { await switchComputer(c, list); return; }
    switching = { name: c.short ?? c.name, agents: list };
    closeView();
    await new Promise((r) => setTimeout(r, 320));
    await switchComputer(c, list);
    switching = null;
  }
</script>

{#if needsConnect || $connectOpen}
  {#key $gateway?.id}<Connect adding={$connectOpen && !needsConnect} onDone={closeView} />{/key}
{:else}

<!-- Fixed app shell: the page itself NEVER scrolls (no horizontal drifting of the sidebar).
     Mobile: list OR bot view (messenger pattern, back arrow + back gesture via hash);
     desktop (md:) shows both side by side as before. Installed as an app (viewport-fit=cover),
     the safe-area insets keep the header below the notch and the composer above the home indicator. -->
<!-- Text size = CSS zoom on the shell; height and insets are divided by it so the shell still fills exactly the viewport -->
<div class="relative flex overflow-hidden bg-zinc-100 font-sans text-[15px] text-zinc-900 antialiased"
  style="zoom: {zoom}; height: calc(100dvh / {zoom}); padding-top: calc(env(safe-area-inset-top) / {zoom}); padding-bottom: calc(env(safe-area-inset-bottom) / {zoom}); padding-left: calc(env(safe-area-inset-left) / {zoom}); padding-right: calc(env(safe-area-inset-right) / {zoom})">
  <!-- The column: the computers overview or the bot list; on a phone it makes room for the chat -->
  {#if !$selected || $isDesktop}
    <div class="relative flex w-full shrink-0 overflow-hidden bg-white md:w-72 md:border-r md:border-zinc-200"
      in:swap={{ dir: direction, enabled: !$isDesktop }} out:swap={{ dir: direction, enabled: !$isDesktop, out: true }}>
      {#if $computersOpen}
        <div class="flex h-full w-full flex-col" in:swap={{ dir: direction }} out:swap={{ dir: direction, out: true }}>
          <ComputersOverview onBack={closeView} onOpen={switchTo} onConnect={(step) => openConnect(step ?? connectStep())} />
        </div>
      {:else}
        <div class="flex h-full w-full flex-col" in:swap={{ dir: direction }} out:swap={{ dir: direction, out: true }}>
          <Sidebar agents={switching ? switching.agents : $shown} title={switching?.name ?? null} selected={$selected} quota={$quota} onSelect={select} onCreated={created}
            computers={$computers} onComputers={app ? openComputers : null} />
        </div>
      {/if}
    </div>
  {/if}

  {#if $selected || $isDesktop}
  <main class="flex min-w-0 flex-1 flex-col" in:swap={{ dir: direction, enabled: !$isDesktop }} out:swap={{ dir: direction, enabled: !$isDesktop, out: true }}>
    {#if $current}
      <Header agent={$current} {pane}
        onToggleComputer={() => toggle("computer")} onToggleRoutines={() => toggle("routines")} onBack={() => select(null)}
        {onAct} onPicture={() => (pictureOpen = true)} onInterrupt={() => interrupt().catch((e) => alert(e.message))} />
      <section class="flex min-h-0 min-w-0 flex-1 {dragging ? 'select-none [&_iframe]:pointer-events-none' : ''}" bind:this={paneEl}>
        {#if $isDesktop || !pane}
          <div class="flex min-h-0 min-w-0 flex-col" style={$isDesktop && pane ? `flex: 0 0 ${ratio * 100}%` : "flex: 1 1 0%"}>
            <ChatView bot={$selected} title={$current.title ?? $selected} entries={$entries} partial={$partial} thought={$thought} onLocalEntry={applyEntry} status={$current.status} onStart={() => onAct("start")} harness={$current.harness} harnessLabel={$current.harnessLabel} />
          </div>
        {/if}
        {#if $isDesktop && pane}
          <div class="group relative w-1.5 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-zinc-400 {dragging ? 'bg-zinc-500' : ''}" role="separator" aria-orientation="vertical" aria-label="Drag to resize the chat and the pane"
            on:pointerdown|preventDefault={startDrag}></div>
        {/if}
        {#if pane === "computer"}<ComputerPanel bot={$selected} />
        {:else if pane === "routines"}{#key $selected}<RoutinesPanel bot={$selected} title={$current.title ?? $selected} />{/key}
        {:else if pane === "document" && $shownDocument}<DocumentPanel doc={$shownDocument} onClose={closeDocument} />{/if}
      </section>
    {:else}
      <div class="m-auto max-w-sm px-6 text-center text-zinc-500">
        <h2 class="mb-2 text-xl font-bold text-zinc-900">metor</h2>
        <p>Pick a bot on the left or create one with the + button. The bot's chat and computer will appear here.</p>
        <button class="mt-4 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 md:hidden" on:click={() => select(null)}>Back to bots</button>
      </div>
    {/if}
  </main>
  {/if}
</div>
{#if pictureOpen && $current}
  <AvatarDialog agent={$current} onDone={() => { pictureOpen = false; refresh(); }} />
{/if}
{/if}
