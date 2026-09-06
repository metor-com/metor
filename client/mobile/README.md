# metor mobile

The app for iPhone, iPad and Android ([ADR-0015](../../knowledge/decisions/0015-native-clients.md)):
a [Capacitor](https://capacitorjs.com) shell around the unchanged interface from `frontend/`. The
interface is bundled and runs on the app's own origin (`capacitor://localhost` on iOS,
`http://localhost` on Android – both built into the gateway's CORS list; `http` rather than
Capacitor's default `https` so that a computer answering over plain http is not blocked as mixed
content, and `localhost` is a secure context either way); the app connects to one
or more bots' computers by setup link, pairing link, pairing code or a `metor://connect?…` link and
keeps each session in the keychain (iOS) or keystore-encrypted storage (Android).

What is native here lives in `src/bridge.js` – the `window.metor` API the desktop app's preload
exposes, read by `frontend/src/lib/base.js`, plus `openComputer`: the list of computers, connect /
use / forget, sign-out handling, notifications while the app is open, the `metor://` link. Unlike
the desktop app there is no main process, so the bridge adds the session token itself: `fetch` to
the connected computer gets `Authorization: Bearer …`, the SSE stream too (a small `EventSource`
replacement on top of `fetch`). The session also goes into the WebView's cookie jar for that
computer's host – not for frames inside the page (WKWebView withholds the cookie from those,
they are cross-site), but for the **bot's screen and terminal, which open in a web view of their
own** (`@capacitor/inappbrowser`): there the computer's host is the top-level page, the cookie
travels, and the gateway serves page, assets, watch cookie and WebSocket exactly as for a browser.
`ComputerPanel.svelte` calls `window.metor.openComputer` for Screen and Terminal when it runs
inside the app and keeps the Files tab in the page. On Android that web view must run in the
app's process (`android.isIsolated: false`; the plugin's default is an isolated process with a
cookie store of its own, which shows the gateway's sign-in page instead).

Status: scaffold (2026-09-06). Pairing by `metor://` link, the session in the keychain or
keystore, the bot list and chat (fetch and SSE with the bearer token), and the bot's screen and
terminal in the app's own web view work in the iOS simulator and the Android emulator against a
local computer. Inline pictures do not yet – see *Open*.

## Development

```sh
cd client/mobile
npm install
npm run sync         # builds frontend/, copies it into www/ (with the bridge), then `cap sync`
npm run ios          # … and opens the Xcode project (ios/App/App.xcodeproj)
npm run android      # … and opens the Android project in Android Studio
```

- **iOS**: Xcode 16 or newer. The Xcode project uses Swift Package Manager (no CocoaPods); the
  first build fetches the Capacitor packages. Simulator from the command line:
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' build`,
  then `xcrun simctl install booted <App.app>` and `xcrun simctl launch booted com.metor.mobile`.
  Keep Xcode's "Sign to Run Locally" signature: with `CODE_SIGNING_ALLOWED=NO` the app has no
  entitlements and every keychain write fails with -34018, so no session is ever kept.
- **Android**: Android Studio with SDK 36 and any JDK 17 to 26 on the PATH. An emulator:
  `sdkmanager --install "system-images;android-36;google_apis;arm64-v8a"`, then
  `avdmanager create avd -n metor -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7`
  and `emulator -avd metor` (both tools from the SDK's `cmdline-tools`).
  `cd android && ./gradlew assembleDebug` builds `app/build/outputs/apk/debug/app-debug.apk`
  (the SDK platform is fetched on first use). The generated project was adjusted for that: the
  Gradle wrapper is 9.5.0 (the template's 8.14 does not start on JDK 25+; 9.6+ no longer works
  with the template's Android Gradle plugin 8.13), `settings.gradle` adds Gradle's toolchain
  resolver, and `gradle/gradle-daemon-jvm.properties` pins the build to a JDK 21 that Gradle
  downloads into `~/.gradle/jdks` itself – the Android plugin's `jlink` step fails on JDK 25+, so
  the daemon must not run on the machine's newer JDK. Verified 2026-09-06 with only OpenJDK 26
  installed.
- **A local computer** during development: the iOS simulator shares the Mac's loopback, so
  `http://127.0.0.1:6010` works as the address (plain http is allowed for local networking only,
  `NSAllowsLocalNetworking` in `Info.plist`); the Android emulator reaches the Mac as
  `http://10.0.2.2:6010` (plain http is allowed app-wide, `res/xml/network_security_config.xml`,
  as in the desktop app and the browser).
  Pairing without typing: `xcrun simctl openurl booted "metor://connect?url=http://127.0.0.1:6010&token=<token from metor auth link>"`
  (iOS asks "Open in metor?" once); Android:
  `adb shell "am start -a android.intent.action.VIEW -d 'metor://connect?url=http://10.0.2.2:6010&token=…'"`
  (the inner quotes matter, the device shell would cut the link at `&`). Debug builds log every
  plugin call to logcat, the stored session included – never hand a debug APK to anyone.
- `www/` is build output (git-ignored); `ios/` and `android/` are committed as generated, with
  the edits listed under *Native parts* – regenerate nothing, edit in place.

## Native parts (the edits to the generated projects)

- `ios/App/App/Info.plist`: the `metor` URL scheme (`CFBundleURLTypes`), local networking over
  plain http (`NSAppTransportSecurity` → `NSAllowsLocalNetworking`).
- `android/app/src/main/AndroidManifest.xml`: the `metor` intent filter, the network security
  config; `res/xml/network_security_config.xml` (plain http allowed).
- `android/gradle/wrapper/gradle-wrapper.properties` (Gradle 9.5.0), `android/settings.gradle`
  (toolchain resolver), `android/gradle/gradle-daemon-jvm.properties` (daemon on JDK 21) – see
  *Android* above; `android/variables.gradle`: `minSdkVersion 26` (Android 8), required by the
  in-app browser plugin.
- `capacitor.config.json`: app id `com.metor.mobile`, `CapacitorCookies` on (the session cookie
  for the web view of screen and terminal), `CapacitorHttp` off (the bridge patches `fetch` itself
  and needs streaming bodies).

Plugins: `@capacitor/app` (launch and open URLs), `@capacitor/local-notifications` (the gateway's
notify events while the app is open), `@aparajita/capacitor-secure-storage` (sessions),
`@capacitor/inappbrowser` (the screen and terminal web view).

## Open

- **Inline pictures** (avatars, attachment previews in the chat): `<img>` loads from the
  computer's host are cross-site subresource loads, and neither WKWebView nor Android's WebView
  sends the session cookie with them (verified 2026-09-06 on both: a public icon from the computer
  loads, an avatar or attachment behind the sign-in does not; Android treats the cookie as
  SameSite=Lax by default). Fetch them with the bearer token in the frontend and show the blob, or
  let the gateway accept a per-session ticket (HMAC of the session id with a server key, revoked
  with the session) on the picture routes. Links to attachments need the same treatment (share
  sheet).
- **Push**: needs the relay (APNs/FCM only take messages signed by the app's publisher); until then
  the app notifies only while it is open. Separate ADR.
- **Store release**: Apple Developer Program and Google Play accounts, icons and splash screens
  (`ios/App/App/Assets.xcassets`, `android/app/src/main/res`), a demo computer for Apple's
  review, the QR scanner for pairing codes, Face ID in front of the session. The `mobile`
  workflow in `.github/workflows/` builds both projects unsigned on every change here.
