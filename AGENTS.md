# SunoShimmerFree agent instructions

This file is the mandatory entrypoint for ChatGPT, Claude, and other coding/review agents working on **GSGrimoire/GS-SunoShimmerFree**. It describes project rules; it does **not** create or schedule an agent.

## First read
1. [HANDOFF.md](HANDOFF.md) for latest exact checkpoint.
2. [Studio product plan](docs/STUDIO_PRODUCT_PLAN.md), [SSF coder/reviewer gate](docs/SSF_AGENT_GATE.md), and [initiative #18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18).
3. The relevant issue, the **current** pull request graph and exact head SHA before operating on source.

## Purpose and product
Build a **complete automated local-first multitrack studio** that analyzes user music first, suggests conservative reversible improvements and supports detailed manual editing, mastering and export. User-facing sound quality and content preservation matter as much as spectral metrics. No automatic destruction of musical content; an invalid or unsupported result must fail clearly.

## Mandatory coordination
- Stay in this repository. Claim one bounded task on one branch and verify no overlapping author is active.
- Use **ChatGPT-1 | SSF Coder** for implementation; **ChatGPT-2 | SSF Independent Reviewer** for a fresh, separate review session. Maintain their distinct responsibilities. Different session labels do not establish different GitHub identities.
- The author cannot independently approve their own changes. Reviews require pinned exact head/base, consolidated findings, explicit verdict and independent affected-path reading.
- Classify risk as Mini or Full using the SSF gate. A Full review is mandatory for untrusted media/ZIP, alignment, memory behavior, concurrency, export correctness, auto-deletion/muting of musical content, persistence, deployment and uncertain security boundaries.
- Implementer gets one bounded correction attempt on any reported issue before escalation; never loop indefinitely.
- Respect current stacked PR bases, reviews and branch protections. Do not force-push, merge or deploy simply to meet Monday morning, 23 November 2026.
- Record all artifacts and decisions in GitHub issues, pull requests and durable documentation, not only a chat. Tests/measurements are evidence, not proof of perceptual audio quality.
- No secrets, private file copies, credential material or user audio uploads to a remote service. Existing public Viking fixtures are already available; minimize duplication.

## Immediate work
Get an independent exact-commit source review of [draft PR #17](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/17), built on [draft #11](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/11). Then proceed through the plan's bounded prioritized milestones. The 20-minute agent scheduling desired by the owner is **not operational** merely because these files exist. Verify scheduling status before claiming autonomous work is active.

## Handoff minimum
Session role; exact repo/branch/base/head; task and design intent; commands and outcomes; changed files and tests; risks and unresolved gates; next eligible role/action; actual release or deployment evidence if any.
