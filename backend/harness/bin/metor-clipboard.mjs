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

// X11 PRIMARY contains the currently selected text, without synthesizing a keypress.
export function copyText(display) {
  if (!Number.isInteger(display) || display < 1) throw new Error("No screen available");
  const result = spawnSync("xclip", ["-selection", "primary", "-out"], {
    env: { ...process.env, DISPLAY: `:${display}` }, encoding: "utf8",
    timeout: 3000, maxBuffer: 256 * 1024,
  });
  if (result.status !== 0) throw new Error("Select plain text in the bot’s browser first (up to 256 KB).");
  return { text: clipboardText(result.stdout) };
}

export function readClipboard(display) {
  if (!Number.isInteger(display) || display < 1) throw new Error("No screen available");
  const result = spawnSync("xclip", ["-selection", "clipboard", "-out"], {
    env: { ...process.env, DISPLAY: `:${display}` }, encoding: "utf8", timeout: 1000, maxBuffer: 256 * 1024,
  });
  return { text: result.status === 0 ? clipboardText(result.stdout) : null };
}
export function copyScreenKey(display) {
  if (!Number.isInteger(display) || display < 1) throw new Error("No screen available");
  const result = spawnSync("xdotool", ["key", "--clearmodifiers", "ctrl+c"], {
    env: { ...process.env, DISPLAY: `:${display}` }, timeout: 3000,
  });
  if (result.status !== 0) throw new Error("Could not copy from the screen.");
  return { ok: true };
}
