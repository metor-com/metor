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
local computer, as do pictures and attachments (see *Pictures and files*) and push (ADR-0017).

The document pane of the browser and the desktop app (a file next to the chat) is not used in
the app: a file goes to the system viewer as described above, which has share and save.

## Several computers

The app connects to one computer at a time; the head of the bot list names it and its back arrow
leads to the overview of all known computers (`#/computers`, knowledge/design/several-computers.md):
one row per computer with its unread count, a tap switches to it (the interface loads anew);
below the rows *Add new computer*; the ⋮ menu of the overview opens the Settings. Inside a
computer the ⋮ menu renames or removes it. The overview asks every computer for its bot list when
it opens (`gateways({ probe: true })` in the bridge, which also keeps each list for the switch:
the interface shows it at first paint after the reload, with the pictures it fetched kept as data
URLs in sessionStorage; `fetch` carries the token of whichever known computer a URL belongs to),
the app once at start. The app icon's badge
is the sum over all computers: the native side keeps the last count per computer (iOS: the
keychain group the extension shares, `PushBadges`; Android: the wrapped preferences), the bridge
writes the connected computer's count from every bot list, the extension and the messaging
service write the number a push carries for the computer named by `c` on its endpoint (a push
while the app is open applies that number as well, `.badge` among the presentation options). A
tap on a push from another computer switches to that computer first, then opens the bot.

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

**When the app is deleted.** No app can run code at its own removal, so the subscription is
cleaned up by the platforms' feedback: the next push to a removed app makes FCM answer
`UNREGISTERED` and APNs `Unregistered` / `BadDeviceToken`, the relay turns both into 410, and the
gateway drops the subscription on the spot (as it does for a browser whose push service says the
same). Verified 2026-09-06 on Android in the emulator: app deleted, next push → relay `410
UNREGISTERED` → the gateway logs "1 dropped" and the entry is gone. The iOS simulator never tells
APNs about a removed app (its tokens keep answering 200); on a real iPhone APNs reports the
removal once the device has been online. Sign-out and "forget" unsubscribe explicitly, and a
revoked session takes its subscriptions with it (ADR-0012/0013). Note for iOS: keychain items
survive an app deletion, so a reinstalled app is still signed in and registers again by itself.

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

**The badge on the app icon.** It shows the number of unread replies across all bots – the same
count the bot list shows. Every push carries it (`badge` in the payload, computed by the gateway
when it sends); the iOS extension puts it on the notification (`content.badge`) and Android
notifications carry it as their number, so the count is right while the app is closed. While the
app is open the bridge applies every bot list it receives on the stream (`MetorPush.setBadge`):
the count goes on the icon, the notifications of bots that are read disappear from the
notification center (iOS: by thread `bot:<name>`; Android: by the notification id, the bot's
hash), all of them when nothing is unread. Applied on every list, not only on changes, because a
notification can arrive for a bot another device has read meanwhile. Android has no icon count
of its own – launchers derive their dot or number from the active notifications. Verified
2026-09-06: iPhone simulator badge 6 at start, 1 after reading a bot, 2 after a reply pushed
while the app was on the home screen (the extension set it), 1 again after reading it with the
notification gone; Android notification `number` matches and is cancelled when the bot is read.

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
`@capacitor/inappbrowser` (the screen and terminal web view), `@capacitor/filesystem` and
`@capacitor-community/file-opener` with `@capacitor/share` (attachments, see *Pictures and files*).

## A real phone and a computer on the Mac

The simulator shares the Mac's network, a real iPhone does not: the box publishes its port on
`127.0.0.1` only by default. For the phone in the same Wi-Fi start the computer with
`METOR_BIND=0.0.0.0 METOR_WATCH_BASE=http://<the Mac's address>:6010 metor box up` – the pairing
link from `metor auth link` then carries the Mac's address. Scan its QR code with the phone's
camera: the gateway sees a phone and asks *Open in the metor app* or *Continue in the browser*
before the one-time token is spent (the app link is `metor://connect?url=…&token=…`, the
browser link the same claim with `web=1`; a desktop browser is signed in straight away as
before). iOS asks once for local-network access. Away from home it is Tailscale or a server.

## Icons and splash screens

The sources are `assets/logo.svg` (the metor mark, the same as `frontend/public/icons/icon.svg`)
and `assets/logo-dark.svg` (the white "m" alone, for dark splash screens). `npm run assets`
regenerates everything with `@capacitor/assets`: the iOS app icon (full-bleed, the mark on
`#18181b`), the iOS launch images (light `#f4f4f5` / dark `#18181b`, logo 640 px wide on 2732),
Android's adaptive launcher icons and splash drawables. Android's status-bar icon for
notifications is a vector drawable of the "m" (`res/drawable/ic_stat_metor.xml`), which Android
wants white on transparent. Pitfall: with an SVG source the tool's `--logoSplashScale` refers to
the SVG's own 512 px, so the splash logo is given as a target width instead.

