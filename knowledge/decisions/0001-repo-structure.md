# 0001 – Repo structure

**Date:** 2026-08-28 · **Status:** revised on 2026-08-30 (mono-repo)

## Context

metor is built as an agent platform on top of the official harnesses (Claude Code, Codex).
Several repositories in a dedicated GitHub organisation (named after the product's original name).

## Decision

- `core` – main repository (app, harness server, box definitions; splitting into further repos
  only once boundaries are stable).
- `knowledge` – knowledge base (research, ADRs, references).
- Further repos (e.g. `box`, `proto`) are extracted from `core` when needed.

## Consequences

Fast start without cross-repo overhead; later extraction via `git subtree split` possible.

## Revision 2026-08-30: mono-repo `goodcarl/metor-crew`

The multi-repo structure (core, knowledge, workspace) only produced overhead (pulling in all repos,
commits spread across repo boundaries). New: **one mono-repo `goodcarl/metor-crew`** with `backend/`
(formerly core), `frontend/` (Svelte, slice 5) and `knowledge/`. Fresh import without history –
deliberately, so that the public history starts clean (ADR-0006): internal notes and third-party
material stayed in the old, private repositories. The repositories of the old organisation are
archived (history archive); internal analyses live in a private companion repository (never part of
this codebase).
