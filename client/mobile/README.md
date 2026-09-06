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

## Push (ADR-0017)

The app registers with APNs or FCM through its own plugin (`MetorPushPlugin`, iOS in
`ios/App/App/`, Android in `android/app/src/main/java/com/metor/mobile/`), generates a Web Push
key pair and auth secret like a browser, and hands the gateway a subscription through the
existing `/push/subscribe` whose endpoint is the relay of this build (`METOR_PUSH_RELAY` at
`npm run ui`, default `https://push.metor.com`): `/v1/apns/<token>`, `/v1/apns-sandbox/<token>`
for development builds, `/v1/fcm/<token>`. The gateway encrypts for the device as it does for a
browser; the relay forwards; on iOS the notification service extension
(`ios/App/MetorNotificationService/`) decrypts and replaces the placeholder before the
notification is shown, on Android the messaging service does. The keys live in the keychain
access group both app and extension share (`$(AppIdentifierPrefix)com.metor.mobile`), on
Android in preferences wrapped with a keystore key. While native push is registered the bridge
shows no local notifications of its own. A tap opens the bot.

**The switch.** Settings → Devices shows the same "Notifications on this device" card as the PWA;
in the app it drives the native registration through `window.metor.push` (`state`, `enable`,
`disable`): *Turn off* removes the subscription at the computer and stops registering at start,
*Turn on* registers again, *Test* asks the gateway for a test push. The preference is per device.
A device that re-registers with a new token or query is one subscription at the gateway, not two
(the gateway matches subscriptions by the endpoint's path).

**Approve / Deny from the notification.** An approval push carries the permission card's `ref`
(gateway) and the id of the computer it came from (`?c=<id>` on the subscription's endpoint, passed
on by the relay). The bridge hands the native side the computer's address and session after each
registration (`MetorPush.setComputer`, keychain / wrapped preferences), so the actions answer
`POST /bots/api/agents/<bot>/chat/permission { ref, decision }` without opening the app – iOS in
`AppDelegate` (category `metor.approval`, both actions require the unlock), Android in
`MetorActionReceiver` (`setAuthenticationRequired`). Verified 2026-09-06 with a synthetic approval
push through the relay: Android shows the two buttons, Approve reaches the gateway (202) and the
notification disappears; iOS decrypts and marks the category (the simulator's notification center
does not let the tool tap, so the action itself waits for a real iPhone). Real approval cards come
from connectors marked "ask first" (ADR-0014); the box's own tools do not ask (ADR-0004).

Verified 2026-09-06 in the iPhone 17 simulator against push.metor.com: registration (real APNs
sandbox token – the simulator on Apple silicon registers with APNs), subscription at a local
computer, gateway → relay → APNs 201, extension decrypts ("Gemini: stopped" with the gateway's
text on the lock screen). Pitfalls met: the simulator build needs `DEVELOPMENT_TEAM` so that the
entitlements carry the team (keychain group, application identifier); an APNs key created as
"production only" answers `BadEnvironmentKeyInToken` for sandbox tokens; `TopicDisallowed` until
the App ID has the Push Notifications capability – and the relay's open APNs connection kept the
old verdict until it reconnected (it now drops the connection after such a refusal);
`xcrun simctl push` does not run the extension, only real pushes do; APNs delivery to the
simulator can lag or skip.

## Native parts (the edits to the generated projects)

- `ios/App/App/Info.plist`: the `metor` URL scheme (`CFBundleURLTypes`), local networking over
  plain http (`NSAppTransportSecurity` → `NSAllowsLocalNetworking`). `App.entitlements` and the
  extension's: `aps-environment`, the shared keychain access group. `SceneDelegate.swift` uses
  `MainViewController` (Capacitor plus the app's own plugins); `AppDelegate.swift` forwards the
  APNs token and handles notification taps. The extension target was added to the Xcode project
  with the `xcodeproj` gem (CocoaPods ships it); `MetorNotificationService/` holds its files.
- `android/app/src/main/AndroidManifest.xml`: the `metor` intent filter, the network security
  config, the messaging service, `POST_NOTIFICATIONS`; `res/xml/network_security_config.xml`
  (plain http allowed); `app/build.gradle`: `firebase-messaging` (the google-services plugin
  applies itself when `google-services.json` exists); `MainActivity.java` registers the plugin.
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
- **Push on Android** works in the emulator (verified 2026-09-06 against push.metor.com with the
  Firebase project's `google-services.json` in `android/app/`, git-ignored): FCM token, subscription
  at the gateway, relay → FCM 201, the messaging service decrypts and shows "Gemini: stopped".
  Pitfall: Play services in a freshly booted emulator reported a push connection but delivered
  nothing until the network was reset (airplane mode on and off); the relay's FCM messages are
  high priority, a normal-priority data message would be held back in the background anyway.
- **Store release**: Apple Developer Program and Google Play accounts, icons and splash screens
  (`ios/App/App/Assets.xcassets`, `android/app/src/main/res`), a demo computer for Apple's
  review, the QR scanner for pairing codes, Face ID in front of the session. The `mobile`
  workflow in `.github/workflows/` builds both projects unsigned on every change here.
