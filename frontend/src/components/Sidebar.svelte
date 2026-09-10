<script>
  // The bot list, messenger style: picture, title, time of the last message, a second line with
  // what the bot is up to (or its last message) and the unread badge (counts and previews come
  // from the gateway's agents list). No status dot: a stopped bot is greyed out, a working one
  // shows three pulsing dots, an error is the last message in red.
  import Typing from "./Typing.svelte";
  import AgentCreate from "./AgentCreate.svelte";
  import Settings from "./Settings.svelte";
  import { settings } from "../lib/settings.js";
  import { whenLabel } from "../lib/when.js";
  import { app, gateway } from "../lib/base.js";
  import { loadComputers } from "../lib/session.js";
  export let agents = [];
  export let selected = null;
  export let quota = null;
  export let onSelect;
  export let onCreated;
  export let title = null;             // App.svelte: another computer's name while its list slides in before the switch
  // Native clients (ADR-0015, knowledge/design/several-computers.md): the head names the computer shown,
  // centred next to a back arrow that leads to the overview of all computers; the ⋮ menu holds what
  // concerns this computer – rename, remove. A browser (one computer, no overview) shows the wordmark
  // and a ⋮ menu with Settings.
  export let computers = [];
  export let onComputers = null;
  $: currentId = $gateway?.id ?? null;   // follows a warm switch
  $: inApp = !!app && !!onComputers;
  $: computerName = title ?? computers.find((c) => c.id === currentId)?.short ?? $gateway?.short ?? $gateway?.name ?? "metor";
  let creating = false, showSettings = false, menuOpen = false;
  async function renameComputer() {
    const c = computers.find((x) => x.id === currentId); const name = prompt("Name of this Space", c?.name ?? computerName); if (name == null) return;
    try { await app.rename(currentId, name.trim()); await loadComputers(); } catch (e) { alert(e.message); }
  }
  async function forgetComputer() {
    if (!confirm(`Forget "${computerName}"? The app signs out of it; the Space and its bots stay as they are.`)) return;
    try { await app.forget(currentId); } catch (e) { alert(e.message); }   // the app shows the connect screen
  }
  const pct = (v) => (v == null ? null : Math.round(v <= 1 ? v * 100 : v));
  // Quota bar (Settings → Appearance): always, never, or once a window reaches the chosen usage
  $: showQuota = !!quota && pct(quota.fiveHour) != null && ($settings.quota === "always"
    || ($settings.quota === "threshold" && Math.max(pct(quota.fiveHour) ?? 0, pct(quota.sevenDay) ?? 0) >= ($settings.quotaThreshold ?? 80)));
  import Avatar from "./Avatar.svelte";
  // Second line: an open approval beats everything, then the dots while the bot works or starts,
  // then the last message (an error in red), then the role
  const working = (a) => a.status === "busy" || a.status === "starting" || a.status === "setting up";
  const preview = (a) => {
    const m = a.lastMessage;
    if (m?.who === "approval" && m.pending) return { text: "waiting for your approval", cls: "text-amber-700" };
    if (working(a)) return { typing: true };
    if (m?.who === "error") return { text: m.text, cls: "text-red-600" };
    if (m?.text) return { text: m.who === "you" ? `You: ${m.text}` : m.text, cls: a.unread ? "text-zinc-800" : "text-zinc-500" };
    return { text: a.role || "", cls: "text-zinc-400" };
  };
</script>

