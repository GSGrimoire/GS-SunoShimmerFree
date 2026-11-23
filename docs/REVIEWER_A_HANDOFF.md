# Review handoff: ChatGPT Reviewer-A

**Project:** GS-SunoShimmerFree (SSF)  
**Authoring role:** ChatGPT Coder-A  
**Independent review role:** ChatGPT Reviewer-A  
**Date:** 2026-11-07  
**Repository:** https://github.com/GSGrimoire/GS-SunoShimmerFree  
**Review target:** Draft pull request https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/3  
**Feature branch:** `feature/sound-polish-v5a`  
**Base branch:** `main`  
**Product roadmap:** https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/2  
**Native Suno ZIP import specification:** https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/4

## Reviewer-A mission

Independently review Coder-A's implementation of the first Sound Polish release. Do **not** assume that Coder-A's tests or PR summary establish correctness. Inspect the diff and relevant existing source, exercise actual integrations if feasible, and return a severity-ranked review with file/line references, concrete reproduction steps and actionable fixes. Do not merge the draft PR without explicit user authorization.

Review the scope that actually exists, not future roadmap promises. In v5a Sound Polish is an optional, post-cleaning tone stage (clarity/presence only). Dynamics, integrated loudness, transient enhancement and stem ZIP import are future work.

## Background and quality goals

- Existing app is entirely local-first: original, cleaned, removed playback; static/shimmer cleaning; non-destructive timeline edits; WAV/MP3 export; browser worker.
- v5a adds `polish.js` and `polish-worker.js`, user controls and presets, plus an independent Polished track version.
- Clarity: bounded bell cut near 320 Hz, maximum -3 decibels.
- Presence: bounded bell boost near 2,500 Hz, maximum +2.5 decibels.
- A linked sample-peak safety attenuation is applied if enabled processing would exceed 0.97 full scale. This is **not** true-peak limiting or level-matched listening.
- Original and Cleaned versions should stay audibly and sample-wise unchanged by v5a, including after a user changes presets.
- No remote audio uploads; no paid service requirement.

## Inspect the following implementation and integration areas

1. **Core algorithm:** Validate `polish.js` peaking filter equations, gain behavior, sample-rate extremes, mono/stereo behavior, filter stability, no silent data corruption, handling of NaN/Infinity, and finite output. Examine peak safety near clipped inputs. Verify bypass correctness.
2. **Asynchronous behavior:** Check `app.js` sequencing when users replace sources, re-clean, rapidly adjust presets, switch versions, or trigger/cancel exports during polishing. Look for races between `worker.js`, `polish-worker.js`, and `export-worker.js`.
3. **Timeline editing and exports:** Test the existing `edit.js` playback/export path for Polished in pristine, split, trimmed, cropped, section-gain and fade cases. Check both WAV and MP3, including clipping messages.
4. **User interface:** Confirm all IDs exist; keyboard shortcuts 1-4 select the intended modes; focus, disabled states, status messages and mobile responsive layout work. Evaluate whether label `Cleaned spectrum` accurately discloses that the spectrogram for Polished is presently NOT the polished spectrum.
5. **Memory, responsiveness, portability:** Try a four-minute stereo track and a short track. Confirm workers on hosted GitHub Pages, reasonable local fallback on `file://`, and no excessive blocking or uncontrolled buffer duplication.
6. **Compatibility regression:** Run existing repository tests (including editing and MP3) and `node tests/polish_test.js`; inspect CI. If browser tests are unavailable, say so explicitly rather than asserting they passed.
7. **Audio quality:** When relevant music examples are available, compare Original, Cleaned and Polished at *matched perceived loudness*, not raw volume. Check for exaggerated Suno shimmer, harshness, phase/stereo changes and apparent improvement on muddy versus clean mixes. Identify any preset that is routinely counterproductive.

## New stem ZIP requirement (future, NOT implemented in PR #3)

The user supplied the original Suno ZIP `The Black Kiln Stems.zip`. The actual binary ZIP has **not** been committed to GitHub and may not be available in Reviewer-A's new session. For detailed spec see issue #4.

Observed structure: 24 root-level audio files, 12 unique stems each paired as `The Black Kiln (StemName).wav` and `The Black Kiln (StemName).mp3`. Stems: Guitar, Synth, Backing Vocals, Drums, Brass, Strings, Woodwinds, Keyboard, Percussion, Vocals, Bass, FX. Each WAV has stereo 48,000 Hz 16-bit signed PCM audio and 10,137,600 frames (211.2 seconds). ZIP ~380 MB compressed, ~538 MB uncompressed. No MIDI in this example.

**Design expectation:** Future SSF should accept a native Suno stem ZIP directly, deduplicate WAV/MP3 variants, prefer WAV, retain precise alignment, process selectively or in chunks to stay within browser memory limits, preserve local privacy, offer individual stem controls and eventual mix reconstruction. Do not silently assume all Suno ZIPs have exactly these names. Do not ask for a new source file if requirements can be reviewed using the documented ZIP manifest or synthetic fixtures. If actual-audio review requires the binary, request the user attach it to that session.

## Review deliverable

Report:
- A **release recommendation**: mergeable, mergeable with minor fixes, or blocker.
- Findings grouped as Critical / High / Medium / Low, each with a concrete location, why it matters, suggested fix, and evidence.
- Tests genuinely run and any tests **not run**.
- Which changes Coder-A must make before merging.
- Optional notes for future stem ZIP import, clearly separated from current v5a blockers.

If connected GitHub actions are available, post the review to PR #3 (issue-thread comment is acceptable). Do not merge code or directly change the branch unless requested. Preserve the responsibilities: Reviewer-A analyzes; Coder-A implements reviewer findings.

## Start a separate review session

Suggested initial message to Reviewer-A:

> You are **ChatGPT Reviewer-A**, independent reviewer for GS-SunoShimmerFree. Read the full handoff at `docs/REVIEWER_A_HANDOFF.md` on branch `feature/sound-polish-v5a` of `GSGrimoire/GS-SunoShimmerFree`. Review draft pull request #3 against main independently, inspect and test the implementation, and report release-blocking defects with reproducible evidence. The product decision to accept native Suno stem ZIP files in a future release is documented in issue #4. Do not merge. Coder-A will implement fixes based on your review.
