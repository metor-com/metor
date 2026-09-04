// Copies the interface build (frontend/dist) into ui/ – the app serves it from its own origin.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "frontend", "dist"), dst = join(here, "..", "ui");
if (!existsSync(join(src, "index.html"))) { console.error("frontend/dist is missing – run `npm run build` in frontend/ first"); process.exit(1); }
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log(`ui: copied ${src} → ${dst}`);
