# ADR-0028: Personal settings and Space administration

Status: accepted, 2026-09-11

## Decision

Keep app-wide device preferences separate from one combined Space management area. Open administration through Manage Space
in each Space menu, both in the overview and inside a Space; do not require a separate
website or add a permanent toolbar button. Display the selected Space name in the
administration area, including mobile. The menu contains Manage Space followed by Remove from my overview. Only removal
is device-local; the Space name is stored centrally in .metor/space.json, validated
on authenticated writes, and broadcast to connected devices through the space SSE
topic. Native clients cache this name for their overview and offline display. All interface labels are English.

A Space belongs to one person with multiple own devices. Keep authentication,
one-time pairing and device revocation. All authenticated devices can manage the
Space. Do not introduce memberships, invitations or Owner/Admin/Member roles.
Manage Space is visible immediately for signed-in connections, without an extra
permission request or polling. Switching to another Space still resolves its connection.

Remove the unreleased membership prototype. Preserve existing owner sessions and
own-device pairing claims, stripping membership fields. Drop invited devices and
invitation claims instead of upgrading their access. A corrupt auth file fails closed.

## Limits

This does not implement the management-plane split in ADR-0018. Bots/terminals still
share OS/file access with management. Legacy local aliases are fallback names until the server supplies its shared name.
Resource resizing/restart/update APIs are not introduced here; existing RAM readouts
and update information move into the administrative area. Authentication-off mode
retains its existing behavior for local experiments or externally protected deployments.

## Verification

Unit tests cover personal pairing, revocation, expiry and prototype migration.
Browser tests cover combined Space settings, name sync across two authenticated devices, absence of role requests, mobile layout
and selecting the correct Space from the overview with a simulated desktop bridge.
The image smoke suite checks the protected gateway and runtime lifecycle.
