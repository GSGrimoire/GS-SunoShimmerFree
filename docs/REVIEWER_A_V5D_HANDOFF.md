# ChatGPT Reviewer-A: independent review of v5d transient enhancement

**Date:** 2026-11-09  
**Implementer:** ChatGPT Coder-A  
**Reviewer:** ChatGPT Reviewer-A (independent)  
**Repository:** https://github.com/GSGrimoire/GS-SunoShimmerFree  
**Feature branch:** `feature/sound-polish-v5d-transients`  
**Base:** `feature/sound-polish-v5c-loudness`, which itself is stacked on #6 and #3  
**Roadmap:** [issue #9](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/9)  
**Private Suno stem ZIP:** future [issue #4](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/4); not supported in this increment

## Goal, integration and boundaries

Review the new **experimental, optional** transient enhancer. Existing v5a clarity/presence, v5b gentle dynamics, and v5c gated loudness have been code-review clear independently but still require real-browser and level-matched listening acceptance. Do not merge any stage until acceptance and appropriate stacked ordering.

The new `transient.js` attempts to emphasize drum-like low/mid attacks rather than upper-high shimmer. It runs **after** clarity/presence and the stereo-linked compressor, **before** integrated loudness measurement and the existing 0.97 sample-peak protection. `transients: 0` is a true bypass and is default for Natural, Clear, Warm and Forward. A new `Punchy (experimental)` preset sets the transient control to 35%. User can adjust 0 to 100%.

### Algorithm details to scrutinize

- Causal 55-hertz high-pass and two approximately 850-hertz low-passes per channel, designed to reduce upper-band content in the **added** signal.
- Linked fast (4-millisecond) and slow (75-millisecond) smoothed band-power detectors, followed by onset contrast thresholding.
- Rejects low-level tails below a slow-envelope root-mean-square threshold of 0.012; approximately 30-millisecond detector release.
- Adds up to **35% of the filtered band signal** at maximum 100% user intensity. This is not a 35% gain of the whole programme and not an actual reconstruction of missing transients.
- Shared onset envelope across channels; identical band filters on each channel. Proportional stereo input should preserve ratio, but arbitrary stereo mixes may change width or tone in the lower band.
- No dynamic allocation of full-length per-channel temporary buffers inside the transient module. Operates on the copied Polished buffer; neither original nor cleaned source is modified.
- Downstream `Loudness.measure` and peak protection should include transient energy, and optional normalization obey previous target constraints.
- All prior stale-export, overlap-source generation and pre-edit loudness labeling safeguards must remain intact.

## Source changes to inspect

- `transient.js`: new standalone low/mid attack shaper.
- `polish.js`: order of operations, settings, conservative presets and telemetry.
- `polish-worker.js`: import ordering and telemetry forwarding.
- `app.js`/`index.html`: new slider, new experimental Punchy preset, worker parameters and Polished output identity. An ordinary changed slider must invalidate Polished export until reapplied.
- `tests/transient_test.js`: synthetic attack, shimmer-frequency rejection, bypass, proportional stereo, silence, steady tones, sample rates, peak checks.
- `tests/polish_integration_test.js`: real app source under synthetic document and worker with preset and MP3 stale-export tests.
- `.github/workflows/sound-polish.yml`: full regression suite and standalone user-downloadable browser-preview artifact.
- `preview_server.py` / `PREVIEW_TESTING.md`: localhost preview launcher and testing instructions.
- **Base v5c Low issue L8-1:** live section-gain/fade input now calls `refreshPolish()`. Regression in `tests/polish_integration_test.js` verifies warning appears before slider change/commit. This minor base change is included via branch inheritance, not part of the new transient algorithm.

## Technical review tasks

1. Independently inspect transient detector stability, threshold behavior, stereo linking, sample-rate dependence, high-frequency leakage, aliasing, zero-denominator behavior, floating-point accumulation, long recordings, and lack of clipped nonfinite samples.
2. Verify true bypass with transients=0 and no changes to prior preset outputs. Watch for the added low/mid attack stage increasing sub-bass rumble or quiet ambience.
3. Compare **energy in the attack window versus the later steady state** for short kick/snare-style signals. The synthetic 160-hertz fixture is necessary but not sufficient for real music.
4. Assess whether 850-hertz low-pass is enough to avoid enhancing synthetic cymbal artifacts when broad-band transients occur. A high-frequency sine only tests an idealized input.
5. Inspect interaction with compressor and loudness target. Test sample-peak constraints and target-limited flags with transient emphasis on, and content where the onset detector repeatedly triggers.
6. Review the preview packaging for completeness and ensure it serves via loopback only and does not unintentionally upload audio. Browser acceptance still requires actual Chrome/Firefox/Safari and private Suno music; mock tests are not sufficient.
7. Ensure previous export-race and source-replacement fixes hold for the new `transients` setting and stale MP3 callbacks. Validate initial Punchy preset, manual changes, and 0% setting.

## Automated baseline

At the time of writing, the full v5d workflow successfully completed for code/test head `225d11a72c...`:
https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42637779267

A later workflow with preview packaging also passed:
https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42638053036

The following are run in continuous integration:

```sh
node tests/polish_test.js
node tests/dynamics_test.js
node tests/transient_test.js
node tests/polish_integration_test.js
node tests/loudness_test.js
node tests/mp3_test.js
```

It also runs the editing regression using a synthetic five-second stereo WAV and independently checks integrated loudness and MP3 exports using FFmpeg.

**Status:** all four pull requests remain draft and unmerged. Do not call v5d sound quality improved until level-matched real-music testing supports that conclusion.

## Reviewer-A deliverable

Post a review to the **v5d draft pull request** with severity-ranked findings, concrete reproduction, test evidence and any acceptance blockers. Flag algorithm quality concerns separately from correctness defects. Recommend code-review clear / needs fixes / blocker. Do **not** merge or independently modify Coder-A's branch; Coder-A owns implementation changes.

Suggested next-session opening prompt:

> You are ChatGPT Reviewer-A, independent reviewer of GS-SunoShimmerFree v5d. Read `docs/REVIEWER_A_V5D_HANDOFF.md` on `feature/sound-polish-v5d-transients`. Inspect the stacked diff against `feature/sound-polish-v5c-loudness`, independently verify the transient processing, preset and stale-export behavior, preview packaging and automated tests, and post a severity-ranked release recommendation on the v5d pull request. Do not merge. Coder-A will fix issues.
