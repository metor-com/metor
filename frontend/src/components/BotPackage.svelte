<script>
  import { onDestroy } from "svelte";
  import { inspectBotPackage, exportBotPackage, importBotPackage } from '../lib/api.js';
  import { app, origin } from '../lib/base.js';
  const packageOrigin = origin;
  import { slugify } from '../lib/slug.js';
  export let mode = 'import';
  export let bot = null;
  export let onDone;
  let includeFiles = true, routines = true, conversation = false, handoff = '';
  let title = mode === 'duplicate' ? `${bot?.title ?? bot?.name ?? 'Bot'} copy` : '';
  let pkg = null, archive = null, busy = false, error = '', result = '';
  let fileInput, inspection = null, checking = false;
  onDestroy(() => inspection?.abort());
  $: id = slugify(title);
  function openFilePicker() {
    inspection?.abort(); inspection = null; checking = false;
    fileInput.value = '';
    fileInput.click();
  }
  async function choose(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    inspection?.abort();
    const controller = new AbortController(); inspection = controller;
    pkg = null; archive = null; error = ''; checking = true;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error('Package must be at most 40 MiB.');
      const value = await inspectBotPackage(file, controller.signal);
      if (inspection !== controller) return;
      if (origin !== packageOrigin) throw new Error('The Space changed. Close this dialog and try again.');
      pkg = value; archive = file; title = value.title;
    } catch (e) {
      if (inspection === controller) error = timedOut ? 'Checking the package timed out. Please choose the file again.' : controller.signal.aborted ? '' : e.message;
    } finally {
      clearTimeout(timeout);
      if (inspection === controller) { checking = false; inspection = null; }
    }
  }

  async function submit() {
    busy = true; error = ''; result = '';
    try {
      if (origin !== packageOrigin) throw new Error('The Space changed. Close this dialog and try again.');
      const value = mode === 'import' ? archive : await exportBotPackage(bot.name, { includeFiles, routines, conversation, handoff });
      if (origin !== packageOrigin) throw new Error('The Space changed. Close this dialog and try again.');
      if (mode === 'export') {
        if (app?.saveBotPackage) {
          const saved = await app.saveBotPackage(`${bot.name}.metor-bot.zip`, await value.arrayBuffer());
          if (saved) onDone();
          return;
        }
        const href = URL.createObjectURL(value);
        const a = document.createElement('a'); a.href = href; a.download = `${bot.name}.metor-bot.zip`; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60000);
        onDone();
      } else {
        const created = await importBotPackage(value, title, id); onDone(created);
      }
    } catch (e) { error = e.message; }
    finally { busy = false; }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
  <div role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="package-title" class="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
    <h2 id="package-title" class="text-xl font-semibold">{mode === 'import' ? 'Import Bot' : mode === 'duplicate' ? 'Duplicate Bot' : 'Export Bot'}</h2>
    <p class="mt-2 text-sm text-zinc-500">Transfer a bot between Spaces or create an independent copy. The original stays in place. The new bot and its routines start paused.</p>
    <p class="mt-2 text-sm text-zinc-500">Runtime sign-ins, internal sessions, browser profiles and Space settings are excluded. Bot files, the role, routines and messages may still contain sensitive text. Review them before sharing.</p>
    {#if mode === 'import'}
      <div class="mt-4">
        <p class="text-sm font-medium">Bot package</p>
        <input class="hidden" type="file" accept=".zip" bind:this={fileInput} on:change={choose} aria-label="Bot package file" />
        <div class="mt-2 flex items-center gap-3">
          <button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-40" disabled={busy} on:click={openFilePicker}>Choose file…</button>
          <span class="min-w-0 truncate text-sm text-zinc-500" title={archive?.name ?? ''}>{archive?.name ?? 'No file selected'}</span>
        </div>
        {#if checking}<p role="status" class="mt-2 text-sm text-zinc-500">Checking package… You can choose another file or close this dialog.</p>{/if}
      </div>
      {#if pkg}<p class="mt-3 text-sm">{pkg.files} files · {pkg.routines} paused routines · {pkg.harness}</p>{/if}
    {:else}
      {#if bot.status !== 'stopped'}<p class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Pause this bot using its actions menu first, then reopen this dialog.</p>{/if}
      <fieldset class="mt-4" disabled={busy}>
        <legend class="sr-only">Package contents</legend>
        <label class="flex gap-2 text-sm font-medium"><input type="checkbox" bind:checked={includeFiles} />Include bot files</label>
        <p class="mt-2 text-xs text-zinc-500">All transferable files and folders, including images and notes. Hidden folders, credentials and linked files are excluded. Up to 25 MiB and 1,000 files; oversized exports fail without omitting files.</p>
        <label class="mt-3 flex gap-2 text-sm"><input type="checkbox" bind:checked={routines} />Include routines (paused on import)</label>
        <label class="mt-2 flex gap-2 text-sm"><input type="checkbox" bind:checked={conversation} />Include conversation (conversation.jsonl)</label>
        <label class="mt-3 block text-sm font-medium">Handoff note (optional)<textarea class="mt-1 w-full rounded-lg border border-zinc-300 p-2 font-normal" rows="3" maxlength="64000" bind:value={handoff} placeholder="Current goal, important decisions and next steps…"></textarea></label>
      </fieldset>
    {/if}
    {#if mode !== 'export'}
      <label class="mt-4 block text-sm font-medium">New bot name<input class="mt-1 w-full rounded-lg border border-zinc-300 p-2 font-normal" maxlength="60" bind:value={title} disabled={busy || checking} /></label>
      <p class="mt-1 text-xs text-zinc-500">ID: {id || '—'}. Choose another name if this bot already exists.</p>
      <p class="mt-2 text-xs text-zinc-500">A fresh runtime session will use the imported context. Sign in to the runtime in this Space before starting. This copy does not merge changes back into the original.</p>
    {/if}
    {#if error}<p role="alert" class="mt-3 text-sm text-red-600">{error}</p>{/if}
    {#if result}<p role="status" class="mt-3 text-sm text-emerald-700">{result}</p>{/if}
    <div class="mt-5 flex justify-end gap-2">
      <button class="rounded-lg border border-zinc-300 px-4 py-2 text-sm" disabled={busy} on:click={() => onDone()}>Close</button>
      <button class="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={busy || checking || (mode === 'import' ? !pkg || !id : bot.status !== 'stopped' || (mode === 'duplicate' && !id))} on:click={submit}>{busy ? 'Working…' : mode === 'export' ? 'Download package' : mode === 'duplicate' ? 'Create copy' : 'Import Bot'}</button>
    </div>
  </div>
</div>
