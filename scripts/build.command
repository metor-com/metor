#!/usr/bin/env bash
# Double-click in Finder or run from Terminal.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
trap 'echo; echo "Build failed. See the error above."; if [ -t 0 ]; then read -r -p "Press Enter to close…" _reply; fi' ERR
export METOR_RUNTIME="${METOR_RUNTIME:-container}"
export METOR_BOX_IMAGE="${METOR_BOX_IMAGE:-metor-box:resize-test}"
case "$METOR_RUNTIME" in container|docker) ;; *) echo "METOR_RUNTIME must be container or docker" >&2; exit 1 ;; esac
for tool in node npm "$METOR_RUNTIME"; do
  command -v "$tool" >/dev/null || { echo "Missing dependency: $tool" >&2; exit 1; }
done
WRAPPER="$ROOT/backend/harness/bin/metor"
for project in frontend client/desktop; do
  if [ ! -d "$project/node_modules" ]; then (cd "$project" && npm ci); fi
done
echo "Building the desktop interface…"
npm --prefix client/desktop run ui
echo "Building ${METOR_BOX_IMAGE}…"
"$WRAPPER" box build
echo "Build complete. Open run.command to start metor."
