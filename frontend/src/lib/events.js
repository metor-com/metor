// One SSE stream for everything (topics: agents, chat:<bot>, notify). EventSource reconnects on its
// own; on top of that our own backoff and an onOpen callback for refetching after a reconnect.
import { url } from "./base.js";
export function openEvents({ topics, onAgents, onChat, onNotify, onOpen }) {
  let es = null, stopped = false, backoff = 1000;
  function start() {
    if (stopped) return;
    es = new EventSource(url(`/bots/api/events?topics=${encodeURIComponent(topics.join(","))}`));
    es.addEventListener("agents", (e) => { try { onAgents?.(JSON.parse(e.data)); } catch {} });
    es.addEventListener("chat", (e) => { try { onChat?.(JSON.parse(e.data)); } catch {} });
    es.addEventListener("notify", (e) => { try { onNotify?.(JSON.parse(e.data)); } catch {} });
    es.onopen = () => { backoff = 1000; onOpen?.(); };
    es.onerror = () => { es.close(); if (!stopped) setTimeout(start, (backoff = Math.min(backoff * 2, 10_000))); };
  }
  start();
  return () => { stopped = true; es?.close(); };
}
