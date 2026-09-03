// One JSON endpoint per method; events arrive separately via the SSE stream (events.js).
const base = "/bots/api";

async function req(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (r.status === 401) location.href = "/bots/";   // session gone → the gateway serves the sign-in page
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
export const createAgent = (name, role, harness, model) => req("POST", "/agents", { name, role, ...(harness ? { harness } : {}), ...(model ? { model } : {}) });
export const listHarnesses = () => req("GET", "/harnesses");
export const setupStart = (id) => req("POST", `/harnesses/${id}/setup/start`);
export const setupStatus = (id) => req("GET", `/harnesses/${id}/setup/status`);
export const setupCancel = (id) => req("POST", `/harnesses/${id}/setup/cancel`);
export const setupCode = (id, code) => req("POST", `/harnesses/${id}/setup/code`, { code });
export const agentAction = (name, action) => req("POST", `/agents/${name}/${action}`);
export const watchUrl = (name) => req("GET", `/agents/${name}/watch-url`);
export const chatSend = (name, text, sendId, attachments) => req("POST", `/agents/${name}/chat/send`, { text, sendId, ...(attachments?.length ? { attachments } : {}) });
export async function uploadFile(name, file) {
  const r = await fetch(`${base}/agents/${name}/chat/upload?filename=${encodeURIComponent(file.name || "image.png")}`, { method: "POST", body: file });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data;
}
export const fileUrl = (name, path) => `${base}/agents/${name}/chat/file?path=${encodeURIComponent(path)}`;
export const listFiles = (name, path = "") => req("GET", `/agents/${name}/files?path=${encodeURIComponent(path)}`);
export const chatPermission = (name, ref, decision) => req("POST", `/agents/${name}/chat/permission`, { ref, decision });
export const listRoutines = (name) => req("GET", `/agents/${name}/routines`);
export const chatInterrupt = (name) => req("POST", `/agents/${name}/chat/interrupt`);
export const chatHistory = (name, limit = 200) => req("GET", `/agents/${name}/chat/history?limit=${limit}`);
