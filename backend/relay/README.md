# metor push relay

The forwarder that gives the phone app native push ([ADR-0017](../../knowledge/decisions/0017-push-relay.md)).
The gateway sends Web Push – body encrypted for the device (RFC 8291), request signed with the
installation's VAPID key (RFC 8292) – to whatever endpoint a subscription names. Browsers name
their vendor's push service; the app names this relay, because APNs and FCM accept only messages
signed with the app publisher's keys. The relay verifies the VAPID signature, applies limits, wraps
the still-encrypted body for Apple or Google and forwards it. It never sees a readable
notification, keeps no queue and no store, and logs no content.

One file, no dependencies, Node 22 or newer: [relay.mjs](relay.mjs). Tests with stand-ins for APNs
and FCM: `npm test` (`node --test test/`); `npm run e2e` sends a message with the gateway's own
`web-push` library through the relay and decrypts it on the device side
([scripts/webpush-e2e.mjs](scripts/webpush-e2e.mjs)).

## Routes

| Route | For |
|---|---|
| `POST /v1/apns/<device token>` | iPhone and iPad, App Store and TestFlight builds |
| `POST /v1/apns-sandbox/<device token>` | development builds (Xcode, simulator) |
| `POST /v1/fcm/<registration token>` | Android |
| `GET /health` | `{ok, apns, fcm}` – which platforms are configured |

The request is exactly what the gateway sends to any push service: `Content-Encoding: aes128gcm`,
`TTL`, `Urgency`, optional `Topic`, `Authorization: vapid t=…, k=…` (the older `WebPush` +
`Crypto-Key` form is accepted too), at most 4096 bytes. Answers use Web Push semantics: 201 sent,
401 signature missing or invalid, 413 too large, 415 wrong encoding, 429 over a limit (with
`Retry-After`), **410 the device token is gone** – the gateway drops the subscription on 410, as it
does for any push service. 500 means the relay's own credentials are wrong, 502 that Apple or
Google failed.

What reaches the device: iOS gets an alert with a placeholder (`metor` / `New activity`),
`mutable-content: 1` and the ciphertext under `metor.body` (base64) – the app's notification
service extension decrypts and replaces title and body; if that ever fails the placeholder shows.
Android gets a data message with `data.body` (base64 ciphertext), `data.enc` (`aes128gcm`) and
`data.v`; the app's messaging service decrypts and shows the notification. `Urgency: high` becomes
APNs priority 10 / FCM priority high, `TTL` becomes `apns-expiration` / `ttl`, `Topic` becomes
`apns-collapse-id` / `collapse_key`.

## Limits

Per device 500 messages a day (UTC, `RELAY_DAILY_LIMIT`) and 60 a minute (`RELAY_BURST_LIMIT`), per
source address 600 a minute (`RELAY_IP_LIMIT`). Counters live in memory; a restart resets them.
Only requests with a valid VAPID signature count.

## Running it

```sh
cd backend/relay && npm test
APNS_KEY_FILE=AuthKey.p8 APNS_KEY_ID=… APNS_TEAM_ID=… FCM_SERVICE_ACCOUNT_FILE=fcm.json RELAY_ORIGIN=https://push.example.com node relay.mjs
```

| Variable | Meaning |
|---|---|
| `RELAY_ORIGIN` | the address the app uses – the VAPID audience every request must name (empty: not checked) |
| `APNS_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID` | the APNs auth key (`.p8`) from the Apple developer portal with its key id and the team id |
| `APNS_TOPIC` | the app's bundle id, default `com.metor.mobile` |
| `FCM_SERVICE_ACCOUNT_FILE` | a Firebase service account key (JSON) with the Cloud Messaging permission |
| `PORT`, `HOST` | default 6020 on all interfaces (the container publishes loopback only) |
| `APNS_URL`, `APNS_SANDBOX_URL`, `FCM_URL` | upstream overrides for tests |

A platform without credentials answers 503 on its route; the other keeps working.

In production: the image `ghcr.io/metor-com/metor-push` (built by the `relay-image` workflow) with
[deploy/relay.compose.yml](../../deploy/relay.compose.yml) – secrets as files in a root-only
directory mounted read-only, the relay on the loopback interface, a TLS proxy in front:

```
push.example.com {
    reverse_proxy 127.0.0.1:6020
}
```

## Running your own

The relay must hold the keys of whoever published the app, so the relay's address is a property of
the app build, not of the gateway. To run your own, build the phone app (`client/mobile/`) with
your own Apple and Firebase credentials and your own relay address; every gateway then reaches it
without any change, because a gateway only ever posts to the endpoint the device gave it.
