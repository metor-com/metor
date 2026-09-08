// The few words the interface says in the device's language (knowledge/design/working-view.md):
// the status words around the steps a bot takes. German and English to begin with, everything
// else English; the rest of the interface stays English until it is translated as a whole.
export const lang = /^de\b/i.test(globalThis.navigator?.language ?? "") ? "de" : "en";

const T = {
  en: { steps: (n) => (n === 1 ? "1 step" : `${n} steps`), typing: "typing…", working: "working", showSteps: "Show the steps" },
  de: { steps: (n) => (n === 1 ? "1 Schritt" : `${n} Schritte`), typing: "schreibt…", working: "arbeitet", showSteps: "Die Schritte zeigen" },
};

export const t = (key, ...args) => { const v = T[lang][key] ?? T.en[key]; return typeof v === "function" ? v(...args) : v; };
