# Independent Reviewer-B handoff: native Suno stem ZIP, v6 draft

**Pull request:** https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/11
**Feature branch:** feature/native-suno-stem-zip-v6
**Stacked base:** feature/sound-polish-v5c-loudness, draft PR #8
**Related issue:** https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/4

## Assignment

Independently review actual feature-branch source and code paths for local ZIP imports, safety and audio processing. This is a separate review: treat the implementer's claims and synthetic tests as evidence to challenge, not proof. **Do not merge, approve browser acceptance without testing, or upload private Suno audio.**

Read docs/STEM_ZIP_ACCEPTANCE.md, compare the branch with its stacked base and inspect:

- stem-zip.js: central directory, bounds, traversal, ZIP64/multidisk/encryption/symlink rejection, CRC, decompression-bomb controls, WAV/MP3 variant grouping, Unicode filenames, allocation.
- stem-ui.js and stem.css: DOM security, asynchronous cancellation, worker replacement, accessibility, AudioContext lifecycle, MP3 decoding, mute/solo, mix math, mismatch warnings, memory, playback and export.
- stem-audio-worker.js: sequential processing, transferable buffer ownership, cleaning/Polish calculations and memory.
- app.js and index.html: ZIP drop routing and regressions in the existing single-track workflow.
- tests/stem_zip_test.js, tests/stem_ui_test.js and the workflow file: test coverage and missing cases.

## Required high-risk reproductions

1. Synthetic ZIP with WAV and MP3 variants for a single stem, then 11 MP3-only stems, arbitrary Unicode names and nested paths.
2. Unsafe paths, symlinks, duplicate names, compressed-size lies, encrypted data, corrupt CRC, unsupported method, overlapping entries, ZIP64 and excessive archive sizes. Confirm no unsafe writes or audio uploads.
3. Slow decode/process, then load a new ZIP or cancel. Check stale messages and exports cannot override the latest source.
4. Mixed WAV/WAV, MP3/MP3 and WAV/MP3 samples at differing native rates and lengths. Do not trust MP3 metadata durations. With the explicit override, verify start alignment and end pad/truncate, never hidden temporal shifting.
5. All selected stems processed sequentially, not cached. Test a >200-second multistem project, measure peak browser memory, and verify the 96 MiB stereo mix cap.
6. Enable/mute/solo, per-stem gain and processing, individual preview and mix export; independently verify numerical sums and stale preview invalidation.
7. WAV float, integer WAV and MP3 exports; validate clipping warning, decodable output, channel count, duration and real playback.
8. Hosted Chrome, Firefox, Safari and a mobile browser; file picker and drag/drop, raw-DEFLATE, web workers, modal keyboard behavior, and unchanged full-track editing.

## Private reference fixture

The uploaded *The Greyseam Hum Stems.zip* is **not** included in GitHub. Structural metadata was inspected locally: eleven root-level MP3 stems, stereo at 48,000 samples per second, with **8,502 MP3 frames each** according to an independent frame-count scan. Basic FFprobe container-duration estimates differ greatly between stems, so do not assume metadata times represent decoded audio or precise encoder alignment. Confirm actual browser-decoded sample lengths and listen for startup delay. **Do not commit or upload the private archive or its extracted audio.**

## Evidence and known limits

The Sound Polish checks workflow runs synthetic stem ZIP safety and workspace tests, plus tone, dynamics, full-track integration, loudness/FFmpeg, MP3 encoding and editing regression checks. Browser-like integration uses simulated document and worker objects, not actual browser playback.

This is a sequential, local memory-bounded reconstruction workspace, not an advanced multitrack time-shifting editor. Equal MP3 encoded-frame counts do not establish exact acoustic alignment.

## Review deliverable

Post a severity-ranked independent GitHub review on PR #11: Critical, High, Medium and Low findings with exact source references, reproducible evidence and fixes. Distinguish executed commands from inferred behavior. Keep all pull requests draft and unmerged until separate real-browser and level-matched listening acceptance is complete.
