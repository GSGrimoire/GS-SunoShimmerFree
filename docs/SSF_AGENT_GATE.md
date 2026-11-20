# SSF engineering agent gate: coder, independent reviewer, and release control

**Date:** 20 November 2026. **Scope:** only `GSGrimoire/GS-SunoShimmerFree`.  
**Current status:** protocol documented; **NO autonomous 20-minute runner is configured by this document**.  
**Canonical product plan:** [STUDIO_PRODUCT_PLAN.md](STUDIO_PRODUCT_PLAN.md). **Initiative:** [#18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18).  
**Immediate review:** [PR #17](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/17), source head `4cff86b28980400664935096be643b120a48b79a` at initial handoff, and its upstream [PR #11](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/11).

## Operating choice: separate coder and reviewer roles

Prefer **two separate ChatGPT sessions**, not a single session which says it switched hats. The work dispatcher can be shared, but the implementation and independent review must use separately instantiated contexts and separate immutable review packets. Review and correction must not happen concurrently on the same head. The two roles may authenticate to GitHub through the same account, so an independent source-code verdict is **not** formal GitHub review approval from a distinct identity. Never claim otherwise.

- **ChatGPT-1 | SSF Coder:** claims exactly one issue and one branch; implements bounded changes, maintains code/tests/handoff, labels frozen head ready for review. Cannot approve its own work.
- **ChatGPT-2 | SSF Reviewer:** loads the pinned head and base independently; gives a consolidated adversarial verdict; does not edit the code being reviewed. If it writes a fix, that code needs a different independent reviewer.
- **Release coordinator (state machine, not another approving persona):** checks approvals and runtime evidence; merges only when authorized and all dependencies have cleared; does not treat calendar time, passing tests or review from the code author as sufficient.

The initial PR #17 was authored by a ChatGPT coder in an earlier conversation, so the first reviewer must be in a **new, non-authoring session**.

## Cadence, scheduler and limitations

**Owner target:** continuous 24-hour operation through Monday morning, 23 November 2026, with a role opportunity every **20 minutes**.

**Scheduling capability verified in this planning session:** ChatGPT task automations allow a **minimum recurrence of one hour per automation**, not every 20 minutes. There is **no valid 20-minute ChatGPT automation schedule** and an ordinary GitHub Actions cron does **not** itself spawn ChatGPT coding sessions. Do not tell the owner that the requested schedule is active unless a compatible agent runner, credentials, permissions, separate-session isolation and actual execution have been verified.

If an **external agent-capable orchestrator** is authorized and operational, use a deterministic 20-minute heartbeat dispatching alternating new sessions: coder on one tick, reviewer on the next; when a role has no eligible work, it records `no-op`. Reserve a short lease per claim, never run reviewer and author against a changing branch, and ensure jobs do not overlap. Do not add API credentials to public repository files or workflows.

**Supported fallback (requires separate activation):** one hourly SSF Reviewer task and one hourly SSF Coder task, offset by 30 minutes in `Europe/Copenhagen`, operating all day and night. Each is within the once-per-hour automation limit. Staggering does not establish a guaranteed 20-minute cadence, two distinct GitHub identities, or a release by the deadline.

A scheduler is a trigger, not a guarantee that external credentials, GitHub permissions, network access, checks or runtime are available. Stop and report if any prerequisite is missing. Do not silently schedule activity under a different repository's existing gate or broaden a portfolio-wide agent's authority.

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

**Mini review:** isolated text, styling or deterministic calculations without safety boundary or audio integrity impact; documented self-review and appropriate tests suffice unless the owner explicitly requires a second reviewer.

**Full review:** any ZIP/media parser security, source-file integrity, decoding, streaming memory, audio alignment, export correctness, asynchronous concurrency, automation that can remove music, local project persistence, credentials, public deployment or material uncertainty. **Independent reviewer required.**

A full review packet must include the complete affected path, exact base/head, threat/failure model, security and signal invariants, malformed or adversarial tests, actual test commands/results, known limitations and real-browser/listening status.

Reviewer reports one of:
- **`Approved without changes`**, exact SHA, complete scope, test evidence, limitations and remaining non-source release gates.
- **`Changes required`**, exact SHA, severity, concrete failure scenario, minimal reproduction, required correction and related cases to inspect.

One correction attempt for a reported defect before escalation; do not enter infinite corrective loops or turn unresolved failures into an implicit pass.

## Immediate priority: independent review of PR #17

Do **not** start by asking the same ChatGPT author session to review PR #17. Assign a distinct ChatGPT-2 reviewer.

Review `stem-ui.js`, `stem.css`, `tests/stem_ui_test.js` and all relevant unchanged caller/worker/decoder paths in the actual PR #17 head, based on stem ZIP PR #11. Compare both implementations; ensure no release claims based on standalone synthetic tests.

Review priorities:
1. Correct sample-to-global-time mapping for selected 370–382 s and 462–474 s excerpts; 20-millisecond fades must not jump or erase wanted notes unexpectedly.
2. The new short excerpt path must **not** claim true bounded decoding: MP3 `decodeAudioData` still decodes full stems. Consider out-of-memory, worker transfer and renderer allocation in real browsers.
3. Verify source generation/cancellation guards, stale exports, invalid input including NaN/infinity, selecting passages outside durations, mismatch and resampling branches.
4. Compare actual browser playback/export with what the mixer produced, including WAV/MP3 correctness and clipping after gain automation.
5. Verify full branch dependency graph and tests, including negative controls. If a high-severity issue is found, give consolidated findings with exact lines/scenarios.

Recorded evidence from previous session: synthetic workflow tests and GitHub Actions checks passed on head `4cff86b...`; **that is not an independent review or human listening verdict**. For a stronger claim, inspect the current latest head, not just this historical pointer.

## Work selection and priority

Do not make parallel high-risk changes while the branch stack remains unreviewed.

1. Independently review **#17**, then prioritize corrections and regression, keeping the same reviewer separate from the coder.
2. Reconcile **#11** ZIP workspace review and stack prerequisite **#3 → #6 → #8**. Review the separate **#10 → #13 → #14** chain before merging localized analysis with stem workspace.
3. Implement the next thin **Studio vertical slice** from product plan #18: project manifest + bounded full-length preview/mix, not another generic spectral effect.
4. Use the confirmed Viking audio test fixture for manual real-world acceptance, with a clean control. Write results in #16 or linked research docs.
5. Protect production `main` and deployed website. Stage preview separately until release evidence passes; do not automatically ship to meet a date.

**Dependency example:** PR #17 is stacked on PR #11, which itself depends on the Sound Polish branch. A green #17 check does not give permission to merge it into `main` directly.

## Release gate: Monday is a target, not authorization

Before any public release or merge to a deployment-triggering branch, verify:

- [ ] Feature and behavior contract explicitly states what is complete and what remains unavailable.
- [ ] All required current-commit independent reviews passed, including ZIP/file security and full duration changes.
- [ ] Automated regressions passed at the integrated head, with evidence that no test was silently skipped.
- [ ] Test five-minute and eight-minute multistem cases in an actual browser with real audio and inspect memory/cancel/exports.
- [ ] Check synchronized playback, MP3 padding, fades, silent clean-stem bypass, level-matched comparison and no wrong-track renders.
- [ ] Confirm no secrets/music uploads, public fixture exposures understood and all owner-held safety or release decisions resolved.
- [ ] Deploy only through the approved environment and verify the actual hosted site, with rollback to prior production if a serious regression appears.

If only part of the complete studio passes, label it **Studio Preview / Alpha**, or hold release. No unattended role may **infer** the owner's subjective musical acceptance from spectral metrics. Log a clear decision by the Monday morning checkpoint.

## Auditor and next-session checklist

1. Read [#18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18), product plan and [#16](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/16).
2. Read latest PRs and source SHAs, not cached snapshots; inspect `main` and draft branch graph.
3. Check whether **any actual scheduler was activated**; this document alone is not one.
4. Declare `[ChatGPT-1 | SSF Coder]` or `[ChatGPT-2 | SSF Independent Reviewer]` with your role and new session ID if one is available.
5. Claim one task; review frozen source or implement; use regression tests; write the exact outcome in a PR/issue, and yield safely.
6. Never mark `RELEASED` based only on code, plan documents or passing automated checks.
