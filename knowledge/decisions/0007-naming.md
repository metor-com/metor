# 0007 – Naming: product, memory system, organisation

**Date:** 2026-08-30 · **Status:** accepted on 2026-08-30: product **metor crew**
(mono-repo `goodcarl/metor-crew`); org question (metor-hq) deferred
· addendum 2026-09-02: product name shortened to **metor**, organisation `metor-com`

## Context

"metor Bot" has a problem: it names the product after its smallest unit – "create a bot in metor
Bot" is linguistically broken. In parallel, the planned
memory system and the GitHub organisation (so far named after the old product name) need names. Criteria
from the discussion: English, functional ("it must be clear what it does"), name the level above the bots,
no collisions (Docker, Cowork).

## Options and assessment

| Candidate | Assessment |
|---|---|
| **metor** (product, plain) | The platform is called metor, the units stay bots. Costs nothing (CLI, domain metor.com, containers are already named that way), hierarchy immediately clear. Baseline recommendation. |
| **metor crew** | Favourite for the product wording: names the collective (crew) above the units (bots), tells the delegation story, works in DE/EN. Conceptually close to Claude Cowork, but no word conflict. |
| **metor fleet** | Runner-up: reflects the unique selling point (every bot its own "ship" = computer), scales in the mind. Cooler than crew; "fleet management" is taken in DevOps. |
| metor works / desk / hands / workforce | Checked, weaker: works vague, desk = helpdesk proximity, hands clunky, workforce = generic term (good as tagline, bad as name). |
| metor team / teams | Etymologically nice (team = draught animals → fits the harness metaphor), but: "teams" collides head-on with Microsoft Teams; the singular is generic (every product has team plans), Claude Code already occupies "Agent Teams/Teammates", and slice-4 groups want the word as feature name. → Reserve "Team" for slice 4, not for the product. |
| metor agents | Rejected: names the unit again (the "metor Bot" problem), collides with the glossary (code term `agent`) and is the most generic industry term of all. |
| metor buddies | Rejected: "buddy" = companion, not worker – tells companionship instead of delegation; proximity to the companion-app category; belittles the bots (a ceiling for tier C). |
| metor mas ("multi-agent system") | Rejected: the acronym needs a footnote (the opposite of self-explanatory), names architecture instead of benefit, factually off (a real MAS = cooperating agents, metor = delegation, until slice 4), phonetically washed out, Spanish/Portuguese más/mas = "more/but". |
| metor dock / bridge | **Not** as product name (Docker resp. network-bridge collision, names storage instead of work) – but good candidates for the **overview/watch page** of the gateway (`/bots/`). |
| ~~metor bot~~ | Rejected: unit confusion. |

**Memory system:** named separately (not part of this repository); "brain" was rejected as
over-promising unless the system actively links and surfaces knowledge.

**GitHub organisation: `metor-hq`.** `metor` is taken on GitHub (checked 2026-08-30);
`metor-hq`, `metorhq`, `getmetor`, `metor-dev` were free. "hq" = functional (headquarters),
paths read cleanly (`metor-hq/core`).

## Consequences (if adopted)

- Extend the glossary (product "metor" resp. "metor crew", possibly "Dock" for the overview
  page); update mentions in READMEs/CLAUDE.md.
- Org rename: the old organisation name (after the old product name) then becomes registrable by third
  parties; update `bootstrap.sh`, the workspace table and `git remote set-url` in all repos.
- Renaming the local folder resets path-bound Claude Code data (sessions, project memory) – only at
  a quiet moment.

## Addendum 2026-09-02: organisation and repository names

- The GitHub organisation is **`metor-com`** (matches the domain; the umbrella brand "metor" with the
  product line "metor crew" as decided above – superseded the same day by the last point below).
- This repository moves there as **`metor-com/metor`** via a history-free re-import (the previous
  private repository is archived); the box image becomes **`ghcr.io/metor-com/metor-box`**.
- Naming scheme inside the organisation (proposed): the product itself is the repository `metor`;
  for the other lines the first segment of a repository name is the product line – `memory`,
  `memory-eval`, `memory-bench-<corpus>` – while brand-wide repositories (`site`) carry no prefix.
  Internal analyses live in a private companion repository (ADR-0006).
- Product name shortened to **metor** (2026-09-02): the brand is the word itself, a suffix only adds
  a second name that needs explaining. Repository `metor-com/metor`, image
  `ghcr.io/metor-com/metor-box`.
