# 0017 – Push relay: native push for the phone app through a forwarder that sees only ciphertext

**Date:** 2026-09-06 · **Status:** accepted (decided with the phone scaffold, [ADR-0015](0015-native-clients.md); not built yet – see *Verification*)

## Context

The interface reaches phones in two forms. The PWA gets Web Push without any service of ours
([ADR-0013](0013-pwa-web-push.md)): the browser vendors' push services accept a message from
whoever signs it with the key pair the subscription was made with (VAPID), so every gateway is a
valid sender and Apple, Google and Mozilla play the relay for free. The native app
(`client/mobile/`, Capacitor, scaffolded 2026-09-06) has no such privilege: APNs and FCM accept
only messages signed with the keys of the app's publisher, and those keys must not travel with a
self-hosted gateway. Every product in the same position runs a relay of its own – Home Assistant,
Nextcloud, Element (Sygnal), Mattermost, Mastodon, ntfy all do; there is no free third-party one,
because a relay is useless without the publisher's keys. Bark ships its APNs key in the open
instead; rejected here: Apple can revoke the key at any time and every installation goes silent
until the next image, and the developer agreement asks for the key to be kept secret.

Without push the native app is worse than the PWA. Polling is no substitute on iOS: background
refresh is throttled to minutes or hours at the system's discretion, a socket may stay open only
for VoIP, audio, navigation and Bluetooth, silent pushes and Live Activities are themselves APNs,
Local Push Connectivity works only on named Wi-Fi networks with a restricted entitlement, and
UnifiedPush has no iOS distributor. Android could hold a foreground service, but the app should
behave the same on both platforms.

What the gateway already does (`metor-push.mjs`): a VAPID key pair per installation,
subscriptions bound to device sessions ([ADR-0012](0012-device-pairing.md)), three events
(approval needed, reply finished, unexpected stop), payloads encrypted for the device (RFC 8291),
`TTL` 24 h, `Urgency` high for approvals, and subscriptions dropped when the push service answers
401/403/404/410. Devices that show the bot's chat are skipped. Nothing of this is browser-specific.

Product constraint: "everything on one host". metor runs no infrastructure where avoidable, and
nothing readable leaves the user's computer.

## Decision

1. **One relay, the only infrastructure metor runs.** A Web-Push-to-APNs/FCM forwarder at
   `push.metor.com`, modelled on Mastodon's `webpush-apn-relay`: it accepts the Web Push request
   the gateway sends today and hands the still-encrypted payload to Apple or Google. It never sees
   a readable notification.
2. **The gateway does not change.** The app registers a subscription through the existing
   `/push/subscribe` with an endpoint at the relay, `https://push.metor.com/v1/<platform>/<device
   token>`, and a P-256 key pair plus auth secret generated in the app, exactly as a browser does.
   `metor-push.mjs` treats the relay like any push service: RFC 8030 POST, body `aes128gcm`,
   headers `TTL`, `Urgency`, `Topic`, `Authorization: vapid …`. A gateway of 0.2.0 already works
   with it. The relay's address is a property of the app build, not of the gateway: the
   publisher's keys and the publisher's relay belong together, so an operator who wants a relay of
   their own builds the app with their own Apple and Firebase credentials and their own relay URL.
   No `METOR_PUSH_RELAY` on the gateway.
3. **The relay is small and stateless.** `backend/relay/` in this repository (`relay.mjs`, own
   `package.json`, `Dockerfile`), published as `ghcr.io/metor-com/metor-push` by its own workflow,
   deployable with the same compose pattern as the box. It:
   - verifies the VAPID signature (`t=` JWT against `k=`), so only a party holding a key pair can
     send – malformed or replayed junk is refused before it reaches Apple or Google;
   - limits per device token (500 messages a day, as Home Assistant does) and per source address,
     and caps the body at 4096 bytes (Web Push's own limit);
   - maps `TTL` to `apns-expiration` / FCM `ttl`, `Urgency` to `apns-priority` (high → 10, else
     5) / FCM priority, `Topic` to `apns-collapse-id` / FCM `collapse_key`;
   - answers with Web Push semantics: 201 created, 413 too large, 429 over the limit, and **410
     Gone** when APNs or FCM report the token as invalid – the gateway then drops the subscription
     with the code it already handles;
   - keeps no queue, no store and no content logs; only counters for the limits and a health
     endpoint.
4. **Platform specifics.** iOS: HTTP/2 to APNs with a JWT from the `.p8` key, `mutable-content: 1`,
   a placeholder alert (title "metor", body "New activity") and the ciphertext in the payload –
   the app's Notification Service Extension decrypts and replaces title and body before display,
   and if it ever fails the placeholder shows, so nothing readable was ever in transit. Android:
   an FCM data message with the ciphertext; the app's messaging service decrypts and builds the
   notification. Both decrypt with the Web Push scheme (ECDH P-256, HKDF, AES-128-GCM): CryptoKit
   on iOS, Tink's `WebPushHybridDecrypt` on Android.
5. **Keys and privacy.** The APNs key and the FCM service account exist only as environment of
   the running relay – never in this repository, never in an image. Rotation is a redeploy of the
   relay, no app update. What the relay sees: device tokens, the sending gateway's VAPID public key
   (a pseudonymous id of the installation), ciphertext sizes and timestamps. Accepted; stated in
   the app's privacy notes.
6. **What the app does with a push.** A tap opens the bot (`onOpenBot` exists in the bridge).
   Notification actions – *Approve* / *Deny* straight from the lock screen, calling the gateway's
   API with the bearer token – come after the first release; the payload's `kind` and `bot` fields
   already carry what they need.
7. **The PWA keeps Web Push without the relay.** Both channels coexist per device session; the
   gateway's viewer-skipping applies to both.

## Consequences

- metor operates one service, on the existing server behind Caddy. Costs: an Apple Developer
  Program membership (needed for TestFlight and the store anyway) and a Firebase project for FCM;
  APNs and FCM themselves are free.
- The store release of the phone app waits for the relay (ADR-0015, item 2): a store app without
  notifications would be the "wrapper" Apple rejects and would offer less than the PWA.
- If the relay is down, the phone app gets no push until it is back; in-app notifications while
  the app is open still work, the PWA is unaffected. Losses on a notification channel are
  accepted, as everywhere else; the relay is stateless by design.
- Version coupling is by the Web Push standard, not by metor versions: relay and app do not need
  to move with the gateway.
- Not covered: Android without Google services (a UnifiedPush distributor could be a second
  target of the same relay later), badge counts, monitoring of the relay itself.
- Effort estimate: relay one day; app side two to three days, most of it the decryption in the iOS
  extension.

## Verification (before the status says implemented)

- Relay: a script posts one of the gateway's real Web Push requests to a test device token,
  first against the APNs sandbox, then FCM; the device shows the decrypted title and body; an
  invalid token yields 410 and the gateway drops the subscription.
- Rate limit and VAPID refusal covered by the relay's own tests (`node --test`).
- End to end from a local computer: approval needed, reply finished, unexpected stop – one push
  each on an iPhone and an Android phone with the app in the background.
