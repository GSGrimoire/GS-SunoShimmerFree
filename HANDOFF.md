# SunoShimmerFree: durable cross-session engineering handoff

**Repository:** `GSGrimoire/GS-SunoShimmerFree`. This file contains operating guidance, **not live commit or automation state**. Re-fetch [issue #18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18), current pull requests, reviews, claims and branch heads every session.

## Product and milestone A
The eventual product is an automated, local-first, reversible multitrack studio. The owner has withdrawn fixed release dates. **Milestone A is only a manual excerpt-only Multi-Stem Preview:** safe supported ZIP import and stem selection, visible sync/format limits, bounded passage audition, per-stem gain/mute/solo, reversible time-local attenuation with continuous fades, and matching selected-passage 32-bit floating-point WAV export with peak-overload reporting. No full-song export, per-stem Polish, selective cleaning, automatic improvement, mastering or training in A. Preserve the production single-track application.

## Existing integration path and known blockers
- [#11](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/11) ZIP workspace inherits #3 → #6 → #8; disabling Polish in the interface does not remove inherited code. Review inherited source or explicitly restack and verify.
- [#42](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/42) is the corrective passage editor line. Verify exact-frame alignment consent and repair short-window 100% mute/fade behavior. Confirm code and behavior parity before closing [#17](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/17) as superseded. [#40](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/40) diagnostics are deferred unless safely integrated.
- [#47](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/47) WebCodecs passage decoding requires reconciliation with the **current** [#46](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/46) head, correction of stale review packet, bounded excerpt decode, seek/pre-roll, consistent alignment and native-memory/cancellation validation.
- [#48](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/48) full-song streaming WAV is **deferred** beyond A. Existing standalone kernels are reference material for later milestones, not new A work.
- [#16](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/16) tracks Viking fixture and listening uncertainty. Use public committed example files minimally, not as permission to upload private audio.

## Execution order
1. Correct [planning PR #19](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/19) and obtain targeted independent documentation review of its new immutable head; no self-merge.
2. Repair and independently review the existing passage-editor and ZIP integration line, resolving ancestry and fade defects.
3. Correct #47 against current #46, then obtain **one Full independent review** of the actual integration tip with dependencies.
4. A named browser-capable operator or **owner Gus as fallback** records real-browser hostile ZIP, timing, peak-memory, cancellation, network, float-WAV parity and level-matched Viking 462–474-second listening results. GitHub-only sessions cannot claim this passed.

No new coder PR while at least two coder PRs await review; freeze new `studio-*` kernels until A ships. Claims and review verdicts are immutable-head scoped. Preserve stack history with merge commits only when independently approved and ordinarily authorized. Do not merge, publish or change production `main` on a deadline.

## Next-session record
Use the relevant PR and issue #18 for live status: actor/session, claim and lease, branch/base/head, changes, exact test commands and results, unresolved gates, and next reviewer/operator action. Automation schedules and identifiers are external live state, never evidence of successful execution.
