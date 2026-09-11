# ADR-0029: Persistent local Space RAM allocation

Status: accepted, 2026-09-11

## Decision

Expose local RAM increases in Manage Space → Resources & updates in the desktop app
on the host. Keep host operations outside the gateway; require a paired local connection
and verify its port matches the runtime container. Report actual inspected allocation,
host capacity and an allocation ceiling. Reserve at least 2 GiB or 20% of host RAM,
whichever is larger, and subtract other running container allocations. This is an
allocation budget, not a guarantee against later host memory pressure.

Allow increases in 256 MiB steps, minimum 1 GiB. Allow Apple reductions down to 1 GiB through the same restart/rollback workflow.
Before confirmation, fetch current usage and warn if it exceeds the new limit or is unknown.
Docker still supports increases only. Revalidate capacity
and target immediately before applying and serialize app-local operations. Explicit
METOR_MEMORY takes precedence and disables the editor. Saved values live in the host
config directory under metor/resources/<runtime>/<container>.memory-mib. The wrapper
reads them on ordinary starts and updates; invalid files fail closed.

For Apple container, require confirmation of task interruption, inspect and preserve
process/environment, volumes, CPU count, ports and supported networking options. Refuse
unsupported configurations before stopping. Verify the image reference still resolves
to the running image digest and create a local recovery alias: the Apple CLI does not
resolve locally tagged images through a tag@digest reference. Recreate from that verified
image with the new RAM. Never remove volumes. Verify gateway readiness and the effective
allocation before atomically publishing the saved setting. On failure, attempt to recreate
the previous allocation; report recovery failure with persistent volumes retained.

For Docker on Linux with a configured limit, increase live through docker update and
verify the result. Keep the swap allowance unchanged. Refuse unbounded other containers
when computing the remaining allocation budget. No Docker Desktop VM or remote host
management is introduced here.

## Verification

Unit tests cover validation, port matching, image/config preservation, rollback and
saved-setting precedence including corrupt files. An opt-in isolated Apple integration
test increases and reduces real VM RAM and verifies allocation, persisted configuration, a file and
a paired session afterward. UI integration verifies restart confirmation/cancellation,
updated allocation, reduction warnings/cancellation, the 1 GiB minimum and mobile layout. Image smoke checks run
against the isolated Space. Linux Docker execution remains unverified on this Mac.
