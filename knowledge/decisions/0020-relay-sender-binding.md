# 0020 – Push relay: the sender's key is bound to the device endpoint

**Date:** 2026-09-06 · **Status:** proposed (build before the first TestFlight round with outside
testers; until then only the maintainer's devices are registered)

## Context

The relay of [ADR-0017](0017-push-relay.md) accepts a message for `/v1/<platform>/<device>` when
the request carries a valid VAPID signature: a JWT signed with the key the request itself names.
That proves the sender owns *a* key, not that this key is the one the device subscribed with. The
review of 2026-09-06 (S08): whoever learns a device endpoint can sign with a key pair of their own
and push ciphertext the app cannot decrypt – useless notifications, the device's rate limit used
up, the relay used as a free forwarder. The device token in the endpoint is thereby a bearer
secret, and it passes through the box's `push.json`, its logs and the app's store.

The Web Push standard has the same shape and its answer: a push service may restrict a
subscription to the application server key it was created with (RFC 8292, section 4); a message
signed with another key is refused.

## Decision

Bind the endpoint to the computer's key without state in the relay:

1. The phone app builds the endpoint it hands to a computer as
   `${RELAY}/v1/<platform>/<device>?c=<computer>&k=<key-id>`, where `<key-id>` is the first 16
   bytes of SHA-256 over the computer's VAPID public key (base64url, the key the app already
   fetches from `GET /bots/api/push/key` before it subscribes).
2. The relay computes the same id from the key that signed the request and refuses the message
   with 401 when `k` is present and differs. The verification (`verifyVapid`) already returns the
   key; the request path uses it.
3. Grace: an endpoint without `k` keeps working until the app is in the stores; then `k` is
   required. The switch is one line in the relay.
4. Nothing else changes: `?c=` stays the app's routing id, the relay stays one file without a
   database, ciphertext stays ciphertext, a device that forgets a computer unsubscribes as today.

## Consequences

- A leaked endpoint is useless without the computer's private VAPID key; the endpoint stops being
  a secret worth protecting.
- The relay's test suite gets the negative case: a second key signing for a known endpoint → 401;
  the same key → 201.
- Rotating a computer's push key (deleting `push.json`) already forces devices to subscribe again;
  the endpoint changes with it, which is right.
- The app must ship the new endpoint before the relay enforces `k`; two small changes in
  `client/mobile/src/bridge.js` and `backend/relay/relay.mjs`.
