# GS SunoShimmerFree

Automatic static and shimmer removal and optional sound polishing for AI-rendered music.

**Use it in your browser:** https://gsgrimoire.github.io/GS-SunoShimmerFree/

Drop in a WAV or MP3, flip between Original, Cleaned, optional Polished, and Removed without losing your place in the song, adjust the settings, trim and tidy the arrangement, and download a WAV or MP3. Everything runs locally in the browser tab, so your track is never uploaded. A four-minute stereo song takes about 15 to 20 seconds to clean on a typical laptop.

## What it removes

**Static.** The fluctuating broadband hiss that sounds like a radio between stations. This stage follows the adaptive spectral denoise method shared on r/SunoAI: a noise profile is learned from the quietest frames of the whole track and subtracted gently below 350 Hz, conservatively through the midrange, and most firmly in the top octaves. The gain mask is smoothed over time and frequency so it does not pump or leave "musical noise". Frames of digital silence (fade-ins, tails) are skipped when sampling, because they would otherwise teach the profile that the static is zero.

**Shimmer.** The glassy, sparkling grain on cymbals and in the air above the mix. Above a chosen frequency (4 kHz by default), each time-frequency cell is compared with the median of its neighbours in time and in frequency. Sustained notes match their time neighbours and drum hits are broadband, so real music passes one of the two tests. Grain is brief and narrow, so it stands above both and is pulled down toward its surroundings. A transient guard raises the time reference whenever the whole band jumps at once, so drum hits are not mistaken for grain. On a dense test mix the defaults removed about two thirds of the grain cells while cutting drum onsets by about half a decibel.

Both stages share one gain mask across all channels, so the stereo image does not move, and the original phase is kept. No EQ, compression, limiting or normalisation is added. The **Removed** track is simply Original minus Cleaned: listen to it to check that only hiss and grit came out. If you can hear the melody in it, turn something down.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Remove static | on | Turns the static stage on or off |
| Strength | 1.00 | How hard the sampled hiss is subtracted (0 to 2) |
| Deepest cut (static) | 7 dB | The most any single frequency is turned down |
| Leave bass alone below | 350 Hz | Kick and bass under this are barely touched |
| Noise sample | 12% | Share of the quietest frames used as the hiss sample |
| Shimmer amount | 60% | Zero turns the shimmer stage off |
| Deepest cut (shimmer) | 6 dB | The most a single fleck is turned down |
| Shimmer starts at | 4 kHz | The stage fades in from here to 1.5 times this |

## Sound Polish (v5a)

After cleaning a track, use **Sound Polish** in the left settings panel to generate an optional **Polished** version. The original and cleaned versions remain untouched and available for comparison. Polish processing is off until you press **Polish cleaned track**.

The current release has two conservative tone controls:

- **Clarity (0 to 100%)** gently cuts the low-mid range around 320 Hz (up to 3 decibels), which may reduce a muddy or distant impression.
- **Presence (0 to 100%)** gently boosts the upper mids around 2.5 kHz (up to 2.5 decibels), which may bring vocals and instruments forward. Use restraint if the track is already harsh.

Presets: Natural, Clear, Warm, Forward, or Custom. All controls use identical filter coefficients across channels and apply linked sample-peak safety attenuation when an enabled process would exceed 97% of digital full scale. **This is not loudness normalization, dynamic compression, transient restoration, or dereverberation.** It cannot reconstruct information missing from the Suno mix.

The **Polished** row can be played and downloaded in WAV or MP3, using the existing non-destructive timeline edits. Switching versions keeps the playback position. The spectrogram currently displays the **Cleaned** version even while Polished is selected; it is not a spectrogram of the final polished audio.

For algorithm tests (requires Node 18 or newer):

