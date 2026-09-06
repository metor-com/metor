#!/usr/bin/env bash
# Archive the iPhone app and upload it to TestFlight (client/mobile/README.md, "TestFlight").
#
# Needs, on a Mac with Xcode: the interface build tools (node) and an App Store Connect API key
# (App Store Connect → Users and Access → Integrations → App Store Connect API, role App Manager).
# The settings come from ~/.config/metor/testflight.env (or the file named in METOR_TESTFLIGHT_ENV),
# a plain shell file, or from the environment:
#   APPLE_TEAM_ID   the developer team
#   ASC_ISSUER_ID   the issuer ID shown above the key list
#   ASC_KEY_ID      the key's ID – derived from the key file's name when unset
#   ASC_KEY_PATH    the downloaded AuthKey_<ID>.p8 – when unset, the single AuthKey_*.p8 under
#                   ~/metor/keys/apple/ is taken
# Optional: BUILD_NUMBER (default: the UTC minute, always increasing), METOR_PUSH_RELAY.
# The version is the repository's VERSION file; the App ID, the push capability and the app record
# in App Store Connect must exist (README). Xcode registers the profiles itself (-allowProvisioningUpdates).
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG="${METOR_TESTFLIGHT_ENV:-$HOME/.config/metor/testflight.env}"
VARS=(APPLE_TEAM_ID ASC_ISSUER_ID ASC_KEY_ID ASC_KEY_PATH BUILD_NUMBER)
if [ -f "$CONFIG" ]; then   # the file fills in what the environment does not set
  for v in "${VARS[@]}"; do eval "env_$v=\${$v:-}"; done
  set -a; . "$CONFIG"; set +a
  for v in "${VARS[@]}"; do eval "[ -n \"\$env_$v\" ] && $v=\$env_$v || true"; done
fi
KEYS_DIR="$HOME/metor/keys/apple"

fail() { echo "testflight: $*" >&2; exit 1; }
absolute() { local p="${1/#\~/$HOME}"; [ -f "$p" ] || return 1; echo "$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"; }

# The key file: named, or the one file in the keys folder
if [ -z "${ASC_KEY_PATH:-}" ]; then
  found=("$KEYS_DIR"/AuthKey_*.p8)
  [ ${#found[@]} -eq 1 ] && [ -f "${found[0]}" ] || fail "no ASC_KEY_PATH and not exactly one AuthKey_*.p8 in $KEYS_DIR – put the downloaded key there or set ASC_KEY_PATH in $CONFIG"
  ASC_KEY_PATH="${found[0]}"
fi
ASC_KEY_PATH=$(absolute "$ASC_KEY_PATH") || fail "key file not found: $ASC_KEY_PATH"
if [ -z "${ASC_KEY_ID:-}" ]; then ASC_KEY_ID=$(basename "$ASC_KEY_PATH" .p8); ASC_KEY_ID="${ASC_KEY_ID#AuthKey_}"; fi
[ -n "${ASC_ISSUER_ID:-}" ] || fail "ASC_ISSUER_ID is not set – the issuer ID from App Store Connect → Users and Access → Integrations, into $CONFIG"
[ -n "${APPLE_TEAM_ID:-}" ] || fail "APPLE_TEAM_ID is not set – the team ID from the developer account, into $CONFIG"

VERSION=$(tr -d '[:space:]' < ../../VERSION)
BUILD=${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
echo "== metor $VERSION build $BUILD, team $APPLE_TEAM_ID, key $ASC_KEY_ID ($ASC_KEY_PATH), issuer $ASC_ISSUER_ID"
[ "${1:-}" = "--check" ] && { echo "settings complete – run without --check to archive and upload"; exit 0; }

OUT=build/testflight; rm -rf "$OUT"; mkdir -p "$OUT"
echo "== interface build + sync"
npm run sync >/dev/null

echo "== archive"
set +e
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" archive \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  "${AUTH[@]}" > "$OUT/archive.log" 2>&1
status=$?; set -e
grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)" "$OUT/archive.log" | head -20 || true
[ $status -eq 0 ] && [ -d "$OUT/App.xcarchive" ] || fail "archive failed – the full log is $OUT/archive.log"

echo "== upload to App Store Connect"
sed "s/TEAM_ID/$APPLE_TEAM_ID/" ios/ExportOptions.plist > "$OUT/ExportOptions.plist"
set +e
xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" "${AUTH[@]}" > "$OUT/export.log" 2>&1
status=$?; set -e
grep -E "error:|EXPORT (SUCCEEDED|FAILED)|Upload" "$OUT/export.log" | head -20 || true
[ $status -eq 0 ] || fail "upload failed – the full log is $OUT/export.log"
echo "Done: $VERSION ($BUILD) – it appears in App Store Connect → TestFlight after processing (a few minutes)."
