<script>
  // Desktop app (ADR-0015): no bots' computer connected yet, signed out of one, or one that does not
  // answer. Two steps: first "on this Mac" or "on a server" (one sentence each), then only what that
  // choice needs. Local (knowledge/design/mac-install.md): none known → set it up; exactly one →
  // open it (start or re-link first when needed); several → pick one. Remote: the address and a
  // setup link, pairing link or pairing code (ADR-0012).
  import { app } from "../lib/base.js";
  const g = app?.gateway ?? null;
  const isLocal = (origin) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(origin ?? "");
  const machine = app?.platform === "darwin" ? "this Mac" : "this machine";
  const RUNTIME = { container: "Apple's container runtime", docker: "Docker" };
  const signedOut = !!g && !g.signedIn;                                // known computer, session gone
  const unreachable = !!g?.signedIn && g.reachable === false;          // known computer, no answer

  // Which step to start on: the context decides (a known computer that needs attention), else the
  // hash (#/connect/local|remote, also used by the app's menus), else the question
  const fromHash = /^#\/connect\/(local|remote)/.exec(location.hash)?.[1] ?? null;
  let step = g ? (isLocal(g.origin) ? "local" : "remote") : fromHash ?? "choose";
  const choose = () => { step = "choose"; error = null; localError = null; };

  // ---------- Known computers ----------
  let list = [];
  const locals = () => list.filter((c) => isLocal(c.origin));
  const remotes = () => list.filter((c) => !isLocal(c.origin));
  async function load() { try { list = (await app.gateways()) ?? []; } catch {} }

  // ---------- Remote: the form ----------
  let address = g && !isLocal(g.origin) ? g.origin : "", claim = "", busy = false, error = null;
  async function submit() {
    busy = true; error = null;
    try { const r = await app.connect({ url: address.trim(), claim: claim.trim() }); if (!r?.ok) error = r?.error ?? "Connection failed."; }
    catch (e) { error = e.message; }
    busy = false;   // on success the app reloads this window with the computer's interface
  }
  async function forget(c) { if (!confirm(`Forget "${c.name}"? The app signs out of it.`)) return; await app.forget(c.id); await load(); }

  // ---------- Local: the host command through the app ----------
  let local = null, localBusy = false, localError = null, progress = [], doing = null, acted = false;
  async function loadLocal() { if (!app?.local) return; try { local = await app.local.status(); } catch (e) { local = { wrapper: false, state: "unknown" }; localError = e.message; } }
  app?.local?.onProgress((p) => {
    if (p.start) { localBusy = true; localError = null; progress = []; }
    if (p.line) progress = [...progress.slice(-7), p.line];
    if (p.done) { localBusy = false; if (!p.ok) localError = p.error ?? "failed"; loadLocal(); load(); }
  });
  async function run(action, id = null) {
    doing = action; localError = null;
    try { const r = await app.local.run(action, id); if (!r?.ok) localError = r?.error ?? "failed"; } catch (e) { localError = e.message; }
  }
  // What the local step does on its own, once it knows the state (the app switches the window when it succeeds)
  async function enterLocal() {
    if (acted || !app?.local) return;
    await Promise.all([loadLocal(), load()]);
    if (!local?.wrapper || local.state === "no-runtime") return;   // the step explains what to install
    const mine = locals();
    const target = g && isLocal(g.origin) ? mine.find((c) => c.id === g.id) ?? g : mine.length === 1 ? mine[0] : null;
    acted = true;
    if (!mine.length) return run("setup");                         // none yet → create it
    if (!target) return;                                            // several → the list below
    if (!target.signedIn) return run("setup", target.id);           // known but signed out → link again
    if (unreachable || local.state === "stopped") return run("up", target.id);   // stopped → start, the app opens it
    app.use(target.id);                                             // running → open
  }
  $: if (step === "local") enterLocal();
  const DOING = { setup: `Setting up the bots' computer on ${machine}…`, up: `Starting the bots' computer on ${machine}…`, down: "Stopping…" };
  const box = "rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm";
  const field = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500";
  const primary = "rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50";
  const small = "rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50";
</script>

