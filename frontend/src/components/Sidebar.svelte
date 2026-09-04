<script>
  import StatusDot from "./StatusDot.svelte";
  import AgentCreate from "./AgentCreate.svelte";
  import Settings from "./Settings.svelte";
  import { settings } from "../lib/settings.js";
  import { statusLabel } from "../lib/status.js";
  export let agents = [];
  export let selected = null;
  export let quota = null;
  export let onSelect;
  export let onCreated;
  export let hiddenOnMobile = false;   // mobile: list OR chat (messenger pattern); desktop: always visible
  let creating = false, showSettings = false;
  const pct = (v) => (v == null ? null : Math.round(v <= 1 ? v * 100 : v));
</script>

<aside class="{hiddenOnMobile ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col bg-white md:w-64 md:border-r md:border-zinc-200">
  <div class="shrink-0 border-b border-zinc-200 px-4 py-4 font-bold">
    metor <span class="ml-1.5 text-[13px] font-normal text-zinc-400">Dock</span>
  </div>
  <ul class="min-h-0 flex-1 overflow-y-auto p-2">
    {#each agents as a (a.name)}
      <li>
        <button
          class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors {a.name === selected ? 'bg-zinc-100' : 'hover:bg-zinc-50'}"
          on:click={() => onSelect(a.name)}
        >
          <StatusDot status={a.status} />
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-sm">{a.title ?? a.name}</strong>
            {#if a.role && $settings.showRoles}<span class="block truncate text-xs text-zinc-500">{a.role}</span>{/if}
          </span>
          <span class="shrink-0 text-xs text-zinc-400">{statusLabel(a.status)}</span>
        </button>
      </li>
    {/each}
    {#if !agents.length}<li class="p-3 text-sm text-zinc-400">no bots yet</li>{/if}
  </ul>
  {#if quota && pct(quota.fiveHour) != null}
    <div class="mx-3 shrink-0 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500" title="Usage of the Claude subscription – all Claude bots share this quota (other runtimes have their own quotas)">
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
  <div class="m-3 flex shrink-0 gap-2">
    <button
      class="min-w-0 flex-1 rounded-xl border border-dashed border-zinc-300 px-3 py-2.5 text-sm text-zinc-500 transition-colors hover:border-zinc-900 hover:text-zinc-900"
      on:click={() => (creating = true)}
    >+ New bot</button>
    <button class="shrink-0 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-500 transition-colors hover:border-zinc-900 hover:text-zinc-900"
      title="Devices, appearance, behaviour" aria-label="Settings" on:click={() => (showSettings = true)}>⚙︎ Settings</button>
  </div>
  {#if creating}
    <AgentCreate onDone={(name, title) => { creating = false; if (name) onCreated(name, title); }} />
  {/if}
  {#if showSettings}
    <Settings onDone={() => (showSettings = false)} />
  {/if}
</aside>
