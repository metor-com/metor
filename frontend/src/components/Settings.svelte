<script>
  // Settings (modal) with three areas: Devices (sign-in, pairing, notifications – ADR-0012/0013),
  // Appearance and Behaviour (per-device preferences from lib/settings.js).
  import Devices from "./Devices.svelte";
  import { settings, update } from "../lib/settings.js";
  export let onDone;
  export let tab = "devices";
  const TABS = [["devices", "Devices"], ["appearance", "Appearance"], ["behaviour", "Behaviour"]];
  // Segmented buttons: may shrink and truncate so the row survives the "Large" text size on a phone
  const seg = (on) => `min-w-0 flex-auto truncate rounded-lg px-1.5 py-1.5 text-[13px] transition-colors ${on ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`;
</script>

<div class="fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-4" role="presentation" on:click={() => onDone?.()}>
  <div class="flex max-h-[calc(100dvh-2rem)] w-[28rem] max-w-full flex-col gap-3.5 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" role="dialog" on:click|stopPropagation>
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-lg font-bold">Settings</h2>
      <button type="button" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50" on:click={() => onDone?.()}>Close</button>
    </div>
    <nav class="flex gap-1 rounded-xl bg-zinc-100 p-1">
      {#each TABS as [id, label] (id)}
        <button type="button" class={seg(tab === id)} on:click={() => (tab = id)}>{label}</button>
      {/each}
    </nav>

    {#if tab === "devices"}
      <Devices />
    {:else if tab === "appearance"}
      <section class="flex flex-col gap-4 text-sm">
        <div class="flex flex-col gap-1.5">
          <strong>Text size</strong>
          <div class="flex gap-1 rounded-xl bg-zinc-100 p-1">
            {#each [["small", "Small"], ["default", "Default"], ["large", "Large"]] as [v, label] (v)}
              <button type="button" class={seg($settings.textSize === v)} on:click={() => update({ textSize: v })}>{label}</button>
            {/each}
          </div>
        </div>
        <label class="flex items-center justify-between gap-3">
          <span><strong class="block">Roles in the bot list</strong><span class="text-xs text-zinc-500">The one-line role under each bot name; off gives a denser list.</span></span>
          <input type="checkbox" class="h-5 w-5 shrink-0 accent-zinc-900" checked={$settings.showRoles} on:change={(e) => update({ showRoles: e.currentTarget.checked })} />
        </label>
        <p class="text-xs text-zinc-400">These settings belong to this device.</p>
      </section>
    {:else}
      <section class="flex flex-col gap-4 text-sm">
        <label class="flex items-center justify-between gap-3">
          <span><strong class="block">Sort bots by latest activity</strong><span class="text-xs text-zinc-500">The bot with the newest message moves to the top, like a messenger. Off: alphabetical.</span></span>
          <input type="checkbox" class="h-5 w-5 shrink-0 accent-zinc-900" checked={$settings.sortByActivity} on:change={(e) => update({ sortByActivity: e.currentTarget.checked })} />
        </label>
        <div class="flex flex-col gap-1.5">
          <strong>Open a bot with</strong>
          <div class="flex gap-1 rounded-xl bg-zinc-100 p-1">
            {#each [["chat", "Chat"], ["split", "Side by side"]] as [v, label] (v)}
              <button type="button" class={seg($settings.defaultView === v)} on:click={() => update({ defaultView: v })}>{label}</button>
            {/each}
          </div>
          <span class="text-xs text-zinc-500">Side by side = chat and computer next to each other; needs a wide screen, phones always start with the chat.</span>
        </div>
        <p class="text-xs text-zinc-400">These settings belong to this device.</p>
      </section>
    {/if}
  </div>
</div>
