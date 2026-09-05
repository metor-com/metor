<script>
  // Change a bot's picture: initials and colour, or an image of your own (PNG, JPEG, WebP, GIF, up to 2 MB).
  import Avatar from "./Avatar.svelte";
  import { PALETTE, initialsOf, colorFor } from "../lib/avatar.js";
  import { setAvatar, uploadAvatar, resetAvatar } from "../lib/api.js";
  export let agent;
  export let onDone;            // () => void – closed (saved or cancelled)
  let initials = agent.avatar?.initials ?? initialsOf(agent.title ?? agent.name);
  let color = agent.avatar?.color ?? colorFor(agent.name);
  let file = null, preview = null, removeImage = false, busy = false, error = null, fileInput;
  $: hasImage = !!agent.avatarAt && !removeImage;
  function chooseFile(e) {
    const f = e.currentTarget.files?.[0]; e.currentTarget.value = "";
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { error = "The picture must be at most 2 MB."; return; }
    file = f; removeImage = false; error = null;
    if (preview) URL.revokeObjectURL(preview); preview = URL.createObjectURL(f);
  }
  async function save() {
    busy = true; error = null;
    try {
      const t = initials.trim();
      if (t && [...t].length <= 3) await setAvatar(agent.name, { initials: t, color });
      if (file) await uploadAvatar(agent.name, file);
      else if (removeImage && agent.avatarAt) await resetAvatar(agent.name);
      onDone?.();
    } catch (e) { error = e.message; busy = false; }
  }
  const swatch = "size-7 rounded-full border-2 transition-transform hover:scale-110";
</script>

<div class="fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-4" role="presentation" on:click={() => onDone?.()}>
  <form class="flex w-[22rem] max-w-full flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl" on:click|stopPropagation on:submit|preventDefault={save}>
    <h2 class="text-lg font-bold">Picture of {agent.title ?? agent.name}</h2>
    <div class="flex items-center gap-4">
      <Avatar {agent} look={{ initials: initials.trim() || "?", color }} image={file ? preview : hasImage ? undefined : null} size={72} />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <button type="button" class="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50" on:click={() => fileInput?.click()}>{hasImage || file ? "Choose another image…" : "Upload an image…"}</button>
        {#if hasImage || file}<button type="button" class="self-start text-[13px] text-zinc-500 underline hover:text-zinc-900" on:click={() => { file = null; removeImage = true; }}>Use initials instead</button>{/if}
        <span class="text-xs text-zinc-400">PNG, JPEG, WebP or GIF, up to 2 MB, square works best.</span>
      </div>
    </div>
    <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Initials (one to three characters)
      <input class="w-24 rounded-lg border border-zinc-300 px-2.5 py-2 text-center text-[15px] font-semibold uppercase text-zinc-900 outline-none focus:border-zinc-900" bind:value={initials} maxlength="3" spellcheck="false" />
    </label>
    <div class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Colour
      <div class="flex flex-wrap items-center gap-2">
        {#each PALETTE as c (c)}
          <button type="button" class="{swatch} {color === c ? 'border-zinc-900' : 'border-transparent'}" style="background:{c}" aria-label={c} on:click={() => (color = c)}></button>
        {/each}
        <label class="ml-1 flex items-center gap-1.5 text-xs text-zinc-500">own
          <input type="color" class="size-7 cursor-pointer rounded border border-zinc-300 bg-white p-0.5" bind:value={color} />
        </label>
      </div>
    </div>
    {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <button type="button" class="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm hover:bg-zinc-50" on:click={() => onDone?.()}>Cancel</button>
      <button type="submit" class="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm text-white hover:bg-zinc-700 disabled:bg-zinc-300" disabled={busy || !initials.trim()}>{busy ? "Saving…" : "Save"}</button>
    </div>
    <input class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" bind:this={fileInput} on:change={chooseFile} />
  </form>
</div>