## TestFlight

`npm run testflight` (`scripts/testflight.sh`) builds the interface, archives the app for a real
iPhone in Release, signs it with the team's automatically managed profiles and uploads it to App
Store Connect, where it appears under TestFlight after a few minutes. It needs, once:

- the App ID `com.metor.mobile` with the Push Notifications capability (exists) and an **app
  record** in App Store Connect (My Apps → + → iOS, bundle ID `com.metor.mobile`);
- an **App Store Connect API key** (Users and Access → Integrations → App Store Connect API) with
  the **Admin** role – the export signs with a cloud-managed Apple Distribution certificate, which
  only an Admin key may create; an App Manager key archives fine and then fails the export with
  "Cloud signing permission error". The issuer ID, the key's ID and the downloaded `.p8` go into
  `~/.config/metor/testflight.env`, a plain shell file the script reads (`METOR_TESTFLIGHT_ENV`
  names another): `APPLE_TEAM_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` (absolute; `ASC_KEY_ID` is
  derived from the file name, and a single `AuthKey_*.p8` under `~/metor/keys/apple/` is found
  without a path). Nothing of that lives in the repository (`ios/ExportOptions.plist` carries a
  placeholder the script fills in). The script stops with a clear message when something is
  missing; the full xcodebuild logs are in `build/testflight/`.

`npm run testflight -- --check` prints the resolved settings and stops, `-- --upload` skips the
archive and uploads the archive of the last run (after fixing a key, say). The version is the
repository's `VERSION`, the build number the UTC minute (`BUILD_NUMBER` overrides). Release builds talk to APNs production, so the relay's `apns` route is used, and the
notification service extension gets its own profile from the same run. Before the first upload
App Store Connect asks the export-compliance question once per build unless
`ITSAppUsesNonExemptEncryption` is set in `Info.plist` – the app only uses the system's TLS and
CryptoKit, decide and set it. The `mobile` workflow still builds unsigned; uploads run from a Mac.

## Pictures and files

In a browser the interface and the computer share an origin, so every `<img>` and every link to a
file carries the session cookie by itself. In the app the interface sits on its own origin and the
computer is a foreign site: the session travels as a bearer token that the bridge adds to `fetch`
and the SSE stream – but a picture or a link is a load the WebView makes on its own, without the
token, and both WebViews withhold the session cookie from such cross-site loads (verified
2026-09-06: a public icon from the computer loads, an avatar behind the sign-in does not; Android
treats the cookie as SameSite=Lax). The desktop app has no such problem, its main process adds the
token to every request (`webRequest.onBeforeSendHeaders`); WKWebView offers nothing of the kind.

So the bridge says `fetchMedia` and the interface adapts (`frontend/src/lib/media.js`):

- **Pictures** (avatars, attachment previews): the `picture` action fetches the URL – the bridge's
  `fetch` carries the token – and puts the blob into the `<img>`; one cache per session (the
  newest 300 object URLs). In a browser and in the desktop app the action just sets `src`.
- **Files** (attachments, the file browser): a tap calls `window.metor.openFile(url, name)`
  instead of following the link. The bridge asks the gateway with `HEAD` (a clear message when
  the file is gone), downloads into a folder of its own under the app's cache
  (`Filesystem.downloadFile` with the token, streamed natively) and opens it with the system:
  Quick Look on iOS, the app registered for the type on Android (`@capacitor-community/file-opener`,
  which brings its own `FileProvider`); the share sheet when nothing opens it. The cache folder is
  emptied at every start. Pitfall: `downloadFile`'s `recursive` option does not create the folder
  on Android – `mkdir` first.

Verified 2026-09-06 in the simulator and the emulator: an uploaded avatar shows, a picture
attachment shows inline and opens full-screen on a tap, a PDF opens in Quick Look and in the
Android PDF viewer. Pictures are not cached on disk by the WebView any more (the object URLs live
in memory) – acceptable for chat-sized pictures.

## Open

- **Push on Android** works in the emulator (verified 2026-09-06 against push.metor.com with the
  Firebase project's `google-services.json` in `android/app/`, git-ignored): FCM token, subscription
  at the gateway, relay → FCM 201, the messaging service decrypts and shows "Gemini: stopped".
  Pitfall: Play services in a freshly booted emulator reported a push connection but delivered
  nothing until the network was reset (airplane mode on and off); the relay's FCM messages are
  high priority, a normal-priority data message would be held back in the background anyway.
- **Store release**: the App Store Connect app record and API key for *TestFlight* (above), a
  Google Play account with an internal track and a signing keystore, a demo computer for Apple's
  review, the QR scanner for pairing codes, Face ID in front of the session. The `mobile`
  workflow in `.github/workflows/` builds both projects unsigned on every change here.
