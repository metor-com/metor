// The few words the interface says in the device's language (knowledge/design/working-view.md):
// the status words around the steps a bot takes, and the line that says what a step does. German
// and English to begin with, everything else English; the rest of the interface stays English
// until it is translated as a whole.
export const lang = /^de\b/i.test(globalThis.navigator?.language ?? "") ? "de" : "en";

const T = {
  en: {
    steps: (n) => (n === 1 ? "1 step" : `${n} steps`), typing: "typing…", working: "working", showSteps: "Show the steps",
    // %s is the step's subject: the command, the file, the query, the page's host
    step: { command: "Running %s", "read-file": "Reading %s", "edit-file": "Editing %s", "search-files": "Searching files for “%s”",
      "web-search": "Searching the web for “%s”", "read-page": "Reading %s", delegate: "Delegating: %s", connector: "%s", other: "%s" },
  },
  de: {
    steps: (n) => (n === 1 ? "1 Schritt" : `${n} Schritte`), typing: "schreibt…", working: "arbeitet", showSteps: "Die Schritte zeigen",
    step: { command: "Führt %s aus", "read-file": "Liest %s", "edit-file": "Ändert %s", "search-files": "Sucht in Dateien nach „%s“",
      "web-search": "Sucht im Web nach „%s“", "read-page": "Liest %s", delegate: "Delegiert: %s", connector: "%s", other: "%s" },
  },
};

export const t = (key, ...args) => { const v = T[lang][key] ?? T.en[key]; return typeof v === "function" ? v(...args) : v; };

// The line for a step: the model's own words when the runtime gave them, otherwise verb + subject
// from the dictionary – as {pre, subject, post} so the subject can be set apart (commands in mono)
export function stepLine(step, name) {
  if (!step) return null;
  if (step.text) return { pre: step.text, subject: "", post: "", mono: false };
  const template = T[lang].step[step.kind] ?? T.en.step[step.kind] ?? "%s";
  const [pre, post = ""] = template.split("%s");
  return { pre, subject: step.subject ?? name ?? "", post, mono: step.kind === "command" };
}
