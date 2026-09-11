<script>
  // Settings (modal): sections in a list on the left, the chosen section on the right – on a phone
  // the list comes first and a section opens over it (messenger pattern, like the rest of the app).
  // Devices = sign-in, pairing, notifications (ADR-0012/0013); Appearance and Behaviour are
  // per-device preferences from lib/settings.js.
  import { onMount } from "svelte";
  import { app, space, gateway } from "../lib/base.js";
  import ServerSetup from "./ServerSetup.svelte";
  let managingServer = false;
  import SpaceAllocation from "./SpaceAllocation.svelte";
  import SpaceMemory from "./SpaceMemory.svelte";
  import Devices from "./Devices.svelte";
  import Connectors from "./Connectors.svelte";
  import Switch from "./Switch.svelte";
  import { settings, update } from "../lib/settings.js";
  import { versionInfo, spaceInfo, renameSpace } from "../lib/api.js";
  export let onDone;
  export let mode = "app";
  export let spaceName = "Space";
  // Computer: metor's version, the newest release, the runtimes the box carries (all from /bots/api/version)
  let info = null, infoError = null, nameDraft = "", nameLoaded = false, nameBusy = false, nameError = null, nameSaved = false, nameDirty = false;
  $: if (nameLoaded && !nameDirty && $space?.name) nameDraft = $space.name;
  async function saveName() {
    nameBusy = true; nameError = null; nameSaved = false;
    try { const value = await renameSpace(nameDraft); space.set(value); nameDraft = value.name; nameDirty = false; nameSaved = true; }
    catch (e) { nameError = e.message; }
    finally { nameBusy = false; }
  }
  onMount(() => {
    if (mode !== 'admin') return;
    spaceInfo().then(value => { space.set(value); nameDraft = value.name; nameLoaded = true; }).catch(e => nameError = e.message);
    versionInfo().then(v => info = v).catch(e => infoError = e.message);
  });
  const RUNTIME_NAMES = { claude: "Claude Code (Agent SDK)", codex: "Codex CLI", gemini: "Gemini CLI", copilot: "Copilot CLI" };
  export let tab = mode === "admin" ? "general" : "appearance";
  let open = false;   // phone: a section is open (list hidden)
  const ALL_SECTIONS = [
    { id: "general", label: "General", hint: "Space name on all devices", icon: "M4 4h16v16H4zM8 8h8M8 12h6" },
    { id: "devices", label: "My devices & notifications", hint: "Your access to this Space",
      icon: "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2" },
    { id: "connectors", label: "Connectors", hint: "MCP servers for every bot",
      icon: "M9 2v5M15 2v5M5 7h14v3a7 7 0 0 1-14 0V7zM12 17v5" },
    { id: "appearance", label: "Appearance", hint: "Text size, the bot list",
      icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" },
    { id: "behaviour", label: "Behaviour", hint: "Order of the bots, default view",
      icon: "M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1M15 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" },
    { id: "computer", label: "Resources & updates", hint: "RAM, version, updates, runtimes",
      icon: "M3 5h18v11H3zM8 21h8M12 16v5" },
  ];
  $: SECTIONS = ALL_SECTIONS.filter(s => (mode === "admin" ? ["general","devices","computer","connectors"] : ["appearance","behaviour"]).includes(s.id));
  $: heading = mode === "admin" ? `Manage Space · ${$space?.name ?? spaceName}` : "App settings";
  $: section = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0];
  async function backFromServer() {
    managingServer = false;
    try { info = await versionInfo(); infoError = null; }
    catch (e) { infoError = e.message; }
  }
  const close = () => onDone?.();
  const seg = (on) => `min-w-0 flex-auto truncate rounded-lg px-3 py-2 text-sm transition-colors ${on ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`;
</script>

