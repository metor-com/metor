import { spawnSync } from "node:child_process";
export function clipboardText(value) {
  if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value, "utf8") > 256 * 1024) {
    throw new Error("Paste plain text up to 256 KB (without null characters).");
  }
  return value;
}
export function pasteText(display, value) {
  const text = clipboardText(value);
  if (!Number.isInteger(display) || display < 1) throw new Error("No screen available");
  if (!text) return { ok: true };
  const env = { ...process.env, DISPLAY: `:${display}` };
  // Input goes through stdin, never shell interpolation or command-line arguments.
  // xclip forks a selection owner; it serves the UTF-8 text until another copy replaces it.
  const copy = spawnSync("xclip", ["-selection", "clipboard", "-in"], {
    env, input: text, encoding: "utf8", stdio: ["pipe", "ignore", "ignore"], timeout: 3000,
  });
  if (copy.status !== 0) throw new Error("Could not access the screen clipboard. Update the Space and try again.");
  // Shift+Insert avoids racing the local Ctrl/Cmd key-up forwarded by noVNC.
  const paste = spawnSync("xdotool", ["key", "--clearmodifiers", "--delay", "0", "shift+Insert"], { env, timeout: 3000 });
  if (paste.status !== 0) throw new Error("Text was copied, but could not be pasted into the screen.");
  return { ok: true };
}
