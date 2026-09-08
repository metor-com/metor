<script>
  import { chatSend, chatPermission, uploadFile, fileUrl } from "../lib/api.js";
  import { picture, openFile } from "../lib/media.js";   // pictures and files inside the phone app (session by fetch, system viewer)
  import RuntimeSignIn from "./RuntimeSignIn.svelte";
  import Ticks from "./Ticks.svelte";
  import Typing from "./Typing.svelte";
  import StepLine from "./StepLine.svelte";
  import { renderMarkdown } from "../lib/markdown.js";
  import { settings } from "../lib/settings.js";
  import { t } from "../lib/i18n.js";
  export let bot;
  export let title = null;   // what people see; bot stays the id for API calls
  export let entries = [];
  export let partial = null;
  export let thought = null;   // the model's thinking while it works – shown in the working bubble with Show steps on
  export let onLocalEntry;
  export let status = null;   // the bot's status (the error card offers Start while it is stopped)
  export let onStart = null;
  export let harness = null, harnessLabel = null;   // the bot's runtime – an expired sign-in is repaired right in the error card
  // The runtime's sign-in is gone. Claude Code answers such a message as if it were a reply ("Not logged in · Please
  // run /login", "Failed to authenticate: OAuth session expired and could not be refreshed"), Gemini refuses an
  // invalid key, Codex answers 401, Copilot streams "Error: Authorization error … credentials may be expired" or
  // "Access denied by policy settings" – short texts, so a bot talking about authentication does not trigger this.
  // The chat then offers the runtime's sign-in right there (RuntimeSignIn), below the reply or in the error card.
  const signInLost = (t) => { const x = String(t ?? "").trim(); return x.length <= 240 && /failed to authenticate|not logged in|please run \/login|oauth session|authentication (failed|error|required)|authorization error|access denied by policy|invalid api key|api key not valid|unauthori[sz]ed|\b401\b/i.test(x); };
  let signedInFor = null;   // the entry whose sign-in went through – the hint replaces the box until the next reply
  let text = "";
  let sending = false;
  let listEl, fileInput;
  let openTools = {};   // expanded tool entries (id → true)
  let openGroups = {};  // unfolded groups of steps (group id → true/false); unset means the Show steps choice
  let pending = [];     // attachments before sending: {file, name, size, image, preview}
  const toggleTool = (id) => (openTools = { ...openTools, [id]: !openTools[id] });
  const toggleGroup = (id) => (openGroups = { ...openGroups, [id]: !(openGroups[id] ?? $settings.showSteps) });
  $: $settings.showSteps, (openGroups = {});   // Show steps / Hide steps applies to every group again

  // The steps a bot took are kept one by one in the history; the chat shows them folded
  // (knowledge/design/working-view.md): consecutive tool entries form one group – "14 steps", a tap
  // unfolds the cards – and every other entry (a message, a reply, an approval, an error) ends it.
  $: rows = (() => {
    const out = []; let group = null;
    for (const e of entries) {
      if (e.kind !== "tool") { group = null; out.push(e); continue; }
      if (!group) { group = { id: `steps:${e.id}`, items: [] }; out.push(group); }
      group.items.push(e);
    }
    return out;
  })();
  // While the bot works and no reply streams yet, a bubble with the three dots and the current step
  // stands at the end – not while it waits for an approval, and after a reply only once the bot has
  // been busy for a moment longer (the status arrives a beat after the reply; without the grace the
  // dots would flash after every answer). The steps of that run stay hidden until the reply is there,
  // unless Show steps is on or the step line in the bubble is tapped.
  let settled = true, settledFor = null, settleTimer = null;
  $: {
    const last = entries[entries.length - 1], id = last?.id ?? null;
    if (id !== settledFor) {
      settledFor = id; clearTimeout(settleTimer);
      if (last?.role === "assistant" && last.kind === "text") { settled = false; settleTimer = setTimeout(() => (settled = true), 1500); } else settled = true;
    }
  }
  $: awaitingApproval = entries[entries.length - 1]?.kind === "permission" && entries[entries.length - 1]?.permission?.status === "pending";
  $: working = status === "busy" && !partial && settled && !awaitingApproval;
  $: liveGroup = working && rows[rows.length - 1]?.items ? rows[rows.length - 1] : null;
  $: currentStep = liveGroup ? liveGroup.items[liveGroup.items.length - 1] : null;

  $: entries, partial, working, scrollDown();
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
  function clearPendingOnSwitch(b) { if (b !== lastBot) { lastBot = b; clearPending(); openTools = {}; openGroups = {}; } }

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
  // Sent messages that the bot has answered (an assistant reply follows them) – two green ticks
  $: answered = (() => {
    const ids = new Set(); let replied = false;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const x = entries[i];
      if (x.role === "assistant" && (x.kind === "text" || x.kind === "permission")) replied = true;
      else if (x.role === "user" && replied) ids.add(x.id);
    }
    return ids;
  })();
  async function decide(entry, decision) {
    try { await chatPermission(bot, entry.id, decision); } catch (e) { alert(`Approval failed: ${e.message}`); }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex min-h-0 min-w-0 flex-1 flex-col" on:dragover|preventDefault on:drop={onDrop}>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden px-3 py-3 md:px-4 md:py-4" bind:this={listEl}>
    {#each rows as e, i (e.id)}
      {#if e.items}
        {@const open = openGroups[e.id] ?? $settings.showSteps}
        {#if e !== liveGroup || open}
          <div class="min-w-0 px-1.5">
            {#if e !== liveGroup}
              <button class="text-[12.5px] text-zinc-400 hover:text-zinc-600" on:click={() => toggleGroup(e.id)}>{open ? "▾" : "▸"} {t("steps", e.items.length)}</button>
            {/if}
            {#if open}
              <div class="flex flex-col gap-1.5 {e !== liveGroup ? 'mt-1.5' : ''}">
                {#each e.items as s (s.id)}
                  <div class="min-w-0">
                    <button class="flex w-full min-w-0 items-baseline gap-2 text-left text-[12.5px] text-zinc-400 hover:text-zinc-600" on:click={() => toggleTool(s.id)}>
                      <span class="shrink-0 font-semibold">{openTools[s.id] ? "▾" : "▸"} ⚙</span>
                      <StepLine tool={s.tool} text={s.text} showDetail={!openTools[s.id]} />
                    </button>
                    {#if openTools[s.id]}
                      <div class="mt-1 max-w-[42rem] rounded-lg bg-zinc-100 px-3 py-2 text-[11.5px]">
                        {#if s.tool?.step && s.tool?.name}<div class="mb-1 font-semibold text-zinc-500">{s.tool.name}</div>{/if}
                        {#if s.tool?.detail}<pre class="overflow-x-auto whitespace-pre-wrap text-zinc-600">{s.tool.detail}</pre>{/if}
                        {#if s.tool?.result}<pre class="mt-1.5 overflow-x-auto border-t border-zinc-200 pt-1.5 whitespace-pre-wrap text-zinc-500">{s.tool.result}</pre>
                        {:else}<p class="mt-1 text-zinc-400">(no result recorded)</p>{/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
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
      {:else if e.kind === "error"}
        <!-- the host stopped with an error: the full text, and Start when this is the last entry of a stopped bot -->
        <div class="max-w-[42rem] rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900">
          <div class="font-semibold">The bot stopped with an error</div>
          <pre class="mt-1 font-sans text-[13px] break-words whitespace-pre-wrap text-red-800 [overflow-wrap:anywhere]">{e.text}</pre>
          {#if status === "stopped" && i === rows.length - 1 && onStart && harness && signInLost(e.text)}
            <div class="mt-2.5 text-zinc-900"><RuntimeSignIn {harness} label={harnessLabel} intro={`The sign-in of ${harnessLabel ?? harness} has expired – sign in again, the bot then starts by itself.`} onDone={onStart} /></div>
          {:else if status === "stopped" && i === rows.length - 1 && onStart}
            <div class="mt-2.5"><button class="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm text-white hover:bg-zinc-700" on:click={onStart}>▶ Start again</button></div>
          {/if}
          <div class="mt-1.5 text-[11px] text-red-700/70">{time(e.ts)}</div>
        </div>
      {:else if e.role === "user"}
        <div class="flex min-w-0 justify-end">
          <div class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-white sm:max-w-[42rem] {e.origin === 'routine' ? 'bg-zinc-600' : 'bg-zinc-900'}">
            {#if e.origin === "routine"}<div class="mb-1 text-[10px] font-semibold tracking-wide text-zinc-300 uppercase">⏰ Routine</div>{/if}
            {#if e.attachments?.length}
              <div class="mb-1.5 flex flex-wrap gap-1.5 {e.text ? '' : 'mb-0'}">
                {#each e.attachments as a}
                  {#if a.image}
                    <a href={fileUrl(bot, a.path)} target="_blank" rel="noopener noreferrer" on:click={(ev) => openFile(ev, fileUrl(bot, a.path), a.name)}><img use:picture={fileUrl(bot, a.path)} alt={a.name} class="max-h-40 max-w-full rounded-lg" /></a>
                  {:else}
                    <a href={fileUrl(bot, a.path)} target="_blank" rel="noopener noreferrer" on:click={(ev) => openFile(ev, fileUrl(bot, a.path), a.name)} class="flex items-center gap-1.5 rounded-lg bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600">📄 <span class="max-w-[14rem] truncate">{a.name}</span> <span class="text-zinc-400">{fmtSize(a.size)}</span></a>
                  {/if}
                {/each}
              </div>
            {/if}
            {#if e.text}<div class="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{e.text}</div>{/if}
            <div class="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-zinc-400">
              <span>{time(e.ts)}</span>
              {#if e.status === "failed"}<span class="text-red-300">✕ failed</span>
              {:else}<Ticks state={answered.has(e.id) ? "answered" : e.status === "delivered" ? "delivered" : "sent"} />{/if}
            </div>
            {#if e.error}<div class="mt-1 text-xs text-red-300">{e.error}</div>{/if}
          </div>
        </div>
      {:else}
        <div class="flex min-w-0">
          <div class="max-w-[85%] rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 sm:max-w-[42rem]">
            {#if e.text}<div class="chat-md">{@html renderMarkdown(e.text)}</div>{/if}
            {#if harness && i === rows.length - 1 && !partial && signInLost(e.text)}
              {#if signedInFor === e.id}
                <p class="mt-2 text-[13px] text-emerald-700">Signed in again – send your message once more.</p>
              {:else}
                <div class="mt-2.5"><RuntimeSignIn {harness} label={harnessLabel} intro={`The sign-in of ${harnessLabel ?? harness} has expired – sign in again, then send your message once more.`} onDone={() => (signedInFor = e.id)} /></div>
              {/if}
            {/if}
            {#if e.attachments?.length}
              <div class="flex flex-wrap gap-1.5 {e.text ? 'mt-2' : ''}">
                {#each e.attachments as a}
                  {#if a.image}
                    <a href={fileUrl(bot, a.path)} target="_blank" rel="noopener noreferrer" on:click={(ev) => openFile(ev, fileUrl(bot, a.path), a.name)}><img use:picture={fileUrl(bot, a.path)} alt={a.name} class="max-h-48 max-w-full rounded-lg border border-zinc-200" /></a>
                  {:else}
                    <a href={fileUrl(bot, a.path)} target="_blank" rel="noopener noreferrer" on:click={(ev) => openFile(ev, fileUrl(bot, a.path), a.name)} class="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-800 hover:bg-zinc-200">📄 <span class="max-w-[14rem] truncate">{a.name}</span> <span class="text-zinc-400">{fmtSize(a.size)}</span></a>
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
          <div class="mt-1 text-[11px] text-zinc-400">{t("typing")}</div>
        </div>
      </div>
    {:else if working}
      <!-- The bot is at work: the dots, and the step it is on – a tap shows this run's steps so far -->
      <div class="flex min-w-0">
        <div class="max-w-[85%] rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 sm:max-w-[42rem]">
          <Typing cls="text-zinc-500" />
          {#if currentStep}
            <button class="mt-1 flex w-full min-w-0 items-baseline gap-2 text-left text-[12px] text-zinc-400 hover:text-zinc-600" title={t("showSteps")} on:click={() => toggleGroup(liveGroup.id)}>
              <span class="shrink-0">⚙</span>
              <StepLine tool={currentStep.tool} text={currentStep.text} />
            </button>
          {/if}
          {#if thought && $settings.showSteps}
            <!-- the thinking's tail, newest lines at the bottom, the rest clipped above -->
            <div class="mt-1.5 flex max-h-24 flex-col justify-end overflow-hidden border-t border-zinc-100 pt-1.5">
              <div class="text-[11.5px] leading-snug whitespace-pre-wrap text-zinc-400 [overflow-wrap:anywhere]">{thought.slice(-600)}</div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
    {#if !entries.length && !partial}<p class="m-auto text-center text-zinc-400">No history yet. Send {title ?? bot} a message.</p>{/if}
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
