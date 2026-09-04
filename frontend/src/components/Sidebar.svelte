<script>
  // The bot list, messenger style: avatar with the status dot, title, time of the last message,
  // its preview and the unread badge (counts and previews come from the gateway's agents list).
  import StatusDot from "./StatusDot.svelte";
  import AgentCreate from "./AgentCreate.svelte";
  import Settings from "./Settings.svelte";
  import { settings } from "../lib/settings.js";
  import { statusLabel } from "../lib/status.js";
  import { whenLabel } from "../lib/when.js";
  export let agents = [];
  export let selected = null;
  export let quota = null;
  export let onSelect;
  export let onCreated;
  export let hiddenOnMobile = false;   // mobile: list OR chat (messenger pattern); desktop: always visible
  let creating = false, showSettings = false, menuOpen = false;
  const pct = (v) => (v == null ? null : Math.round(v <= 1 ? v * 100 : v));
  // Quota bar (Settings → Appearance): always, never, or once a window reaches the chosen usage
  $: showQuota = !!quota && pct(quota.fiveHour) != null && ($settings.quota === "always"
    || ($settings.quota === "threshold" && Math.max(pct(quota.fiveHour) ?? 0, pct(quota.sevenDay) ?? 0) >= ($settings.quotaThreshold ?? 80)));
  const initial = (a) => (a.title ?? a.name ?? "?").trim().charAt(0).toUpperCase() || "?";
  // Second line: what the bot is doing right now beats the last message; then the message; then the role
  const preview = (a) => {
    if (a.status === "busy") return { text: "working…", cls: "text-emerald-700" };
    if (a.status === "waiting") return { text: "waiting for your approval", cls: "text-amber-700" };
    if (a.status === "setting up") return { text: "setting up…", cls: "text-zinc-400" };
    const m = a.lastMessage;
    if (m?.text) return { text: m.who === "you" ? `You: ${m.text}` : m.who === "approval" ? m.text : m.text, cls: a.unread ? "text-zinc-800" : "text-zinc-500" };
    return { text: a.role || statusLabel(a.status), cls: "text-zinc-400" };
  };
</script>

<svelte:window on:click={() => (menuOpen = false)} />
<aside class="{hiddenOnMobile ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col bg-white md:w-72 md:border-r md:border-zinc-200">
  <!-- Messenger header: wordmark, the ⋮ menu (Settings) and the round + for a new bot -->
  <div class="flex shrink-0 items-center justify-between px-4 py-3">
    <span class="text-2xl font-bold tracking-tight text-zinc-900">metor</span>
    <div class="flex items-center gap-1">
      <div class="relative">
        <button type="button" class="flex size-10 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100" aria-label="Menu" title="Menu"
          on:click|stopPropagation={() => (menuOpen = !menuOpen)}>
          <svg class="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
        </button>
        {#if menuOpen}
          <div class="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
            <button type="button" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={() => { menuOpen = false; showSettings = true; }}>Settings</button>
          </div>
        {/if}
      </div>
      <button type="button" class="flex size-9 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm hover:bg-zinc-700" aria-label="New bot" title="New bot"
        on:click={() => (creating = true)}>
        <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  </div>
  <ul class="min-h-0 flex-1 overflow-y-auto p-2">
    {#each agents as a (a.name)}
      {@const p = preview(a)}
      <li>
        <button
          class="flex w-full items-center gap-3 rounded-xl px-3 {$settings.compactList ? 'py-2' : 'py-2.5'} text-left transition-colors {a.name === selected ? 'bg-zinc-100' : 'hover:bg-zinc-50'}"
          on:click={() => onSelect(a.name)}
        >
          <span class="relative shrink-0">
            <span class="flex {$settings.compactList ? 'size-8 text-sm' : 'size-11 text-base'} items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-700">{initial(a)}</span>
            <span class="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white leading-none {a.name === selected ? 'border-zinc-100' : ''}"><StatusDot status={a.status} /></span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline justify-between gap-2">
              <strong class="truncate text-[15px] font-semibold">{a.title ?? a.name}</strong>
              <span class="shrink-0 text-xs {a.unread ? 'font-medium text-zinc-900' : 'text-zinc-400'}">{whenLabel(a.lastMessageAt)}</span>
            </span>
            {#if !$settings.compactList}
              <span class="mt-0.5 flex items-center justify-between gap-2">
                <span class="truncate text-[13px] {p.cls}">{p.text}</span>
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
