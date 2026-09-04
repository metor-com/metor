<script>
  // Settings (modal): sections in a list on the left, the chosen section on the right – on a phone
  // the list comes first and a section opens over it (messenger pattern, like the rest of the app).
  // Devices = sign-in, pairing, notifications (ADR-0012/0013); Appearance and Behaviour are
  // per-device preferences from lib/settings.js.
  import Devices from "./Devices.svelte";
  import Switch from "./Switch.svelte";
  import { settings, update } from "../lib/settings.js";
  export let onDone;
  export let tab = "devices";
  let open = false;   // phone: a section is open (list hidden)
  const SECTIONS = [
    { id: "devices", label: "Devices", hint: "Signed-in browsers, link a phone, notifications",
      icon: "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2" },
    { id: "appearance", label: "Appearance", hint: "Text size, the bot list",
      icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" },
    { id: "behaviour", label: "Behaviour", hint: "Order of the bots, default view",
      icon: "M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1M15 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" },
  ];
  $: section = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0];
  const close = () => onDone?.();
  const seg = (on) => `min-w-0 flex-auto truncate rounded-lg px-3 py-2 text-sm transition-colors ${on ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`;
</script>

<div class="fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-3 sm:p-8" role="presentation" on:click={close}>
  <div class="flex h-full max-h-[40rem] w-[48rem] max-w-full overflow-hidden rounded-2xl bg-white shadow-xl" role="dialog" on:click|stopPropagation>

    <!-- Sections: always on desktop; on a phone only while no section is open -->
    <nav class="{open ? 'hidden sm:flex' : 'flex'} w-full shrink-0 flex-col gap-1 bg-zinc-50 p-3 sm:w-56 sm:border-r sm:border-zinc-200 sm:p-4">
      <div class="flex items-center justify-between px-3 pb-4 pt-2">
        <h2 class="text-lg font-bold">Settings</h2>
        <button type="button" class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100 sm:hidden" on:click={close}>Close</button>
      </div>
      {#each SECTIONS as s (s.id)}
        <button type="button"
          class="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-zinc-600 transition-colors hover:bg-white/70 hover:text-zinc-900 sm:py-2.5 {tab === s.id ? 'sm:bg-white sm:text-zinc-900 sm:shadow-sm' : ''}"
          on:click={() => { tab = s.id; open = true; }}>
          <svg class="h-5 w-5 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={s.icon} /></svg>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">{s.label}</span>
            <span class="block truncate text-xs text-zinc-400 sm:hidden">{s.hint}</span>
          </span>
          <span class="text-zinc-300 sm:hidden" aria-hidden="true">›</span>
        </button>
      {/each}
    </nav>

    <!-- The chosen section -->
    <section class="{open ? 'flex' : 'hidden sm:flex'} min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-3 border-b border-zinc-100 px-5 py-4 sm:px-8 sm:py-5">
        <button type="button" class="-ml-2 rounded-lg px-2 py-1 text-xl text-zinc-500 hover:text-zinc-900 sm:hidden" on:click={() => (open = false)} aria-label="Back to the sections">←</button>
        <div class="min-w-0 flex-1">
          <h3 class="text-base font-semibold">{section.label}</h3>
          <p class="truncate text-[13px] text-zinc-500">{section.hint}</p>
        </div>
        <button type="button" class="hidden rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 sm:block" on:click={close}>Close</button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7">
        {#if tab === "devices"}
          <Devices />
        {:else if tab === "appearance"}
          <div class="flex flex-col divide-y divide-zinc-100">
            <div class="flex flex-col gap-3 pb-6">
              <div><div class="text-sm font-medium">Text size</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">Scales the whole interface on this device.</p></div>
              <div class="flex gap-1 rounded-xl bg-zinc-100 p-1">
                {#each [["small", "Small"], ["default", "Default"], ["large", "Large"]] as [v, label] (v)}
                  <button type="button" class={seg($settings.textSize === v)} on:click={() => update({ textSize: v })}>{label}</button>
                {/each}
              </div>
            </div>
            <div class="flex items-center justify-between gap-6 py-6">
              <div><div class="text-sm font-medium">Roles in the bot list</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">The one-line role under each bot name. Off gives a denser list.</p></div>
              <Switch checked={$settings.showRoles} label="Roles in the bot list" onChange={(v) => update({ showRoles: v })} />
            </div>
            <p class="pt-5 text-xs text-zinc-400">These settings belong to this device.</p>
          </div>
        {:else}
          <div class="flex flex-col divide-y divide-zinc-100">
            <div class="flex items-center justify-between gap-6 pb-6">
              <div><div class="text-sm font-medium">Sort bots by latest activity</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">The bot with the newest message moves to the top, like a messenger. Off keeps the alphabetical order.</p></div>
              <Switch checked={$settings.sortByActivity} label="Sort bots by latest activity" onChange={(v) => update({ sortByActivity: v })} />
            </div>
            <div class="flex flex-col gap-3 py-6">
              <div><div class="text-sm font-medium">Open a bot with</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">Side by side shows chat and computer next to each other. It needs a wide screen; phones always start with the chat.</p></div>
              <div class="flex gap-1 rounded-xl bg-zinc-100 p-1">
                {#each [["chat", "Chat"], ["split", "Side by side"]] as [v, label] (v)}
                  <button type="button" class={seg($settings.defaultView === v)} on:click={() => update({ defaultView: v })}>{label}</button>
                {/each}
              </div>
            </div>
            <p class="pt-5 text-xs text-zinc-400">These settings belong to this device.</p>
          </div>
        {/if}
      </div>
    </section>
  </div>
</div>
