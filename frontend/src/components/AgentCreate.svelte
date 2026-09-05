<script>
  import { onDestroy } from "svelte";
  import { createAgent, listHarnesses, setupStart, setupStatus, setupCancel, setupCode } from "../lib/api.js";
  import { slugify, isValidId } from "../lib/slug.js";
  export let onDone;
  // The name is free text (title); the id – directory, links, address between bots – is derived
  // from it live and can be overridden. The gateway computes the id again and is authoritative.
  let name = "", role = "", busy = false, error = null;
  let id = "", idEdited = false;
  $: previewId = idEdited ? id.trim() : slugify(name);
  $: idOk = !idEdited || isValidId(id.trim());
  let harnesses = null, harness = "claude-stream", model = null;
  let modelId = "";   // "Other model id…": a full id the runtime knows (claude-fable-5-1), for models the list has no name for yet
  const OTHER = "__other";
  $: chosenModel = model === OTHER ? modelId.trim() : model;
  // The real id behind the chosen alias, as the bots' answers reported it (null until a bot of that family has answered)
  $: resolvedId = current?.models.find((m) => m.id === model)?.resolved ?? null;
  let lastResolved = null;
  $: if (model === OTHER) { if (!modelId.trim() && lastResolved) modelId = lastResolved; } else lastResolved = resolvedId;
  $: modelOk = model !== OTHER || /^[A-Za-z0-9][\w.:[\]-]{0,63}$/.test(modelId.trim());
  let wizard = null, pollTimer = null, code = "";   // wizard: state of the sign-in for the selected runtime
  const ACTIVE = ["starting", "pending", "verifying"];

  loadHarnesses();
  async function loadHarnesses() {
    try {
      harnesses = await listHarnesses();
      pick(harnesses.find((h) => h.id === harness) ?? harnesses[0]);
    } catch (e) { error = e.message; harnesses = []; }
  }
  $: current = harnesses?.find((h) => h.id === harness) ?? null;
  function pick(h) {
    if (!h) return;
    harness = h.id;
    model = h.models.find((m) => m.default)?.id ?? h.models[0]?.id ?? null;
    stopWizard();
  }

  // ---------- Setup wizard: the runtime's official sign-in, driven from here ----------
  // mode "device": link + one-time code shown here, confirmed at the provider (Codex)
  // mode "code":   link shown here, the provider shows a code at the end, pasted here (Claude Code)
  async function startWizard() {
    error = null; code = "";
    try { wizard = await setupStart(harness); poll(); } catch (e) { error = e.message; }
  }
  function poll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        wizard = await setupStatus(harness);
        if (wizard.state === "done") { await loadHarnesses(); wizard = null; return; }
        if (ACTIVE.includes(wizard.state)) poll();
      } catch { poll(); }
    }, 2000);
  }
  async function submitCode() {
    if (!code.trim()) return;
    error = null;
    try { wizard = await setupCode(harness, code.trim()); if (wizard.state === "verifying") code = ""; poll(); } catch (e) { error = e.message; }
  }
  function stopWizard() { clearTimeout(pollTimer); if (wizard && ACTIVE.includes(wizard.state)) setupCancel(harness).catch(() => {}); wizard = null; }
  onDestroy(() => clearTimeout(pollTimer));
  const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {});

  async function submit() {
    busy = true; error = null;
    try {
      const r = await createAgent(name.trim(), role.trim(), harness, chosenModel, idEdited ? id.trim() : undefined);
      onDone?.(r.name, name.trim());
    } catch (e) { error = e.message; busy = false; }
  }
</script>

