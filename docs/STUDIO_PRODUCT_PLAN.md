# SunoShimmerFree Studio: product and engineering development plan

**Owner directive:** 20 November 2026. **Plan status:** proposed specification, not a feature/release claim.  
**North star:** a full local-first automated music studio with inspectable, reversible, human-controllable processing.  
**Target:** candidate for Monday morning, **23 November 2026, Europe/Copenhagen**, with shipping conditioned on real verification.  
**Tracking:** [Studio initiative #18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18), [existing tool roadmap #2](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/2), [Viking stem repair #16](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/16).  
**Agent operating contract:** [SSF_AGENT_GATE.md](SSF_AGENT_GATE.md).

## 1. Product definition and experience

The user should be able to build a song from an existing mix or a Suno-native stem export, receive useful recommendations, edit the result, and export reproducible music. SunoShimmerFree (SSF) is **not** a music-generation model or a replacement for generation features; it is a **post-production and multitrack studio** for user-provided audio. No subscription-only Suno account, remote server, or proprietary paid application is a required dependency.

### Primary workflow

1. **Import:** drag and drop a single song in WAV/MP3, a native Suno stem ZIP, or a collection of compatible stems; inspect names, duration, sample rate, channel count, alignment and extraction uncertainty. Source audio never changes.
2. **Analyze before editing:** bounded sampling of the full mix and each stem. Show quality indicators for possible hiss/shimmer, clipping, click-like events, frequency balance, dynamics, loudness, timing mismatches and peaks; distinguish observations from hypotheses and confidence. Do not equate treble energy with shimmer.
3. **Repair proposal:** preview safe suggestions, including clean a stem, attenuate or mute a selected region, adjust tone/dynamics, or do nothing. Choose bypass on clean stems. Never silently delete musical material.
4. **Automatic first pass:** one explicit, non-destructive **Auto Improve** action applies only eligible, bounded changes and records an undoable recipe. A/B at comparable loudness with listening checks and a Removed/residual audition; provide explanations when no safe automatic correction exists.
5. **Manual studio:** multitrack synchronized timeline, trim/split/move/region operations, fade/crossfade, per-stem gain/mute/solo, optionally pan, selected-stem cleanup, effect chain controls, automation lanes and history.
6. **Mix and master:** locally render the adjusted mix, measure peak/headroom, provide gentle optional finishing, and compare with the original.
7. **Export and reopen:** stereo WAV and MP3 as supported, optional stem exports, a portable text project recipe manifest, and eventual reopen/resume where the browser allows. No data upload unless explicitly introduced, justified and approved as a separate architecture decision.

### Product principles

- **Default safe and transparent:** suggestions are not verdicts; audio improvement is decided by meaningful listening, not a scalar metric. A healthy track should remain unchanged.
- **Manual control is first class:** every automatic decision must appear in the same editor as human decisions, including where it occurs, strength, bypass, and undo.
- **Local, privacy-conscious, accessible:** no network upload of music; accessible controls, keyboard support, responsive layout and clear progress/cancel.
- **Non-destructive and reproducible:** source media immutable; rendered variants are derived. Save effect names, version, parameters, time ranges, reference levels and source fingerprints.
- **Competitive experience without false promises:** do not imply the browser can demix source stems better than Suno or restore clipped/lossy material with certainty; never imply that v1's static/shimmer mask removes sustained harmonic corruption by default.

## 2. Audit of current baseline (as of 20 November 2026)

| Capability | Evidence/status |
| --- | --- |
| Single-track browser clean, editing and WAV/MP3 export | Present in production `main`; independently inspect deployed runtime before relying on it |
| Static and shimmer processing | `engine.js`, conservative frequency-mask methods; not equivalent to full audio restoration |
| Optional tone polish, dynamics, loudness and transients | **Draft stacked** pull requests [#3](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/3) → [#6](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/6) → [#8](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/8) → [#10](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/10); no blanket released claim |
| Automatic quality diagnostics and localized shimmer | **Draft** [#13](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/13) → [#14](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/14), on the Sound Polish stack |
| Native ZIP/stem workspace, per-stem whole-track mute/solo/clean/polish/mix | **Draft** [#11](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/11), based on #8 |
| Passage-specific stem attenuation and short previews | **Draft** [#17](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/17), based on #11; tests green at last recorded code head, real-browser audio not accepted |
| Real extreme case | [Ten Viking MP3 stems](https://github.com/GSGrimoire/GS-SunoShimmerFree/tree/main/example-files/viking-shimmer), 8 minutes each; structural evidence and measurements in [research note](research/epic-viking-ambience-stem-aware-shimmer-2026-11-20.md) and issue #16 |
| Long-song memory handling | **Blocking**: current mix workspace has 96 mebibyte compiled stereo limit, while 8-minute float32 stereo at 48 kHz is 176 mebibytes **per buffer** |
| Studio project persistence / effect automation / true full-length multitrack render | Not established. No released complete studio |

**Important:** Different feature drafts stack on different bases. Reading only `main` will understate existing work; merging them out of order risks lost fixes, duplicate logic and deployment regressions.

## 3. Technical architecture

### 3.1 Immutable project and operation graph

Introduce a versioned **project manifest** (data, not embedded media) with:
- Project ID, schema version and tool version.
- Source references, original file digests, format, native sample rate, channels, exact decoded frame count, validated alignment offset or explicitly unresolved sync warning.
- Track ID, source ID, source interval, timeline start, gain/pan (if implemented), enabled/mute/solo, original/clean/polished variants, effects and bypass state.
- Ordered **non-destructive operations** and automation regions (time range, target track, attenuation or effect value, fades and duration).
- An explicit **master bus** recipe (mix gain, optional polish, loudness target and ceiling), export settings, analysis references and change log/history.
- A render fingerprint from sources + ordered transforms + processor versions and params, not from file names alone.

The project stores intent separately from any cached floating-point audio. Undo/redo manipulates immutable edit transactions. A reset or project close must cancel all stale generation jobs and free references.

### 3.2 Bounded media pipeline

`Input/ZIP inspector → Media decoder/readers → Source-alignment layer → bounded segments → analysis → per-track chain → timeline mixer → master bus → preview or streaming export`

- Use **sample-frame time** internally; convert displayed seconds only at boundaries. Handle resampling and fractional offsets deliberately.
- Maintain one or a few **bounded decoded chunks** plus a small playback cache. Avoid `ten stems × full-length float32 × multiple versions`. Memory budgets must account for raw compressed files, decoded channels, worker transfers, Web Audio buffers, output and encoder state, not just the compiled mix.
- MP3 decoding may still materialize whole tracks through browser `decodeAudioData`: prototype true bounded decode or an explicit alternative before promising full-length ten-stem support in memory-constrained browsers. Do not conceal memory spikes by limiting only the final mix buffer.
- Prefer shared deterministic signal-processing units for preview and export, with context/overlap at edit and spectral boundaries. Gain automation, fades, and mixing should not need re-decoding at every slider change.
- Use worker cancellation, source generation/abort fencing and stale export checks. Stop gracefully on unsupported formats, rates, corrupt archives or quota errors.
- ZIP parsing retains current security checks: traversal, symlinks, encrypted entries, CRC, inflated-size/ratio limits, duplicate stem variants and path canonicalization.

### 3.3 Quality assistant and decision engine

**Measure → rank candidates → preview → accept → track recipe.** Keep measurement code separate from the user-facing recommendation policy.

- Measurements: quiet/active loudness, high-frequency energy by time and by stem, flat-top samples, clicks, crest factor, transient preservation, stereo correlation, audio-duration and stem-mismatch confidence.
- Distinguish hiss, spectral shimmer, sustained distortion, source-separation leakage, reverberation and ordinary cymbal/harmonic brightness. Where the evidence is ambiguous, say **unknown** and choose bypass.
- Generate **candidate edits**, not irreversible commands. Examples: late Other stem attenuate -3 dB; Other 462–474 s mute; shimmer-only clean selected stem; full mix pass at conservative settings; no action.
- Evaluate both residual quality and **content preservation**. A 4 dB reduction in high-frequency energy accompanied by a 6 dB drop in overall musical level is not a free win.
- Every automatic suggestion must cite source windows, exact settings and expected trade-offs; users can compare original, proposed, accepted and removed content.

### 3.4 Studio timeline and user interface

- Timeline ruler/zoom, playhead, selection, scrubbing, snap (optional initially), loop selection and marker navigation.
- Synchronized track strips for all stems; waveform preview, name, audible state, level, solo, mute, effects state and clipping.
- Region actions: add/move/trim/split/duplicate, fade in/out, crossfade, region gain, reversible timed mute, per-region cleaning if the processing backend supports it.
- Track actions: independent gain/pan, solo/mute, selective Clean and Sound Polish; multiple intervals per stem after one-interval prototype passes review.
- Version audition: Original, Proposed, Cleaned, Polished, Final, Removed; synchronized level-matched A/B wherever meaningful.
- Accessibility: explicit labels, keyboard and screen-reader use, busy/cancel states, visible errors and progressive disclosure of advanced controls.

### 3.5 Render, export and persistence

- Rebuild precisely from project operations. Validate 16/24/32-bit WAV formats, MP3 bitrate and resampling, clipping warnings, stereo preservation and decoder/encoder delay limitations.
- Do not export an obsolete render after source replacement or edits. Test multiple concurrent operations, browser tab suspension and cancellation.
- A portable, schema-validated JSON recipe plus media re-link (file digest check) is a first persistence step; consider local browser storage only after quota/retention/privacy review.
- Do not silently persist entire audio in remote systems. Public example-files are test fixtures, not permission to upload user projects.

## 4. Incremental delivery map

| Milestone | Sequenced work | Definition of done |
| --- | --- | --- |
| **S0: stabilize baseline and trust** | Inventory draft PR dependencies, read actual source, run relevant suites, get **independent review of #17** and any required predecessor; check deployed vs preview separation | No contradictory branch claims; pinned findings and pass/fail; defects logged with owner; production remains stable |
| **S1: project and timeline kernel** | Versioned manifest; source/track IDs; precise timeline regions; immutable operations; deterministic undo/redo | Synthetic stereo alignment, bypass identity, split/trim/fade invariants, version compatibility tests |
| **S2: multitrack memory-safe engine** | Segmented decode, bounded cache and worker jobs; frame-aligned processing and mixing; streaming or bounded export path | Eight-minute Viking 10-stem import and long-form mix without memory exhaustion in documented target browsers; graceful unsupported browser fallback |
| **S3: automated quality assistant** | Bounded diagnostics, conservative per-stem and passage recommendations, explainable one-click preview and undo | Clean source bypass, synthetic corrupted sources, confidence calibration and no unauthorized destructive change |
| **S4: studio editing experience** | Synchronized multitrack timeline, regions, multiple fades, per-track effects, audition and undo | Real-browser import/play/edit/export across track replacement, crossfades and effects; accessibility checks |
| **S5: master and reopen** | Master bus, measured loudness/headroom, export options, recipe save/relink | Pixel-independent audio reproducibility checks, target loudness honest, deterministic project reopen |
| **S6: harder studio tools** | Pan/buses, richer effects, batch workflows, reference mastering, arrangement/tempo tools, user-designed presets | Feature-level contracts and fresh review; do not couple to first release |

S0–S5 constitute the **full studio end-to-end target**. They are deliverables, not an assertion they can all be finished in one weekend. S6 is breadth beyond the first complete version.

## 5. Monday candidate: prioritize a vertical slice, not a demo façade

**Internal morning checkpoint:** Monday, 23 November 2026, Copenhagen local time. An exact publication hour has not been specified.

### Priority order between now and the checkpoint

1. **Review current risky draft chain**, starting with #17 independently, and avoid broad speculative rewriting. Determine the minimum safe branch integration path.
2. **Working studio vertical slice:** local source import → analyze → preview a recommended safe setting → multitrack selection/edit → mix → export, with original preserved. Surface which subfeatures remain manual.
3. **Length and memory:** make the Viking eight-minute recording a hard acceptance case, or label preview-only excerpt support accurately and keep full-studio launch blocked.
4. **Actual-browser and listening:** confirm no wrong-source export, timing shifts, click at passage boundaries, song-element loss or runaway memory. Compare late Other, Synth and Percussion against baseline and conservative selected-stem cleaning.
5. **Only after those gates:** independent pinned-head approval, explicit merge authorization under repository rules, deployment to a separate preview, and real deployment smoke test. Do not equate GitHub Actions success with audible repair.

### Decision at the deadline

- **Full studio release:** only if S0–S5 and the release gates are actually satisfied.
- **Studio Preview / Alpha:** if a smaller complete usable workflow passes its own criteria but full-studio requirements remain open. Clearly label missing capabilities, keep existing production tool stable, and do not represent it as the full product.
- **Hold:** if long-track memory, source integrity, security, clip/export correctness or independent review is unresolved.

A fixed date cannot substitute for audio listening or independent source review. The user owns subjective musical acceptance and any explicit holds.

## 6. Test matrix

| Layer | Required checks |
| --- | --- |
| Parser / import | Malformed and encrypted ZIP, unsafe paths, CRC, decompression bombs, duplicate WAV/MP3, Unicode labels, file type sniffing, missing/corrupt stems |
| Signal quality | Clean bypass identity, mono/stereo, phase coherence, intentional silence, impulsive transients, harmonic sustains, stereo balance, shimmer versus wanted treble |
| Timing | Decoded MP3 padding, WAV alignment, source-to-preview frame accuracy, crossfade and crop boundaries, rate mismatch, track solo/mute and sample-accurate export |
| Memory and concurrency | Eight-minute 10-stem fixture, worst-case temporary allocations, cancellation, stale worker response, tab close/reopen, export while editing |
| Studio state | Non-destructive operations, undo/redo, manifest validation/migration, re-linked media integrity, no destructive auto-mute |
| Audio output | WAV and MP3 formats, output sample rates, clipping/headroom, fidelity versus rendered preview, labels and correct source selection |
| Acceptance | Cross-browser manual smoke tests, keyboard navigation, independent review at current pinned head, blind or level-matched listening on Viking example and a clean control |

Measurements and screenshots must be attached to an issue or documentation in GitHub; an isolated chat is not a project record. Automated test files should be synthetic where feasible; the public Viking fixture is a **manual acceptance** test and must not be duplicated into further artifacts without purpose.

## 7. Current blocking questions and explicit non-goals

**Unverified now:** compatibility of the entire stacked PR chain; production preview release path; true bounded per-stem MP3 decoding; full-length 10-stem mix/export; live keyboard/timeline interaction; reliable automatic detection of sustained harmonic corruption; level-matched listening acceptance.

**Do not:** alter the production site before release gates; enable server upload; expose private music; auto-delete stem content; relabel frequency reduction as perceptual improvement; merge an author's draft before required independent review; claim a Monday full release solely because code exists.

## 8. Ownership, planning and handoffs

- **ChatGPT-1, Coder:** owns implementation branches, targeted regressions and a complete pinned review packet.
- **ChatGPT-2, Independent Reviewer:** different session, reads actual code and evaluates risks/defects. Reviewer does not repair its own reviewed code.
- **Human owner:** final musical listening judgment, architecture decisions that materially change product scope, and explicit release holds. Do not create unnecessary owner-only tasks if existing issues cover the work.
- **Release gate operator:** only after review, merge ordering and user acceptance; do not assume role labels imply distinct GitHub identities.
- **Source of truth:** this plan, issue #18, [SSF_AGENT_GATE.md](SSF_AGENT_GATE.md), the currently open PR graph and their pinned handoffs. For the experimental repair, consult #16 and PR #17.

**Start the next session with:** #18 → this plan → agent gate → PR graph → a single claimed priority. The first priority is independently reviewing PR #17, not adding a seventh untested audio effect.
