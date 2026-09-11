<script>
  import { onDestroy } from 'svelte';
  import { app } from '../lib/base.js';
  export let onBack;
  let host = '', port = 22, domain = '', password = '', identity = null, verified = false;
  let authMethod = 'password', keyName = '', passphrase = '';
  let info = null, busy = false, error = '', progress = '', installing = false;
  const field = 'w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm';
  const primary = 'rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50';
  const off = app.server.onProgress(line => progress = line);
  onDestroy(() => { off?.(); app.server.cancel(); password = ''; passphrase = ''; });
  async function probe() {
    busy = true; error = ''; verified = false;
    try { const r = await app.server.probe({ host, port }); if (!r.ok) throw Error(r.error); identity = r; if (!domain && !/^\d/.test(host)) domain = host; }
    catch (e) { error = e.message; }
    finally { busy = false; }
  }
  async function inspect() {
    busy = true; error = '';
    try {
      const result = app.server.inspect({ ...identity, domain, password, authMethod, passphrase }); password = ''; passphrase = '';
      const r = await result; if (!r.ok) throw Error(r.error); info = r;
    } catch (e) { error = e.message; }
    finally { busy = false; password = ''; passphrase = ''; }
  }
  async function install() {
    busy = true; installing = true; error = ''; progress = 'Preparing installation…';
    try { const r = await app.server.install(); if (!r.ok) throw Error(r.error); }
    catch (e) { error = e.message; info = null; }
    finally { busy = false; installing = false; }
  }
  async function chooseKey() {
    error = '';
    try { const r = await app.server.chooseKey(); if (r.ok) keyName = r.name; else if (!r.cancelled) error = r.error; } catch (e) { error = e.message; }
  }
  function reset() { app.server.cancel(); identity = null; info = null; verified = false; error = ''; progress = ''; password = ''; passphrase = ''; keyName = ''; }
</script>
<main class="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
  <button type="button" class="text-sm text-zinc-500 disabled:opacity-50" disabled={busy} on:click={() => { reset(); onBack(); }}>‹ Back</button>
  <h1 class="mt-2 text-xl font-bold">Set up an existing server</h1>
  <p class="mt-2 text-sm text-zinc-500">Use a fresh Ubuntu or Debian server from Hetzner or another provider. Your server stays in your own account.</p>
  {#if !identity}
    <form class="mt-5 flex flex-col gap-3" on:submit|preventDefault={probe}>
      <label class="text-sm">Server address<input class={field} bind:value={host} placeholder="Server IP or hostname" required disabled={busy} /></label>
      <label class="text-sm">SSH port<input class={field} type="number" min="1" max="65535" bind:value={port} required disabled={busy} /></label>
      <button class={primary} disabled={busy}>{busy ? 'Checking server identity…' : 'Continue'}</button>
    </form>
  {:else if !info && !installing}
    <div class="mt-4 rounded-lg bg-zinc-100 p-3 text-sm">
      <p class="font-medium">Verify this server</p>
      <p class="mt-1">Compare this fingerprint with the one in your provider’s server console:</p>
      <code class="mt-2 block break-all text-xs">{identity.fingerprint}</code>
      <details class="mt-2"><summary class="cursor-pointer">How do I check it?</summary><p class="mt-2">Open the server console in your provider account, sign in as root and run:</p><code class="mt-1 block break-all text-xs">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code></details>
      <label class="mt-3 flex items-start gap-2"><input type="checkbox" bind:checked={verified} disabled={busy} />The fingerprints match.</label>
    </div>
    <form class="mt-4 flex flex-col gap-3" on:submit|preventDefault={inspect}>
      <label class="text-sm">Space domain<input class={field} bind:value={domain} placeholder="bots.example.com" required disabled={busy} /></label>
      <p class="text-xs text-zinc-500">Point this domain’s DNS records to the server. Allow TCP ports 80 and 443 for HTTPS.</p>
      <label class="text-sm">Sign in as root using
        <select class={field} bind:value={authMethod} disabled={busy} on:change={() => { password = ''; passphrase = ''; }}>
          <option value="password">Password</option><option value="key">SSH key</option>
        </select>
      </label>
      {#if authMethod === 'key'}
        <button type="button" class="rounded-lg border border-zinc-300 p-2 text-sm" disabled={busy || !verified} on:click={chooseKey}>{keyName || 'Choose private SSH key…'}</button>
        <label class="text-sm">Key passphrase (if encrypted)<input class={field} type="password" autocomplete="off" bind:value={passphrase} disabled={busy || !verified} /></label>
        <p class="text-xs text-zinc-500">Choose the private key matching the public key you added at your provider. Your private key stays on this device. The passphrase is never saved.</p>
      {:else}
        <label class="text-sm">Root password<input class={field} type="password" autocomplete="off" bind:value={password} required disabled={busy || !verified} /></label>
        <p class="text-xs text-zinc-500">Used for this setup only. The password is never saved. A provider-console password may not allow SSH login; use your SSH key if the server was created with one.</p>
      {/if}
      <button class={primary} disabled={busy || !verified || (authMethod === 'key' && !keyName)}>{busy ? 'Checking server…' : 'Check server'}</button>
      <button type="button" class="text-sm underline" disabled={busy} on:click={reset}>Use another server</button>
    </form>
  {:else if info && !installing}
    <div class="mt-4 rounded-lg bg-zinc-100 p-4 text-sm">
      <p class="font-medium">{info.os} · {info.cpus} vCPUs</p>
      <p class="mt-1">{(info.ram / 1024).toFixed(1)} GiB RAM · {(info.disk / 1024).toFixed(1)} GiB free disk</p>
      <p class="mt-2">Space allocation: {(info.memory / 1024).toFixed(2)} GiB RAM. The remaining RAM stays available to the server.</p>
      {#if info.ram < 15000}<p class="mt-2 text-zinc-600">16 GB of server RAM is recommended for several active bots. This server can run a smaller Space.</p>{/if}
    </div>
    {#if info.resume}<p class="mt-3 text-sm">An earlier setup was found (stage: {info.resume}). Existing data and settings will be retained.</p>{/if}
    {#if info.dns}<p class="mt-3 text-sm {info.dns.ok ? 'text-green-700' : 'text-amber-700'}">{info.dns.message}</p>{/if}
    <button type="button" class="mt-2 text-sm underline" on:click={() => { info = null; progress = ''; }}>Change details or check again</button>
    {#if info.resume === 'ready'}
      <p class="mt-4 text-sm">Connect this app to the existing Space at <strong>{domain}</strong>. Running bots will stay running.</p>
    {:else}
      <p class="mt-4 text-sm">Install Docker, metor {app.version}, persistent storage and HTTPS at <strong>{domain}</strong>, then connect this app. This can take several minutes. Keep the app open.</p>
    {/if}
    <button type="button" class="mt-4 w-full {primary}" disabled={busy || info.dns?.ok === false} on:click={install}>{info.resume === 'ready' ? 'Reconnect existing Space' : info.resume ? 'Resume setup and connect' : 'Install and connect'}</button>
  {/if}
  {#if progress}<p class="mt-4 text-sm text-zinc-600" role="status">{progress}</p>{/if}
  {#if error}<p class="mt-4 text-sm text-red-600" role="alert">{error}</p>{/if}
</main>
