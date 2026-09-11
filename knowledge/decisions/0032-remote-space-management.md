# ADR-0032: Manage an existing server through temporary SSH access

Status: implemented, 2026-09-11.

## Decision

The desktop app exposes **Manage server…** under **Manage Space → Resources & updates**
for connected HTTPS Spaces. The user supplies root authentication for this operation,
using the existing fingerprint verification and password/private-key flow. No new
permanent root access, Docker socket exposure or gateway privilege is introduced.
The SSH session is tied to the selected Space and expires after ten idle minutes;
closing the view closes idle access. Finishing an update closes access as well.
Credentials are cleared on success and failure, including rejected management targets.

Only `/opt/metor` installations carrying the desktop domain marker and a matching
Compose working-directory label are supported. The main process derives the permitted
domain from the selected, paired Space. Choosing a different Space invalidates operations
on the old session. Existing browser/mobile clients continue to show version and RAM
information without receiving SSH credentials or gaining host administration APIs.

Diagnostics expose running/health state, Docker's OOM flag, restart count, RAM allocation,
free disk and release/image. Raw Docker health logs, environment variables, bot content
and credentials are not returned to the renderer. Refresh is explicit.

## Updates

An update installs the numbered official image matching the desktop app version, only
when it is newer than the running numbered official release. A separate confirmation
explains that active bot work is interrupted and recommends a server backup. The app
serializes updates with setup through the existing file lock and rechecks the current
image and saved image before changing files.

The image is downloaded before changing `.env`. Its matching Compose definition is extracted
and validated; custom Compose files are rejected by comparison with the running release’s
original file. This ensures newly introduced volumes are mounted. Other settings survive
atomic file replacement; `.env.before-update` and `compose.yml.before-update` retain the
old configuration during the operation.
Only the box service is recreated (`--no-deps`); Caddy and all named volumes remain.
SSH scripts are parsed as a complete function and run with closed stdin so child processes
(such as Compose exec) cannot consume the remaining script. The gateway must report the requested version before the backup file is removed.
On a start/readiness failure, the previous configuration is restored and its box restarted.
This restores the image/configuration, not a snapshot of data migrations. Backups remain
necessary. An interrupted update with a retained backup requires manual review instead
of silently replacing the backup or attempting another update.

## Validation and limits

Tests cover version guards, changed/pending installations, environment preservation,
download/start/readiness failures and restoration. Real socket tests cover DNS/TCP
failure, certificate rejection, explicitly trusted TLS and wrong gateway responses.
The Docker recovery integration test passed with the real released image and Caddy in an
isolated Ubuntu 24.04 ARM64 VM. A real OpenSSH/private-key test also passed installation,
diagnostics and upgrade from 0.3.0 to 0.4.0, retaining files, runtime volumes, device access
and RAM. The new Copilot volume was added and Caddy was not restarted. This exposed and
fixed two issues: missing Compose updates and child processes consuming SSH script input. Its domain uses a local test CA; public ACME issuance and provider
firewall changes remain separate provider acceptance checks.

Remote RAM changes, automatic background updates, backup creation, full rollback across
data migrations and hosts installed outside the desktop workflow are follow-ups.
