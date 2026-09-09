// Runs only inside the authenticated noVNC page, including standalone/mobile views.
(() => {
  const match = /^\/bots\/([a-z0-9-]+)\/vnc\.html$/.exec(location.pathname);
  if (!match) return;
  const endpoint = `/bots/api/agents/${match[1]}/screen-paste`;
  const toolbar = document.createElement("div");
  toolbar.style.cssText = "position:fixed;right:12px;top:12px;z-index:1000;font:14px system-ui;color:white";
  const button = document.createElement("button");
  button.textContent = "Paste"; button.title = "Paste text into the focused field on the bot’s screen";
  button.style.cssText = "border:1px solid #71717a;border-radius:8px;padding:8px 12px;background:#27272a;color:white;cursor:pointer";
  const notice = document.createElement("div");
  notice.setAttribute("role", "status");
  notice.style.cssText = "max-width:300px;background:#27272a;border-radius:8px;margin-top:6px;padding:8px;display:none;white-space:normal";
  const copyButton = button.cloneNode(true);
  copyButton.textContent = "Copy"; copyButton.title = "Copy selected text from the bot’s browser";
  copyButton.style.marginRight = "6px";
  toolbar.append(copyButton, button, notice); document.body.append(toolbar);
  let busy = false, noticeTimer;
  function message(text) {
    clearTimeout(noticeTimer); notice.textContent = text; notice.style.display = "block";
    noticeTimer = setTimeout(() => { notice.style.display = "none"; }, 6000);
  }
  async function paste(text) {
    if (busy || !text) return false;
    if (new TextEncoder().encode(text).length > 256 * 1024 || text.includes("\0")) { message("Paste plain text up to 256 KB (without null characters)."); return false; }
    busy = true; button.disabled = true;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not paste text.");
      message("Text sent to the focused field."); return true;
    } catch (error) { message(error.message || "Could not paste text."); return false; }
    finally { busy = false; button.disabled = false; }
  }
  function manualCopy(text) {
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(420px,80vw);border:1px solid #71717a;border-radius:12px;padding:20px;background:#27272a;color:white;font:14px system-ui";
    const label = document.createElement("label"); label.textContent = "Press Cmd+C or Ctrl+C to copy this text, then close.";
    const field = document.createElement("textarea"); field.rows = 7; field.readOnly = true; field.value = text;
    field.style.cssText = "box-sizing:border-box;display:block;width:100%;margin:12px 0;padding:8px;font:14px system-ui";
    label.append(field);
    const close = document.createElement("button"); close.textContent = "Close"; close.onclick = () => dialog.close();
    dialog.addEventListener("close", () => { field.value = ""; dialog.remove(); });
    dialog.append(label, close); document.body.append(dialog); dialog.showModal(); field.focus(); field.select();
  }
  copyButton.addEventListener("pointerdown", (event) => event.preventDefault());
  copyButton.onclick = async () => {
    if (busy) return;
    busy = true; copyButton.disabled = true; button.disabled = true;
    try {
      const response = await fetch(endpoint.replace("screen-paste", "screen-copy"), { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not copy text.");
      if (!result.text) { message("Select plain text in the bot’s browser first."); return; }
      try { await navigator.clipboard.writeText(result.text); message("Text copied to your clipboard."); }
      catch { manualCopy(result.text); }
    } catch (error) { message(error.message || "Could not copy text."); }
    finally { busy = false; copyButton.disabled = false; button.disabled = false; }
  };
  function manualPaste() {
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(420px,80vw);border:1px solid #71717a;border-radius:12px;padding:20px;background:#27272a;color:white;font:14px system-ui";
    const label = document.createElement("label"); label.textContent = "Paste text here, then send it to the focused field on the bot’s screen.";
    const field = document.createElement("textarea"); field.rows = 7;
    field.style.cssText = "box-sizing:border-box;display:block;width:100%;margin:12px 0;padding:8px;font:14px system-ui";
    label.append(field);
    const send = document.createElement("button"); send.textContent = "Paste into screen";
    const cancel = document.createElement("button"); cancel.textContent = "Cancel"; cancel.style.marginLeft = "12px";
    send.onclick = async () => { send.disabled = true; if (await paste(field.value)) dialog.close(); else send.disabled = false; };
    cancel.onclick = () => dialog.close();
    dialog.addEventListener("close", () => { field.value = ""; dialog.remove(); });
    dialog.append(label, send, cancel); document.body.append(dialog); dialog.showModal(); field.focus();
  }
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.onclick = async () => {
    if (!navigator.clipboard?.readText) return manualPaste();
    try { const text = await navigator.clipboard.readText(); if (text) await paste(text); else message("The clipboard contains no text."); }
    catch { manualPaste(); }
  };
  let syncClipboard = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== "app://metor" || event.data?.type !== "metor:clipboard-sync") return;
    syncClipboard = event.data.enabled === true;
    button.hidden = copyButton.hidden = syncClipboard;
  });
  const inScreen = (target) => target instanceof Element && !!target.closest("#noVNC_container");
  // Stop noVNC from forwarding V before the local browser can dispatch its native paste
  // event. Do not preventDefault: that would suppress access to event.clipboardData.
  for (const type of ["keydown", "keyup"]) window.addEventListener(type, (event) => {
    if (syncClipboard && inScreen(event.target) && event.metaKey && event.key.toLowerCase() === "c") {
      event.preventDefault(); event.stopImmediatePropagation();
      if (type === "keydown" && !event.repeat) fetch(endpoint.replace("screen-paste", "screen-copy-key"), { method: "POST" }).catch(() => message("Could not copy text."));
      return;
    }
    if (inScreen(event.target) && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") event.stopImmediatePropagation();
  }, true);
  // Electron's Edit menu may dispatch a native copy event instead of a keydown.
  window.addEventListener("copy", (event) => {
    if (!syncClipboard || !inScreen(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    fetch(endpoint.replace("screen-paste", "screen-copy-key"), { method: "POST" }).catch(() => message("Could not copy text."));
  }, true);
  window.addEventListener("paste", (event) => {
    if (!inScreen(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const text = event.clipboardData?.getData("text/plain");
    if (text) void paste(text); else message("Copy some plain text first, or use Paste.");
  }, true);
})();
