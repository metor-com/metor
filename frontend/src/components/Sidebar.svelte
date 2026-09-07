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
  import { app } from "../lib/base.js";
  export let agents = [];
  export let selected = null;
  export let quota = null;
  export let onSelect;
  export let onCreated;
  export let hiddenOnMobile = false;   // mobile: list OR chat (messenger pattern); desktop: always visible
  // Native clients (ADR-0015) with two or more computers: the head names this computer and leads to
  // the overview of all of them (knowledge/design/several-computers.md); with one, nothing changes
  export let computers = [];
  export let onComputers = null;
  export let onConnect = null;         // the ⋮ menu's "Connect a bots' computer…" (apps only)
  $: several = computers.length >= 2 && !!onComputers;
  $: computerName = computers.find((c) => c.id === app?.gateway?.id)?.short ?? app?.gateway?.short ?? app?.gateway?.name ?? "metor";
  let creating = false, showSettings = false, menuOpen = false;
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
<aside class="{hiddenOnMobile ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col bg-white md:w-72 md:border-r md:border-zinc-200">
  <!-- Head: with several computers a back button (to the overview), the computer's name and the ⋮ menu;
       with one computer the wordmark and the menu. "New bot" sits below the last bot in the list. -->
  <div class="flex shrink-0 items-center gap-1 py-3 {several ? 'pl-2 pr-3' : 'pl-4 pr-3'}">
    {#if several}
      <button type="button" class="flex size-10 shrink-0 items-center justify-center rounded-full text-xl text-zinc-600 hover:bg-zinc-100" on:click={onComputers} title="Your bots' computers" aria-label="Back to your bots' computers">←</button>
      <span class="min-w-0 flex-1 truncate px-1 text-lg font-bold tracking-tight text-zinc-900" title={computerName}>{computerName}</span>
    {:else}
      <span class="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight text-zinc-900">metor</span>
    {/if}
    <div class="relative shrink-0">
      <button type="button" class="flex size-10 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100" aria-label="Menu" title="Menu"
        on:click|stopPropagation={() => (menuOpen = !menuOpen)}>
        <svg class="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
      </button>
      {#if menuOpen}
        <div class="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
          <button type="button" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={() => { menuOpen = false; showSettings = true; }}>Settings</button>
          {#if onConnect}<button type="button" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={() => { menuOpen = false; onConnect(); }}>Connect a bots' computer…</button>{/if}
        </div>
      {/if}
    </div>
  </div>
  <ul class="min-h-0 flex-1 overflow-y-auto p-2">
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
              {#if p.typing && $settings.compactList}<Typing cls="text-zinc-400" />   <!-- no second line here: the dots take the time's place -->
              {:else}<span class="shrink-0 text-xs {a.unread ? 'font-medium text-zinc-900' : 'text-zinc-400'}">{whenLabel(a.lastMessageAt)}</span>{/if}
            </span>
            {#if !$settings.compactList}
              <span class="mt-0.5 flex items-center justify-between gap-2">
                {#if p.typing}<Typing />{:else}<span class="truncate text-[13px] {p.cls}">{p.text}</span>{/if}
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
    <!-- Below the last bot; once the list is longer than the sidebar it sticks to the bottom edge -->
    <li class="sticky -bottom-2 -mx-2 bg-white px-2 pb-2 pt-1">
      <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 {$settings.compactList ? 'py-2' : 'py-2.5'} text-left text-zinc-600 hover:bg-zinc-50" on:click={() => (creating = true)}>
        <span class="flex shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-400 {$settings.compactList ? 'size-8' : 'size-11'}">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </span>
        <span class="text-[15px] font-medium">New bot</span>
      </button>
    </li>
  </ul>
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
