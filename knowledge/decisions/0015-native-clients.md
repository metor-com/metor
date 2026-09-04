# 0015 – Native clients: Electron on the desktop, PWA on phones, one `client/` directory

**Date:** 2026-09-04 · **Status:** accepted (desktop app and gateway prerequisites implemented 2026-09-04; phones remain the PWA)

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
