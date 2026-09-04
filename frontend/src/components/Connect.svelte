<script>
  // Desktop app (ADR-0015): no computer connected yet, or this device was signed out of it. Connect
  // with a setup link, a pairing link or a pairing code – the same one-time secrets a browser uses
  // (ADR-0012). Known computers can be reopened or forgotten; the app keeps their sessions.
  import { app } from "../lib/base.js";
  const signedOut = !!app?.gateway && !app.gateway.signedIn;
  let address = app?.gateway?.origin ?? "", claim = "", busy = false, error = null, list = [];
  async function load() { try { list = (await app.gateways()) ?? []; } catch {} }
  load();
  async function submit() {
    busy = true; error = null;
    try {
      const r = await app.connect({ url: address.trim(), claim: claim.trim() });
      if (!r?.ok) error = r?.error ?? "Connection failed.";
      // on success the app reloads this window with the computer's interface
    } catch (e) { error = e.message; }
    busy = false;
  }
  async function forget(g) { if (!confirm(`Forget "${g.name}"? The app signs out of that computer.`)) return; await app.forget(g.id); await load(); }
  const field = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500";
</script>

<div class="flex h-dvh items-center justify-center overflow-auto bg-zinc-100 p-4 font-sans text-[15px] text-zinc-900 antialiased">
  <main class="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
    <h1 class="text-xl font-bold">metor</h1>
    <p class="mt-1 text-[13px] leading-relaxed text-zinc-500">
      {signedOut ? "This device was signed out of the computer. Link it again with a pairing code or a setup link." : "Connect this app to your computer."}
    </p>
    <form class="mt-5 flex flex-col gap-3" on:submit|preventDefault={submit}>
      <label class="flex flex-col gap-1 text-[13px]">
        <span class="text-zinc-600">Address of the computer</span>
        <input class="{field} font-mono" bind:value={address} placeholder="https://bots.example.com" autocapitalize="off" autocorrect="off" spellcheck="false" />
      </label>
      <label class="flex flex-col gap-1 text-[13px]">
        <span class="text-zinc-600">Setup link, pairing link or pairing code</span>
        <input class="{field} font-mono" bind:value={claim} placeholder="https://…/bots/auth/claim?token=…  or  XXXX-XXXX" autocapitalize="off" autocorrect="off" spellcheck="false" required />
      </label>
      <button type="submit" class="mt-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50" disabled={busy || !claim.trim()}>{busy ? "Connecting…" : "Connect"}</button>
      {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
    </form>
    <ol class="mt-4 list-decimal pl-5 text-[13px] leading-relaxed text-zinc-500">
      <li><strong>Setup link</strong>: shown by the installer and by <code class="rounded bg-zinc-100 px-1">metor auth link</code> inside the box. Paste it – the address comes with it.</li>
      <li><strong>Pairing code</strong>: on a device that is signed in, open <em>Settings → Devices → Link a device</em>, then enter the address and the code here.</li>
    </ol>
    {#if list.length}
      <div class="mt-6 flex flex-col gap-2">
        <div class="text-sm font-medium">Known computers</div>
        <ul class="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {#each list as g (g.id)}
            <li class="flex items-center gap-3 px-4 py-3 text-sm">
              <span class="min-w-0 flex-1">
                <strong class="block truncate font-medium">{g.name}{#if !g.signedIn} <span class="font-normal text-zinc-400">· signed out</span>{/if}</strong>
                <span class="block truncate font-mono text-xs text-zinc-500">{g.origin}</span>
              </span>
              {#if g.signedIn}<button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50" on:click={() => app.use(g.id)}>Open</button>{/if}
              <button type="button" class="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50" on:click={() => forget(g)}>Forget</button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if app?.version}<p class="mt-6 text-xs text-zinc-400">metor app {app.version}</p>{/if}
  </main>
</div>
