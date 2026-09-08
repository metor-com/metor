// The move between the views of the messenger pattern – computers overview, bot list, chat – as on a
// phone: forward, the arriving view slides in from the right over the leaving one, which moves a
// third of the way to the left and dims; back, the leaving view slides out to the right and the one
// beneath comes back from the left. Only transform and opacity change, so the compositor does the
// work and it stays smooth on iPhone and Android. The leaving view is taken out of the flow (absolute)
// so the arriving one gets the room – the parent must be `relative` and clip (`overflow-hidden`).
// Honours the system's reduced-motion setting: then the views just switch.
import { cubicOut } from "svelte/easing";
export const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
export function swap(node, { dir = "forward", out = false, enabled = true } = {}) {
  if (!enabled || reducedMotion()) return { duration: 0 };
  const forward = dir === "forward";
  if (out) { node.style.position = "absolute"; node.style.inset = "0"; node.style.pointerEvents = "none"; }
  node.style.zIndex = (forward ? !out : out) ? "20" : "10";   // the view that slides over the other one lies on top
  return {
    duration: out ? 240 : 300, easing: cubicOut,
    css: (t, u) => out
      ? (forward ? `transform: translateX(${-30 * u}%); opacity: ${1 - 0.5 * u}` : `transform: translateX(${100 * u}%)`)
      : (forward ? `transform: translateX(${100 * u}%)` : `transform: translateX(${-30 * u}%); opacity: ${1 - 0.5 * u}`),
  };
}
