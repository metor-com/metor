<script>
  // Devices (ADR-0012): every browser that opened a setup or pairing link holds a session.
  // Link a device = QR code / link / short code, valid for two minutes; revoke = sign that device out.
  import { onDestroy } from "svelte";
  import { authSessions, authRevoke, authPair, authLogout } from "../lib/api.js";
  export let onDone;
  let sessions = null, pair = null, error = null, timer = null, left = 0;

  async function load() { try { sessions = await authSessions(); } catch (e) { error = e.message; sessions = []; } }
  load();
  // While the pairing card is open, refresh every 3 s so the new device shows up at once
  function tick() { clearTimeout(timer); timer = setTimeout(async () => { left = pair ? Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000)) : 0; if (pair && left === 0) pair = null; await load(); if (pair) tick(); }, 3000); }
  async function startPair() {
    error = null;
    try { pair = await authPair(); left = Math.round((pair.expiresAt - Date.now()) / 1000); tick(); } catch (e) { error = e.message; }
  }
  async function revoke(s) {
    if (!confirm(s.current ? "Sign out this device?" : `Sign out "${s.name}"?`)) return;
    try { if (s.current) { await authLogout(); location.href = "/bots/"; return; } await authRevoke(s.id); await load(); } catch (e) { error = e.message; }
  }
  const fmt = (ms) => new Date(ms).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {});
  onDestroy(() => clearTimeout(timer));
</script>

<div class="fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-4" role="presentation" on:click={() => onDone?.()}>
  <div class="flex w-[26rem] max-w-full flex-col gap-3.5 rounded-2xl bg-white p-5 shadow-xl" role="dialog" on:click|stopPropagation>
    <h2 class="text-lg font-bold">Devices</h2>
    {#if sessions === null}
      <p class="text-[13px] text-zinc-400">Loading…</p>
    {:else}
      <ul class="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
        {#each sessions as s (s.id)}
          <li class="flex items-center gap-3 px-3 py-2.5 text-sm">
            <span class="min-w-0 flex-1">
              <strong class="block truncate">{s.name}{#if s.current} <span class="font-normal text-emerald-700">· this device</span>{/if}</strong>
              <span class="block truncate text-xs text-zinc-500">last seen {fmt(s.lastSeenAt)} · since {fmt(s.createdAt)}</span>
            </span>
            <button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50" on:click={() => revoke(s)}>{s.current ? "Sign out" : "Remove"}</button>
          </li>
        {/each}
        {#if !sessions.length}<li class="px-3 py-2.5 text-sm text-zinc-400">no devices</li>{/if}
      </ul>
    {/if}

    {#if pair}
      <div class="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-[13px]">
        <p class="self-start text-zinc-700">On the new device: scan the code with the camera, or open the sign-in page there and enter the pairing code.</p>
        {#if pair.qr}<img class="h-48 w-48 rounded-lg bg-white p-1" src={pair.qr} alt="QR code with the pairing link" />{/if}
        <div class="flex items-center gap-2">
          <span class="text-zinc-500">Pairing code</span>
          <code class="rounded-lg bg-white px-2.5 py-1 text-base font-bold tracking-wider">{pair.code}</code>
          <button type="button" class="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100" on:click={() => copy(pair.url)}>Copy link</button>
        </div>
        <p class="text-xs text-zinc-400">Valid for {left} s, single use.</p>
      </div>
    {/if}

    {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
    <div class="flex justify-between gap-2">
      <button type="button" class="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm text-white hover:bg-zinc-700" on:click={startPair}>{pair ? "New code" : "Link a device"}</button>
      <button type="button" class="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm hover:bg-zinc-50" on:click={() => onDone?.()}>Close</button>
    </div>
    <p class="text-xs text-zinc-400">Lost all devices? Run <code>metor auth link</code> inside the box for a new setup link.</p>
  </div>
</div>
