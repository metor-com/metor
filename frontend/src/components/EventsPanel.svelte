<script>
  import { onMount } from "svelte";
  import { listBotEvents } from "../lib/api.js";
  export let bot;
  let events = [], error = null, loaded = false, filter = "all", query = "", count = 100;
  const labels = { "runtime.memory_waiting": "Runtime start waiting", "runtime.memory_resumed": "Runtime start admitted", "host.started": "Bot host started", "host.stopped": "Bot host stopped", "runtime.waking": "Waking runtime", "runtime.ready": "Runtime ready", "runtime.sleep_requested": "Idle timeout reached", "runtime.sleeping": "Runtime sleeping", "runtime.error": "Runtime error", "routine.queued": "Routine queued", "routine.paused": "Routine paused automatically", "turn.queued": "Message queued", "turn.started": "Processing started", "turn.completed": "Processing completed", "turn.failed": "Processing failed", "turn.interrupted": "Processing interrupted", "turn.interrupt_requested": "Stop requested" };
  const problem = e => /error|failed|interrupted/.test(e.type);
  $: filtered = events.filter(e => (filter === "all" || (filter === "errors" ? problem(e) : filter === "routines" ? !!e.routineId : /^(runtime|host)\./.test(e.type))) && (!query || [e.type, labels[e.type], e.runId, e.routineId, e.turnId, e.reason].join(" ").toLowerCase().includes(query.toLowerCase()))).slice().reverse();
  $: { filter; query; count = 100; }
  onMount(() => {
    let live = true, pending = false;
    async function reload() {
      if (pending) return; pending = true;
      try { const data = await listBotEvents(bot); if (live) { events = data.events; error = null; loaded = true; } }
      catch (e) { if (live) error = e.message; }
      finally { pending = false; }
    }
    reload(); const timer = setInterval(reload, 5000);
    return () => { live = false; clearInterval(timer); };
  });
  function download() {
    const href = URL.createObjectURL(new Blob([filtered.slice().reverse().map(e => JSON.stringify(e)).join("\n") + "\n"], { type: "application/x-ndjson" }));
    const a = document.createElement("a"); a.href = href; a.download = `${bot}-events.jsonl`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 10000);
  }
</script>
<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-50">
  <div class="flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-3">
    <h3 class="font-semibold">Event log</h3>
    <button class="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40" disabled={!filtered.length} on:click={download}>Export</button>
  </div>
  <div class="space-y-2 border-b border-zinc-200 p-4">
    <select aria-label="Filter events" bind:value={filter} class="w-full rounded border border-zinc-300 bg-white p-2 text-sm">
      <option value="all">All events</option><option value="routines">Routines</option><option value="runtime">Sleep and runtime</option><option value="errors">Errors and interruptions</option>
    </select>
    <input aria-label="Search events" bind:value={query} placeholder="Search or paste a run ID…" class="w-full rounded border border-zinc-300 p-2 text-sm" />
    <p class="text-xs text-zinc-500">Updates every 5 seconds. Older events expire as the log fills. Export includes all matching retained events.</p>
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto p-4" aria-label="Bot events">
    {#if error}<p role="alert" class="mb-3 text-sm text-red-700">{error}</p>{/if}
    {#if !loaded && !error}<p class="text-sm text-zinc-500">Loading events…</p>
    {:else if loaded && !filtered.length}<p class="text-sm text-zinc-500">No matching events yet.</p>{/if}
    {#each filtered.slice(0, count) as e (e.id)}
      <article class="mb-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm">
        <p class:text-red-700={problem(e)} class="font-medium">{labels[e.type] ?? e.type}</p>
        <time class="text-xs text-zinc-500" datetime={e.ts} title={e.ts}>{new Date(e.ts).toLocaleString()}</time>
        {#if e.durationMs != null}<span class="text-xs text-zinc-500"> · {(e.durationMs / 1000).toFixed(1)} s</span>{/if}
        {#if e.availableBytes != null}<p class="mt-1 text-xs text-zinc-600">RAM available: {Math.round(e.availableBytes / 1024 ** 2)} MiB{#if e.requiredBytes != null} · required: {Math.ceil(e.requiredBytes / 1024 ** 2)} MiB{/if}</p>{/if}
        {#if e.reason}<p class="mt-1 break-words text-xs text-zinc-600">{e.reason === "see_host_log" ? "See the bot’s host.log for error details." : e.reason}</p>{/if}
        {#if e.runId}<button class="mt-1 block max-w-full break-all text-left text-xs text-blue-700 hover:underline" title="Show this routine run" on:click={() => { filter = "all"; query = e.runId; }}>Run: {e.runId}</button>{/if}
        {#if e.routineId}<p class="break-all text-xs text-zinc-500">Routine: {e.routineId}</p>{/if}
        {#if e.turnId}<p class="break-all text-xs text-zinc-500">Message: {e.turnId}</p>{/if}
      </article>
    {/each}
    {#if filtered.length > count}<button class="rounded border px-3 py-2 text-sm" on:click={() => count += 100}>Show more</button>{/if}
  </div>
</div>
