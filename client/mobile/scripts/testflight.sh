#!/usr/bin/env bash
# Archive the iPhone app and upload it to TestFlight (client/mobile/README.md, "TestFlight").
#
# Needs, on a Mac with Xcode: the interface build tools (node) and an App Store Connect API key
# (App Store Connect → Users and Access → Integrations → App Store Connect API) with the **Admin** role:
# the export signs with a cloud-managed Apple Distribution certificate, and only Admin keys may
# create one ("Cloud signing permission error" otherwise). `--check` prints the settings and stops,
# `--upload` skips the archive step and uploads the archive from the last run.
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
  eval "$(. "$CONFIG"; for v in "${VARS[@]}"; do eval "printf 'cfg_%s=%q\\n' $v \"\${$v:-}\""; done)"
  for v in "${VARS[@]}"; do eval "[ -n \"\${$v:-}\" ] || $v=\${cfg_$v:-}"; done
  # a stale export from an earlier attempt must not beat a working file
  if [ -n "${ASC_KEY_PATH:-}" ] && ! [ -f "${ASC_KEY_PATH/#\~/$HOME}" ] && [ -f "${cfg_ASC_KEY_PATH:-}" ]; then
    echo "note: ASC_KEY_PATH from the environment ($ASC_KEY_PATH) does not exist – using the settings in $CONFIG"
    ASC_KEY_PATH=$cfg_ASC_KEY_PATH; ASC_KEY_ID=${cfg_ASC_KEY_ID:-}
    ASC_ISSUER_ID=${cfg_ASC_ISSUER_ID:-$ASC_ISSUER_ID}; APPLE_TEAM_ID=${cfg_APPLE_TEAM_ID:-$APPLE_TEAM_ID}
  fi
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
given="$ASC_KEY_PATH"
if ! ASC_KEY_PATH=$(absolute "$given"); then
  # moved since? with the key's ID the file is unmistakable wherever it lies under ~/metor/keys
  id="${ASC_KEY_ID:-$(basename "$given" .p8)}"; id="${id#AuthKey_}"
  ASC_KEY_PATH=$(find "$HOME/metor/keys" -name "AuthKey_$id.p8" 2>/dev/null | head -1)
  [ -n "$ASC_KEY_PATH" ] && echo "note: $given is gone, using $ASC_KEY_PATH" || fail "key file not found: $given (and no AuthKey_$id.p8 under ~/metor/keys) – fix ASC_KEY_PATH in $CONFIG"
fi
if [ -z "${ASC_KEY_ID:-}" ]; then ASC_KEY_ID=$(basename "$ASC_KEY_PATH" .p8); ASC_KEY_ID="${ASC_KEY_ID#AuthKey_}"; fi
[ -n "${ASC_ISSUER_ID:-}" ] || fail "ASC_ISSUER_ID is not set – the issuer ID from App Store Connect → Users and Access → Integrations, into $CONFIG"
[ -n "${APPLE_TEAM_ID:-}" ] || fail "APPLE_TEAM_ID is not set – the team ID from the developer account, into $CONFIG"

VERSION=$(tr -d '[:space:]' < ../../VERSION)
BUILD=${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
echo "== metor $VERSION build $BUILD, team $APPLE_TEAM_ID, key $ASC_KEY_ID ($ASC_KEY_PATH), issuer $ASC_ISSUER_ID"
[ "${1:-}" = "--check" ] && { echo "settings complete – run without --check to archive and upload"; exit 0; }

OUT=build/testflight
if [ "${1:-}" = "--upload" ] && [ -d "$OUT/App.xcarchive" ]; then
  echo "== using the archive of the last run ($OUT/App.xcarchive)"
else
  rm -rf "$OUT"; mkdir -p "$OUT"
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
fi

echo "== upload to App Store Connect"
sed "s/TEAM_ID/$APPLE_TEAM_ID/" ios/ExportOptions.plist > "$OUT/ExportOptions.plist"
set +e
xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" "${AUTH[@]}" > "$OUT/export.log" 2>&1
status=$?; set -e
grep -E "error:|EXPORT (SUCCEEDED|FAILED)|Upload" "$OUT/export.log" | head -20 || true
[ $status -eq 0 ] || { grep -q "Cloud signing permission" "$OUT/export.log" && echo "hint: the API key needs the Admin role (README, TestFlight)"; fail "upload failed – the full log is $OUT/export.log"; }
echo "Done: $VERSION ($BUILD) – it appears in App Store Connect → TestFlight after processing (a few minutes)."
