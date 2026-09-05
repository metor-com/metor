<script>
  import { onDestroy } from "svelte";
  import { watchUrl } from "../lib/api.js";
  import { url } from "../lib/base.js";
  import FilesPanel from "./FilesPanel.svelte";
  export let bot;
  let src = null, error = null, timer = null;
  let mode = "screen";       // screen | terminal
  let termOpened = false;    // load the terminal iframe only on first open, then keep it mounted (the shell survives tab switches)

  $: load(bot);
  function load(name) {
    clearTimeout(timer); timer = null;
    src = null; error = null; mode = "screen"; termOpened = false;
    if (name) attempt(name);
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
  function show(m) { mode = m; if (m === "terminal") termOpened = true; }
  onDestroy(() => clearTimeout(timer));
  $: sub = (v) => `rounded-md px-3 py-1 text-xs transition-colors ${mode === v ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`;
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-800">
  <div class="flex shrink-0 gap-1 border-b border-zinc-700 bg-zinc-900 px-2 py-1.5">
    <button class={sub("screen")} on:click={() => show("screen")}>Screen</button>
    <button class={sub("terminal")} on:click={() => show("terminal")}>Terminal</button>
    <button class={sub("files")} on:click={() => show("files")}>Files</button>
  </div>
  <div class="relative min-h-0 min-w-0 flex-1">
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
      <div class="absolute inset-0 flex"><FilesPanel {bot} /></div>
    {/if}
  </div>
</div>
