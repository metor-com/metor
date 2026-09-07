<script>
  // A file a bot made, next to the chat (instead of it on a phone): a toolbar with the name, Download and
  // Close, below it the file – pictures as such, text and Markdown rendered, pages, PDFs and media in a
  // frame (a page or SVG is served sandboxed by the gateway, so its scripts reach nothing of ours), and
  // for everything else (Office files, archives) only the name and Download. In a browser the frame and
  // the download carry the session cookie; in the desktop app the main process adds the token to both.
  import { app } from "../lib/base.js";
  import { picture } from "../lib/media.js";
  import { renderMarkdown } from "../lib/markdown.js";
  export let doc;          // { url, name }
  export let onClose;
  const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
  const FRAME = new Set(["html", "htm", "pdf", "mp4", "webm", "mov", "mp3", "m4a", "wav", "ogg"]);
  const TEXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "log", "yaml", "yml", "xml", "js", "mjs", "ts", "py", "sh", "css", "sql"]);
  const ext = (n) => String(n ?? "").split(".").pop()?.toLowerCase() ?? "";
  $: e = ext(doc.name);
  $: kind = IMAGE.has(e) ? "image" : FRAME.has(e) ? "frame" : TEXT.has(e) ? "text" : "none";
  let text = null, error = null;
  $: if (kind === "text") load(doc.url); else { text = null; error = null; }
  async function load(url) {
    text = null; error = null;
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); const t = await r.text(); if (url === doc.url) text = t; }
    catch (x) { if (url === doc.url) error = x.message; }
  }
  const tool = "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 text-xs text-zinc-700 hover:bg-zinc-50";
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-100">
  <div class="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
    <span class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900" title={doc.name}>{doc.name}</span>
    {#if app?.download}
      <button type="button" class={tool} on:click={() => app.download(doc.url, doc.name)} title="Save this file on your machine">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M6 11l6 6 6-6M4 21h16" /></svg>Download</button>
    {:else}
      <a class={tool} href={doc.url} download={doc.name} title="Save this file">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M6 11l6 6 6-6M4 21h16" /></svg>Download</a>
    {/if}
    <button type="button" class="flex size-8 shrink-0 items-center justify-center rounded-lg text-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" on:click={onClose} aria-label="Close the document" title="Close">×</button>
  </div>
  <div class="min-h-0 min-w-0 flex-1 overflow-auto">
    {#key doc.url}
      {#if kind === "image"}
        <div class="flex min-h-full items-center justify-center p-4"><img use:picture={doc.url} alt={doc.name} class="max-h-full max-w-full rounded-lg bg-white shadow-sm" /></div>
      {:else if kind === "frame"}
        <iframe title={doc.name} src={doc.url} class="h-full w-full bg-white" sandbox={e === "html" || e === "htm" ? "allow-scripts allow-forms allow-popups" : undefined}></iframe>
      {:else if kind === "text"}
        {#if error}<p class="p-4 text-sm text-red-600">{error}</p>
        {:else if text === null}<p class="p-4 text-sm text-zinc-400">Loading…</p>
        {:else if e === "md" || e === "markdown"}<div class="prose prose-zinc max-w-3xl px-6 py-5 text-[15px]">{@html renderMarkdown(text)}</div>
        {:else}<pre class="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[13px] leading-relaxed text-zinc-800">{text}</pre>{/if}
      {:else}
        <div class="m-auto flex h-full max-w-sm flex-col items-center justify-center gap-3 p-6 text-center text-zinc-500">
          <span class="text-4xl">📄</span>
          <p class="text-sm">This kind of file has no preview here. Download it to open it with the program it belongs to.</p>
        </div>
      {/if}
    {/key}
  </div>
</div>
