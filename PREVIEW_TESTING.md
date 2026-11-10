# SSF v5e online preview and Auto Clean acceptance

**Open the test site directly:** https://gsgrimoire.github.io/GS-SunoShimmerFree/preview/

This online page is a *separate experimental preview*, not the released application at the root. No Python, terminal, ZIP extraction or local server is needed. The preview is a pinned snapshot of the branch listed in the page's test-build metadata, and can be updated independently of the unmerged draft pull requests.

## Test Auto Clean first

1. Open the preview in your normal desktop browser and upload **one standard Suno WAV or MP3**, preferably a track with a noticeably crackling, clipped or harsh drum passage. The native Suno multi-stem ZIP format is **not accepted** yet.
2. The page initially uses its normal manual/default Cleaned path. Once the track has loaded and initial cleaning has finished, click **Analyze & Auto Clean** in the left settings panel.
3. Read the resulting **Why these settings?** report. It records how much audio was sampled and which indicators appeared, including flat-topped waveforms, abrupt click-like sample changes, quieter high-frequency energy and low-mid buildup.
4. If there is an indicator of cleaning the algorithm can conservatively address, it reprocesses the Cleaned track. For low-mid buildup it also produces a mild Polished version. Wait for the status to say finished.
5. Listen to Original versus Cleaned/Polished at **matched perceived loudness**. Inspect whether the particular drum sound improved, stayed the same, or got less natural. Test export in lossless WAV first.
6. Try the same button on an already-clean track. It should prefer **no change** rather than aggressively processing clear material.
7. Try clicking Auto Clean, then changing a manual slider or replacing the track while it is analyzing. The outdated diagnosis must not change controls, process the wrong source, or replace the new track's audio.

### Limits of an automatic diagnosis

This analyzer samples at most 16 distributed windows and does **not** isolate drum stems or listen as a human does. Flattened peaks can mean clipping, limiting or a deliberate effect. Sharp clicks can be real audio damage or legitimate percussion. It cannot reliably reconstruct a clipped waveform, reverse missing MP3 information, or remove all distorted drum artifacts. The button therefore does not automatically engage **dynamics, transient emphasis, presence boost or loudness normalization**, especially on suspicious material. A report that says no safe automatic repair is recommended is not a processing failure.

## Verify the earlier features as well

- Compare Natural, Clear, Warm and Forward, then try Punchy (experimental) with Transient Emphasis at 0 versus 35%.
- Try the optional loudness targets of -18, -16 and -14 loudness units relative to full scale, understanding that the target can be limited by available sample-peak headroom.
- Check Original, Cleaned, Polished and Removed version switching during playback.
- Split, crop, add section gain and fades, undo/redo, and confirm the **before-edits** loudness warning does not claim to represent the final export.
- Download pristine and edited WAV and MP3. Test that the downloaded audio can open and that the export does not secretly reflect an outdated preset.

For a useful assessment, compare at least three Suno tracks: one with a clipped/crackling drum, one with hiss or shimmer, and one already clean. Report which setting was selected, the problem you heard, whether automatic cleanup helped, and any unexpected changes to cymbals, bass, dynamics or stereo balance.

All four earlier Sound Polish pull requests and the new Auto Clean increment remain **draft and unmerged** until code review and real-browser/level-matched listening acceptance. The online preview uses a separate static snapshot under /preview/, leaving production application files untouched.
