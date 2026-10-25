# GS SunoShimmerFree

Automatic static and shimmer removal for AI-rendered music.

**Use it in your browser:** https://gsgrimoire.github.io/GS-SunoShimmerFree/

Drop in a WAV or MP3, flip between Original, Cleaned and Removed without losing your place in the song, adjust the settings, and download a clean WAV. Everything runs locally in the browser tab, so your track is never uploaded. A four-minute stereo song takes about 15 to 20 seconds on a typical laptop.

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

## WAV or MP3?

Both work. MP3 is decoded at its own sample rate before processing, and the result is always written as WAV. Start from the WAV download when you have it: an MP3 encoder has already discarded detail and added its own artifacts, which this tool cannot put back.

## Command line

The same engine runs in Node 18 or newer, with no packages to install.

```
node cli.js "My Song.wav"
node cli.js "My Song.mp3" --out cleaned --shimmer 0.8 --max-cut 6
```

Options: `--out folder`, `--bits 16|24|32`, `--no-static`, `--strength`, `--max-cut`, `--quiet`, `--bass`, `--shimmer`, `--shimmer-max-db`, `--shimmer-from`. WAV files are read directly; other formats need ffmpeg on the PATH. Output: `<name> - Clean.wav`, `<name> - Removed.wav` and `<name> - report.txt`.

## Files

| File | Role |
|---|---|
| `engine.js` | The processing method. The single source of truth, used by the page, the worker and the command line |
| `wav.js` | WAV reading and writing |
| `worker.js` | Runs the engine off the page's main thread |
| `index.html`, `style.css`, `app.js` | The web page |
| `cli.js` | Command-line version |
| `tests/reference.py` | An independent NumPy/SciPy implementation used only as a test oracle |

## Testing

`tests/reference.py` implements the same method with library routines instead of the engine's hand-written block code. To check the engine:

```
node cli.js input.wav --out js --bits 32
python3 tests/reference.py input.wav reference.wav
python3 tests/reference.py --compare "js/input - Clean.wav" reference.wav
```

For v1 the two agreed to within 1e-14 on stereo, mono, three-channel, sub-window-length and silent-intro test files, with default and non-default settings, and the browser download matched the command-line output sample for sample.

## Version history

**v1** (October 2026). First release: static stage after the r/SunoAI method, new shimmer stage with transient guard, stereo-linked mask, silent-frame skipping, browser tool with A/B/Removed playback and spectrogram wipe, command line, test oracle.

**Page v2** (October 2026). The web page was restyled after Suno's own interface so Suno users find it familiar: a settings panel on the left with a Clean button in place of Create, the Original, Cleaned and Removed versions as a song list with per-row downloads, and a fixed player bar. The engine is unchanged at v1, so results are identical.

---

A free tool from [GS Grimoire](https://www.patreon.com/GSGrimoire). Not affiliated with or endorsed by Suno.
