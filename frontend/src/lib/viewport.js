// Breakpoint as a store: below 768 px the interface uses the messenger pattern (list OR bot view,
// no "side by side"); Tailwind's md: classes use the same threshold.
import { readable } from "svelte/store";

const mq = window.matchMedia("(min-width: 768px)");
export const isDesktop = readable(mq.matches, (set) => {
  const on = (e) => set(e.matches);
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
});
