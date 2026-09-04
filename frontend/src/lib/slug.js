// Title → bot id, for the live preview in the create dialog. Mirror of slugify() in
// backend/harness/bin/metor-store.mjs (the gateway's result is what counts); the only difference:
// an empty result stays empty here (the gateway then assigns a random id) and a reserved word
// (api, assets) is shown as is – the gateway refuses it with a message.
const TRANSLIT = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "æ": "ae", "ø": "oe", "å": "aa" };
const RESERVED = new Set(["api", "assets"]);
export function slugify(title) {
  let s = String(title ?? "").toLowerCase().replace(/[äöüßæøå]/g, (c) => TRANSLIT[c]);
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}
export const isValidId = (n) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(n) && !RESERVED.has(n);
