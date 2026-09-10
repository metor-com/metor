#!/usr/bin/env bash
# Double-click in Finder or run from Terminal.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
trap 'echo; echo "Start failed. See the error above."; if [ -t 0 ]; then read -r -p "Press Enter to close…" _reply; fi' ERR
export METOR_RUNTIME="${METOR_RUNTIME:-container}"
export METOR_BOX_IMAGE="${METOR_BOX_IMAGE:-metor-box:resize-test}"
case "$METOR_RUNTIME" in container|docker) ;; *) echo "METOR_RUNTIME must be container or docker" >&2; exit 1 ;; esac
for tool in node npm curl "$METOR_RUNTIME"; do
  command -v "$tool" >/dev/null || { echo "Missing dependency: $tool" >&2; exit 1; }
done
WRAPPER="$ROOT/backend/harness/bin/metor"
node scripts/local-dev.mjs start "$@"
READY=0
for ((attempt=0; attempt<90; attempt++)); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${METOR_PORT:-6010}/bots/api/version" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != 1 ]; then
  echo "Space did not become reachable." >&2
  "$WRAPPER" box logs
  exit 1
fi
# Restart only this checkout's Electron main process, never another Electron app.
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const executable = resolve('client/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
for (const line of lines) {
  const match = line.trim().match(/^(\d+)\s+(.+)$/);
  if (!match || !match[2].startsWith(executable + ' ')) continue;
  const pid = Number(match[1]);
  try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code === 'ESRCH') continue; throw error; }
  let stopped = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') { stopped = true; break; } throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!stopped) throw new Error('Please close the running development desktop app and run this script again.');
}
JS
echo "Opening metor…"
cd "$ROOT/client/desktop"
npm run dev
