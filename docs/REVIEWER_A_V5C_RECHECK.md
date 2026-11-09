# ChatGPT Reviewer-A: v5c loudness correctness re-review

**Review owner:** ChatGPT Reviewer-A (independent review)  
**Developer:** ChatGPT Coder-A  
**Date:** 2026-11-08  
**Target:** [draft pull request #8](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/8) on `feature/sound-polish-v5c-loudness` against `feature/sound-polish-v5b-dynamics`  
**Prior blocking review:** [Reviewer-A third stage, 8 November](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/8#pullrequestreview-5819532990)

## Context and merge gates

Reviewer-A marked PR #3 (clarity/stabilization) and PR #6 (dynamics) **code-review clear**, subject to mandatory actual browser verification, level-matched Suno listening and stacked merge order. Do not reopen those increments without a concrete regression. PR #8 had three medium-severity correctness findings and was blocked. Coder-A implemented fixes, documented behavior and regression tests. All branches remain draft and unmerged.

## Fix M8-1: loudness after gain near the absolute gate

Original `polish.js` reported `meter.lufs + normalizationGainDb + safetyDb`. This is mathematically incorrect when gain causes new 400-millisecond blocks to cross the -70 integrated-loudness gate. It is now replaced with a fresh `Loudness.measure(output, sampleRate)` of the **actual final Float32 audio** whenever gain has changed. `normalizationLimited` also checks whether the final measured result deviates by more than 0.25 loudness units from the chosen target.

The regression in `tests/loudness_test.js` reproduces Reviewer-A's ten-second 48-kilohertz stereo sine, first second at amplitude 0.0005 and following nine seconds at 0.00017. It asserts final reported value matches fresh measurement within 0.02 loudness units and verifies that counted gate blocks genuinely change.

**Reviewer-A verify:** measure the output independently on the reported edge case and on unrelated dynamic programme material. Check no stale/incorrect normalization values are exposed in the worker or application. Ensure no new loudness-over-target issue is hidden by the limit flag.

## Fix M8-2: rejected target-only input must bypass

If fewer than 400 milliseconds or more than two channels, the integrated-loudness meter returns unsupported. Previously requesting a target alone made `active=true` and activated the 0.97 sample-peak ceiling despite applying no normalization. Now a target **alone** is not counted as a signal-processing stage; the peak constraint only runs if clarity, presence, dynamics or eligible normalization actually applied. Unsupported target-only processing is sample-identical, including audio with original peaks >0.97; it reports an unsupported reason and does not silently normalize.

The regression checks 250-millisecond stereo at amplitude 0.99, and one-second triple-channel samples including +1.2/-0.8, proving exact output identity, zero normalization/safety gain and correct unsupported status. It also checks that explicit tone processing retains peak protection.

**Reviewer-A verify:** short, three-channel and silent audio, with and without active tone settings. Confirm the bypass is intentional and doesn't pretend to meet a loudness target.

## Fix M8-3: pre-edit meter versus edited export

UI label changed from `Measured X LUFS` to `Measured before timeline edits: X LUFS`. When the edited timeline is not pristine, the interface adds: `Timeline edits can change exported loudness and may clip; peak protection applies before edits.` The `afterEdit` path now refreshes the status on edits, undo and reset. This is deliberately a **clear qualification**, not an expensive full edited-track loudness re-render on every change.

New `tests/polish_integration_test.js` assertion runs the actual application with simulated worker/DOM interactions: a pre-edit label is shown, splitting the timeline adds the edit warning, and resetting edits clears the warning. This specifically prevents presenting pre-edit loudness as a final post-edit export meter.

**Reviewer-A verify:** status label during section boosts/cuts/crops/fades and when resetting/undoing. In actual browser playback/download confirm a section gain can change output level and should not be represented by the pre-edit meter. Inspect output clipping behavior separately.

## Automated evidence and remaining limitations

[Full GitHub Actions run 42521674003](https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42521674003) **passed** for the code/test head. It includes tone, linked dynamics, application state/race tests, gated loudness versus independent FFmpeg, actual MP3 encoding/decoding and editing regressions.

The synthetic integration tests do **not** establish actual Chrome/Firefox/Safari or local-file worker behavior, mobile layout, sample-accurate listening, quality improvements or perceived-loudness-matched A/B assessment. These remain user acceptance tasks. The private Suno stem ZIP must not be uploaded to public GitHub; native stem import is future issue #4.

## Reviewer output and strict boundaries

Post a **new severity-ranked release recommendation** on PR #8 with reproducible evidence, test execution limits and any remaining fixes. Do not merge any PR or independently edit Coder-A's feature branches. Coder-A will address confirmed defects. Do not begin transient enhancement release before current stages are verified.

Suggested new-session instruction:

> You are ChatGPT Reviewer-A, independent reviewer of GS-SunoShimmerFree. Read `docs/REVIEWER_A_V5C_RECHECK.md` on branch `feature/sound-polish-v5c-loudness`, inspect the newest changes in draft PR #8, reproduce former findings M8-1, M8-2, and M8-3, check the current passing tests and document any remaining release blockers. Post your assessment to PR #8. Do not merge. ChatGPT Coder-A will address any defects.
