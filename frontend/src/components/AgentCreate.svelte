<script>
  import { createAgent, listHarnesses } from "../lib/api.js";
  import RuntimeSignIn from "./RuntimeSignIn.svelte";
  import { slugify, isValidId } from "../lib/slug.js";
  import Avatar from "./Avatar.svelte";
  import { PALETTE, initialsOf, colorFor } from "../lib/avatar.js";
  import { uploadAvatar } from "../lib/api.js";
  export let onDone;
  // The name is free text (title); the id – directory, links, address between bots – is derived
  // from it live and can be overridden. The gateway computes the id again and is authoritative.
  let name = "", role = "", busy = false, error = null;
  let id = "", idEdited = false;
  // The picture: initials follow the name until edited, the colour is drawn from the name until chosen;
  // an image of your own replaces both (uploaded once the bot exists)
  let initials = "", initialsEdited = false, color = PALETTE[0], colorEdited = false, imageFile = null, imagePreview = null, fileInput;
  $: if (!initialsEdited) initials = initialsOf(name);
  $: if (!colorEdited) color = colorFor(name || "bot");
  function chooseImage(e) {
    const f = e.currentTarget.files?.[0]; e.currentTarget.value = "";
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { error = "The picture must be at most 2 MB."; return; }
    imageFile = f; error = null; if (imagePreview) URL.revokeObjectURL(imagePreview); imagePreview = URL.createObjectURL(f);
  }
  // The bot is created in the background – try the upload until its directory exists (a few seconds)
  async function uploadWhenReady(botName, file) {
    for (let i = 0; i < 20; i += 1) { try { await uploadAvatar(botName, file); return; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
  }
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
  }

  // The runtime's sign-in (RuntimeSignIn.svelte) – the harness list is loaded again once it went through

  async function submit() {
    busy = true; error = null;
    try {
      const look = initials.trim() ? { initials: initials.trim().slice(0, 3), color } : { color };
      const r = await createAgent(name.trim(), role.trim(), harness, chosenModel, idEdited ? id.trim() : undefined, look);
      if (imageFile) uploadWhenReady(r.name, imageFile);   // in the background – the list shows the image when it lands
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
    <div class="flex items-center gap-3">
      <Avatar look={{ initials: initials.trim() || "?", color }} image={imagePreview} size={56} />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <input class="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-center text-[15px] font-semibold uppercase text-zinc-900 outline-none focus:border-zinc-900" bind:value={initials} maxlength="3" placeholder="ABC" spellcheck="false" title="Initials, one to three characters"
            on:input={() => (initialsEdited = true)} />
          {#each PALETTE as c (c)}
            <button type="button" class="size-6 rounded-full border-2 transition-transform hover:scale-110 {color === c ? 'border-zinc-900' : 'border-transparent'}" style="background:{c}" aria-label={c} on:click={() => { color = c; colorEdited = true; }}></button>
          {/each}
          <input type="color" class="size-6 cursor-pointer rounded border border-zinc-300 bg-white p-0.5" bind:value={color} title="Own colour" on:input={() => (colorEdited = true)} />
        </div>
        <div class="flex items-center gap-3 text-xs text-zinc-400">
          <button type="button" class="underline hover:text-zinc-700" on:click={() => fileInput?.click()}>{imageFile ? "Choose another image…" : "Or upload an image…"}</button>
          {#if imageFile}<button type="button" class="underline hover:text-zinc-700" on:click={() => { imageFile = null; imagePreview = null; }}>use initials instead</button>{/if}
        </div>
      </div>
    </div>
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
      {#key harness}<RuntimeSignIn harness={current.id} label={current.label} setup={current.setup} onDone={loadHarnesses} />{/key}
    {/if}

    {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <button type="button" class="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm hover:bg-zinc-50" on:click={() => onDone?.(null)}>Cancel</button>
      <button type="submit" class="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm text-white hover:bg-zinc-700 disabled:bg-zinc-300" disabled={busy || !name.trim() || !idOk || !modelOk || !current?.setup.ok}>{busy ? "Setting up…" : "Create"}</button>
    </div>
    <p class="text-xs text-zinc-400">Setup (desktop + session) takes up to a minute.</p>
      <input class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" bind:this={fileInput} on:change={chooseImage} />
  </form>
</div>
