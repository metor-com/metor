<script>
  // Desktop app (ADR-0015): no computer connected yet, or this device was signed out of it. Connect
  // with a setup link, a pairing link or a pairing code – the same one-time secrets a browser uses
  // (ADR-0012). Known computers can be reopened or forgotten; the app keeps their sessions.
  import { app } from "../lib/base.js";
  const signedOut = !!app?.gateway && !app.gateway.signedIn;
  const unreachable = !!app?.gateway?.signedIn && app.gateway.reachable === false;   // known computer, no answer
  let address = app?.gateway?.origin ?? "", claim = "", busy = false, error = null, list = [];
  async function load() { try { list = (await app.gateways()) ?? []; } catch {} }
  load();

  // A computer on this machine (ADR-0015, mac-install): the app carries the host command and drives
  // Docker or Apple's container runtime. The button's job follows the state: set up, start, or
  // connect again; the command's output shows live while it runs.
  let local = null, localBusy = false, localError = null, progress = [];
  const RUNTIME = { container: "Apple's container runtime", docker: "Docker" };
  const machine = app?.platform === "darwin" ? "this Mac" : "this machine";
  async function loadLocal() { if (!app?.local) return; try { local = await app.local.status(); } catch (e) { local = { wrapper: false, state: "unknown", error: e.message }; } }
  loadLocal();
  app?.local?.onProgress((p) => {
    if (p.start) { localBusy = true; localError = null; progress = []; }
    if (p.line) progress = [...progress.slice(-7), p.line];
    if (p.done) { localBusy = false; if (!p.ok) localError = p.error ?? "failed"; loadLocal(); load(); }
  });
  // What the button should do: no known local computer or signed out → setup (mints a link, starts if needed);
  // known and signed in → start when stopped, open when running
  $: localAction = !local ? null
    : local.state === "no-runtime" || !local.wrapper ? null
    : !local.computer?.signedIn ? "setup"
    : local.state === "stopped" ? "up"
    : local.state === "running" ? "open" : "setup";
  $: localLabel = { setup: local?.state === "running" ? `Connect to the computer on ${machine}` : `Set up a computer on ${machine}`, up: `Start the computer on ${machine}`, open: `Open the computer on ${machine}` }[localAction] ?? "";
  async function runLocal() {
    localError = null;
    if (localAction === "open") { await app.use(local.computer.id); return; }
    try { const r = await app.local.run(localAction); if (!r?.ok) localError = r?.error ?? "failed"; } catch (e) { localError = e.message; }
  }

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
    {#if unreachable}
      <div class="mt-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
        <div><strong>{app.gateway.name}</strong> does not answer at <code class="font-mono">{app.gateway.origin}</code>. It is stopped, or this machine cannot reach it right now.</div>
        <button type="button" class="self-start rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs hover:bg-amber-100" on:click={() => app.use(app.gateway.id)}>Try again</button>
      </div>
    {/if}
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
    {#if app?.local && local && local.wrapper}
      <div class="mt-6 flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
        <div class="text-sm font-medium">A computer on {machine}</div>
        {#if local.state === "no-runtime"}
          <p class="text-[13px] leading-relaxed text-zinc-500">
            Needs a container runtime. On an Apple silicon Mac with macOS 26: <a class="underline" href="https://github.com/apple/container/releases" target="_blank" rel="noreferrer">Apple's container runtime</a>;
            otherwise <a class="underline" href="https://docs.docker.com/get-docker/" target="_blank" rel="noreferrer">Docker</a> or Colima. Install one, then check again.
          </p>
          <button type="button" class="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100" on:click={loadLocal}>Check again</button>
        {:else}
          <p class="text-[13px] leading-relaxed text-zinc-500">
            {RUNTIME[local.runtime] ?? local.runtime ?? "A container runtime"} on {machine}
            {#if local.state === "running"}– the computer is running.{:else if local.computer}– the computer is stopped.{:else}– no computer yet. The first setup downloads the image (about 1 GB) and takes a few minutes.{/if}
          </p>
          {#if localAction}
            <button type="button" class="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50" disabled={localBusy} on:click={runLocal}>{localBusy ? "Working…" : localLabel}</button>
          {/if}
        {/if}
        {#if progress.length}
          <pre class="max-h-40 overflow-auto rounded-lg bg-zinc-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-200">{progress.join("\n")}</pre>
        {/if}
        {#if localError}<p class="text-[13px] text-red-600">{localError}</p>{/if}
      </div>
    {/if}
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
