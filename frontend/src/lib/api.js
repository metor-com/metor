// One JSON endpoint per method; events arrive separately via the SSE stream (events.js).
import { app, origin, url, signedOut } from "./base.js";
const base = url("/bots/api");

const unreachable = () => new Error(app ? `The bots' computer at ${origin} does not answer – is it running?` : "The bots' computer does not answer – check the connection.");
async function req(method, path, body) {
  let r;
  try {
    r = await fetch(base + path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw unreachable(); }
  const data = await r.json().catch(() => null);
  if (r.status === 401) signedOut();   // session gone → the gateway's sign-in page, or the app's connect screen
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data;
}

// Devices (ADR-0012): the session behind this browser, all sessions, pairing, sign-out
export const authMe = () => req("GET", "/auth/me");
export const authSessions = () => req("GET", "/auth/sessions");
export const authRevoke = (id) => req("DELETE", `/auth/sessions/${id}`);
export const authPair = () => req("POST", "/auth/pair");
export const authLogout = () => req("POST", "/auth/logout");
// Push notifications (ADR-0013): the gateway's VAPID key, this browser's subscription, a test message
export const pushKey = () => req("GET", "/push/key");
export const pushSubscribe = (subscription) => req("POST", "/push/subscribe", { subscription });
export const pushUnsubscribe = (endpoint) => req("POST", "/push/unsubscribe", { endpoint });
export const pushTest = () => req("POST", "/push/test");

export const listAgents = () => req("GET", "/agents");
// title = what people see; the gateway derives the id from it unless `name` (an explicit id) is given
export const createAgent = (title, role, harness, model, name, avatar) => req("POST", "/agents", { title, role, ...(name ? { name } : {}), ...(harness ? { harness } : {}), ...(model ? { model } : {}), ...(avatar ? { avatar } : {}) });
export const listHarnesses = () => req("GET", "/harnesses");
export const setupStart = (id) => req("POST", `/harnesses/${id}/setup/start`);
export const setupStatus = (id) => req("GET", `/harnesses/${id}/setup/status`);
export const setupCancel = (id) => req("POST", `/harnesses/${id}/setup/cancel`);
export const setupCode = (id, code) => req("POST", `/harnesses/${id}/setup/code`, { code });
export const agentAction = (name, action) => req("POST", `/agents/${name}/${action}`);
export const watchUrl = (name) => req("GET", `/agents/${name}/watch-url`);
export const chatSend = (name, text, sendId, attachments) => req("POST", `/agents/${name}/chat/send`, { text, sendId, ...(attachments?.length ? { attachments } : {}) });
export async function uploadFile(name, file) {
  let r;
  try { r = await fetch(`${base}/agents/${name}/chat/upload?filename=${encodeURIComponent(file.name || "image.png")}`, { method: "POST", body: file }); }
  catch { throw unreachable(); }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data;
}
// The bot's picture: initials and colour (PUT), an uploaded image (POST) or back to initials (DELETE)
export const setAvatar = (name, avatar) => req("PUT", `/agents/${name}/avatar`, avatar);
export async function uploadAvatar(name, file) {
  let r; try { r = await fetch(`${base}/agents/${name}/avatar`, { method: "POST", headers: { "content-type": file.type }, body: file }); } catch { throw unreachable(); }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data;
}
export const resetAvatar = (name) => req("DELETE", `/agents/${name}/avatar`);
export const fileUrl = (name, path) => `${base}/agents/${name}/chat/file?path=${encodeURIComponent(path)}`;
export const listFiles = (name, path = "") => req("GET", `/agents/${name}/files?path=${encodeURIComponent(path)}`);
export const chatPermission = (name, ref, decision) => req("POST", `/agents/${name}/chat/permission`, { ref, decision });
export const listRoutines = (name) => req("GET", `/agents/${name}/routines`);
export const chatInterrupt = (name) => req("POST", `/agents/${name}/chat/interrupt`);
export const chatRead = (name) => req("POST", `/agents/${name}/chat/read`);   // "I am looking at this chat" – clears the unread badge
export const chatHistory = (name, limit = 200) => req("GET", `/agents/${name}/chat/history?limit=${limit}`);
// Connectors (ADR-0014): MCP servers for every bot, the curated directory, restart of the running bots
export const listConnectors = () => req("GET", "/connectors");
export const connectorDirectory = () => req("GET", "/connectors/directory");
export const addConnector = (body) => req("POST", "/connectors", body);
export const updateConnector = (id, body) => req("PUT", `/connectors/${id}`, body);
export const removeConnector = (id) => req("DELETE", `/connectors/${id}`);
export const restartBots = () => req("POST", "/connectors/restart");
