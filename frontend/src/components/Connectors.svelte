<script>
  // Connectors (ADR-0014): MCP servers every bot gets. Three views – the list, the directory
  // (curated, from the gateway) and the form for a custom or directory-based connector.
  // Secrets come back masked; a masked value sent back unchanged keeps what is stored.
  import { onMount } from "svelte";
  import { listConnectors, connectorDirectory, addConnector, updateConnector, removeConnector, restartBots } from "../lib/api.js";
  import Switch from "./Switch.svelte";
  let items = null, dir = null, error = null, busy = false;
  let mode = "list";          // list | pick | edit
  let menu = false;           // the Add menu
  let form = null;            // the connector being edited
  let restartNeeded = false, restartNote = null;

  const keyFor = (name) => String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const shellJoin = (parts) => parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" ");
  const lines = (m, sep) => Object.entries(m ?? {}).map(([k, v]) => `${k}${sep}${typeof v === "object" ? (v.value ?? "") : v}`).join("\n");
  const summary = (c) => (c.transport === "stdio" ? shellJoin([c.command, ...(c.args ?? [])]) : c.url);

  async function load() { try { items = (await listConnectors()).connectors; } catch (e) { error = e.message; items = []; } }
  onMount(load);

  async function openDirectory() {
    menu = false; error = null;
    if (!dir) { try { dir = (await connectorDirectory()).directory; } catch (e) { error = e.message; return; } }
    mode = "pick";
  }
  function startCustom() { menu = false; error = null; form = { name: "", key: "", transport: "stdio", command: "", env: "", url: "", headers: "", enabled: true, approval: false, source: "custom", hints: null }; mode = "edit"; }
  function fromDirectory(d) {
    form = { name: d.name, key: d.id, transport: d.transport, command: d.command ?? "", url: d.url ?? "", env: lines(d.env, "="), headers: lines(d.headers, ": "),
      enabled: true, approval: false, source: "directory", directoryId: d.id, hints: d };
    mode = "edit";
  }
  function edit(c) {
    form = { id: c.id, name: c.name, key: c.key, transport: c.transport, command: c.transport === "stdio" ? shellJoin([c.command, ...(c.args ?? [])]) : "",
      env: lines(c.env, "="), url: c.url ?? "", headers: lines(c.headers, ": "), enabled: c.enabled, approval: !!c.approval, source: c.source, directoryId: c.directoryId, hints: null };
    mode = "edit";
  }
  async function save() {
    busy = true; error = null;
    const body = { name: form.name, transport: form.transport, enabled: form.enabled, approval: form.approval, source: form.source, ...(form.directoryId ? { directoryId: form.directoryId } : {}),
      ...(form.id ? {} : { key: form.key || keyFor(form.name) }),
      ...(form.transport === "stdio" ? { command: form.command, env: form.env } : { url: form.url, headers: form.headers }) };
    try { if (form.id) await updateConnector(form.id, body); else await addConnector(body); await load(); restartNeeded = true; mode = "list"; }
    catch (e) { error = e.message; }
    busy = false;
  }
  async function toggle(c, on) { error = null; try { await updateConnector(c.id, { enabled: on }); await load(); restartNeeded = true; } catch (e) { error = e.message; } }
  async function del(c) {
    if (!confirm(`Remove the connector "${c.name}"?`)) return;
    error = null; try { await removeConnector(c.id); await load(); restartNeeded = true; } catch (e) { error = e.message; }
  }
  async function restart() {
    error = null; restartNote = "Restarting…";
    try { const r = await restartBots(); restartNote = r.bots.length ? `${r.bots.length} bot${r.bots.length === 1 ? "" : "s"} restarting – the connectors are active in a moment.` : "No bot was running – the connectors are there when a bot starts."; restartNeeded = false; }
    catch (e) { restartNote = null; error = e.message; }
  }
  $: hintFor = (kind, key) => form?.hints?.[kind]?.[key];
  $: hintKeys = (kind) => Object.entries(form?.hints?.[kind] ?? {});
  const field = "rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900";
</script>

<svelte:window on:click={() => (menu = false)} />

