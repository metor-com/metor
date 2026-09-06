# 0015 – Native clients: Electron on the desktop, PWA on phones, one `client/` directory

**Date:** 2026-09-04 · **Status:** accepted (desktop app and gateway prerequisites implemented 2026-09-04; Capacitor scaffold in `client/mobile/` 2026-09-06, see the addendum; phones remain the PWA until it ships)

## Context

The interface is a PWA served by the gateway under `/bots/` (ADR-0013): same origin, session
cookie (ADR-0012), the API base `/bots/api` hard-wired in `frontend/src/lib/api.js` and
`events.js`, a 401 answered by loading the sign-in page. Wanted on top: installable apps for
macOS, Windows, Linux, Android and iOS, later voice control. On the desktop the app has jobs the
PWA cannot do: start and stop a local computer (the mac-install draft), show notifications while
it runs, capture the user's own screen so a bot can see it, keep several gateways side by side.

Shells considered:

- **Tauri 2** – one codebase for all five platforms, the system webview on each: WKWebView on
  macOS and iOS, WebView2 on Windows, WebKitGTK on Linux, the Android WebView. Experience with
  Tauri 2 apps: the same UI renders slightly differently per client (fonts, form controls,
  scrollbars, CSS support lagging on WebKitGTK), and screen capture (`getDisplayMedia`) is absent
  from WKWebView and spotty in WebKitGTK – it would need a native plugin per operating system.
- **Electron** – bundled Chromium: identical rendering on the three desktops, the engine the
  interface is developed against anyway, screen and window capture built in (own picker,
  macOS Screen Recording permission, PipeWire portal on Linux). Cannot run on iOS or Android.
- **Capacitor** – wraps the same web build in WKWebView / Android WebView for the stores.
- Flutter, React Native, Swift/Kotlin – a second UI; rejected for a one-person project with a
  living web client.

Platform rules that matter:

- **macOS outside the App Store:** Developer ID signature plus notarization, an automated
  scan, no content review. The shell is irrelevant.
- **Mac App Store:** App Sandbox and entitlements; both shells have a documented path. Not for an
  app that drives Docker or Apple `container` as child processes.
- **iOS App Store:** web content must use WebKit; an app that only wraps a website is rejected as
  minimum functionality; the reviewer needs a working sign-in. Electron is impossible there.
  Google Play has no webview rule.
- **Push:** a native app on a phone needs APNs/FCM, and those only accept messages signed with
  the publisher's keys – a relay run by the project. Web Push in the PWA needs none (ADR-0013).

## Decision

1. **Desktop = Electron** for macOS, Windows and Linux. The renderer is the unchanged
   `frontend/` Vite build; native parts live only in a small preload API: screen and window
   capture, tray and menu bar, the deep link `metor://` for setup and pairing links, native
   notifications derived from the SSE stream (no push while the app runs), control of a local
   computer through the `metor` wrapper as a child process, several gateways side by side.
   Distribution outside the Mac App Store: notarized DMG plus Homebrew cask; signed Windows
   installer plus winget; AppImage and deb on Linux, Flatpak optional. Updates from GitHub
   Releases through the Electron updater. Electron is pinned and bumped with every metor release.
2. **Phones stay the PWA** until a need appears that the PWA cannot meet (store presence,
   background voice). Then **Capacitor** wraps the same build; the UI is bundled in the app and
   speaks only the API, with native push, deep links, share sheet and biometrics in front of the
   token – this is what clears the iOS minimum-functionality rule. Native push then needs the
   relay, which is the actual decision at that point and gets its own ADR.
3. **One `client/` directory in the mono-repo** (ADR-0001): `client/desktop/` (Electron: main,
   preload, packaging) and later `client/mobile/` (Capacitor with the generated `ios/` and
   `android/` projects committed, built on macOS runners). No `client/shared/` – the shared part
   is `frontend/`. Store texts and screenshots live under each app's `store/`. The Homebrew tap
   and the winget manifests stay separate repositories because their tooling requires it.
