# Security policy

## Supported versions

Only the latest release (and `main`) receives security fixes. Update a server with
`docker compose pull && docker compose up -d` (see [INSTALL.md](INSTALL.md)).

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories on the repository:
`metor-com/metor` -> **Security** -> **Report a vulnerability**
(https://github.com/metor-com/metor/security/advisories/new). Do not open a public issue and do not
post details in discussions or pull requests before a fix is released. You will get an
acknowledgement, and once the report is confirmed, a fix and - if you want one - a mention in the
advisory.

## Scope

- The gateway inside the box (port 6010) has **no authentication of its own - by design**. Whoever
  reaches the port can read every chat, drive every bot and open every bot's terminal. Deployments
  must bind the port to localhost and sit behind a reverse proxy with a login; the bundled compose
  and Caddy files do this correctly - see "Security first" in [INSTALL.md](INSTALL.md). An exposed
  gateway is a deployment mistake, not a vulnerability in metor.
- Inside the box, bots may do anything - the box is the sandbox
  ([ADR-0004](knowledge/decisions/0004-bot-policy.md)). In scope are escapes from the box, bypasses
  of the approval boundary, leaks of login data from the runtime volumes, and holes in the cookie
  scheme that protects the screen and terminal WebSockets behind the proxy login.
- Claude Code, Codex and the other bundled components are third-party software; please report
  issues in them to their maintainers (see [THIRD-PARTY.md](THIRD-PARTY.md)).
