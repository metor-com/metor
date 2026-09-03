<script>
  import { chatSend, chatPermission, uploadFile, fileUrl } from "../lib/api.js";
  import { renderMarkdown } from "../lib/markdown.js";
  export let bot;
  export let entries = [];
  export let partial = null;
  export let onLocalEntry;
  let text = "";
  let sending = false;
  let listEl, fileInput;
  let openTools = {};   // expanded tool entries (id → true)
  let pending = [];     // attachments before sending: {file, name, size, image, preview}
  const toggleTool = (id) => (openTools = { ...openTools, [id]: !openTools[id] });

  $: entries, partial, scrollDown();
  function scrollDown() { requestAnimationFrame(() => { if (listEl) listEl.scrollTop = listEl.scrollHeight; }); }

  // ---------- Attachments: file dialog, paste (screenshots!), drag and drop ----------
  const MAX_FILE = 25 * 1024 * 1024, MAX_COUNT = 10;
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
  let pasteCount = 0;
  function addFiles(fileList) {
    for (const file of Array.from(fileList ?? [])) {
      if (pending.length >= MAX_COUNT) { alert(`At most ${MAX_COUNT} attachments per message.`); break; }
      if (file.size > MAX_FILE) { alert(`${file.name || "File"} is too large (max. 25 MB).`); continue; }
      const image = file.type.startsWith("image/");
      // Pasted screenshots are generically named "image.png" – give them a clearer name
      const name = file.name && file.name !== "image.png" ? file.name : `screenshot-${++pasteCount}.png`;
      pending = [...pending, { file, name, size: file.size, image, preview: image ? URL.createObjectURL(file) : null }];
    }
  }
  function removePending(i) {
    if (pending[i]?.preview) URL.revokeObjectURL(pending[i].preview);
    pending = pending.filter((_, idx) => idx !== i);
  }
  function clearPending() { for (const a of pending) if (a.preview) URL.revokeObjectURL(a.preview); pending = []; }
  function onPaste(e) {
    const files = Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  }
  function onDrop(e) { e.preventDefault(); addFiles(e.dataTransfer?.files); }
  function onPickFiles(e) { addFiles(e.target.files); e.target.value = ""; }
  $: if (bot) clearPendingOnSwitch(bot);
  let lastBot = null;
  function clearPendingOnSwitch(b) { if (b !== lastBot) { lastBot = b; clearPending(); } }

  async function send() {
    const t = text.trim();
    if ((!t && !pending.length) || sending) return;
    sending = true;
    try {
      const attachments = [];
      for (const a of pending) {
        const r = await uploadFile(bot, new File([a.file], a.name, { type: a.file.type }));
        attachments.push({ path: r.path, name: a.name, size: a.size, image: a.image });
      }
      const r = await chatSend(bot, t, crypto.randomUUID(), attachments);
      onLocalEntry?.({ id: r.id, ts: new Date().toISOString(), role: "user", text: t, ...(attachments.length ? { attachments } : {}), status: "sending" });
      text = "";
      clearPending();
    } catch (e) { alert(`Sending failed: ${e.message}`); }
    sending = false;
  }
  function onKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
  const time = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  async function decide(entry, decision) {
    try { await chatPermission(bot, entry.id, decision); } catch (e) { alert(`Approval failed: ${e.message}`); }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex min-h-0 min-w-0 flex-1 flex-col" on:dragover|preventDefault on:drop={onDrop}>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden px-3 py-3 md:px-4 md:py-4" bind:this={listEl}>
    {#each entries as e (e.id)}
      {#if e.kind === "tool"}
        <div class="min-w-0 px-1.5">
          <button class="flex w-full min-w-0 items-baseline gap-2 text-left text-[12.5px] text-zinc-400 hover:text-zinc-600" on:click={() => toggleTool(e.id)}>
            <span class="shrink-0 font-semibold">{openTools[e.id] ? "▾" : "▸"} ⚙ {e.tool?.name ?? e.text}</span>
            {#if e.tool?.detail && !openTools[e.id]}<span class="min-w-0 truncate font-mono text-[11.5px]">{e.tool.detail}</span>{/if}
          </button>
          {#if openTools[e.id]}
            <div class="mt-1 max-w-[42rem] rounded-lg bg-zinc-100 px-3 py-2 text-[11.5px]">
              {#if e.tool?.detail}<pre class="overflow-x-auto whitespace-pre-wrap text-zinc-600">{e.tool.detail}</pre>{/if}
              {#if e.tool?.result}<pre class="mt-1.5 overflow-x-auto border-t border-zinc-200 pt-1.5 whitespace-pre-wrap text-zinc-500">{e.tool.result}</pre>
              {:else}<p class="mt-1 text-zinc-400">(no result recorded)</p>{/if}
            </div>
          {/if}
        </div>
      {:else if e.kind === "permission"}
        <div class="max-w-[42rem] rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <div class="font-semibold">Approval: {e.permission?.title ?? e.permission?.tool ?? "?"}</div>
          {#if e.permission?.reason}<div class="mt-1 text-[13px] text-amber-900/70">{e.permission.reason}</div>{/if}
          {#if e.permission?.input}<code class="mt-1.5 block overflow-x-auto rounded-lg bg-amber-100/70 px-2.5 py-1.5 text-xs">{e.permission.input}</code>{/if}
          {#if e.permission?.status === "pending"}
            <div class="mt-2.5 flex gap-2">
              <button class="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm text-white hover:bg-zinc-700" on:click={() => decide(e, "allow")}>Allow</button>
              <button class="rounded-lg bg-amber-100 px-3.5 py-1.5 text-sm text-red-800 hover:bg-amber-200" on:click={() => decide(e, "deny")}>Deny</button>
            </div>
          {:else}
            <div class="mt-2 text-[13px] text-amber-900/70">{e.permission?.status === "allowed" ? "✓ allowed" : "✗ denied"}</div>
          {/if}
        </div>
      {:else if e.role === "user"}
        <div class="flex min-w-0 justify-end">
          <div class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-white sm:max-w-[42rem] {e.origin === 'routine' ? 'bg-zinc-600' : 'bg-zinc-900'}">
            {#if e.origin === "routine"}<div class="mb-1 text-[10px] font-semibold tracking-wide text-zinc-300 uppercase">⏰ Routine</div>{/if}
            {#if e.attachments?.length}
              <div class="mb-1.5 flex flex-wrap gap-1.5 {e.text ? '' : 'mb-0'}">
                {#each e.attachments as a}
                  {#if a.image}
                    <a href={fileUrl(bot, a.path)} target="_blank" rel="noopener noreferrer"><img src={fileUrl(bot, a.path)} alt={a.name} class="max-h-40 max-w-full rounded-lg" /></a>
                  {:else}
                    <a href={fileUrl(bot, a.path)} target="_blank" rel="noopener noreferrer" class="flex items-center gap-1.5 rounded-lg bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600">📄 <span class="max-w-[14rem] truncate">{a.name}</span> <span class="text-zinc-400">{fmtSize(a.size)}</span></a>
                  {/if}
                {/each}
              </div>
            {/if}
            {#if e.text}<div class="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{e.text}</div>{/if}
            <div class="mt-1 text-[11px] text-zinc-400">
              {time(e.ts)} · {e.status === "delivered" ? "delivered" : e.status === "failed" ? "failed" : "delivering…"}
            </div>
            {#if e.error}<div class="mt-1 text-xs text-red-300">{e.error}</div>{/if}
          </div>
        </div>
      {:else}
        <div class="flex min-w-0">
          <div class="max-w-[85%] rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 sm:max-w-[42rem]">
            {#if e.text}<div class="chat-md">{@html renderMarkdown(e.text)}</div>{/if}
            {#if e.attachments?.length}
              <div class="flex flex-wrap gap-1.5 {e.text ? 'mt-2' : ''}">
                {#each e.attachments as a}
                  {#if a.image}
                    <a href={fileUrl(bot, a.path)} target="_blank" rel="noopener noreferrer"><img src={fileUrl(bot, a.path)} alt={a.name} class="max-h-48 max-w-full rounded-lg border border-zinc-200" /></a>
                  {:else}
                    <a href={fileUrl(bot, a.path)} target="_blank" rel="noopener noreferrer" class="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-800 hover:bg-zinc-200">📄 <span class="max-w-[14rem] truncate">{a.name}</span> <span class="text-zinc-400">{fmtSize(a.size)}</span></a>
                  {/if}
                {/each}
              </div>
            {/if}
            <div class="mt-1 text-[11px] text-zinc-400">{time(e.ts)}</div>
          </div>
        </div>
      {/if}
    {/each}
    {#if partial}
      <div class="flex min-w-0">
        <div class="max-w-[85%] rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 opacity-85 sm:max-w-[42rem]">
          <div class="chat-md">{@html renderMarkdown(partial)}</div>
          <div class="mt-1 text-[11px] text-zinc-400">typing…</div>
        </div>
      </div>
    {/if}
    {#if !entries.length && !partial}<p class="m-auto text-center text-zinc-400">No history yet. Send {bot} a message.</p>{/if}
  </div>
  {#if pending.length}
    <div class="flex shrink-0 flex-wrap gap-2 border-t border-zinc-200 bg-white px-3 pt-3 md:px-4">
      {#each pending as a, i (a)}
        <div class="relative flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-1.5 pr-2.5">
          {#if a.preview}
            <img src={a.preview} alt={a.name} class="h-11 w-11 rounded object-cover" />
          {:else}
            <div class="flex h-11 w-11 items-center justify-center rounded bg-zinc-200 text-lg">📄</div>
          {/if}
          <div class="min-w-0 max-w-[10rem]">
            <div class="truncate text-xs font-medium">{a.name}</div>
            <div class="text-[11px] text-zinc-400">{fmtSize(a.size)}</div>
          </div>
          <button type="button" class="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-xs leading-none text-white hover:bg-zinc-600"
            on:click={() => removePending(i)} aria-label="Remove attachment {a.name}">×</button>
        </div>
      {/each}
    </div>
  {/if}
  <form class="flex shrink-0 gap-2 border-t border-zinc-200 bg-white px-3 py-2.5 md:px-4 md:py-3 {pending.length ? 'border-t-0 pt-2.5' : ''}" on:submit|preventDefault={send}>
    <input type="file" multiple class="hidden" bind:this={fileInput} on:change={onPickFiles} />
    <button type="button" class="shrink-0 self-stretch rounded-xl border border-zinc-300 px-3 text-lg text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
      on:click={() => fileInput?.click()} title="Attach a file (or paste/drop an image)" aria-label="Attach a file">📎</button>
    <!-- text-base (16px): anything smaller makes iOS zoom into the page on focus -->
    <textarea
      rows="2"
      class="min-w-0 flex-1 resize-none rounded-xl border border-zinc-300 px-3 py-2 text-base outline-none focus:border-zinc-900 md:text-[15px]"
      bind:value={text}
      on:keydown={onKey}
      on:paste={onPaste}
      placeholder="Message {bot}…"
    ></textarea>
    <button type="submit" class="shrink-0 self-stretch rounded-xl bg-zinc-900 px-4.5 text-sm text-white hover:bg-zinc-700 disabled:bg-zinc-300" disabled={sending || (!text.trim() && !pending.length)}>{sending ? "Sending…" : "Send"}</button>
  </form>
</div>
