<script>
  import { onMount } from 'svelte';
  import { spaceMemory } from '../lib/api.js';
  import { app, gateway } from '../lib/base.js';
  let state = null, value = null, error = null, busy = false, success = false;
  const gib = n => `${Number((n / 1024 ** 3).toFixed(2))} GiB`;
  const id = $gateway?.id;
  const local = !!app?.local?.resources && $gateway?.local;
  async function reload() {
    try { state = await app.local.resources(id); value = Math.min(state.maxBytes / 1024 ** 3, Math.floor(state.currentBytes / 1024 ** 3 * 4) / 4 + 1); }
    catch (e) { error = e.message; }
  }
  onMount(() => { if (local) reload(); });
  async function apply() {
    busy = true; error = null; success = false;
    let warning = '';
    if (value * 1024 ** 3 < state.currentBytes) {
      try {
        const memory = await spaceMemory();
        warning = memory.available && Number.isFinite(memory.usedBytes)
          ? memory.usedBytes > value * 1024 ** 3 ? ` Current memory usage (${gib(memory.usedBytes)}) exceeds the new limit. Bots and browsers may not all fit after restarting.` : ''
          : ' Current memory usage could not be checked. Bots and browsers may not all fit after restarting.';
      } catch { warning = ' Current memory usage could not be checked. Bots and browsers may not all fit after restarting.'; }
    }
    if (state.restartRequired && !confirm(`Set total RAM to ${gib(value * 1024 ** 3)} and restart the Space? Running bot tasks will be interrupted. Bots, chats, files and sign-ins are kept.${warning}`)) { busy = false; return; }
    try { const result = await app.local.setMemory(id, value * 1024); if (!result.ok) throw new Error(result.error); success = true; await reload(); }
    catch (e) { error = e.message; }
    finally { busy = false; }
  }
</script>
<div class="flex flex-col gap-3 py-6" aria-label="Space RAM allocation">
  <h4 class="text-sm font-medium">RAM for this Space</h4>
  {#if !local}
    <p class="text-[13px] text-zinc-500">To change RAM for a local Space, open metor on the computer that runs it. For a remote Space, change the container limit on its server.</p>
  {:else if state}
    <div class="flex flex-wrap justify-between gap-2 text-sm"><span>Currently {gib(state.currentBytes)}</span><span class="text-zinc-500">{gib(state.hostBytes)} host RAM</span></div>
    <p class="text-[13px] text-zinc-500">Up to {gib(state.maxBytes)} for this Space, keeping {gib(state.reserveBytes)} for the host{state.otherBytes ? ` and ${gib(state.otherBytes)} for other containers` : ''}.</p>
    {#if state.savedMiB}<p class="text-xs text-zinc-500">Saved allocation: {gib(state.savedMiB * 1024 ** 2)}. Used on future starts and updates.</p>{/if}
    {#if state.override}<p role="status" class="text-sm text-amber-800">METOR_MEMORY is set to {state.override} and overrides saved settings. Remove the override and restart the app to change RAM here.</p>
    {:else if state.maxBytes > state.currentBytes || (state.allowReduction && state.maxBytes >= 1024 ** 3 && state.currentBytes > 1024 ** 3)}
      <form on:submit|preventDefault={apply} class="flex flex-col gap-3">
        <label class="text-sm" for="space-ram">New total RAM (GiB)</label>
        <input id="space-ram" aria-describedby="space-ram-hint" class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50" type="number" min={state.allowReduction ? 1 : Math.floor(state.currentBytes / 1024 ** 3 * 4) / 4 + 0.25} max={state.maxBytes / 1024 ** 3} step="0.25" bind:value required disabled={busy} />
        <p id="space-ram-hint" class="text-xs text-zinc-500">This replaces the current allocation; it is not added to it. {state.allowReduction ? "Choose at least 1 GiB, in steps of 0.25 GiB." : "Increases only, in steps of 0.25 GiB."}</p>
        {#if value * 1024 ** 3 > state.currentBytes}<p class="text-xs text-zinc-500">{gib(value * 1024 ** 3)} total · {gib(value * 1024 ** 3 - state.currentBytes)} more than currently allocated.</p>{/if}
        {#if value && value * 1024 ** 3 < state.currentBytes}<p class="text-xs text-zinc-500">{gib(value * 1024 ** 3)} total · {gib(state.currentBytes - value * 1024 ** 3)} less than currently allocated. Bots and browsers will have less RAM after restarting.</p>{/if}
        {#if state.restartRequired}<p class="text-[13px] text-zinc-500">Applying restarts the Space and interrupts running bot tasks. Bots, chats, files and sign-ins are kept.</p>{/if}
        <button class="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={busy || !value || value < 1 || value * 1024 ** 3 === state.currentBytes || (!state.allowReduction && value * 1024 ** 3 < state.currentBytes) || value * 1024 ** 3 > state.maxBytes || !Number.isInteger(value * 4)}>{busy ? 'Applying…' : state.restartRequired ? 'Apply and restart' : 'Apply RAM increase'}</button>
      </form>
    {:else}<p class="text-[13px] text-amber-800">There is no room for an increase within the host reserve. Stop other containers or add host RAM.</p>{/if}
  {:else if !error}<p class="text-[13px] text-zinc-500">Reading host capacity…</p>{/if}
  {#if error}<p role="alert" class="text-sm text-red-700">{error}</p>{/if}
  {#if success}<p role="status" class="text-sm text-zinc-600">RAM allocation applied and saved.</p>{/if}
</div>
