# SunoShimmerFree agent instructions

Mandatory entrypoint for agents in **GSGrimoire/GS-SunoShimmerFree**. These instructions do not schedule or authorize autonomous activity.

## First read and authority
1. [HANDOFF.md](HANDOFF.md), [Studio product plan](docs/STUDIO_PRODUCT_PLAN.md), [SSF agent gate](docs/SSF_AGENT_GATE.md).
2. [Live milestone A scope, claims and blockers: issue #18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18), plus the relevant issue and current pull request reviews.
3. Re-fetch actual branch ancestry, base and head before acting. Live state and automation configuration belong in issue #18, not in repository rulebooks. Owner's current scope in #18 supersedes stale historical handoffs.

## Product and current scope
Long-term goal: a full, local-first, automated, reversible multitrack music studio. **Milestone A is narrower: manual excerpt-only Multi-Stem Preview.** Safely import a supported local stem ZIP, select stems and a bounded passage, preview synchronized reconstruction, adjust per-stem gain/mute/solo, apply reversible time-local attenuation with continuous fades, and export only that passage as **32-bit floating-point WAV** matching the preview. Show alignment assumptions and browser/input limitations; fail closed on unsafe archives. Report above-full-scale samples rather than silently clamping the float mix. Basic excerpt-only diagnostics are optional. Per-stem Polish, selective cleaning, artificial intelligence, full-song export, mastering, project persistence and standalone kernels are not A dependencies. Preserve existing single-track production.

## Coordination and review
- Stay in this repository. Claim one bounded task and one branch; inspect current claims before editing. Re-fetch head before commit. One writer per branch; no force push.
- Coder: **[ChatGPT-1 | SSF Coder]**. Independent source reviewer: **[ChatGPT-2 | SSF Independent Reviewer]**, in a different session. A shared GitHub identity does not constitute separate-account approval.
- No new coder pull request while **two or more** coder pull requests await review. Freeze new standalone `studio-*` kernels until A ships. Prefer repairing the existing integration line.
- Independent Full review is required for ZIP/media parsing, decoding, alignment, memory, concurrency, audio editing/export, security and deployment. Reviewer findings target an immutable commit; one bounded correction attempt per defect, then independent re-review. Do not self-approve.
- Existing #11 ancestry includes #3 → #6 → #8 even when Polish is disabled in the A interface. Verify inherited code or carefully restack and test. #42 is the current passage-editor correction line; confirm parity before closing superseded #17. #40 diagnostics are not an A blocker. #47 needs current-parent reconciliation with #46 and a fresh integration review. Defer #48 full-song export.
- No secrets, mandatory audio uploads, unauthorized training data, telemetry or unreviewed third-party code/assets. Check licensing. Public Viking fixtures are source-only, accessed minimally.

## Browser and release gates
A **named browser-capable reviewer/session**, or **owner Gus as fallback**, executes real-browser memory, cancellation, network and level-matched listening checks and records evidence. GitHub-only agents cannot claim those gates passed. Require final-head tests, hostile ZIP rejection, excerpt preview/float-WAV parity, click alignment, bounded-memory evidence, and Viking 462–474-second listening before acceptance. No deadline authorizes bypass, merge or deployment.

## Handoff
Record role, exact repository/branch/base/head, claim, changed files, executed tests with outcomes, unresolved risks, and next reviewer/operator action in the relevant pull request and issue #18. No source-only review constitutes a release.
