<script>
  // Routines of a bot (read-only list; the bot creates and changes them itself via chat).
  // Loads on mount – the panel is mounted whenever it is opened, so the list is always fresh.
  import { onMount } from "svelte";
  import { listRoutines } from "../lib/api.js";
  export let bot;
  export let title = null;

  let routines = null;   // null = loading
  const fmtTs = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
  onMount(async () => { try { routines = await listRoutines(bot); } catch { routines = []; } });
</script>

<div class="shrink-0 border-b border-zinc-200 bg-white px-4 py-3">
  {#if routines === null}
    <p class="text-sm text-zinc-400">Loading routines…</p>
  {:else if !routines.routines?.length}
    <p class="text-sm text-zinc-400">No routines yet. Tell {title ?? bot} in the chat what should happen regularly – the bot sets them up itself.</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each routines.routines as r (r.id)}
        <li class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <code class="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-xs">{r.cron}</code>
          <span class="shrink-0 font-medium">{r.name}</span>
          {#if r.enabled === false}<span class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800" title={r.pausedReason ?? ""}>paused</span>{/if}
          <span class="min-w-0 flex-1 truncate text-zinc-500" title={r.prompt}>{r.prompt}</span>
          <span class="shrink-0 basis-full text-xs text-zinc-400 md:basis-auto">last {fmtTs(r.lastRunAt)} · next {fmtTs(r.nextRunAt)} · {r.id}</span>
        </li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-zinc-400">Create, change and delete routines via chat – the bot manages them itself (times in the box's local time).</p>
  {/if}
</div>
