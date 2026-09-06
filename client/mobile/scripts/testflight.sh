#!/usr/bin/env bash
# Archive the iPhone app and upload it to TestFlight (client/mobile/README.md, "TestFlight").
#
# Needs, on a Mac with Xcode: the interface build tools (node), and an App Store Connect API key
# (App Store Connect → Users and Access → Integrations → App Store Connect API, role App Manager):
#   ASC_KEY_ID      the key's ID
#   ASC_ISSUER_ID   the issuer ID shown above the key list
#   ASC_KEY_PATH    the downloaded AuthKey_<ID>.p8
#   APPLE_TEAM_ID   the developer team
# Optional: BUILD_NUMBER (default: the UTC minute, always increasing), METOR_PUSH_RELAY.
# The version is the repository's VERSION file; the App ID, the push capability and the app record
# in App Store Connect must exist (README). Xcode registers the profiles itself (-allowProvisioningUpdates).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ASC_KEY_ID:?set ASC_KEY_ID}" "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}" "${ASC_KEY_PATH:?set ASC_KEY_PATH}" "${APPLE_TEAM_ID:?set APPLE_TEAM_ID}"
VERSION=$(tr -d '[:space:]' < ../../VERSION)
BUILD=${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
OUT=build/testflight; rm -rf "$OUT"; mkdir -p "$OUT"

echo "== interface build + sync"
npm run sync >/dev/null

echo "== archive $VERSION ($BUILD)"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" archive \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  "${AUTH[@]}" | grep -E "error:|warning: .*(entitlement|provision)|ARCHIVE (SUCCEEDED|FAILED)" || true
[ -d "$OUT/App.xcarchive" ] || { echo "no archive – see above"; exit 1; }

echo "== upload to App Store Connect"
sed "s/TEAM_ID/$APPLE_TEAM_ID/" ios/ExportOptions.plist > "$OUT/ExportOptions.plist"
xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" "${AUTH[@]}" | grep -E "error:|EXPORT (SUCCEEDED|FAILED)|Upload" || true
echo "Done: $VERSION ($BUILD) – it appears in App Store Connect → TestFlight after processing (a few minutes)."
