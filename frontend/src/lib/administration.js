import { writable } from "svelte/store";
import { gateway, app, origin } from "./base.js";
import { switchComputer, loadComputers } from "./session.js";
export const administration = writable(null);
gateway.subscribe(() => administration.set(null));
export async function openAdministration(c = null) {
  // A currently open personal Space needs no extra permission request or switch.
  let current;
  const unsubscribe = gateway.subscribe(value => current = value); unsubscribe();
  if (c && app && c.id !== current?.id && !(await switchComputer(c))) return;
  administration.set({ name: c?.name ?? current?.name ?? "Space", origin });
}
export async function removeFromOverview(c) {
  if (!confirm(`Remove "${c.name}" from this device? The Space and its bots will keep running.`)) return;
  try { await app.forget(c.id); await loadComputers(); } catch(e) { alert(e.message); }
}
