# 0006 – Legal guardrails: subscriptions and third-party material

**Date:** 2026-08-30 · **Status:** accepted · **Note:** risk map based on our own reading of the
terms (as of 2026-08-30), not legal advice. Have it reviewed by a lawyer before tier C.

## Context

metor orchestrates harness processes (Claude Code, later Codex/Gemini CLI) under the respective user's
subscription. Tier C (customers on the platform, ADR-0005) raises the question of which operating
models the vendors' terms allow. Plus risks from third-party material.

## Decision: the traffic light per operating model

Applies mutatis mutandis to all three vendors (Anthropic, OpenAI, Google):

| Model | Assessment |
|---|---|
| **Own subscription, own machine, official harness** (today) | ✅ Allowed. Claude Code / Codex CLI / Gemini CLI are the explicitly permitted automated surfaces of the subscriptions; background sessions and limits included. ADR-0004 (only the real harness, never token extraction) keeps us on this side. |
| **Customers on OUR subscription** | ⛔ Doubly forbidden everywhere: account sharing ("make your Account available to anyone else" – Anthropic; "make your account accessible to another person" – OpenAI, translated from the German EU terms) plus resale ban. Never. |
| **Every customer logs THEIR subscription into their box** (BYO subscription) | ⚠️ Grey area with all three. Not classic resale (the customer has their own contract), but: Anthropic's Consumer Terms broadly forbid "products that compete with our Services" (proximity to Claude Cowork!); vendors can claim circumvention. Only start with the vendor's explicit approval ("except as expressly approved"). |
| **Customers via API key** (usage-based) | ✅ The intended path. Anthropic Commercial Terms A.1: use permitted "to power products and services Customer makes available to its own customers"; OpenAI Business Terms and Gemini API/Vertex analogous. `bot.json` already provides the `harness` field for this. |

## Vendor specifics

- **Anthropic (Consumer Terms):** automated access only "where we otherwise explicitly
  permit it" → Claude Code is exactly that. Broad competing-products ban (not just models).
- **OpenAI (EU Consumer Terms, 2026-01-16):** the competing ban only covers competing
  **models** ("output to develop models … that compete with OpenAI", translated) – narrower than
  Anthropic. A separate business-use addendum explicitly governs commercial use of the
  consumer services (liability cap: 12 months' fees or $100). Codex CLI with ChatGPT login is an
  official feature. Forbidden: renting/selling/distributing the services, automated extraction,
  circumventing limits.
- **Google (Gemini CLI):** which terms apply depends on the login (`docs/resources/tos-privacy.md`
  in the CLI repo): personal account → Gemini Code Assist for Individuals + Google ToS
  (**caution: prompts may be used for training** – unsuitable for bots with customer data);
  AI Pro/Ultra subscription → Google One Terms; API key → Gemini API Terms (paid tier without
  training); Vertex/Workspace → Cloud Terms. Commercial path here too: API/Vertex.

## Further guardrails

1. **Third-party material:** internal analyses of other products and any third-party material
   live in a private repository and are **never part of this codebase** (verified private on
   2026-08-30). Clean-room principle: behaviour may be studied and described in our own words;
   code, structures and constants are never reproduced (contamination risk). Before anything is
   made public, check that nothing has slipped in.
2. **Other companies' product names** appear only nominatively (compatibility, origin).
3. **FOSS components of the box** (noVNC MPL, websockify LGPL, x11vnc GPL, Chromium BSD):
   used unmodified from Debian packages – uncritical; check licence obligations when modifying.
   Adopting code from MIT projects (e.g. openbot) only with a licence notice.

## Consequences

- Tier C is planned on the API route; BYO subscription only after asking the vendor.
- Before making any repository public: check against point 1.
- Before tier C: have the original terms reviewed by a lawyer – this ADR is the map, not the legal
  opinion.
