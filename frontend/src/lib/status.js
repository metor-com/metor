// Status labels shown in the UI (terms per knowledge/GLOSSARY.md); unknown values pass through unchanged.
export const statusLabel = (s) =>
  ({ idle: "ready", busy: "working", waiting: "waiting for approval", stopped: "stopped" }[s] ?? s);
