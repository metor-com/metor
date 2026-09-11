<script>
  import { onMount } from "svelte";
  import { spaceMemory } from "../lib/api.js";
  let memory = null, error = null;
  const size = n => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GiB` : `${Math.round(n / 1024 ** 2)} MiB`;
  onMount(() => {
    let live = true, pending = false;
    async function reload() {
      if (pending) return; pending = true;
      try { const data = await spaceMemory(); if (live) { memory = data; error = null; } }
      catch (e) { if (live) error = e.message; }
      finally { pending = false; }
    }
    reload(); const timer = setInterval(reload, 3000);
    return () => { live = false; clearInterval(timer); };
  });
</script>
<div class="flex flex-col gap-3 py-6" aria-label="Space memory">
  <h4 class="text-sm font-medium">RAM protection</h4>
  {#if error}<p role="alert" class="text-sm text-red-700">{error}</p>{/if}
  {#if memory?.available}
    <div class="flex flex-wrap justify-between gap-2 text-sm"><span>{size(memory.availableBytes)} available</span><span class="text-zinc-500">{size(memory.totalBytes)} total</span></div>
    <div role="progressbar" aria-label="Space RAM usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(100 * memory.usedBytes / memory.totalBytes)} class="h-2 overflow-hidden rounded-full bg-zinc-100">
      <div class="h-full rounded-full {memory.low ? 'bg-amber-500' : 'bg-zinc-500'}" style="width: {100 * memory.usedBytes / memory.totalBytes}%"></div>
    </div>
    <p class="text-xs text-zinc-500">{size(memory.usedBytes)} in use or unavailable · updated every 3 seconds</p>
    {#if memory.low}<p role="status" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Low available RAM. Starts may wait for their required reserve. Running tasks continue.</p>{/if}
    <p class="text-[13px] leading-relaxed text-zinc-500">New runtimes need {size(memory.startBytes)} of available RAM plus a {size(memory.reserveBytes)} reserve for the Space. Browser starts reserve 512 MiB; a full desktop 640 MiB, or 128 MiB when its browser is already running. Terminal starts reserve 64 MiB. All starts share the queue and resume automatically.</p>
    <p class="text-[13px] leading-relaxed text-zinc-500">To free memory, pause a bot you are not using. Sleeping runtimes keep their browser and desktop open.</p>
  {:else if memory}<p role="status" class="text-sm text-amber-900">RAM readings are unavailable. New runtime and computer starts wait until the Space can check memory again.</p>
  {:else if !error}<p class="text-sm text-zinc-500">Reading RAM usage…</p>{/if}
  {#if memory?.coordinationError}<p role="status" class="text-sm text-amber-900">The startup queue could not be read. Check the Space logs.</p>{/if}
  {#if memory?.starting}<p class="break-words text-sm">Starting: {memory.starting}</p>{/if}
  {#if memory?.waiting?.length}
    <div class="text-sm"><p class="font-medium">Waiting starts ({memory.waiting.length})</p><ul class="mt-1 list-inside list-disc text-zinc-600">{#each memory.waiting as item (`${item.name}:${item.kind ?? "runtime"}`)}<li class="break-words">{item.name}{item.kind && item.kind !== "runtime" ? ` · ${item.kind}` : ""}</li>{/each}</ul></div>
  {/if}
</div>