\`\`\`
node tests/polish_test.js
\`\`\`

Development roadmap and agreed scope: [Sound Polish, quality assistant, and stems](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/2). Next: gentle dynamic control, measured loudness and safe optimization, then transient enhancement. Future stem-aware workflows are exploratory.

## Sound Polish dynamic control (v5b, development)

The next optional stage extends the **Polished** version with a **Dynamics** slider. At 0%, dynamics processing is bypassed; Natural retains 0%, while Clear, Warm and Forward include modest preconfigured amounts. A 100% setting is the highest supported compression, not an automatic recommendation.

The linked compressor uses a smoothed root-mean-square envelope across channels, a soft knee, approximately 25-millisecond attack and 220-millisecond release. It applies the **same instantaneous gain** to all channels, avoiding stereo balance shifts. The threshold varies between approximately -12 and -16 decibels relative to full scale; the compression ratio varies between 1:1 and 1.8:1. This is intentionally a gentle *level-smoothing* control, not transient enhancement or dereverberation. There is no automatic makeup gain. The existing peak-safety adjustment remains in place and the input audio is not overwritten.

Use the existing Polished playback and WAV or MP3 download row. You must click **Polish again** after changing settings; downloads of a Polished version with mismatched controls are disabled. Dynamic control should be evaluated through level-matched listening, rather than by treating quieter output as worse or louder output as better.

Run \`node tests/dynamics_test.js\` for numerical compressor behavior, stereo linkage, transients, bypass, and finite values. The application integration and existing format regression suites remain required.

**Development status:** This feature is on a stacked draft branch based on unmerged v5a, pending review. Loudness measurement/optimization is a separate subsequent stage rather than silently added to the compressor.

## Integrated loudness and optional normalization (v5c, development)

Sound Polish now includes an optional **Loudness target** selector. By default it **measures only** and leaves the audio samples unchanged if other polish controls are off. Supported targets: **-18**, **-16**, or **-14 loudness units relative to full scale (LUFS)**. A target is a requested level, **not a guarantee**: the application caps positive boosts to +6 decibels, attenuation to -12 decibels, and protects sample peaks at or below 0.97 full scale. It applies *one uniform scalar gain to all channels*, not a limiter or compressor. Excessive peaks may prevent reaching a target. The status message reports measured achieved loudness and flags constrained targets.

The browser-local meter uses a two-stage K-weighting filter and 400-millisecond blocks with 75% overlap, an absolute gate at -70 and a relative gate 10 loudness units below the preliminary average. It approximates **integrated programme loudness** according to International Telecommunication Union Recommendation BS.1770 and European Broadcasting Union R 128 for mono and stereo. It does not claim certified meter compliance. After gain adjustments, it **remeasures the final Polished samples** because applying gain can change which blocks pass the absolute loudness gate. Comparison against the independent FFmpeg EBU R 128 filter is part of the automated test suite.

**Limitations:** Tracks shorter than 400 milliseconds or layouts beyond stereo are not normalized and display an explanation; if a loudness target was the only selected operation, these unsupported recordings are left **sample-identical**, even when original peaks exceed the usual processing ceiling. Other explicitly enabled tone/dynamics operations retain their existing peak protection. Peak safety is currently **sample-peak based, not true-peak based**, so inter-sample reconstruction overshoots are not explicitly constrained. This feature does not restore missing source quality, remove reverberation or guarantee streaming-platform loudness. The displayed loudness is explicitly labeled **before timeline edits**. Later section-volume changes, fades and crops can change final exported loudness or cause clipping, and the interface warns about that on edited tracks. Inspect final edited exports separately. Original and Cleaned audio remain unchanged.

Reference documents: [ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770) and [EBU R128](https://tech.ebu.ch/publications/r128). Tests: \`node tests/loudness_test.js\` (uses FFmpeg for independent reference), plus the earlier regression suite. This development is stacked on the unmerged dynamic-control branch; do not release before the base work is reviewed.

## Editing

Under the versions list is a waveform of the song, split into sections. Edits never touch the audio itself: they are a list of which stretches play, in what order, at what volume and with what fades, so every step can be undone and the same edit applies to Original, Cleaned and Removed alike.

| To | Do this |
|---|---|
| Select a stretch | Drag across the waveform, or put the playhead at each end and press Mark in (I) and Mark out (O). Esc clears it. |
| Cut it out | Select, then Cut or Delete. The audio either side joins up. |
| Keep only that stretch | Select, then Keep only. |
| Split a section | Put the playhead where you want the split, then Split (S). |
| Change the volume of a passage | Select it, Make section, then set Volume (−24 to +12 dB) in the section panel. |
| Fade in or out | Click a section, then drag the dot at its top-left or top-right corner, or use the Fade in and Fade out sliders. Fades follow a smooth quarter-sine curve. |
| Look closer | Zoom with + and −, or Ctrl and the scroll wheel. |
| Change your mind | Undo (Ctrl+Z), Redo (Ctrl+Shift+Z), or Reset edits, which can itself be undone. |

Every join is smoothed with a 4 ms fade either side, and volume changes between neighbouring sections ramp over 10 ms, so edits do not click. Stretches you have cut are shaded on the spectrogram. Playback, the seek bar and both downloads follow the edits; edited downloads are named `(edited)`. If a volume boost pushes the result past 0 dBFS, the page says so after the download: lower the loud section or download as 32-bit float, which does not clip.

## WAV or MP3?

Both work as input. Start from WAV when available: MP3 has already discarded detail and added its own artifacts, which this tool cannot put back.

For output, choose **Download as** above the versions list, then use the download button beside **Cleaned** or **Removed**:

- **WAV:** the existing 16-bit, 24-bit (default), or 32-bit float choices.
- **MP3:** target bitrates of 192, 256, or 320 kilobits per second. These are smaller, lossy copies.

Both formats include the current cuts, section volumes and fades. Polished downloads also include Sound Polish tone adjustments. MP3 encoding runs locally in a separate worker with progress and a Cancel button. Changing the source or cleaning again cancels an in-progress export. Later edits do not change an export already underway.

MP3 supports mono or stereo. Tracks with more channels can still be downloaded as WAV, without a silent downmix. The encoder converts unsupported sample rates to an MP3-compatible rate, and low-rate sources can use lower bitrates than the selected target. MP3 also adds encoder delay and padding. Keep WAV for archival use, further processing, exact alignment, or samples above full scale (32-bit float). MP3 export requires a worker-capable browser on the hosted page or a local web server; WAV remains available if MP3 encoding fails.

## Command line

The same engine runs in Node 18 or newer, with no packages to install.

```
node cli.js "My Song.wav"
node cli.js "My Song.mp3" --out cleaned --shimmer 0.8 --max-cut 6
node cli.js "My Song.wav" --format both --mp3-bitrate 320
```

Options: `--out folder`, `--format wav|mp3|both` (default WAV), `--mp3-bitrate 192|256|320` (default 320), `--bits 16|24|32`, `--no-static`, `--strength`, `--max-cut`, `--quiet`, `--bass`, `--shimmer`, `--shimmer-max-db`, `--shimmer-from`. WAV files are read directly; other formats need ffmpeg on the PATH. Output: Cleaned and Removed files in the selected format(s), plus `<name> - report.txt`. MP3 output uses the bundled encoder and needs no additional installation. `--bits` controls WAV only.

## Files

| File | Role |
|---|---|
| `engine.js` | The static/shimmer processing method. The single source of truth, used by the page, the worker and the command line |
| `polish.js`, `polish-worker.js` | Optional browser-local tone finishing and its background worker |
| `tests/polish_test.js` | Clarity/presence filter response, bypass, peak-safety and stereo regression tests |
| `edit.js` | The editing method: sections, cut, split, volume, fades, declicking, rendering |
| `wav.js` | WAV reading and writing |
| `mp3.js`, `export-worker.js` | Shared MP3 encoding and background browser export |
| `vendor/` | Pinned, unmodified lamejs encoder, source and licences |
| `worker.js` | Runs the engine off the page's main thread |
| `index.html`, `style.css`, `app.js` | The web page |
| `cli.js` | Command-line version |
| `tests/reference.py` | An independent NumPy/SciPy implementation of the cleaning, used only as a test oracle |
| `tests/edit_test.js`, `tests/edit_reference.py` | Edit engine tests and an independent NumPy render of the same edits |

## Testing

`tests/reference.py` implements the same method with library routines instead of the engine's hand-written block code. To check the engine:

```
node cli.js input.wav --out js --bits 32
python3 tests/reference.py input.wav reference.wav
python3 tests/reference.py --compare "js/input - Clean.wav" reference.wav
```

For v1 the two agreed to within 1e-14 on stereo, mono, three-channel, sub-window-length and silent-intro test files, with default and non-default settings, and the browser download matched the command-line output sample for sample.

To check the edit engine:

```
node tests/edit_test.js input.wav edits
python3 tests/edit_reference.py input.wav edits
```

`edit_test.js` runs fixed edit sequences (cuts at the ends and across section boundaries, crops, sections with volume and fades, fades that would not fit), checks the invariants after each, and writes each result with its section list. `edit_reference.py` renders the same section lists from the written rules and compares. For edit engine v1 the worst difference was 3e-8, which is float32 rounding, and an edited download from the page matched the reference to 1.5e-8.

To check MP3 exports (requires `ffmpeg` and `ffprobe` as independent decoders):

```
node tests/mp3_test.js
```

This checks mono and stereo, sample-rate conversion, bitrate choices, short and silent tracks, edited audio, unsupported input, and command-line format selection. The existing cleaning and WAV codecs are unchanged.

## Version history

**v1** (October 2026). First release: static stage after the r/SunoAI method, new shimmer stage with transient guard, stereo-linked mask, silent-frame skipping, browser tool with A/B/Removed playback and spectrogram wipe, command line, test oracle.

**Page v2** (October 2026). The web page was restyled after Suno's own interface so Suno users find it familiar: a settings panel on the left with a Clean button in place of Create, the Original, Cleaned and Removed versions as a song list with per-row downloads, and a fixed player bar. The engine is unchanged at v1, so results are identical.

**Page v3, edit engine v1** (October 2026). An editor under the versions list: zoomable waveform with sections, drag to select, cut, keep only, split, make section, section volume and fades with draggable handles, mark in and out, undo and redo. Joins and volume changes are declicked. Playback, the seek bar and downloads follow the edits, and cut stretches are shaded on the spectrogram. The cleaning engine is unchanged at v1.

**Page v4, command line v2** (October 2026). Add local MP3 downloads alongside WAV, including edited Cleaned and Removed tracks, quality selection, background encoding, progress and cancellation. The command line adds `--format wav|mp3|both` and `--mp3-bitrate`. Also fix a pre-existing waveform redraw error when replacing a loaded track. Cleaning and edit engines are unchanged.

**Page v5a, Sound Polish v1** (November 2026). Optional preset-driven clarity and presence after cleaning, with a separate Polished playback/download version, independent worker and peak-safe linked output. Original cleaning and command line behavior are unchanged.

---

A free tool from [GS Grimoire](https://www.patreon.com/GSGrimoire). Not affiliated with or endorsed by Suno.
