// The bridge between the interface and the app (ADR-0015): `window.metor`. Read by
// frontend/src/lib/base.js; a browser has no such object and behaves as before.
const { contextBridge, ipcRenderer } = require("electron");
const info = ipcRenderer.sendSync("metor:info");
contextBridge.exposeInMainWorld("metor", {
  platform: info.platform,
  version: info.version,
  gateway: info.gateway,                                            // { id, name, origin, version, signedIn } | null
  gateways: (opts) => ipcRenderer.invoke("metor:gateways", opts ?? null),   // [{ id, name, origin, version, signedIn, local, unread, reachable }]; { probe: true } asks every computer first
  rename: (id, name) => ipcRenderer.invoke("metor:rename", id, name),
  onComputers: (cb) => ipcRenderer.on("metor:computers", (_e, list) => cb(list)),   // the list again whenever the app's own watch learns something
  connect: (args) => ipcRenderer.invoke("metor:connect", args),     // { url, claim } → { ok, error? }
  use: (id) => ipcRenderer.invoke("metor:use", id),
  forget: (id) => ipcRenderer.invoke("metor:forget", id),
  signedOut: () => ipcRenderer.send("metor:signed-out"),
  notify: (n) => ipcRenderer.send("metor:notify", { title: n?.title, body: n?.body, bot: n?.bot }),
  onOpenBot: (cb) => ipcRenderer.on("metor:open-bot", (_e, bot) => cb(bot)),
  // A computer on this machine through the bundled host command (Docker or Apple's container runtime)
  local: {
    status: () => ipcRenderer.invoke("metor:local-status"),         // { wrapper, runtime, state, platform, computer }
    run: (action, id) => ipcRenderer.invoke("metor:local", action, id ?? null),   // setup | up | down [for that local computer] → { ok, error? }
    onProgress: (cb) => ipcRenderer.on("metor:local-progress", (_e, p) => cb(p)),
  },
});
