export const METOR_COMMANDS = [
  { id: "metor:steps", name: "steps", origin: "metor", action: "steps", description: "Show or hide the bot’s steps in this chat" },
  { id: "metor:stop", name: "stop", origin: "metor", action: "stop", description: "Interrupt the bot’s current response" },
];
export function slashParts(text) {
  const m = /^\/([\w:.-]*)(?:[ \t]+([^\n]*))?$/.exec(text);
  return m ? { name: m[1], argument: m[2] ?? null } : null;
}
export function matchingCommands(commands, text) {
  const p = slashParts(text);
  return p && p.argument === null ? commands.filter((c) => c.name.toLowerCase().startsWith(p.name.toLowerCase())) : [];
}
export function exactCommand(commands, text, selectedId) {
  const p = slashParts(text.trim());
  if (!p) return null;
  const matches = commands.filter((c) => c.name === p.name);
  return matches.find((c) => c.id === selectedId) ?? (matches.length === 1 ? matches[0] : null);
}
