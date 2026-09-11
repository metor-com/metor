# ADR-0031: Set up an existing server from the desktop app

Status: Implemented; first Hetzner deployment confirmed by the user. Date: 2026-09-11.

Users rent a fresh Linux VPS themselves. Hetzner is the first acceptance provider;
installation is provider-independent and does not access provider billing or APIs.

The native connection screen offers **Set up an existing server**. The main process
uses SSH2, restricted initially to ED25519 host keys and root password or private-key authentication.
It discovers the fingerprint without authenticating, asks the user to compare it with
the provider console, and pins that fingerprint before sending authentication. Rebuilding
a VPS therefore requires verification again; no global SSH known_hosts entry is changed.
Passwords and key passphrases are not logged or persisted. The native file picker
selects the private key; its path is held per window and cannot be supplied by the
renderer. File contents stay in the main process, with a 64 KiB bound. Encrypted keys
are unlocked locally; only the public key and SSH signature reach the server. Temporary
key buffers are cleared after authentication/inspection, including failures. The
short-lived SSH connection expires after ten minutes while reviewing the server.
No SSH keys are installed and no permanent server-management access is retained.
The existing device-pairing flow stores only the usual app session in its normal store.

Read-only inspection checks supported Ubuntu/Debian versions, x86-64/ARM64, root access,
CPU/RAM/free disk, Docker containers/volumes and conflicting listeners. Small servers
need 2 CPUs, about 4 GB RAM and 12 GiB free space; 16 GB RAM and a 40 GB disk remain
recommended. Space RAM is capped at 8 GiB initially, leaving at least 1 GiB or 20% for
the host. The user reviews allocation and explicitly starts installation.

The app sends its bundled installer over SSH, using the image matching the app version.
A host file lock serializes installs. A domain marker identifies incomplete app installs;
retries on the same domain retain volumes and the original allocation. Foreign installs
are rejected. The app does not remove failed installations or change SSH/firewall policy.
Server output stays in memory; only predefined progress stages and actionable preflight
errors reach the renderer. Setup links remain in the main process.

Caddy obtains HTTPS certificates. The gateway remains bound to loopback. Public HTTPS
must work, with normal certificate verification, before the app redeems the setup link.
Users manage DNS and provider firewall rules. If HTTPS is delayed, retry the same server
and domain; no bot data is deleted. Keep the app open during installation.

Tests cover a real local SSH transport (identity discovery, mismatch before password,
authentication and resource inspection) plus input injection and preflight rejection.
On 2026-09-11 the user confirmed successful deployment and use of metor on a Hetzner
CX23 (2 vCPUs, 4 GB RAM, 40 GB disk). Before installation, SSH root password login
had to be enabled on the existing server; resetting its root password alone had not
enabled SSH access. The host fingerprint was compared in the provider console.
The app installation and connection then worked, and the user tried metor successfully.
This confirms the first live deployment, not every provider failure path. Other
distributions/architectures and additional providers still need acceptance tests.
Non-root sudo, custom proxies and ongoing remote RAM management are follow-ups.

## Recovery and diagnostics (2026-09-11)

The installer persists non-secret phase names (docker/image/files/start/gateway/ready).
Domain ownership is published through an atomic directory rename on first installation.
Configuration files use write-then-rename; additional `.env` settings survive retries.
Ready installations issue a new setup link without pulling images or restarting bots.
A file lock serializes both setup and reconnect operations. An unready completed Space
reports an error instead of silently reinstalling or downgrading it.

The app checks all resolved A/AAAA addresses against the server's interface addresses
before installation. Directly addressed public VPSs are the supported path; NAT and
proxied DNS require manual setup. HTTPS polling keeps certificate verification enabled.
On failure, DNS, TCP 443/80 reachability, certificate and gateway-response checks provide
separate remediation. No raw container logs or credentials are sent to the UI.

Automated recovery tests kill the real Bash installer at four stages and rerun it against
a Docker test double and temporary filesystem. They verify retained data, additional
environment settings, allocation and replacement of partial files. Real local SSH tests
cover disconnect/reconnect, private-key signatures, encrypted keys, wrong passphrases,
key rejection and host mismatch before any authentication offer.

Follow-up verification on 2026-09-11: real Docker and Caddy on an isolated Ubuntu 24.04
ARM64 VM passed all four SIGKILL/retry boundaries, retaining bots, chat, files, device
authentication, runtime volumes and enforced RAM allocation. HTTPS used a local Caddy CA
with verification enabled. A real OpenSSH key login, diagnostics and release upgrade were
also verified (ADR-0032). These tests do not claim public ACME, provider firewall failure
recovery or additional provider acceptance; the Hetzner password deployment above remains
the provider acceptance evidence.
