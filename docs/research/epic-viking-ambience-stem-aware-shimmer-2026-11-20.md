# Real-world test case: Epic Viking Ambience, stem-aware shimmer repair

**Recorded:** 20 November 2026  
**Status:** exploratory measurement and product hypothesis, **not** a validated repair or production-ready test  
**Owner:** GS SunoShimmerFree project  
**Related work:** [roadmap #2](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/2), [stem import #4](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/4), [stem workspace draft PR #11](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/11), [localized shimmer draft PR #14](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/14)

## Why this case matters

The user's account of the recording: approximately eight minutes, vocal/Viking hums at the start followed by a horn/trumpet-like sustained note, which becomes increasingly shimmery or distorted over time. This is a **listening report**, not an algorithmic diagnosis. Suno's extracted-stem screenshot shows ten labeled stems with markedly different waveforms. Instrument categories are source-separation labels, not reliable evidence that a particular stem contains a clean isolated instrument.

**New product hypothesis (user, 20 Nov):** Do not assume the best repair is full-mix spectral processing. Some stems may be clean and others defective. A reversible, time-local mute or attenuation of an unneeded stem may beat stronger artifact suppression; alternatively run the existing shimmer remover on **selected stems only**, then remix. Compare the simplest successful intervention first.

A mute is **not automatically free**: it may remove the underlying musical material along with the unwanted artifact. Use content-preservation listening tests and short crossfades.

## Source fixture and reproducibility

The original locally supplied archive is named `Epic Viking Ambience Stems.zip`. Compressed ZIP size **87,872,840 bytes**, ZIP SHA-256 `3125dae57b8c0a45257ebc35aa442330b0cb89a07fe295083aa216a54f108528`. Ten MP3 files at ZIP root, named:

`0 Lead Vocals.mp3`, `1 Drums.mp3`, `2 Bass.mp3`, `3 Keyboard.mp3`, `4 Percussion.mp3`, `5 Strings.mp3`, `6 Synth.mp3`, `7 Other.mp3`, `8 Brass.mp3`, `9 Woodwinds.mp3`.

All ten report **48,000 Hz, stereo**, and each has **20,000 MP3 frames**. With 1,152 samples per frame, encoded duration is **480.0 s (8:00)** per stem. Container-based duration fields were inconsistent and, for some stems, grossly inflated (e.g., Other reports 1,184 seconds; Brass 1,850 seconds). The decoded audio and alignment must be checked rather than trusting container duration metadata.

**Fixture confirmed 20 November 2026:** All **ten MP3 stems** are committed at [`example-files/viking-shimmer/`](https://github.com/GSGrimoire/GS-SunoShimmerFree/tree/main/example-files/viking-shimmer) on `main`. Their repository file sizes total **89,193,776 bytes**; they match the ten stem *names* listed above. This supersedes an earlier note that only a placeholder was present. Full audio byte-for-byte equivalence to the original ZIP has **not been verified**. The repository is public, and these audio files are publicly retrievable; do not redistribute them beyond this project or make additional copies without considering permissions.

The prior chat generated separate audio previews and a CSV locally, but those chat attachments are **not** a durable repository source. The numerical results and key reproduction information are recorded here and in the three adjacent CSV files.

## What was measured

### Five-position stem survey

MP3 decoded with FFmpeg to mono floating-point audio at **24,000 Hz**. Windows:
`intro=0–16 s`; `early=40–60 s`; `mid=220–240 s`; `late=360–380 s`; `end=456–476 s`.
For each window, calculate root-mean-square level, Welch power spectral density (8,192-sample segment, 50% overlap), integrated power above 6,000 Hz, its fraction of total spectral power and the dominant frequency from 70–6,000 Hz. Stored in [five-position metrics](epic-viking-ambience-five-window-metrics.csv).

Interpretation must distinguish **absolute high-band energy** from **high-band percentage of an almost silent stem**. No automatic “shimmer present” labels follow from these measurements. The late/end region is not monotonically bright across every stem. For example, Other's high-band energy changes from about -99.28 dB in the early window, to -56.72 dB in the late window, and to -63.98 dB in the end window. The early-to-end increase is ~35.3 dB, but this is not a continuously rising trajectory.

### Reference Shimmer Focus pass

An independent Python implementation reproducing the repository's `tests/reference.py` shimmer equations (not a full-browser run), on 12-second **462–474 s** stereo sections of eight stems. Settings: **static denoise off**, shimmer amount **0.8**, maximum high-band cut **6 dB**, shimmer onset **6,000 Hz**. Results in [shimmer test CSV](epic-viking-ambience-shimmer-focus.csv).

Representative measured reduction in integrated power **above 6,000 Hz**: Other **0.73 dB**, Percussion **0.66 dB**, Drums **0.81 dB**, Strings **0.80 dB**, Synth **0.76 dB**, Woodwinds **0.69 dB**, Bass **0.82 dB**, Brass **0.75 dB**. These are **small objective changes**. They do not prove that shimmer is gone, nor that the removed component is non-musical. No validated listening preference test has been conducted. The low-mid frequency band is almost unchanged by this high-band-only setting.

### Exploratory stem ablation, no repair algorithm

A separate calculation decoded equal **12-second windows** starting at **230, 370 and 462 seconds** in stereo at **48,000 Hz**. It summed the ten decoded stems directly, then recalculated the sum after removing **one stem at a time**. Welch spectral energy above 6,000 Hz is measured on the stereo average. Positive “mute delta” means the band or full-mix root-mean-square level **decreased** after muting that stem. The data are in [ablation CSV](epic-viking-ambience-stem-ablation.csv).

| Window | Stem muted | >6 kHz energy decrease | Whole-mix level decrease |
| --- | --- | ---: | ---: |
| 230–242 s | Woodwinds | 4.84 dB | 5.75 dB |
| 230–242 s | Bass | 2.16 dB | 4.68 dB |
| 370–382 s | Synth | 2.37 dB | 0.91 dB |
| 370–382 s | Other | 1.83 dB | 0.16 dB |
| 462–474 s | Other | **4.06 dB** | **5.68 dB** |
| 462–474 s | Percussion | 0.97 dB | ~0.00 dB |

This establishes that the **impact of muting depends on time and stem**. At 462–474 seconds, muting Other attenuates more of the combined high band than running the conservative shimmer filter on Other alone, but it also removes a large amount of the total sound. At 370–382 seconds, muting Other reduces high-band energy with little whole-mix level effect. Neither observation is proof of better **perceived** audio: full-band level is a weak proxy for essential music; phases and stem bleed matter. The arithmetic sum may not exactly reconstruct Suno's source mix (unknown extraction normalization, codec delay and leakage).

## Proposed listening comparisons, in order

1. **Baseline:** original Suno full mix (if available), and a separately marked reconstruction from all 10 stems. Check sync, MP3 encoder padding, duration and level; do not assume the two are identical.
2. **Bypass:** stem-by-stem solo/monitor at intro, middle, and late/end. Mark audible artifacts and essential musical material by time. Avoid equating “more treble” with “more distortion.”
3. **Selective mute/attenuation:** manually bypass a suspect stem for a **chosen passage** with short crossfades and full undo; use partial attenuation when full mute removes wanted music. Start with late Other and mid/late Synth, and audition Percussion as well, based on the above numerical observations only.
4. **Selected-stem shimmer processing:** compare processing only suspect stems versus processing all stems. Keep clean stems bit-transparent. Report preset, exact parameters, and stem-level removed-minus-cleaned auditions.
5. **Hybrid:** use local stem attenuation where musically dispensable, and conservative stem-specific shimmer reduction where material must be preserved. Reconstruct and compare at matched levels.
6. **Do not automatically escalate** to dynamic suppression, more aggressive broadband subtraction, dereverberation, or modulation based only on a spectral metric.

Primary decision metric: **blind or level-matched human listening for less objectionable distortion while preserving the horn, ambience, transients, and continuity**. Secondary measures: high-band energy, residual spectrum, phase/stereo image, sample peaks, timing, processing time, and memory.

## Product requirements to evaluate (not implemented as part of this report)

- Per-stem independent **clean bypass**, processor parameters, mute/solo, gain and output selection. Keep untouched stems bit-transparent where possible.
- **Time-local** stem states: mute, attenuate, or stem-specific Clean over an editable interval; short adjustable crossfades at boundaries; reversible edits; clear visual indication of processed regions. Current experimental stem ZIP workspace provides whole-stem mute/solo/gain/Clean, **not confirmed time-local stem automation**.
- A simple “compare mix” audition of Original/Reconstructed, stem-bypass, selective-clean, selective-mute, and hybrid, ideally with loudness-matched A/B and a separate Removed audition. No suggestion to mute based solely on instrument label.
- A **bounded-memory implementation**. One 480-second, stereo, 48-kHz, float32 buffer is **184,320,000 bytes (~176 MiB)**; ten simultaneously decoded stems need ~1.72 GiB before extra versions. The experimental stem workspace documents a **96 MiB compiled stereo buffer budget**. Verify that an eight-minute source is handled by windowing/streaming or gracefully rejected, never through unsafe simultaneous full-stem buffers.
- Worker cancellation, generation guards, source replacement safety and local-only processing remain necessary; no accidental wrong-track exports or unreviewed default changes.
- Regression fixtures: synthetic mixed stems for exact bypass and boundary clicks plus this real-world case for **manual listening acceptance**. Do not put large audio binaries into default automated tests without a deliberate fixture-storage decision.

## Tracking

- **Experiment issue:** [#16, time-local stem muting and selective shimmer repair](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/16). Use it for future listening outcomes, decisions and implementation acceptance.

## Status and caveats

- Measurements are exploratory and tool-assisted. **No complete 8-minute browser clean, full-mix reconstruction acceptance, or blinded listening assessment was performed.**
- The reference algorithm is not a learned defect separator. A sustained harmonic distortion may survive its temporal/spectral outlier suppression; more aggressive filtering could damage the wanted horn.
- Per-stem muting can eliminate an artifact only if the corresponding wanted musical content is absent, redundant, or acceptably sacrificed in that interval.
- SSF development remains stacked and draft: stem ZIP [PR #11](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/11), localized shimmer [PR #14](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/14). Do not merge based on this report. Keep independent review, browser acceptance and real-audio listening gates.

## Resuming from another ChatGPT or Claude session

Read this report, its three companion CSVs, [experiment issue #16](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/16), roadmap #2, native ZIP issue #4, stem workspace PR #11, and localized shimmer PR #14. The ten individual MP3s are on `main`; a native Suno ZIP with those stems may need to be reassembled for the ZIP importer. Validate synchronization and file integrity before comparing mixes. First task: listen to three strategically chosen intervals with per-stem solo and stem-bypass, then implement or prototype the **smallest reversible, time-local stem edit** that gives a meaningful perceptual improvement. Do not treat these numerical findings as a proven diagnosis or a feature acceptance.