<div class="fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-3 sm:p-8" role="presentation" on:click={close}>
  <div class="flex h-full max-h-[40rem] w-[48rem] max-w-full overflow-hidden rounded-2xl bg-white shadow-xl" role="dialog" aria-label={heading} on:click|stopPropagation>

    <!-- Sections: always on desktop; on a phone only while no section is open -->
    <nav class="{open ? 'hidden sm:flex' : 'flex'} w-full shrink-0 flex-col gap-1 bg-zinc-50 p-3 sm:w-56 sm:border-r sm:border-zinc-200 sm:p-4">
      <div class="flex items-center justify-between px-3 pb-4 pt-2">
        <h2 class="break-words text-base font-bold">{heading}</h2>
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
          {#if mode !== "app"}<p class="mb-1 break-words text-xs text-zinc-500 sm:hidden">{heading}</p>{/if}
          <h3 class="text-base font-semibold">{section.label}</h3>
          <p class="truncate text-[13px] text-zinc-500">{section.hint}</p>
        </div>
        <button type="button" class="hidden rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 sm:block" on:click={close}>Close</button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7">
        {#if tab === "general"}
          <form class="flex flex-col gap-3" on:submit|preventDefault={saveName}>
            <label for="space-name" class="text-sm font-medium">Space name</label>
            <input id="space-name" class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" bind:value={nameDraft} maxlength="60" required disabled={!nameLoaded || nameBusy} on:input={() => { nameSaved = false; nameDirty = true; }} />
            <p class="text-[13px] text-zinc-500">This name is shared across all your connected devices.</p>
            <button class="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={!nameLoaded || nameBusy || !nameDraft.trim()}>{nameBusy ? "Saving…" : "Save name"}</button>
            {#if nameError}<p role="alert" class="text-sm text-red-600">{nameError}</p>{/if}
            {#if nameSaved}<p role="status" class="text-sm text-zinc-500">Name saved on this Space.</p>{/if}
          </form>
        {:else if tab === "devices"}
          <Devices />
        {:else if tab === "connectors"}
          <Connectors />
        {:else if tab === "computer"}
          {#if managingServer && app?.server && $gateway && !$gateway.local}
            <ServerSetup manageId={$gateway.id} spaceDomain={new URL($gateway.origin).hostname} onBack={backFromServer} />
          {:else}
          <div class="flex flex-col divide-y divide-zinc-100">
            {#if app?.server?.status && $gateway && !$gateway.local && $gateway.origin.startsWith('https://')}
              <div class="flex flex-col gap-2 pb-6">
                <div class="text-sm font-medium">Server</div>
                <p class="text-[13px] text-zinc-500">Check Docker status, free disk and restarts, or update this Space. Available for servers set up through metor.</p>
                <button class="self-start rounded-lg border border-zinc-300 px-3 py-2 text-sm" on:click={() => managingServer = true}>Manage server…</button>
              </div>
            {/if}
            <SpaceAllocation />
            <SpaceMemory />
            <div class="flex flex-col gap-2 py-6">
              <div class="flex items-baseline justify-between gap-4">
                <div class="text-sm font-medium">metor {info?.version ?? "…"}</div>
                {#if info?.latest?.newer}<span class="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">{info.latest.version} available</span>
                {:else if info?.latest}<span class="text-xs text-zinc-400">up to date</span>{/if}
              </div>
              {#if infoError}<p class="text-[13px] text-red-600">{infoError}</p>{/if}
              {#if info?.latest?.newer}
                <p class="text-[13px] leading-relaxed text-zinc-500">Release {info.latest.version} is out{#if info.latest.url} – <a class="underline" href={info.latest.url} target="_blank" rel="noopener noreferrer">what changed</a>{/if}. Bots, histories and sign-ins survive an update.</p>
                <p class="text-[13px] leading-relaxed text-zinc-500">On a server, use Manage server in the desktop app or follow the <a class="underline" href="https://github.com/metor-com/metor/blob/main/INSTALL.md#operations" target="_blank" rel="noopener noreferrer">server update instructions</a>. On a Mac: <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">metor box update</code>.</p>
              {:else if info && !info.latest}
                <p class="text-[13px] leading-relaxed text-zinc-500">{info.updateCheck ? "The newest release has not been looked up yet – the Space checks GitHub once a day." : "The Space does not check for new releases (METOR_UPDATE_CHECK=off)."}</p>
              {/if}
            </div>
            <div class="flex flex-col gap-2 py-6">
              <div class="text-sm font-medium">Runtimes</div>
              {#if info?.runtimes}
                <ul class="text-[13px] text-zinc-700">
                  {#each Object.entries(RUNTIME_NAMES) as [id, name] (id)}
                    <li class="flex justify-between gap-4 py-1"><span>{name}</span><span class="font-mono text-zinc-500">{info.runtimes[id] ?? "–"}</span></li>
                  {/each}
                </ul>
              {/if}
              <p class="text-[13px] leading-relaxed text-zinc-500">The runtimes travel with metor: an update of metor brings the versions that were tested together, and with them new models. Codex's model list, for one, is the CLI's own catalogue.</p>
            </div>
          </div>
          {/if}
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
              <div><div class="text-sm font-medium">Compact bot list</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">One line per bot, without the last message underneath.</p></div>
              <Switch checked={$settings.compactList} label="Compact bot list" onChange={(v) => update({ compactList: v })} />
            </div>
            {#if app?.writeClipboard}
              <div class="flex items-center justify-between gap-6 py-6">
                <div><div class="text-sm font-medium">Sync clipboard with active screen</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">Copy in the bot’s browser to paste on your computer. Paste on the screen to send local text. Only active while the screen has focus.</p></div>
                <Switch checked={$settings.syncScreenClipboard} label="Sync clipboard with active screen" onChange={(v) => update({ syncScreenClipboard: v })} />
              </div>
            {/if}
            <div class="flex flex-col gap-3 py-6">
              <div><div class="text-sm font-medium">Claude quota</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">The usage bar of the Claude subscription at the bottom of the bot list.</p></div>
              <div class="flex gap-1 rounded-xl bg-zinc-100 p-1">
                {#each [["always", "Always"], ["threshold", "From a usage of…"], ["never", "Never"]] as [v, label] (v)}
                  <button type="button" class={seg($settings.quota === v)} on:click={() => update({ quota: v })}>{label}</button>
                {/each}
              </div>
              {#if $settings.quota === "threshold"}
                <label class="flex items-center gap-3 text-[13px] text-zinc-600">
                  <input type="range" min="10" max="95" step="5" class="flex-1 accent-zinc-900" value={$settings.quotaThreshold} on:input={(e) => update({ quotaThreshold: Number(e.currentTarget.value) })} />
                  <span class="w-24 shrink-0 text-right">from <strong class="text-zinc-900">{$settings.quotaThreshold}%</strong></span>
                </label>
                <p class="text-xs text-zinc-400">Shown as soon as the 5-hour or the weekly window reaches that usage.</p>
              {/if}
            </div>
            <p class="pt-5 text-xs text-zinc-400">These settings belong to this device.</p>
          </div>
        {:else}
          <div class="flex flex-col divide-y divide-zinc-100">
            <div class="flex items-center justify-between gap-6 pb-6">
              <div><div class="text-sm font-medium">Sort bots by latest activity</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">The bot with the newest message moves to the top, like a messenger. Off keeps the alphabetical order.</p></div>
              <Switch checked={$settings.sortByActivity} label="Sort bots by latest activity" onChange={(v) => update({ sortByActivity: v })} />
            </div>
            <div class="flex items-center justify-between gap-6 py-6">
              <div><div class="text-sm font-medium">Adapt screen resolution to panel</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">Adjust the bot’s screen after resizing the panel, once the bot is idle. Off keeps the current resolution and scales the view to fit. Other devices viewing this bot share its screen resolution.</p></div>
              <Switch checked={$settings.autoResizeScreen} label="Adapt screen resolution to panel" onChange={(v) => update({ autoResizeScreen: v })} />
            </div>
            <div class="flex flex-col gap-3 py-6">
              <div><div class="text-sm font-medium">Open a bot with</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">Whether the bot's computer is shown next to the chat from the start. The computer button in the header toggles it at any time; the divider between chat and computer can be dragged.</p></div>
              <div class="flex gap-1 rounded-xl bg-zinc-100 p-1">
                {#each [["chat", "Chat only"], ["split", "Chat and computer"]] as [v, label] (v)}
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