4. **Gateway and frontend prerequisites, independent of the shell** (the tasks in `BACKLOG.md`):
   - a configurable API base in the frontend (origin plus `/bots/api`) instead of the literal,
     for JSON, SSE, uploads and the watch URLs of screen and terminal; the 401 handling must not
     load `/bots/` when the UI runs from an app origin;
   - a bearer token beside the cookie: the app redeems a setup link, pairing link or code
     through a JSON endpoint and receives the session secret once, keeps it in the OS keychain
     and sends `Authorization: Bearer` on every request, including SSE and the WebSocket
     upgrades for noVNC and ttyd (today those demand the session cookie and a per-bot watch
     cookie set by the HTTP proxy step); the session stays a device (ADR-0012), visible and
     revocable as before;
   - CORS for app origins (`METOR_APP_ORIGINS`, exact match, `Vary: Origin`, preflights for
     the JSON methods) – the `SameSite=Lax` cookie does not travel to a foreign origin, which
     is why the bearer token exists;
   - `GET /bots/api/version` before sign-in: gateway version and capabilities (harnesses,
     push, connectors), so an app can refuse an old computer with a clear message.
5. **Rendering QA shrinks to two engines:** Chromium on the desktop, Safari for the iPhone PWA.
   WebKitGTK is not a target.

## Consequences

- Electron costs about 100 MB per download and a few hundred MB installed, more memory than a
  system webview, and a major release every eight weeks with Chromium security fixes. Accepted
  for identical rendering and reliable capture; the computer image is larger by an order of
  magnitude anyway.
- Signing accounts: Apple Developer Program (also needed for iOS later), a Windows code-signing
  service. The desktop app is not in the Mac App Store.
- The sentence in ADR-0013 that names Tauri as the native shell is revised by this ADR; item 6 of
  the mac-install draft becomes an Electron menu-bar app.
- The frontend may no longer assume the same origin: no relative navigation on 401, no service
  worker inside the apps (push comes natively there), watch URLs built from the configured base.
- Voice: the microphone behaves the same in Chromium everywhere; the mobile webviews need a spike
  before voice is promised there.
- Until the relay exists, the phone experience is the PWA – including push, which the PWA
  already has and a native app would not.

## Addendum 2026-09-06: the phone scaffold

`client/mobile/` exists as decided in item 2 and 3 – earlier than planned, so that the app can be
used from TestFlight and Play's internal track long before a store release. Facts found on the way:

- The bundled interface runs on `capacitor://localhost` (iOS) and `https://localhost` (Android);
  both are built into the gateway's CORS list next to `app://metor`.
- There is no main process on a phone, so the bearer token cannot be added outside the page: the
  bridge (`src/bridge.js`, part of the app, not of `frontend/`) patches `fetch` and replaces
  `EventSource` for the connected computer. Frames (screen, terminal) and inline pictures are
  loaded by the WebView itself; for them the bridge puts the session into the WebView's cookie jar
  for the computer's host. Verified the same day in the iOS simulator: the cookie is stored but
  WKWebView does not send it with cross-site loads from the app's origin (third-party cookie
  blocking) – a public icon from the computer loads, an avatar behind the sign-in does not. The
  screen and terminal therefore open in a web view of their own (`@capacitor/inappbrowser`),
  where the computer's host is the top-level page: verified the same day, the in-app web view
  shares the cookie jar and the bot's desktop appears through noVNC with the gateway unchanged.
  Android (emulator, API 36) behaves the same, with two twists: the app's origin is
  `http://localhost`, not Capacitor's default `https://localhost`, so that a computer answering over
  plain http is not blocked as mixed content (localhost is a secure context either way); and the
  in-app web view must run in the app's process (`isIsolated: false`), the plugin's default
  isolated process has a cookie store of its own. Pictures and files (2026-09-06): the bridge
  says `fetchMedia`, the interface fetches pictures with the token and shows the blob, and a
  tapped file goes to the app, which downloads it with the token and opens it with the system
  viewer – no ticket in URLs, the gateway only learnt `HEAD` on the file route
  (`frontend/src/lib/media.js`, `client/mobile/README.md` "Pictures and files").
- Simulator builds must keep Xcode's "Sign to Run Locally" signature: without entitlements the
  keychain refuses every write (-34018) and the app cannot keep a session.
- Push stays as decided: none in the app until the relay exists – a Web-Push-to-APNs/FCM
  forwarder that only sees ciphertext, the gateway's existing Web Push code unchanged; decided in
  [ADR-0017](0017-push-relay.md). The PWA keeps push meanwhile.
- iOS uses Swift Package Manager (`--packagemanager SPM`), no CocoaPods. Android: the template's
  Gradle 8.14 does not start on JDK 25+, and the Android Gradle plugin's `jlink` step fails there
  too – the project runs Gradle 9.5 with a daemon pinned to a JDK 21 that Gradle downloads itself
  (`gradle-daemon-jvm.properties`), so any JDK 17-26 on the machine will do.
