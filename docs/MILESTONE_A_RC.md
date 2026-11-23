# Milestone A release candidate: excerpt multi-stem preview

**Candidate branch:** `claude/milestone-a-acceptance-gate`. It is a fast-forward of PR #47 (`feature/stem-webcodecs-mp3-frame-decoder-v1` at `42df674`, which already contains #3, #6, #8, #11, #42, #43, #44, #45 and #46).
**Scope (issue #18, milestone A):** local ZIP import of Suno stems, a selected passage previewed with all stems in sync, gain/mute/solo and reversible time-local attenuation with 20 ms fades, and export of that passage as 32-bit float WAV. Not in scope: full-song MP3 mixing or export (#48), Polish and cleaning claims, AI, persistence.
**Status:** candidate for independent review. Not approved, merged or deployed.

The exact commit is the head of the candidate branch. Every result below is pinned to the SHA it ran on; re-run the gate on any later commit.

## 1. Executable gate (one command)

```
git checkout <candidate sha>
# fixtures live on main; the stack predates them
mkdir -p /tmp/vk && for f in "0 Lead Vocals" "1 Drums" "2 Bass" "3 Keyboard" "4 Percussion" \
  "5 Strings" "6 Synth" "7 Other" "8 Brass" "9 Woodwinds"; do
  git show "origin/main:example-files/viking-shimmer/$f.mp3" > "/tmp/vk/$f.mp3"; done
SSF_VIKING_DIR=/tmp/vk node tests/run_acceptance_gate.js
```

Requires Node 22 and FFmpeg 6 (Chrome's WebCodecs MP3 decoder is FFmpeg's mpegaudio decoder). It runs every `tests/*_test.js` with `SSF_REQUIRE_FIXTURES=1`, so nothing passes by skipping, and it prints the commit, the tool versions and one PASS/FAIL line per suite. Exit code 0 only if all suites pass, no suite prints a SKIP line, and the checkout is a clean git checkout with a known commit. A dirty or unknown revision still runs every suite but ends `GATE INVALID` with exit code 2, because the result cannot be pinned to a SHA (`tests/acceptance_gate_test.js` checks this).

CI (`.github/workflows/sound-polish.yml`) runs the same gate: it installs FFmpeg first, extracts the ten Viking stems from main commit `c6b882c` into `/tmp/viking-shimmer` (outside the checkout, so the tree stays clean), sets `SSF_REQUIRE_FIXTURES=1`, and runs `node tests/run_acceptance_gate.js`. A green step therefore means every suite printed PASS; read the gate's output in the job log, which includes the parity and acceptance results.

| Suite | What it proves |
|---|---|
| `milestone_a_acceptance_test.js` | The real 8-minute, 10-stem Viking ZIP through the real `stem-zip.js`, `stem-mp3.js`, `wav.js` and `stem-ui.js` (browser shell simulated). Each preview is compared with an independent reference mix built from complete FFmpeg decodes: 462–474 s with all stems; -6 dB gain, mute, 100% and 50% attenuation with fades; solo; cancel on stem 4 then rebuild. The 32-bit float WAV export is decoded back and must be bit-identical to the preview. Full-length MP3 and out-of-range passages are refused with clear messages. |
| `stem_mp3_ffmpeg_parity_test.js` | 80 passages × 10 stems: indexed seek is bit-identical to a full decode. |
| `stem_mp3_test.js`, `stem_wav_passage_test.js`, `stem_zip_test.js`, `stem_ui_test.js`, `stem_resample_test.js` | Framing, reservoir, CRC, gapless metadata, cancellation, hostile WAV and ZIP inputs, workspace state. |
| `mp3_test.js`, `polish*`, `dynamics`, `loudness` | Existing single-track and Polish behaviour unchanged. |

Negative controls: halving the fade length fails the acceptance test (difference 0.079); the head without the range-error fix fails it on the out-of-range message; removing the seek pre-roll fails the parity test.

## 2. Real-browser gate (no install)

Open on the preview site (see #18):

`https://ssf-preview.goofyspook.workers.dev/b/<candidate sha>/tests/browser/milestone-a.html`

It runs in the browser's own WebCodecs decoder and fetches the public Viking stems from `/main/`. Nothing is uploaded. It checks each stem's 462–474 s seek against a full decode from frame 0, that all stems share one timeline, that abort settles as cancelled and the decoder works again, and it reports the Chromium heap. The verdict line reads `PASSED: all 15 checks` or names the failures.

Then the manual part, at `https://ssf-preview.goofyspook.workers.dev/b/<candidate sha>/`:

1. Zip the ten Viking stems from `example-files/viking-shimmer` on `main` (any zip tool) and import the ZIP.
2. Set preview start 462 and end 474. Build. Play. Expect all ten stems in sync with no clicks at the start or end.
3. Mute Other from 465 to 470 at 100%. Build and play. Expect a smooth 20 ms fade out and back in, with no click.
4. Export as 32-bit float WAV. Open it in any editor. Expect 12.000 s at 48 kHz, matching what you heard.
5. Start a build and press Cancel processing at once. Expect "Processing cancelled", export disabled, and a later build that works.
6. Set end 0 (full length). Expect a clear refusal for MP3 (milestone A is excerpt-only).
7. Keep Chrome's Task Manager open (Window → Task Manager) and note the tab's memory at its peak.
8. Load and use the single-track tool once. Expect it unchanged.

## 3. Measured results and limits

| Measure | Result | Where |
|---|---|---|
| Seek parity, 10 stems at 462–474 s, real Chrome 156 (desktop) and 157 (cloud) | max abs difference 0; one output per frame; no timestamp gaps | PR #47 evidence comments; browser page |
| Seek parity offline, 80 passages | max abs difference 0; max pre-roll 12 frames | parity suite |
| Seek time per 12 s stem, Chrome | about 0.46–0.56 s (a full feed takes about 1.6 s) | browser page |
| Abort during decode, Chrome | settles as cancelled in about 35 ms; decoder works again | browser page |
| JavaScript heap, Chrome (10 stems sequentially) | 5 → 33 MiB peak | browser page |
| Preview vs 32-bit float WAV export | bit-identical | acceptance suite |

Known limits for the candidate (disclosed in the UI):

- MP3 is excerpt-only; full-length MP3 decode is refused to protect memory (#48 is the follow-up).
- The whole compressed ZIP entry is held in memory during a build (about 10–20 MB per stem for the Viking set).
- Native decoder memory is not measured by any automated check. Chrome's Task Manager reading (step 7) is the evidence.
- MP3 timing follows the decoder-output timeline: encoder delay is not removed, identically for every MP3 stem. Mixing MP3 with WAV stems stays blocked.
- Firefox and Safari WebCodecs MP3 support is untested. The workspace probes support and refuses cleanly if it is missing.
- Fades and attenuation have been checked numerically against the documented rule, not by ear.

## 4. Pass/fail checklist for release

Each line is PASS or FAIL against one exact SHA.

- [ ] `node tests/run_acceptance_gate.js` prints `GATE PASSED` on a clean checkout of the SHA
- [ ] Browser page prints `PASSED: all 15 checks` in desktop Chrome on the SHA
- [ ] Manual steps 1–8 behave as described (owner)
- [ ] Level-matched listening at 462–474 s: Other, Synth and Percussion are no worse than the original, and the attenuated region fades cleanly (owner)
- [ ] Peak tab memory noted and acceptable (owner)
- [ ] Independent Full review of the SHA by a session that did not write the code
- [ ] Security gates in #36 that apply to a preview release are satisfied
- [ ] Owner authorizes merge (merge commits, bottom-up) and deployment

Any FAIL blocks the release. A minor, disclosed beta defect may be accepted by the owner. Regressions to the single-track tool, privacy failures, unsafe archives or preview/export mismatch may not.
