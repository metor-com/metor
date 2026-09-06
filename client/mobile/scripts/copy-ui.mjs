// Takes the interface build (frontend/dist) into www/ – the app bundles it and serves it from its
// own origin – and bundles the bridge (src/bridge.js) that gives the page `window.metor`.
// www/index.html is the build's index with one change: the interface's module script is loaded by
// the bridge once the app knows which computer it is connected to (base.js reads `window.metor`
// at import time), and the PWA manifest is dropped (the app is the app).
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const src = join(root, "frontend", "dist"), dst = join(here, "..", "www");
if (!existsSync(join(src, "index.html"))) { console.error("frontend/dist is missing – run `npm run build` in frontend/ first"); process.exit(1); }
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, join(dst, "bots"), { recursive: true });   // the build is made for /bots/ – keep it there
let html = readFileSync(join(src, "index.html"), "utf8");
const m = /<script type="module" crossorigin src="(\/bots\/assets\/index-[^"]+\.js)"><\/script>/.exec(html);
if (!m) { console.error("index.html: the interface's module script was not found"); process.exit(1); }
html = html.replace(m[0], `<script type="module" src="/bridge.js" data-entry="${m[1]}"></script>`)
  .replace(/\s*<link rel="manifest"[^>]*>/, "");
writeFileSync(join(dst, "index.html"), html);
const version = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
await build({
  entryPoints: [join(here, "..", "src", "bridge.js")], bundle: true, format: "esm", target: ["ios15", "chrome100"],
  outfile: join(dst, "bridge.js"), sourcemap: false, minify: false, logLevel: "warning",
  // The push relay of this build (ADR-0017): whoever builds the app with their own Apple/Firebase credentials sets their own
  define: { __METOR_VERSION__: JSON.stringify(version), __METOR_PUSH_RELAY__: JSON.stringify((process.env.METOR_PUSH_RELAY ?? "https://push.metor.com").replace(/\/$/, "")) },
});
console.log(`www: interface from ${src}, bridge ${version}`);