<div class="flex h-dvh items-center justify-center overflow-auto bg-zinc-100 p-4 font-sans text-[15px] text-zinc-900 antialiased">

  {#if step === "choose"}
    <!-- Step 1: where the bots' computer is – one sentence each, nothing else yet -->
    <main class="w-full max-w-md {box}">
      <h1 class="text-xl font-bold">metor</h1>
      <p class="mt-1 text-[13px] leading-relaxed text-zinc-500">Where should your bots' computer be?</p>
      <div class="mt-5 flex flex-col gap-3">
        <button type="button" class="rounded-xl border border-zinc-200 px-4 py-3 text-left hover:border-zinc-400 hover:bg-zinc-50" on:click={() => (step = "local")}>
          <div class="text-sm font-medium">On {machine}</div>
          <p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">The app creates a computer for your bots right here and keeps it running. Nothing to rent, nothing to configure.</p>
        </button>
        <button type="button" class="rounded-xl border border-zinc-200 px-4 py-3 text-left hover:border-zinc-400 hover:bg-zinc-50" on:click={() => (step = "remote")}>
          <div class="text-sm font-medium">On a server</div>
          <p class="mt-0.5 text-[13px] leading-relaxed text-zinc-500">Your bots' computer already runs on a server of yours. You connect with its setup link or a pairing code.</p>
        </button>
      </div>
      {#if app?.version}<p class="mt-6 text-xs text-zinc-400">metor app {app.version}</p>{/if}
    </main>

  {:else if step === "local"}
    <!-- Step 2a: on this machine – the state decides what happens, the user mostly watches -->
    <main class="w-full max-w-md {box}">
      <button type="button" class="text-[13px] text-zinc-500 hover:text-zinc-900" on:click={choose}>‹ Back</button>
      <h1 class="mt-2 text-xl font-bold">The bots' computer on {machine}</h1>
      {#if !local}
        <p class="mt-3 text-[13px] text-zinc-500">Checking…</p>
      {:else if !local.wrapper}
        <p class="mt-3 text-[13px] leading-relaxed text-zinc-500">This build of the app cannot manage a computer on {machine}: the metor host command is missing.</p>
      {:else if local.state === "no-runtime"}
        <p class="mt-3 text-[13px] leading-relaxed text-zinc-500">
          A container runtime is needed first. On an Apple silicon Mac with macOS 26 install
          <a class="underline" href="https://github.com/apple/container/releases" target="_blank" rel="noreferrer">Apple's container runtime</a>;
          otherwise <a class="underline" href="https://docs.docker.com/get-docker/" target="_blank" rel="noreferrer">Docker</a> or Colima. Then check again.
        </p>
        <button type="button" class="mt-4 {small}" on:click={() => { acted = false; enterLocal(); }}>Check again</button>
      {:else if localBusy || (acted && !locals().length && !localError)}
        <p class="mt-3 text-[13px] leading-relaxed text-zinc-500">
          {DOING[doing] ?? "Working…"}
          {#if doing === "setup" && !locals().length} The first time this downloads the image (about 1 GB) and takes a few minutes.{/if}
          Uses {RUNTIME[local.runtime] ?? local.runtime}.
        </p>
      {:else if locals().length > 1 && !(g && isLocal(g.origin))}
        <p class="mt-1 text-[13px] leading-relaxed text-zinc-500">Several on {machine} – which one?</p>
        <ul class="mt-4 flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {#each locals() as c (c.id)}
            <li class="flex items-center gap-3 px-4 py-3 text-sm">
              <span class="min-w-0 flex-1">
                <strong class="block truncate font-medium">{c.name}{#if !c.signedIn}<span class="font-normal text-zinc-400">&nbsp;· signed out</span>{/if}</strong>
                <span class="block truncate font-mono text-xs text-zinc-500">{c.origin}</span>
              </span>
              {#if c.signedIn}<button type="button" class="shrink-0 {small}" on:click={() => app.use(c.id)}>Open</button>
              {:else}<button type="button" class="shrink-0 {small}" on:click={() => run("setup", c.id)}>Connect</button>{/if}
              <button type="button" class="shrink-0 {small}" on:click={() => forget(c)}>Forget</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mt-3 text-[13px] leading-relaxed text-zinc-500">
          {#if unreachable}It does not answer at <code class="font-mono">{g.origin}</code> – it is stopped, or {machine} cannot reach it right now.{/if}
          {#if signedOut}This app was signed out of it.{/if}
          {RUNTIME[local.runtime] ?? local.runtime} on {machine} – it is {local.state}.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          {#if local.state === "stopped"}<button type="button" class={primary} on:click={() => run("up", g?.id)}>Start it</button>{/if}
          {#if g && !g.signedIn}<button type="button" class={primary} on:click={() => run("setup", g.id)}>Connect again</button>
          {:else if g && local.state === "running"}<button type="button" class={primary} on:click={() => app.use(g.id)}>Open it</button>{/if}
          {#if !g && locals().length === 1}<button type="button" class={primary} on:click={() => { acted = false; enterLocal(); }}>Open it</button>{/if}
        </div>
      {/if}
      {#if progress.length}
        <pre class="mt-4 max-h-40 overflow-auto rounded-lg bg-zinc-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-200">{progress.join("\n")}</pre>
      {/if}
      {#if localError}
        <p class="mt-3 text-[13px] text-red-600">{localError}</p>
        <button type="button" class="mt-2 {small}" on:click={() => { acted = false; localError = null; enterLocal(); }}>Try again</button>
      {/if}
    </main>

  {:else}
    <!-- Step 2b: on a server – the address and a one-time secret from there -->
    <main class="w-full max-w-md {box}">
      <button type="button" class="text-[13px] text-zinc-500 hover:text-zinc-900" on:click={choose}>‹ Back</button>
      <h1 class="mt-2 text-xl font-bold">The bots' computer on a server</h1>
      {#if unreachable}
        <div class="mt-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
          <div>The bots' computer at <code class="font-mono">{g.origin}</code> does not answer. It is down, or {machine} cannot reach it right now.</div>
          <button type="button" class="self-start rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs hover:bg-amber-100" on:click={() => app.use(g.id)}>Try again</button>
        </div>
      {:else if signedOut}
        <p class="mt-1 text-[13px] leading-relaxed text-zinc-500">This app was signed out of <code class="font-mono">{g.origin}</code>. Link it again with a pairing code or a setup link.</p>
      {:else}
        <p class="mt-1 text-[13px] leading-relaxed text-zinc-500">Paste the setup link from the installer, or enter the address and a pairing code from a device that is signed in.</p>
      {/if}
      <form class="mt-5 flex flex-col gap-3" on:submit|preventDefault={submit}>
        <label class="flex flex-col gap-1 text-[13px]">
          <span class="text-zinc-600">Address of the bots' computer</span>
          <input class="{field} font-mono" bind:value={address} placeholder="https://bots.example.com" autocapitalize="off" autocorrect="off" spellcheck="false" />
        </label>
        <label class="flex flex-col gap-1 text-[13px]">
          <span class="text-zinc-600">Setup link, pairing link or pairing code</span>
          <input class="{field} font-mono" bind:value={claim} placeholder="https://…/bots/auth/claim?token=…  or  XXXX-XXXX" autocapitalize="off" autocorrect="off" spellcheck="false" required />
        </label>
        <button type="submit" class="mt-1 {primary}" disabled={busy || !claim.trim()}>{busy ? "Connecting…" : "Connect"}</button>
        {#if error}<p class="text-[13px] text-red-600">{error}</p>{/if}
      </form>
      <ol class="mt-4 list-decimal pl-5 text-[13px] leading-relaxed text-zinc-500">
        <li><strong>Setup link</strong>: shown by the installer and by <code class="rounded bg-zinc-100 px-1">metor auth link</code> inside the box. Paste it – the address comes with it.</li>
        <li><strong>Pairing code</strong>: on a device that is signed in, open <em>Settings → Devices → Link a device</em>, then enter the address and the code here.</li>
      </ol>
      {#await load() then _}
        {#if remotes().length}
          <div class="mt-6 flex flex-col gap-2">
            <div class="text-sm font-medium">Your bots' computers on servers</div>
            <ul class="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
              {#each remotes() as c (c.id)}
                <li class="flex items-center gap-3 px-4 py-3 text-sm">
                  <span class="min-w-0 flex-1">
                    <strong class="block truncate font-medium">{c.name}{#if !c.signedIn}<span class="font-normal text-zinc-400">&nbsp;· signed out</span>{/if}</strong>
                    <span class="block truncate font-mono text-xs text-zinc-500">{c.origin}</span>
                  </span>
                  {#if c.signedIn}<button type="button" class="shrink-0 {small}" on:click={() => app.use(c.id)}>Open</button>{/if}
                  <button type="button" class="shrink-0 {small}" on:click={() => forget(c)}>Forget</button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/await}
    </main>
  {/if}
</div>
