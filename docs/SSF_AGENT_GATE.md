# SSF engineering agent gate: coder, independent reviewer, and release control

**Date:** 20 November 2026. **Scope:** only `GSGrimoire/GS-SunoShimmerFree`.  
**Live scheduling status:** verify active automations and observed runs from current coordination in [issue #18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18); do not infer activity from this rulebook.  
**Canonical product plan:** [STUDIO_PRODUCT_PLAN.md](STUDIO_PRODUCT_PLAN.md). **Initiative:** [#18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18).  

## Operating choice: separate coder and reviewer roles

Prefer **two separate ChatGPT sessions**, not a single session which says it switched hats. The work dispatcher can be shared, but the implementation and independent review must use separately instantiated contexts and separate immutable review packets. Review and correction must not happen concurrently on the same head. The two roles may authenticate to GitHub through the same account, so an independent source-code verdict is **not** formal GitHub review approval from a distinct identity. Never claim otherwise.

- **ChatGPT-1 | SSF Coder:** claims exactly one issue and one branch; implements bounded changes, maintains code/tests/handoff, labels frozen head ready for review. Cannot approve its own work.
- **ChatGPT-2 | SSF Reviewer:** loads the pinned head and base independently; gives a consolidated adversarial verdict; does not edit the code being reviewed. If it writes a fix, that code needs a different independent reviewer.
- **Release coordinator (state machine, not another approving persona):** checks approvals and runtime evidence; merges only when authorized and all dependencies have cleared; does not treat calendar time, passing tests or review from the code author as sufficient.


## Scheduling, capacity and claims

Schedulers trigger sessions but do not prove coding, reviews, or release. Check actual automation state outside this repository; record any live configuration and claims in issue #18, never hard-code automation IDs or current head SHAs here. Do not silently reuse portfolio automations or claim unsupported cadence. Owner decision (25 November 2026): **no numerical cap on outstanding implementation pull requests**. This does not authorize concurrent writers on a branch or overlapping tasks. Each coder session claims one bounded task and branch; inspect open diffs, current claims, dependencies and ancestry before starting. Prefer existing integration branches and canonical contracts. The historical standalone `studio-*` freeze applied until A shipped (beta shipped 23 November). Use one writer per branch, scoped claim and lease, and re-fetch branch head immediately before committing. Stop on collision. Independent review before integration remains mandatory for all implementation changes.

## State machine and handoff contract

| State | Writer / reader | Transition rule |
| --- | --- | --- |
| `BACKLOG` | Coordinator / coder | An issue has scoped acceptance and dependencies |
| `CLAIMED` | Coder only | Single ownership of issue/branch with a recent lease |
| `IMPLEMENTING` | Coder only | Small change, tests, self-review in progress |
| `REVIEW_READY` | Coder yields | Test evidence, frozen exact head SHA, full diff and risk category attached |
| `IN_REVIEW` | Reviewer only | Reviewer first re-fetches immutable head and verifies base/branch not stale |
| `CHANGES_REQUIRED` | Reviewer verdict | Coder may make **one bounded fix attempt per defect**, then return new SHA |
| `SOURCE_APPROVED` | Reviewer verdict | Approval is for **one immutable commit** with stated scope and limitations |
| `BROWSER_AUDIO_GATE` | Release operator + owner listening | Real browser, audio quality, memory, alignment and exports pass on integrated branch |
| `MERGE_ELIGIBLE` | Coordinator | All predecessor PRs integrated safely; branch protections, approvals and explicit holds checked |
| `RELEASED` | Deployment operator | Actual published URL/version and smoke test independently verified |
| `BLOCKED` | Any role | Missing evidence/credentials, unresolved significant issue, conflicting edits, listener rejection or deadline without acceptance |

**Coordination mechanics:**
- Use existing GitHub issues/PRs for durable claims; identify actor, role, timestamp, lease expiry, issue, branch and pinned SHA in a **single handoff comment**. Check for a recent active claim before write; re-read immediately before commit. GitHub comments and labels are not atomic distributed locks, so uncertain collisions mean **stop**, not overwrite.
- Prefer separate branches per bounded feature. No force push, blind branch reset, concurrent edits, or stale-head PR approval.
- A review targets the **specific head SHA** and actual PR base, not only the branch name. Any author edit invalidates prior approval for affected behavior. Re-review changed code and adjacent consumers as needed.
- Post no-op only when no safe eligible work; otherwise choose the highest priority from #18 and existing open PR dependencies, not speculative new unrelated effects.
- Each iteration ends with: actor/session label, what changed or inspected, exact commit, tests run with outcomes, outstanding risks, next specific role and next action.

## Review depth

Adopt the risk-sensitive GS Tools review framework but honor stricter SSF-specific gates.

**Mini review:** isolated text, styling or deterministic calculations without safety boundary or audio integrity impact; documented self-review and appropriate tests are preparatory evidence; independent review before integration is still required.

**Full review:** any ZIP/media parser security, source-file integrity, decoding, streaming memory, audio alignment, export correctness, asynchronous concurrency, automation that can remove music, local project persistence, credentials, public deployment or material uncertainty. **Independent reviewer required.**

A full review packet must include the complete affected path, exact base/head, threat/failure model, security and signal invariants, malformed or adversarial tests, actual test commands/results, known limitations and real-browser/listening status.

Reviewer reports one of:
- **`Approved without changes`**, exact SHA, complete scope, test evidence, limitations and remaining non-source release gates.
- **`Changes required`**, exact SHA, severity, concrete failure scenario, minimal reproduction, required correction and related cases to inspect.

One correction attempt for a reported defect before escalation; do not enter infinite corrective loops or turn unresolved failures into an implicit pass.

## Current milestone A and release gates

The long-term studio goal does not change the narrow current acceptance contract. Milestone A is **manual excerpt-only Multi-Stem Preview**: safe local ZIP import, stem selection and honest sync/browser limits; bounded synchronized passage playback; per-stem gain, mute/solo and reversible time-local attenuation with continuous fades; and selected-passage **32-bit floating-point WAV** export matching preview, with unclamped float mixing and peak-overload reporting. Excerpt-only diagnostics are optional. Per-stem Polish, selective cleaning, automatic repair, long-form export, mastering, training and standalone kernels are not A dependencies. Preserve existing production single-track behavior.

Execution order: (1) correct planning PR #19, targeted independent documentation review; (2) repair #42 short-window 100% mute/fades, confirm exact-frame mismatch consent and parity against already-closed #17; (3) reconcile #47 with **current** #46 head, bounded decode/seek/pre-roll, consistent decoder alignment and memory/cancellation evidence, then one independent **Full review of actual integration-tip SHA**. Defer #40 diagnostics and #48 long-form export. #11's #3 → #6 → #8 ancestry still requires explicit review or carefully tested restacking even if Polish is disabled in A.

A requires final-head synthetic tests (hostile ZIP, click/fade alignment, stale worker, cancellation, memory and preview/float-WAV parity), real-browser peak memory for eight-minute ten-stem Viking input, runtime codec probing, no unexpected post-load network requests, and real-audio level-matched listening at 462–474 seconds. **A named browser-capable reviewer/session, or owner Gus as fallback, is the gate executor** and records browser/memory/listening evidence. GitHub-only sessions cannot certify these gates. Missing evidence means **hold unreleased**. No fixed date authorizes merge or deployment. Respect local-first privacy and review third-party licenses before incorporation.

## Auditor and next-session checklist

1. Read [#18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18), product plan and [#16](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/16).
2. Read latest PRs and source SHAs, not cached snapshots; inspect `main` and draft branch graph.
3. Check actual automation state and latest claims in issue #18; this document alone does not activate a scheduler.
4. Declare `[ChatGPT-1 | SSF Coder]` or `[ChatGPT-2 | SSF Independent Reviewer]` with your role and new session ID if one is available.
5. Claim one task; review frozen source or implement; use regression tests; write the exact outcome in a PR/issue, and yield safely.
6. Never mark `RELEASED` based only on code, plan documents or passing automated checks.
