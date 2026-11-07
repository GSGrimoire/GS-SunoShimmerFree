# SSF v5a browser acceptance and regression matrix

**Status:** draft PR #3; independent reviewer and user listening acceptance required before merge.  
**Reviewer:** ChatGPT Reviewer-A. **Implementer:** ChatGPT Coder-A.  
**Review scope:** clarity/presence Sound Polish only. Stem ZIP import (issue #4) is future scope.

## Prepare

1. Check out branch `feature/sound-polish-v5a` and serve over localhost (for example `python3 -m http.server 8000`). This allows workers to run. Also separately open the HTML as a local file to exercise worker fallback.
2. Test at least one mono and one stereo WAV, and one Suno MP3. Use synthetic audio for technical checks and private user tracks only in local testing; do not push private stems to GitHub.
3. Open browser developer tools and note JavaScript errors, audio glitches, console warnings, and sustained memory consumption.

## Core flows

| Test | Steps | Expected |
|---|---|---|
| Load/clean | Import WAV and MP3; run default cleaning | Original, Cleaned, Removed available; original cleanup still works |
| First polish | Select Natural; click Polish cleaned track | Polished becomes available and auto-previews unless listener changed mode during processing |
| Preset changes | Change to Forward but do not reapply | Old Polished audio may be played, but **download is disabled** while controls differ from the rendered version |
| Re-polish/download race | While re-polish is running, rapidly click Polished download (WAV and MP3) | Cannot export old preset under new preset; no stale file generated |
| Export cancellation race | Start a Polished MP3 export, then change preset and start re-polish | Older export is canceled; late worker completion must not download |
| Mode preservation | Start polish, switch to Original while worker runs, wait for completion, both paused and playing | Stays on Original; no forced switch to Polished; playback can continue |
| Autoselection | Start polish, make no mode change | New Polished selected when processing finishes |
| Re-clean success/failure | Change cleaning settings and click Clean track while Polished exists | Polish button and Polished downloads disabled while cleaning; old Polished invalidated; on success new Cleaned usable; on error retained Cleaned may be polished again |
| Rapid replacement | Start polish then import a different source before completion | Old worker result ignored; no stale download/recovered old version |
| Version switching | Test keys 1, 2, 3, 4 and radio buttons during and after playback | Original, Cleaned, Polished, Removed selected in that order without losing playback position |
| Edits | Split, cut, crop, change section gain, add fades; export Cleaned and Polished | Editing applied identically to exported timeline; no click artifacts at joins |
| WAV download | Export pristine and edited Polished as 16/24/32-bit WAV | Valid files and expected samples; no silent clipping; proper filename |
| MP3 download | Export pristine and edited Polished at 192/256/320 kilobits per second | Valid files, expected length with MP3 delay, audible quality, proper filename |
| Local fallback | Open directly as `file://` with blocked workers | Cleaning and Polish fallback paths work; MP3 may require worker-capable hosted server |
| Browser/mobile | Desktop Chrome/Firefox/Safari as available and narrow viewport | Settings and Polished row accessible, no unreachable controls |

## Listening checks

Compare Original, Cleaned and Polished at **matched perceived loudness** on multiple Suno tracks, including one already clean, one muddy/distant, and one shimmer-heavy/percussive track. Test Natural, Clear, Warm and Forward. Record whether clarity improves separation, presence introduces vocal harshness, and shimmer becomes more pronounced. A louder rendition is not automatically better. Subjective results cannot be established by numerical tests.

## Automated baseline

Run the following before merging:

```bash
node tests/polish_test.js
node tests/polish_integration_test.js
node tests/mp3_test.js
```

The integration test exercises the actual `app.js` source with a synthetic document, workers and audio. It verifies state transitions and export-event identity, but **does not replace real browser audio playback or actual downloads**. The MP3 test uses genuine codec output and independent FFmpeg decoding.

Review feedback and final approval should be posted on [draft pull request #3](https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/3). Do not merge solely on a passing continuous integration run.
