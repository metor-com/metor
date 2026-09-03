# Contributing to metor

Thanks for helping. This file is short on purpose; the details live in the documents it links to.

## Running locally

Follow the [quickstart in the README](README.md#quickstart-local-development): clone the
repository, `metor box build`, `metor box up`, sign in once, open http://127.0.0.1:6010/bots/.
For the UI with hot reload: `cd frontend && npm install && npm run dev` (see
[frontend/README.md](frontend/README.md)). [CLAUDE.md](CLAUDE.md) is the working context for
coding-agent sessions in this repository and is just as useful for humans.

## Conventions

- Everything in the repository is written in English: code, comments, documentation, commit
  messages. No personal names, hostnames or addresses in tracked files.
- Terms follow [knowledge/GLOSSARY.md](knowledge/GLOSSARY.md): the UI says "bot" and "computer",
  the code says `agent` and `box`.
- Before committing changes to `backend/harness/bin/*.mjs`, run `node --check <file>`; for Bash
  scripts `bash -n <file>`. Image changes: rebuild (`metor box build`) and run
  `scripts/smoke.sh` against the running box (`--no-chat` skips the roundtrips that spend quota).
- Finished user-visible features and fixes: one or two lines under `Unreleased` in
  [CHANGELOG.md](CHANGELOG.md), written from the user's point of view.
- Ideas and open items go to [BACKLOG.md](BACKLOG.md).
- Decisions with architectural consequences get a new ADR in
  [knowledge/decisions/](knowledge/decisions/README.md); verified facts and pitfalls of the
  harnesses go to `knowledge/harness/`.
- No source maps in releases, no silent uploads, no secrets in the repository.
- `git pull` before you start; keep pull requests small and focused.

## Developer Certificate of Origin (DCO)

There is no contributor license agreement. Instead, every commit must carry a `Signed-off-by` line
with your name and e-mail address - `git commit -s` adds it. By signing off you certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): that you wrote the
contribution yourself or otherwise have the right to submit it under the project's open-source
license (Apache-2.0), that you did not copy it from somewhere that forbids this, and that you
understand the contribution and your sign-off are public and may be redistributed with the project
indefinitely. Pull requests with unsigned commits are not merged; `git commit --amend -s` and
`git rebase --signoff` add missing sign-offs.

## Security

Do not report vulnerabilities in public issues - see [SECURITY.md](SECURITY.md).