{#if mode === "list"}
  <div class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <p class="text-[13px] leading-relaxed text-zinc-500">MCP servers every bot can use – tools beyond the browser, the terminal and the files. A connector reaches a bot when the bot starts.</p>
      <div class="relative shrink-0">
        <button type="button" class="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700" on:click|stopPropagation={() => (menu = !menu)}>Add ▾</button>
        {#if menu}
          <div class="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
            <button type="button" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={openDirectory}>From the directory</button>
            <button type="button" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-zinc-50" on:click={startCustom}>Custom connector</button>
          </div>
        {/if}
      </div>
    </div>
    {#if items === null}
      <p class="text-[13px] text-zinc-400">Loading…</p>
    {:else if !items.length}
      <p class="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-400">No connectors yet. Add one from the directory, or a custom MCP server.</p>
    {:else}
      <ul class="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
        {#each items as c (c.id)}
          <li class="flex items-center gap-3 px-4 py-3">
            <span class="min-w-0 flex-1">
              <strong class="block truncate text-sm font-medium {c.enabled ? '' : 'text-zinc-400'}">{c.name}</strong>
              <span class="block truncate text-xs text-zinc-500"><code>{c.key}</code> · {c.transport === "stdio" ? "command" : c.transport.toUpperCase()}{c.approval ? " · asks first" : ""} · {summary(c)}</span>
            </span>
            <Switch checked={c.enabled} label="Enabled" onChange={(v) => toggle(c, v)} />
            <button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50" on:click={() => edit(c)}>Edit</button>
            <button type="button" class="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50" on:click={() => del(c)}>Remove</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if restartNeeded}
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
        <span>Saved. Running bots pick the change up at their next start.</span>
        <button type="button" class="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700" on:click={restart}>Restart running bots</button>
      </div>
    {/if}
    {#if restartNote}<p class="text-[13px] text-zinc-600">{restartNote}</p>{/if}
    {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
    <p class="text-xs leading-relaxed text-zinc-400">Connectors apply to every bot; a choice per bot is planned. Keys and tokens are stored inside the bots' computer, where the bots can read them anyway.</p>
  </div>

{:else if mode === "pick"}
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <button type="button" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50" on:click={() => (mode = "list")}>← Back</button>
      <p class="text-[13px] text-zinc-500">Well-known MCP servers. Some need an API key or token from that service.</p>
    </div>
    <ul class="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
      {#each dir as d (d.id)}
        <li class="flex items-center gap-3 px-4 py-3">
          <span class="min-w-0 flex-1">
            <strong class="block text-sm font-medium">{d.name} <span class="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-normal text-zinc-500">{d.auth === "none" ? "no key needed" : d.auth === "optional" ? "key optional" : "needs a key"}</span></strong>
            <span class="block text-[13px] leading-relaxed text-zinc-500">{d.description}</span>
          </span>
          <button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-40" disabled={items?.some((c) => c.key === d.id)} on:click={() => fromDirectory(d)}>{items?.some((c) => c.key === d.id) ? "Added" : "Add"}</button>
        </li>
      {/each}
    </ul>
    {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
  </div>

{:else}
  <form class="flex flex-col gap-4" on:submit|preventDefault={save}>
    <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Name
      <input class={field} bind:value={form.name} required maxlength="60" placeholder="e.g. GitHub" />
      {#if !form.id}<span class="text-xs">key: <code class="text-zinc-600">{form.key || keyFor(form.name) || "…"}</code> – the tool prefix the bots see (mcp__<i>key</i>__…)</span>{/if}
    </label>
    {#if !form.id}
      <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Type
        <select class={field} bind:value={form.transport}>
          <option value="stdio">Command (stdio)</option>
          <option value="http">HTTP (streamable)</option>
          <option value="sse">SSE</option>
        </select>
      </label>
    {/if}
    {#if form.transport === "stdio"}
      <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Command
        <input class="{field} font-mono" bind:value={form.command} required placeholder="npx -y @scope/package --flag" spellcheck="false" autocapitalize="off" />
      </label>
      <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Environment variables
        {#each hintKeys("env") as [k, h] (k)}<span class="text-xs"><code class="text-zinc-600">{k}</code> – {h.label}{h.required ? " (required)" : ""}</span>{/each}
        <textarea class="{field} font-mono" rows="3" bind:value={form.env} placeholder="KEY=value – one per line" spellcheck="false" autocapitalize="off"></textarea>
      </label>
    {:else}
      <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">URL
        <input class="{field} font-mono" bind:value={form.url} required placeholder="https://…" spellcheck="false" autocapitalize="off" />
      </label>
      <label class="flex flex-col gap-1.5 text-[13px] text-zinc-500">Headers
        {#each hintKeys("headers") as [k, h] (k)}<span class="text-xs"><code class="text-zinc-600">{k}</code> – {h.label}{h.required ? " (required)" : ""}</span>{/each}
        <textarea class="{field} font-mono" rows="3" bind:value={form.headers} placeholder="Name: value – one per line" spellcheck="false" autocapitalize="off"></textarea>
      </label>
    {/if}
    <label class="flex items-center justify-between gap-4 text-sm">
      <span><span class="block">Ask before each use</span><span class="block text-xs leading-relaxed text-zinc-500">Off: the bots use the connector on their own, like the browser. On: every call shows an approval card in the chat (Claude Code bots).</span></span>
      <Switch checked={form.approval} label="Ask before each use" onChange={(v) => (form.approval = v)} />
    </label>
    <label class="flex items-center justify-between gap-4 text-sm">
      <span>Enabled</span>
      <Switch checked={form.enabled} label="Enabled" onChange={(v) => (form.enabled = v)} />
    </label>
    {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <button type="button" class="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50" on:click={() => { mode = "list"; error = null; }}>Cancel</button>
      <button type="submit" class="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:bg-zinc-300" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </div>
  </form>
{/if}
