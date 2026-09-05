// metor-setup – setup assistant for runtimes (ADR-0011): runs the harness's official login
// under the gateway and holds its state for the UI. One slot per runtime, purely in memory.
// Three modes (registry `setup.mode`):
//   device – the CLI prints link + one-time code, the user confirms at the provider (Codex)
//   code   – the CLI prints a link, the provider shows the user a code at the end, the user pastes
//            it into the UI and it goes to the waiting CLI's stdin (Claude Code)
//   key    – the user pastes an API key; the registry stores it inside the box and checks it with
//            one request (Gemini CLI, since Google closed the account login for the CLI)
// Credentials NEVER leave the box – the UI only sees the display data of the official flow.
// No user input reaches argv; the pasted code is written to the CLI's stdin only.
import { spawn } from "node:child_process";
import { HARNESSES } from "./metor-harness.mjs";

const slots = new Map();   // harnessId → { state, url, code, error, child, out, startedAt }
const ACTIVE = ["starting", "pending", "verifying"];
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
const lastLine = (out) => out.trim().split("\n").map((l) => l.trim()).filter((l) => l && !/paste code here/i.test(l)).pop()?.slice(0, 300);

export function setupStart(id) {
  const desc = HARNESSES[id];
  if (!desc) return { state: "failed", error: "unknown runtime" };
  const mode = desc.setup.mode;
  if (mode === "terminal") return { state: "terminal", mode, command: desc.setup.command };
  if (mode === "key") { slots.set(id, { state: "pending", url: desc.setup.link ?? null, code: null, error: null, child: null, out: "", startedAt: Date.now() }); return setupStatus(id); }
  const cur = slots.get(id);
  if (cur && ACTIVE.includes(cur.state)) return setupStatus(id);   // idempotent, no double spawn
  const child = spawn(desc.setup.command[0], desc.setup.command.slice(1), { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...(desc.setup.env ?? {}) } });
  const slot = { state: "starting", url: null, code: null, error: null, child, out: "", startedAt: Date.now() };
  slots.set(id, slot);
  // Some CLIs are driven over a protocol (Gemini: ACP) – the registry says what to send first
  for (const line of desc.setup.stdin ?? []) { try { child.stdin.write(line + "\n"); } catch {} }
  const onData = (d) => {
    slot.out = strip(slot.out + String(d)).slice(-4000);
    // Servers that keep running after the login: the registry's patterns decide, not the exit
    if (desc.setup.done?.test(slot.out) && !["done", "failed", "cancelled"].includes(slot.state)) { slot.state = "done"; try { child.kill(); } catch {} return; }
    if (desc.setup.failed?.test(slot.out) && !["done", "failed", "cancelled"].includes(slot.state)) { slot.state = "failed"; slot.error = "the sign-in was not accepted – start it again"; try { child.kill(); } catch {} return; }
    if (slot.state === "starting") {
      const url = slot.out.match(/https:\/\/\S+/)?.[0];
      if (!url) return;
      if (mode === "device") {
        const code = slot.out.match(/\b([A-Z0-9]{4}-[A-Z0-9]{5,6})\b/)?.[1];
        if (code) { slot.url = url; slot.code = code; slot.state = "pending"; }
      } else { slot.url = url; slot.state = "pending"; }
    } else if (slot.state === "verifying" && /invalid|expired|denied|error|failed/i.test(String(d))) {
      // The CLI rejected the pasted code (it may prompt again) – report and let the user retry
      slot.state = "failed"; slot.error = lastLine(strip(String(d))) ?? "code not accepted";
      try { child.kill(); } catch {}
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (codeNum) => {
    if (["cancelled", "failed"].includes(slot.state)) return;
    // Exit status alone is not proof (the CLI can end quietly) – the login probe decides
    if (codeNum === 0 && desc.loginProbe().ok) slot.state = "done";
    else { slot.state = "failed"; slot.error = codeNum === 0 ? "the sign-in did not complete" : (lastLine(slot.out) ?? `exit ${codeNum}`); }
  });
  child.on("error", (e) => { slot.state = "failed"; slot.error = e.message; });
  const t = setTimeout(() => {   // the link/code expires after ~15 min
    if (ACTIVE.includes(slot.state)) { slot.state = "failed"; slot.error = "Timed out – please restart the setup"; try { child.kill(); } catch {} }
  }, 16 * 60 * 1000);
  t.unref?.();
  return setupStatus(id);
}

// Mode "code": hand the code the provider showed the user to the waiting CLI
export async function setupSubmit(id, code) {
  const s = slots.get(id);
  if (!s) return { state: "idle" };
  const setup = HARNESSES[id]?.setup ?? {};
  if (setup.mode === "key") {
    if (s.state !== "pending") return setupStatus(id);
    const k = setup.clean ? setup.clean(code) : String(code ?? "").trim();
    if (!setup.valid?.(k)) return { ...setupStatus(id), error: "that does not look like a key – paste just the key, without spaces" };
    s.state = "verifying"; s.error = null;
    const v = setup.verify ? await setup.verify(k) : { ok: true };   // one small request through the CLI
    if (!v.ok) { s.state = "pending"; s.error = v.error ?? "key not accepted"; return setupStatus(id); }
    try { setup.store(k); s.state = "done"; } catch (e) { s.state = "failed"; s.error = e.message; }
    return setupStatus(id);
  }
  if (setup.mode !== "code") return { ...setupStatus(id), error: "this runtime needs no code" };
  if (s.state !== "pending") return setupStatus(id);
  let c = String(code ?? "").trim();
  // A pasted address instead of the code (…?code=…): take the code out of it
  try { if (/^https?:\/\//.test(c)) c = new URL(c).searchParams.get("code") ?? c; } catch {}
  if (!c || c.length > 400 || /[\x00-\x1f\x7f]/.test(c)) return { ...setupStatus(id), error: "invalid code" };
  s.state = "verifying"; s.error = null;
  try { s.child.stdin.write(c + "\n"); } catch (e) { s.state = "failed"; s.error = e.message; }
  return setupStatus(id);
}

export function setupStatus(id) {
  const s = slots.get(id);
  const mode = HARNESSES[id]?.setup.mode ?? null;
  if (!s) return { state: "idle", mode };
  return { state: s.state, mode, url: s.url, code: s.code, error: s.error, hint: HARNESSES[id]?.setup.hint ?? null, codeLabel: HARNESSES[id]?.setup.codeLabel ?? null, keyLabel: HARNESSES[id]?.setup.keyLabel ?? null };
}

export function setupCancel(id) {
  const s = slots.get(id);
  if (s && ACTIVE.includes(s.state)) { s.state = "cancelled"; try { s.child?.kill(); } catch {} }
  return setupStatus(id);
}