<svelte:window on:click={() => (menuOpen = false)} />
<aside class="flex h-full w-full flex-col bg-white">
  <!-- Head: in an app the back arrow to the overview and the computer's name centred, in a browser the
       wordmark; at the right the ⋮ menu. The round + for a new bot floats bottom right over the list. -->
  <div class="{inApp ? 'grid grid-cols-[2.5rem_1fr_2.5rem]' : 'flex justify-between'} shrink-0 items-center gap-1 py-3 {inApp ? 'pl-2' : 'pl-4'} pr-3">
    {#if inApp}
      <button type="button" class="flex size-10 items-center justify-center rounded-full text-xl text-zinc-600 hover:bg-zinc-100" on:click={onComputers} title="Your Spaces" aria-label="Back to your Spaces">←</button>
      <span class="min-w-0 truncate text-center text-lg font-bold tracking-tight text-zinc-900" title={computerName}>{computerName}</span>
    {:else}
      <span class="min-w-0 truncate text-2xl font-bold tracking-tight text-zinc-900">metor</span>
    {/if}
    <div class="flex items-center justify-end gap-1">
      <div class="relative">
        <button type="button" class="flex size-10 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100" aria-label="Menu" title="Menu"
          on:click|stopPropagation={() => (menuOpen = !menuOpen)}>
          <svg class="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
        </button>
        {#if menuOpen}
          <div class="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
            {#if inApp}
              <button type="button" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={() => { menuOpen = false; renameComputer(); }}>Rename Space…</button>
              <button type="button" class="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-zinc-50" on:click={() => { menuOpen = false; forgetComputer(); }}>Forget Space</button>
            {:else}
              <button type="button" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={() => { menuOpen = false; showSettings = true; }}>Settings</button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
  <div class="relative flex min-h-0 flex-1 flex-col">
  <ul class="min-h-0 flex-1 overflow-y-auto p-2 pb-20">
    {#each agents as a (a.name)}
      {@const p = preview(a)}
      <li>
        <button
          class="flex w-full items-center gap-3 rounded-xl px-3 {$settings.compactList ? 'py-2' : 'py-2.5'} text-left transition-colors {a.name === selected ? 'bg-zinc-100' : 'hover:bg-zinc-50'} {a.status === 'stopped' ? 'opacity-60' : ''}"
          on:click={() => onSelect(a.name)}
        >
          <Avatar agent={a} size={$settings.compactList ? 32 : 44} />
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline justify-between gap-2">
              <strong class="truncate text-[15px] font-semibold">{a.title ?? a.name}</strong>
              {#if a.waitingForMemory && $settings.compactList}<span class="text-xs text-amber-700" title="Waiting to start">Waiting</span>
              {:else if p.typing && $settings.compactList}<Typing cls="text-zinc-400" />   <!-- no second line here: the dots take the time's place -->
              {:else}<span class="shrink-0 text-xs {a.unread ? 'font-medium text-zinc-900' : 'text-zinc-400'}">{whenLabel(a.lastMessageAt)}</span>{/if}
            </span>
            {#if !$settings.compactList}
              <span class="mt-0.5 flex items-center justify-between gap-2">
                {#if a.waitingForMemory}<span class="truncate text-[13px] text-amber-700">{a.waitingForMemory.reason === "low_memory" ? "Waiting for RAM" : "Waiting to start"}</span>{:else if p.typing}<Typing />{:else}<span class="truncate text-[13px] {p.cls}">{p.text}</span>{/if}
                {#if a.unread}<span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[11px] font-semibold text-white">{a.unread > 99 ? "99+" : a.unread}</span>{/if}
              </span>
            {:else if a.unread}
              <span class="sr-only">{a.unread} unread</span>
            {/if}
          </span>
          {#if $settings.compactList && a.unread}<span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[11px] font-semibold text-white">{a.unread > 99 ? "99+" : a.unread}</span>{/if}
        </button>
      </li>
    {/each}
    {#if !agents.length}<li class="p-3 text-sm text-zinc-400">no bots yet</li>{/if}
  </ul>
  <!-- New Bot: a floating button, bottom right over the list (the list keeps room below its last row) -->
  <button type="button" class="fab absolute bottom-3 right-3 flex size-12 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg hover:bg-zinc-700" aria-label="New Bot" title="New Bot" on:click={() => (creating = true)}>
    <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  </button>
  </div>
  {#if showQuota}
    <div class="m-3 shrink-0 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500" title="Usage of the Claude subscription – all Claude bots share this quota (other runtimes have their own quotas)">
      <div class="mb-1 flex justify-between">
        <span>Claude quota · 5h</span>
        <span>{pct(quota.fiveHour)}%{#if pct(quota.sevenDay) != null} · week {pct(quota.sevenDay)}%{/if}</span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-zinc-200">
        <div class="h-full rounded-full {pct(quota.fiveHour) > 80 ? 'bg-red-500' : pct(quota.fiveHour) > 50 ? 'bg-amber-500' : 'bg-emerald-500'}"
          style="width: {Math.min(pct(quota.fiveHour), 100)}%"></div>
      </div>
    </div>
  {/if}
  {#if creating}
    <AgentCreate onDone={(name, title) => { creating = false; if (name) onCreated(name, title); }} />
  {/if}
  {#if showSettings}
    <Settings onDone={() => (showSettings = false)} />
  {/if}
</aside>
