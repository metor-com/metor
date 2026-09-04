<script>
  // Devices (ADR-0012), shown inside Settings: every browser that opened a setup or pairing link
  // holds a session. Link a device = QR code / link / short code, valid for two minutes; revoke =
  // sign that device out. Plus the push notifications card of this device (ADR-0013).
  import { onDestroy } from "svelte";
  import { authSessions, authRevoke, authPair, authLogout } from "../lib/api.js";
  import { pushState, installPrompt, installApp, enablePush, disablePush, testPush } from "../lib/push.js";
  import { signedOut } from "../lib/base.js";
  let sessions = null, pair = null, error = null, timer = null, left = 0;

  // Push notifications: one card per device – state and hints come from lib/push.js
  let testResult = null, testing = false;
  const hints = {
    unsupported: "This browser cannot receive push notifications.",
    unavailable: "Push is not available in this box (the image lacks web-push).",
    "needs-install": "On iPhone and iPad push works only from the Home Screen app: Share → Add to Home Screen, open metor from there, sign in with a pairing code, then turn notifications on.",
    denied: "Notifications are blocked for metor – allow them in the browser or system settings, then reload.",
    off: "Get notified when a bot needs an approval, finishes a reply or stops unexpectedly.",
    on: "Approvals, finished replies and unexpected stops reach this device – unless you are looking at that chat.",
  };
  async function onTest() {
    testing = true; testResult = null;
    try {
      const r = await testPush();
      testResult = r.sent ? `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"} – the notification should show up now.`
        : r.enabled ? "Nothing sent – this device is not subscribed any more, turn notifications on again." : "Push is not available in this box.";
    } catch (e) { testResult = e.message; }
    testing = false;
  }

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
    try { if (s.current) { await authLogout(); signedOut(); return; } await authRevoke(s.id); await load(); } catch (e) { error = e.message; }
  }
  const fmt = (ms) => new Date(ms).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {});
  onDestroy(() => clearTimeout(timer));
</script>

<div class="flex flex-col gap-8">
  <div class="flex flex-col gap-3">
    <div><div class="text-sm font-medium">Signed-in devices</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">Every browser that opened a setup or pairing link. Remove one to sign it out.</p></div>
    {#if sessions === null}
      <p class="text-[13px] text-zinc-400">Loading…</p>
    {:else}
      <ul class="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
        {#each sessions as s (s.id)}
          <li class="flex items-center gap-3 px-4 py-3 text-sm">
            <span class="min-w-0 flex-1">
              <strong class="block truncate font-medium">{s.name}{#if s.current} <span class="font-normal text-emerald-700">· this device</span>{/if}</strong>
              <span class="block truncate text-xs text-zinc-500">last seen {fmt(s.lastSeenAt)} · since {fmt(s.createdAt)}</span>
            </span>
            <button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50" on:click={() => revoke(s)}>{s.current ? "Sign out" : "Remove"}</button>
          </li>
        {/each}
        {#if !sessions.length}<li class="px-4 py-3 text-sm text-zinc-400">no devices</li>{/if}
      </ul>
    {/if}
    {#if pair}
      <div class="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-[13px]">
        <p class="self-start leading-relaxed text-zinc-700">On the new device: scan the code with the camera, or open the sign-in page there and enter the pairing code.</p>
        {#if pair.qr}<img class="h-48 w-48 rounded-lg bg-white p-1" src={pair.qr} alt="QR code with the pairing link" />{/if}
        <div class="flex items-center gap-2">
          <span class="text-zinc-500">Pairing code</span>
          <code class="rounded-lg bg-white px-2.5 py-1 text-base font-bold tracking-wider">{pair.code}</code>
          <button type="button" class="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100" on:click={() => copy(pair.url)}>Copy link</button>
        </div>
        <p class="text-xs text-zinc-400">Valid for {left} s, single use.</p>
      </div>
    {/if}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <button type="button" class="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700" on:click={startPair}>{pair ? "New code" : "Link a device"}</button>
      <span class="text-xs leading-relaxed text-zinc-400">Lost all devices? <code>metor auth link</code> inside the box mints a new setup link.</span>
    </div>
    {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
  </div>

  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1"><div class="text-sm font-medium">Notifications on this device</div><p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">{hints[$pushState.state] ?? ""}</p></div>
      {#if $pushState.state === "on"}
        <button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50" disabled={testing} on:click={onTest}>Test</button>
        <button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50" on:click={() => { testResult = null; disablePush(); }}>Turn off</button>
      {:else if $pushState.state === "off"}
        <button type="button" class="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700" on:click={enablePush}>Turn on</button>
      {/if}
    </div>
    {#if $installPrompt}
      <button type="button" class="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50" on:click={installApp}>Install metor as an app</button>
    {/if}
    {#if testResult}<p class="text-[13px] text-zinc-700">{testResult}</p>{/if}
    {#if $pushState.error}<p class="text-[13px] text-red-600">{$pushState.error}</p>{/if}
  </div>
</div>
