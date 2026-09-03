<script>
  import { listFiles, fileUrl } from "../lib/api.js";
  export let bot;
  let path = "", data = null, error = null, lastBot = null;

  $: if (bot !== lastBot) { lastBot = bot; path = ""; }
  $: fetchDir(bot, path);
  async function fetchDir(b, p) {
    data = null; error = null;
    try { const r = await listFiles(b, p); if (b === bot && p === path) data = r; }
    catch (e) { if (b === bot) error = e.message; }
  }
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
  const fmtTs = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  $: crumbs = path ? path.split("/") : [];
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-50 text-[13px] text-zinc-900">
  <div class="sticky top-0 flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-3 py-2">
    <button class="rounded px-1.5 py-0.5 hover:bg-zinc-100 {path ? 'text-zinc-500' : 'font-semibold'}" on:click={() => (path = "")}>{bot}</button>
    {#each crumbs as c, i}
      <span class="text-zinc-300">/</span>
      <button class="rounded px-1.5 py-0.5 hover:bg-zinc-100 {i === crumbs.length - 1 ? 'font-semibold' : 'text-zinc-500'}"
        on:click={() => (path = crumbs.slice(0, i + 1).join("/"))}>{c}</button>
    {/each}
    <button class="ml-auto rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100" title="Reload" on:click={() => fetchDir(bot, path)}>↻</button>
  </div>
  {#if error}
    <p class="m-auto px-6 text-center text-zinc-400">{error}</p>
  {:else if data === null}
    <p class="m-auto px-6 text-center text-zinc-400">Loading…</p>
  {:else if !data.entries.length}
    <p class="m-auto px-6 text-center text-zinc-400">Empty folder.</p>
  {:else}
    <ul class="divide-y divide-zinc-100">
      {#each data.entries as e (e.name)}
        <li>
          {#if e.type === "dir"}
            <button class="flex w-full min-w-0 items-baseline gap-2.5 px-3 py-2 text-left hover:bg-zinc-100"
              on:click={() => (path = path ? `${path}/${e.name}` : e.name)}>
              <span class="shrink-0">📁</span><span class="min-w-0 flex-1 truncate font-medium">{e.name}</span>
              <span class="shrink-0 text-xs text-zinc-400">{fmtTs(e.mtime)}</span>
            </button>
          {:else}
            <a class="flex min-w-0 items-baseline gap-2.5 px-3 py-2 hover:bg-zinc-100"
              href={fileUrl(bot, path ? `${path}/${e.name}` : e.name)} target="_blank" rel="noopener noreferrer">
              <span class="shrink-0">📄</span><span class="min-w-0 flex-1 truncate">{e.name}</span>
              <span class="shrink-0 text-xs text-zinc-400">{fmtSize(e.size)}</span>
              <span class="shrink-0 text-xs text-zinc-400">{fmtTs(e.mtime)}</span>
            </a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
