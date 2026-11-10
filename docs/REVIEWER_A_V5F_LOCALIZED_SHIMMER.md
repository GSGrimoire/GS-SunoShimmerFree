# Reviewer-A: v5f localized shimmer / conservative audition

**Date:** November 10, 2026
**Coder:** ChatGPT Coder-A
**Base:** v5e Auto Clean draft PR #13, still unmerged
**Status:** experimental draft; real listening not yet accepted

## Why

A user reported unwanted high-frequency shimmer most noticeable near the end of a Suno track, noticeable echo/ambience remaining, and a Removed track carrying recognisable melody. The prior Auto Clean version samples only a small number of distributed windows and fires its "quiet high-frequency noise" rule primarily for quiet excerpts. It can correctly return "No safe automatic repair" even when the user perceives an undesirable late effect. More aggressive broadband static subtraction is known to remove audible music and cannot safely isolate reverb or cymbals from shimmer.

Coder-A also inspected locally the user's private GS Grimoire_Fault Lines.mp3 (about 178 seconds). The high-frequency balance changes over time, which is not sufficient to classify an artifact. No private user audio was added to GitHub.

## Changes

1. auto-clean.js retains at most **16 half-second windows**, reserving the last eight for the final 15% of the track. Each window is labeled with start time and region. The analysis reports the *relative* tail versus earlier high-frequency energy. A tail-only candidate requires at least three valid windows in both regions, a minimum tail high-frequency share of 0.003, and at least +4 decibels relative lift. This is a signal-feature hypothesis, **not proof of shimmer**. If triggered, explicit Auto Clean click selects only restrained shimmer processing (0.75, maximum 6 dB attenuation, start 6 kHz), with **static subtraction off**, dynamics/presence/transients/loudness target off.
2. index.html/app.js: **Try Shimmer Focus (static off)** button allows manual reversible comparison even when the heuristic cannot justify automatic processing. It sets static denoiser OFF, shimmer 0.8, maximum 6 dB, starting 6 kHz and reruns the existing cleaner. Original remains untouched.
3. tests/auto_clean_test.js: normal music, quiet hiss, clipping, click, low-mid buildup, tail-only treble, uniformly bright music, explicit tail sampling, memory budget.
4. tests/polish_integration_test.js: app state harness checks the new button's worker settings, bypass, duplicate-job prevention and Cleaned export.
5. All older tone, dynamics, transient, loudness, audio-export race and editor tests must continue passing.

## Reviewer limitations and priorities

The spectral profile cannot distinguish cymbals, musical harmonics, aliasing, codec grain, reverb or shimmer. The shimmer-only pass may be too subtle or may dull some cymbals. It **does not** remove true echo or reverberation. The Removed signal is Original minus Cleaned; it is not noise-only separation and will inevitably contain musical elements when the filter overlaps musical frequencies.

Reviewer-A should inspect end-window coverage and boundary conditions, short/silent tracks, relative high-band false positives, stereo handling, memory copy bounds, worker-staleness/manual cancellation, and whether the UI describes the limitations accurately. Independently check the synthetic assertions and the current head's full GitHub Actions run. Real listening on user recordings and multiple browsers remains mandatory.

Post severity-ranked findings on the v5f draft pull request and do not merge it. Coder-A handles fixes.
