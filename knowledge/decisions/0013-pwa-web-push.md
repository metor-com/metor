# 0013 – Installable interface (PWA) with Web Push, no push relay

**Date:** 2026-09-04 · **Status:** accepted (implemented)

## Context

The interface is used from phones and tablets. Two things were missing: an app icon on the home
screen, and a notification when a bot needs an approval or has finished while the phone is in
the pocket. The stopgap was ntfy (`METOR_NTFY_URL`: a third-party app and a public topic, only
for approvals). Native apps are planned, but they cost an Apple developer account, store releases
and – because every metor installation is self-hosted – a push relay run by us, since APNs and FCM
only accept messages signed with the app publisher's keys. Web Push with VAPID has none of these
costs: the sender is whoever holds the key pair, and that can be each installation's own gateway.

## Decision

1. **The interface is a PWA.** Manifest, service worker and icons live in `frontend/public/` and
   are served by the gateway under `/bots/`; `index.html` carries the iOS home-screen meta tags
   and `viewport-fit=cover`, the app shell pads with the safe-area insets. No offline shell – the
   interface is live by nature; the worker only caches the hashed build assets.
2. **The gateway sends Web Push itself** (`metor-push.mjs`, package `web-push` in the image).
   The VAPID key pair is created on first use and stored with the subscriptions in
   `/workspace/.metor/push.json`. A subscription belongs to the device session that created it
   (ADR-0012) and disappears with it (sign-out, revoke, stale session) or when the push service
   rejects it for good (404/410 gone, 401/403 key mismatch). Payloads are encrypted for the
   device (RFC 8291); the push services of Apple, Google and Mozilla see nothing readable.
3. **Three events:** *approval needed* (a permission entry with status pending), *reply finished*
   (the bot's status goes from busy to idle; the last assistant text of that turn is the body),
   *unexpected stop* (status stopped without a stop or remove requested through the interface;
   the host's error text when it failed). Devices whose interface shows that bot's chat – an open
   SSE stream with its topic – are skipped; the interface closes its stream while in the
   background, so a phone in the pocket does get the push. Every push shows a notification: iOS
   revokes the subscription of a worker that stays silent.
4. **Public files.** Manifest, icons and the service worker are served before the sign-in gate:
   browsers fetch them without cookies while installing, and they contain nothing secret.
5. **UI.** The Devices dialog gets a card "Notifications on this device": turn on/off, a test
   message, "Install metor as an app" where the browser offers it (Android, desktop Chrome), and
   the iPhone/iPad hint (home screen first). The push endpoints are the same ones a native client
   would use later.

## Consequences

- Needs HTTPS (localhost excepted) – the installer's caddy profile or the operator's own proxy.
- iPhone and iPad (iOS 16.4+) receive push only from the Home Screen app, and that app has its
  own cookie jar: sign in once inside it with a pairing code. The card says so.
- The supervisor now stops the gateway before the bots; otherwise every restart of the box would
  push "stopped" for each bot.
- One notification per finished turn; when a turn produced several text blocks, only the last is
  in the body. The tail of the chat file runs 400 ms behind the state file, hence a one-second
  grace before the reply push is composed.
- `METOR_NTFY_URL` stays as an option for one more release and can then go.
- Native clients (Tauri) remain possible on top: same gateway endpoints; only native APNs/FCM
  push would need a relay – which is exactly why the phone starts as a PWA.

## Verified 2026-09-04 (local box, headless Chromium inside the box via `playwright-core`)

- Service worker registers and activates; the Devices card subscribes a real FCM endpoint, the
  gateway's test push is accepted by the push service (`sent: 1`), an unknown endpoint is dropped
  (410). A reply push fires after a bot turn (`push: reply for <bot>`).
- Headless Chromium does not *receive* FCM pushes (no push channel in headless); the worker's push
  handler was exercised with the DevTools command `ServiceWorker.deliverPushMessage` instead –
  notification shown with title, body, icon and the bot URL. The phone is the real test.
- The desktop app's embedded browser pane cannot register service workers at all ("unknown error
  occurred when fetching the script") – a sandbox limit, not a gateway problem.