<div class="fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-4" role="presentation" on:click={() => { stopWizard(); onDone?.(null); }}>
  <form class="flex w-[26rem] max-w-full flex-col gap-3.5 rounded-2xl bg-white p-5 shadow-xl" on:click|stopPropagation on:submit|preventDefault={submit}>
    <h2 class="text-lg font-bold">New bot</h2>
    <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Name
      <input class="rounded-lg border border-zinc-300 px-2.5 py-2 text-[15px] text-zinc-900 outline-none focus:border-zinc-900" bind:value={name} placeholder="e.g. Scout or Fußball-Späher 2" maxlength="60" required autofocus />
      <span class="flex items-center gap-1.5 text-xs text-zinc-400">
        {#if idEdited}
          <span>id</span>
          <input class="w-40 rounded border px-1.5 py-0.5 font-mono text-xs text-zinc-700 outline-none {idOk ? 'border-zinc-300 focus:border-zinc-900' : 'border-red-400'}" bind:value={id} spellcheck="false" autocapitalize="off" />
          <button type="button" class="underline hover:text-zinc-700" on:click={() => { idEdited = false; id = ""; }}>derive from the name</button>
        {:else}
          <span>id: <code class="text-zinc-600">{previewId || "assigned automatically"}</code> – directory, links and the address other bots use</span>
          <button type="button" class="shrink-0 underline hover:text-zinc-700" on:click={() => { id = previewId; idEdited = true; }}>change</button>
        {/if}
      </span>
    </label>
    <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Role
      <textarea rows="3" class="resize-none rounded-lg border border-zinc-300 px-2.5 py-2 text-[15px] text-zinc-900 outline-none focus:border-zinc-900" bind:value={role} placeholder="What should this bot do?"></textarea>
    </label>
    {#if harnesses === null}
      <p class="text-[13px] text-zinc-400">Loading runtimes…</p>
    {:else if harnesses.length}
      <div class="flex gap-2.5">
        <label class="flex flex-1 flex-col gap-1.5 text-[13px] text-zinc-500">Runtime
          <select class="rounded-lg border border-zinc-300 px-2 py-2 text-[15px] text-zinc-900 outline-none focus:border-zinc-900"
            value={harness} on:change={(e) => pick(harnesses.find((h) => h.id === e.target.value))}>
            {#each harnesses as h (h.id)}<option value={h.id}>{h.label}{h.setup.ok ? "" : " – not set up"}</option>{/each}
          </select>
        </label>
        <label class="flex flex-1 flex-col gap-1.5 text-[13px] text-zinc-500">Model
          <select class="rounded-lg border border-zinc-300 px-2 py-2 text-[15px] text-zinc-900 outline-none focus:border-zinc-900" bind:value={model}>
            {#each current?.models ?? [] as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
            <option value={OTHER}>Other model id…</option>
          </select>
        </label>
      </div>
      {#if model !== OTHER && resolvedId}
        <p class="-mt-1 text-xs text-zinc-400">Right now that is <code class="font-mono">{resolvedId}</code> – the name follows the newest model; to pin this one, choose <em>Other model id…</em>.</p>
      {/if}
      {#if model === OTHER}
        <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Model id
          <input class="rounded-lg border border-zinc-300 px-2 py-2 font-mono text-[15px] text-zinc-900 outline-none focus:border-zinc-900" bind:value={modelId} placeholder="claude-fable-5-1" autocapitalize="off" autocorrect="off" spellcheck="false" />
          <span class="text-xs text-zinc-400">A full id the runtime knows; it refuses one it does not. The names above follow the newest models by themselves.</span>
        </label>
      {/if}
    {/if}

    {#if current && !current.setup.ok}
      <div class="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px]">
        {#if !wizard || wizard.state === "idle"}
          <p class="text-amber-900">{current.label} is not set up yet – sign in once with your subscription.</p>
          {#if current.setup.mode === "terminal"}
            <p class="text-amber-900/80">Run once in the terminal:</p>
            <code class="block overflow-x-auto rounded-lg bg-amber-100/70 px-2.5 py-1.5 text-xs">{current.setup.command}</code>
          {:else}
            <button type="button" class="self-start rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700" on:click={startWizard}>Sign in</button>
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
          <p class="text-amber-900">2. Paste the {wizard.keyLabel ?? "API key"} here – it stays inside the bots' computer:</p>
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
          <button type="button" class="self-start rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700" on:click={startWizard}>Try again</button>
        {/if}
      </div>
    {/if}

    {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <button type="button" class="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm hover:bg-zinc-50" on:click={() => { stopWizard(); onDone?.(null); }}>Cancel</button>
      <button type="submit" class="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm text-white hover:bg-zinc-700 disabled:bg-zinc-300" disabled={busy || !name.trim() || !idOk || !modelOk || !current?.setup.ok}>{busy ? "Setting up…" : "Create"}</button>
    </div>
    <p class="text-xs text-zinc-400">Setup (desktop + session) takes up to a minute.</p>
  </form>
</div>
