<script>
  // The runtime's official sign-in, driven from the interface. Used by the create dialog (a runtime
  // that is not set up yet) and by the chat's error card (a sign-in that expired while a bot ran).
  // mode "device": link + one-time code shown here, confirmed at the provider (Codex)
  // mode "code":   link shown here, the provider shows a code at the end, pasted here (Claude Code)
  // mode "key":    an API key pasted here, it stays inside the Space (Gemini)
  // mode "terminal": a command to run inside the box (no wizard for that runtime)
  import { onDestroy } from "svelte";
  import { listHarnesses, setupStart, setupStatus, setupCancel, setupCode } from "../lib/api.js";
  export let harness;             // the runtime's id
  export let label = null;        // its name for people – looked up when missing
  export let setup = null;        // { ok, mode, command } from the harness list – looked up when missing
  export let intro = null;        // the sentence above the button
  export let onDone = null;       // called once the sign-in went through
  let wizard = null, pollTimer = null, code = "", error = null;
  const ACTIVE = ["starting", "pending", "verifying"];
  if (!setup || !label) listHarnesses().then((hs) => { const h = hs.find((x) => x.id === harness); if (h) { label = label ?? h.label; setup = setup ?? h.setup; } }).catch((e) => { error = e.message; });

  async function start() {
    error = null; code = "";
    try { wizard = await setupStart(harness); poll(); } catch (e) { error = e.message; }
  }
  function poll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        wizard = await setupStatus(harness);
        if (wizard.state === "done") { wizard = null; onDone?.(); return; }
        if (ACTIVE.includes(wizard.state)) poll();
      } catch { poll(); }
    }, 2000);
  }
  async function submitCode() {
    if (!code.trim()) return;
    error = null;
    try { wizard = await setupCode(harness, code.trim()); if (wizard.state === "verifying") code = ""; poll(); } catch (e) { error = e.message; }
  }
  onDestroy(() => { clearTimeout(pollTimer); if (wizard && ACTIVE.includes(wizard.state)) setupCancel(harness).catch(() => {}); });
  const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {});
</script>

<div class="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px]">
  {#if !wizard || wizard.state === "idle"}
    <p class="text-amber-900">{intro ?? `${label ?? harness} is not set up yet – sign in once with your subscription.`}</p>
    {#if setup?.mode === "terminal"}
      <p class="text-amber-900/80">Run once in the terminal:</p>
      <code class="block overflow-x-auto rounded-lg bg-amber-100/70 px-2.5 py-1.5 text-xs">{setup.command}</code>
    {:else}
      <button type="button" class="self-start rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700" on:click={start}>Sign in</button>
    {/if}
  {:else if wizard.state === "starting"}
    <p class="text-amber-900">Starting sign-in…</p>
  {:else if wizard.state === "pending" && wizard.mode === "device"}
    <p class="text-amber-900">1. Open <a class="font-medium underline" href={wizard.url} target="_blank" rel="noopener noreferrer">{wizard.url}</a></p>
    <div class="flex items-center gap-2">
      <span class="text-amber-900">2. Enter this code:</span>
      <code class="rounded-lg bg-amber-100 px-2.5 py-1 text-base font-bold tracking-wider">{wizard.code}</code>
      <button type="button" class="rounded-lg border border-amber-300 px-2 py-1 text-xs hover:bg-amber-100" on:click={() => copy(wizard.code)}>Copy</button>
    </div>
    <p class="text-amber-900/70">Waiting for confirmation… (code valid for 15 minutes)</p>
    {#if wizard.hint}<p class="text-xs text-amber-900/60">{wizard.hint}</p>{/if}
  {:else if (wizard.state === "pending" || wizard.state === "verifying") && wizard.mode === "key"}
    <p class="text-amber-900">1. <a class="font-medium underline" href={wizard.url} target="_blank" rel="noopener noreferrer">Get a key at Google AI Studio</a> (free).</p>
    <p class="text-amber-900">2. Paste the {wizard.keyLabel ?? "API key"} here – it stays inside the Space:</p>
    <div class="flex items-center gap-2">
      <input type="password" class="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 font-mono text-sm outline-none focus:border-zinc-900"
        bind:value={code} placeholder={wizard.keyLabel ?? "API key"} autocomplete="off" spellcheck="false"
        on:keydown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitCode(); } }} />
      <button type="button" class="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:bg-zinc-300" disabled={!code.trim() || wizard.state === "verifying"} on:click={submitCode}>{wizard.state === "verifying" ? "Checking…" : "Confirm"}</button>
    </div>
    {#if wizard.error}<p class="text-[13px] text-red-600">{wizard.error}</p>{/if}
    {#if wizard.hint}<p class="text-xs text-amber-900/60">{wizard.hint}</p>{/if}
  {:else if wizard.state === "pending"}
    <p class="text-amber-900">1. <a class="font-medium underline" href={wizard.url} target="_blank" rel="noopener noreferrer">Open the sign-in page</a> and sign in.</p>
    <p class="text-amber-900">2. {wizard.codeLabel ?? "Paste the code the page shows at the end:"}</p>
    <div class="flex items-center gap-2">
      <input class="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 font-mono text-sm outline-none focus:border-zinc-900"
        bind:value={code} placeholder="code from the sign-in page" autocomplete="off" spellcheck="false"
        on:keydown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitCode(); } }} />
      <button type="button" class="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:bg-zinc-300" disabled={!code.trim()} on:click={submitCode}>Confirm</button>
    </div>
    {#if wizard.error}<p class="text-red-700">{wizard.error}</p>{/if}
    <p class="text-xs text-amber-900/60">{wizard.hint ?? "The link is valid for 15 minutes."}</p>
  {:else if wizard.state === "verifying"}
    <p class="text-amber-900">Checking the code…</p>
  {:else if wizard.state === "failed" || wizard.state === "cancelled"}
    <p class="text-red-700">Setup failed{wizard.error ? `: ${wizard.error}` : ""}.</p>
    {#if wizard.hint}<p class="text-xs text-amber-900/70">{wizard.hint}</p>{/if}
    <button type="button" class="self-start rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700" on:click={start}>Try again</button>
  {/if}
  {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
</div>
