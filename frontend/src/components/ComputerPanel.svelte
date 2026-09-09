<script>
  import { onDestroy } from "svelte";
  import { watchUrl, resizeScreen } from "../lib/api.js";
  import { app, url } from "../lib/base.js";
  import { settings } from "../lib/settings.js";
  import FilesPanel from "./FilesPanel.svelte";
  export let bot;
  export let status = "idle";
  export let resizing = false;
  let width = 0, height = 0, resizeTimer, resizeNote = "", lastSize = "", inFlight = false;
  function measure(node) {
    const observer = new ResizeObserver(([entry]) => {
      width = Math.round(entry.contentRect.width); height = Math.round(entry.contentRect.height);
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  $: scheduleResize(bot, src, mode, width, height, resizing, status, $settings.autoResizeScreen);
  function scheduleResize(name, source, view, w, h, dragging, state, enabled) {
    clearTimeout(resizeTimer);
    if (!enabled) { resizeNote = ""; lastSize = ""; return; }
    if (native || !source || view !== "screen" || !w || !h || dragging) return;
    if (state !== "idle") { resizeNote = "Screen size will adjust when the bot is idle."; return; }
    const key = `${name}:${w}x${h}`;
    if (key === lastSize) { resizeNote = ""; return; }
    resizeTimer = setTimeout(async () => {
      if (inFlight) { scheduleResize(bot, src, mode, width, height, resizing, status, $settings.autoResizeScreen); return; }
      inFlight = true;
      try {
        const result = await resizeScreen(name, w, h);
        if (bot !== name || !$settings.autoResizeScreen) return;
        if (result.deferred) resizeNote = "Screen size will adjust when the bot is idle.";
        else { lastSize = key; resizeNote = ""; }
      } catch (e) { if (bot === name && $settings.autoResizeScreen) resizeNote = e.message; }
      finally { inFlight = false; }
    }, 400);
  }
  let src = null, error = null, timer = null;
  let mode = "screen";       // screen | terminal | files
  let termOpened = false;    // load the terminal iframe only on first open, then keep it mounted (the shell survives tab switches)
  // Phone app (client/mobile): a frame here would be a cross-site load without the session (WKWebView
  // withholds the cookie), so screen and terminal open in a web view of their own, where the computer's
  // host is first-party; this pane then shows the files and the two buttons re-open that view.
  const native = !!app?.openComputer;

  $: load(bot);
  function load(name) {
    clearTimeout(timer); timer = null;
    src = null; error = null; termOpened = false; lastSize = ""; resizeNote = ""; clearTimeout(resizeTimer);
    mode = native ? "files" : "screen";
    if (!name) return;
    if (native) openNative("screen"); else attempt(name);
  }
  async function openNative(m) {
    try { const path = m === "screen" ? (await watchUrl(bot)).path : `/bots/${bot}/terminal/`; await app.openComputer(url(path)); error = null; }
    catch (e) { error = e.message; }
  }
  async function attempt(name) {
    try {
      const r = await watchUrl(name);
      if (bot === name) { src = url(r.path); error = null; }
    } catch (e) {
      // Right after creation the desktop takes a few seconds to appear – keep trying instead of giving up
      if (bot === name) { error = e.message; timer = setTimeout(() => attempt(name), 4000); }
    }
  }
  function show(m) { if (native && m !== "files") return openNative(m); mode = m; if (m === "terminal") termOpened = true; }
  onDestroy(() => { clearTimeout(timer); clearTimeout(resizeTimer); });
  $: sub = (v) => `rounded-md px-3 py-1 text-xs transition-colors ${mode === v ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`;
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-800">
  <div class="flex shrink-0 gap-1 border-b border-zinc-700 bg-zinc-900 px-2 py-1.5">
    <button class={sub("screen")} on:click={() => show("screen")}>Screen</button>
    <button class={sub("terminal")} on:click={() => show("terminal")}>Terminal</button>
    <button class={sub("files")} on:click={() => show("files")}>Files</button>
  </div>
  <div class="relative min-h-0 min-w-0 flex-1" use:measure>
    {#if resizeNote && mode === "screen"}<p class="absolute bottom-2 left-2 right-2 z-10 rounded bg-zinc-900/90 px-3 py-2 text-xs text-zinc-200" role="status">{resizeNote}</p>{/if}
    {#if src}
      <iframe title="Screen of {bot}" {src} class="absolute inset-0 h-full w-full border-0" class:hidden={mode !== "screen"} allow="clipboard-read; clipboard-write"></iframe>
    {:else if mode === "screen"}
      <p class="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-zinc-400">
        {error ? `Waiting for the bot's computer… (${error})` : "Loading the bot's computer…"}
      </p>
    {/if}
    {#if termOpened}
      <iframe title="Terminal of {bot}" src={url(`/bots/${bot}/terminal/`)} class="absolute inset-0 h-full w-full border-0" class:hidden={mode !== "terminal"} allow="clipboard-read; clipboard-write"></iframe>
    {/if}
    {#if mode === "files"}
      <div class="absolute inset-0 flex flex-col">
        {#if native && error}<p class="shrink-0 px-3 py-2 text-xs text-red-300">{error}</p>{/if}
        <div class="flex min-h-0 flex-1"><FilesPanel {bot} /></div>
      </div>
    {/if}
  </div>
</div>
