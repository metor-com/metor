// Copies the interface build (frontend/dist) into ui/ – the app serves it from its own origin – and
// the host command (backend/harness/bin/metor) into resources/, from where a packaged app runs it.
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const src = join(root, "frontend", "dist"), dst = join(here, "..", "ui");
if (!existsSync(join(src, "index.html"))) { console.error("frontend/dist is missing – run `npm run build` in frontend/ first"); process.exit(1); }
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log(`ui: copied ${src} → ${dst}`);
const version = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
const wrapper = readFileSync(join(root, "backend", "harness", "bin", "metor"), "utf8").replace("METOR_VERSION_FALLBACK=dev", `METOR_VERSION_FALLBACK=${version}`);
mkdirSync(join(here, "..", "resources"), { recursive: true });
writeFileSync(join(here, "..", "resources", "metor"), wrapper); chmodSync(join(here, "..", "resources", "metor"), 0o755);
console.log(`resources/metor: the host command, version ${version}`);
