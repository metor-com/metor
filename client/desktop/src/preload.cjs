// The bridge between the interface and the app (ADR-0015): `window.metor`. Read by
// frontend/src/lib/base.js; a browser has no such object and behaves as before.
const { contextBridge, ipcRenderer } = require("electron");
const info = ipcRenderer.sendSync("metor:info");
contextBridge.exposeInMainWorld("metor", {
  platform: info.platform,
  version: info.version,
  gateway: info.gateway,                                            // { id, name, origin, version, signedIn } | null
  gateways: () => ipcRenderer.invoke("metor:gateways"),
  connect: (args) => ipcRenderer.invoke("metor:connect", args),     // { url, claim } → { ok, error? }
  use: (id) => ipcRenderer.invoke("metor:use", id),
  forget: (id) => ipcRenderer.invoke("metor:forget", id),
  signedOut: () => ipcRenderer.send("metor:signed-out"),
  notify: (n) => ipcRenderer.send("metor:notify", { title: n?.title, body: n?.body, bot: n?.bot }),
  onOpenBot: (cb) => ipcRenderer.on("metor:open-bot", (_e, bot) => cb(bot)),
});
