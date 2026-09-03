# 0012 – Sign-in by device pairing instead of passwords

**Date:** 2026-09-03 · **Status:** accepted (implemented)

## Context

Until now the interface had no sign-in of its own: the installer asked for a user name and a
password and put Caddy's `basic_auth` in front of the gateway (ADR-0005). That has three costs. The
installer needs a person at the keyboard (a password has to be invented and typed twice). Browsers do
not send Basic Auth on WebSocket handshakes, so the Caddyfile needed an exception for screen and
terminal plus a watch cookie in the gateway – a construction every operator with their own proxy had
to reproduce. And there was no way to see which devices have access or to throw one out.

The interface is used from the desktop and from the phone. Every user has a phone with a camera,
and the pattern people know from messengers is: the first device gets in with a link, every further
device by scanning a code shown on a device that is already in.

## Decision

1. **The gateway signs devices in itself.** Every browser that redeems a one-time claim receives a
   session: a random 256-bit secret in an `HttpOnly`, `SameSite=Lax` (and, behind HTTPS, `Secure`)
   cookie scoped to `/bots`, valid for a year until revoked. Every request – JSON API, static files,
   SSE and the WebSocket upgrades for screen and terminal – requires it; without it the API answers
   401 and pages get a plain sign-in page.
2. **Claims are one-time tokens.** The *setup link* (`metor auth link`, also printed by the
   supervisor on the first boot without any session) is valid for 24 hours; the *pairing* claim
   created on a signed-in device ("Devices → Link a device") is valid for two minutes and comes in
   three forms of the same secret: QR code, link, and an 8-character code (alphabet without 0/O/1/I)
   for typing on the sign-in page. Redeeming deletes the claim.
3. **Only hashes at rest.** `/workspace/.metor/auth.json` holds SHA-256 hashes of session secrets and
   claim tokens, compared in constant time. A bot that reads the file (inside the box everything is
   readable, ADR-0004) gains nothing usable. Failed redemptions are throttled per address (10 per
   10 minutes).
4. **Devices are visible and revocable** in the interface (name derived from the browser, last seen,
   remove) and on the CLI (`metor auth sessions`, `metor auth revoke <id>`). Losing every device is
   not a lock-out: `metor auth link` over SSH mints a new setup link.
5. **Caddy only terminates TLS.** The bundled Caddyfile shrinks to a `reverse_proxy` with
   `flush_interval -1`; no `basic_auth`, no WebSocket exception. Operators who want a second login
   layer in front may keep one (then the WebSocket exception is theirs again). `METOR_AUTH=off`
   disables the gateway sign-in for exactly that case or for local experiments.
6. **The installer asks nothing about users.** It prints the setup link (and a QR code) at the end;
   with `METOR_DOMAIN` set in the environment it runs without a single question.

## Consequences

- The watch cookie for WebSockets is now redundant (the session cookie travels with the handshake)
  and can be removed in a later clean-up; it does no harm.
- Tier C (several users, ADR-0005) gets its foundation: a session belongs to a user record later,
  the pairing flow stays the same.
- Passkeys (WebAuthn) remain a possible upgrade on top of this: the phone as authenticator,
  phishing-resistant – not a replacement for the pairing model.
- Local development needs one claim per fresh workspace volume (`metor auth link` after
  `metor box up`); sessions live in the `metor-workspace` volume and survive image updates.
