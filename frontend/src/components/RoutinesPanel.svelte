<script>
  // Routines of a bot as a pane next to the chat (read-only: the bot creates and changes them
  // itself in the chat). Every routine as a card in plain words – when it runs, next and last run,
  // whether it is paused and why, the task it sends – plus the recent runs of the bot.
  import { onMount } from "svelte";
  import { listRoutines } from "../lib/api.js";
  import { describeCron } from "../lib/cron.js";
  import { dateTimeLabel, relativeLabel } from "../lib/when.js";
  export let bot;
  export let title = null;

  let data = null, error = null, open = {};
  onMount(async () => { try { data = await listRoutines(bot); } catch (e) { error = e.message; data = { routines: [], runs: [] }; } });
  const ms = (iso) => (iso ? Date.parse(iso) : null);
  $: routines = [...(data?.routines ?? [])].sort((a, b) => (ms(a.nextRunAt) ?? Infinity) - (ms(b.nextRunAt) ?? Infinity));
  $: runs = [...(data?.runs ?? [])].reverse().slice(0, 12);
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-50">
  <div class="flex shrink-0 items-baseline justify-between border-b border-zinc-200 bg-white px-5 py-3">
    <h3 class="text-base font-semibold">Routines</h3>
    {#if data}<span class="text-[13px] text-zinc-500">{routines.length === 1 ? "1 routine" : `${routines.length} routines`}</span>{/if}
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
    {#if data === null}
      <p class="text-sm text-zinc-400">Loading routines…</p>
    {:else if !routines.length}
      <div class="rounded-2xl border border-dashed border-zinc-300 bg-white px-5 py-6 text-center">
        <p class="text-sm text-zinc-600">No routines yet.</p>
        <p class="mt-1 text-[13px] leading-relaxed text-zinc-500">Tell {title ?? bot} in the chat what should happen regularly – for example "every weekday at 7 check the news and write me a summary" – and the bot sets the routine up itself.</p>
      </div>
    {:else}
      <ul class="flex flex-col gap-3">
        {#each routines as r (r.id)}
          {@const paused = r.enabled === false}
          <li class="rounded-2xl border bg-white px-4 py-3.5 shadow-sm {paused ? 'border-amber-200' : 'border-zinc-200'}">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-[15px] font-semibold">{r.name}</div>
                <div class="mt-0.5 flex items-center gap-1.5 text-[13px] text-zinc-700" title="cron: {r.cron}">
                  <svg class="size-4 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  <span>{describeCron(r.cron) ?? `cron: ${r.cron}`}</span>
                </div>
              </div>
              <span class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium {paused ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">{paused ? "paused" : "active"}</span>
            </div>
            <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              <dt class="text-zinc-400">Next run</dt>
              <dd class="text-zinc-800">{#if paused || !r.nextRunAt}–{:else}{dateTimeLabel(ms(r.nextRunAt))} <span class="text-zinc-400">· {relativeLabel(ms(r.nextRunAt))}</span>{/if}</dd>
              <dt class="text-zinc-400">Last run</dt>
              <dd class="text-zinc-800">{#if r.lastRunAt}{dateTimeLabel(ms(r.lastRunAt))} <span class="text-zinc-400">· {relativeLabel(ms(r.lastRunAt))}</span>{:else}never{/if}</dd>
            </dl>
            {#if paused && r.pausedReason}
              <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">Paused: {r.pausedReason}. Tell the bot to switch it back on.</p>
            {/if}
            <div class="mt-3 border-t border-zinc-100 pt-2.5">
              <div class="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">What the bot is asked to do</div>
              <p class="mt-1 text-[13px] leading-relaxed text-zinc-700 {open[r.id] ? '' : 'line-clamp-3'}">{r.prompt}</p>
              {#if r.prompt.length > 160}
                <button type="button" class="mt-1 text-xs text-zinc-500 underline hover:text-zinc-900" on:click={() => (open[r.id] = !open[r.id])}>{open[r.id] ? "less" : "more"}</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      {#if runs.length}
        <h4 class="mt-6 mb-2 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Recent runs</h4>
        <ul class="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
          {#each runs as run (run.id)}
            <li class="flex items-baseline justify-between gap-3 px-4 py-2 text-[13px]">
              <span class="truncate text-zinc-700">{run.name}</span>
              <span class="shrink-0 text-zinc-400">{dateTimeLabel(ms(run.ts))}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="mt-4 text-xs leading-relaxed text-zinc-400">Create, change, pause or delete a routine in the chat – the bot manages them itself. Times are the computer's local time.</p>
    {/if}
    {#if error}<p class="mt-2 text-[13px] text-red-600">{error}</p>{/if}
  </div>
</div>
