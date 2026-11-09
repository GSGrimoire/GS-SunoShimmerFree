# SSF v5d local browser preview

This package is for **local acceptance testing**, not a released production version. It includes the latest draft stages: **clarity/presence**, **dynamic control**, **loudness measurement and optional constrained normalization**, and **experimental low/mid transient emphasis**.

## Open it

1. On GitHub, open the successful **Sound Polish checks** workflow run for branch `feature/sound-polish-v5d-transients`. Under **Artifacts**, download **SSF-v5d-browser-preview**.
2. Extract the downloaded archive into a folder. Do not launch `index.html` directly, because browser security may restrict worker-based audio export from a local file.
3. Open a terminal in the extracted folder.
4. Start the local preview server: **Windows:** `py -3 preview_server.py`; **macOS/Linux:** `python3 preview_server.py`. Python 3 is required, no extra packages.
5. Your browser should open automatically at **http://127.0.0.1:8765/**. If not, copy that address into your browser.
6. To stop the preview, press **Ctrl+C** in the terminal.

Only the loopback interface of your own computer is served. The audio processing happens locally in the browser; audio is not uploaded to GitHub or any third-party service. Do not upload personal music as public GitHub issues or attachments.

## Test checklist

- Try at least one regular stereo WAV or MP3 from Suno. **Native Suno stem ZIP input is not supported in this build yet** (future [issue #4](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/4)).
- Confirm Original, Cleaned, Removed and Polished switching works while paused and while playing. Numeric shortcuts: 1 Original, 2 Cleaned, 3 Polished, 4 Removed.
- Start with Natural. Adjust Clarity and Presence, apply, and compare at **the same perceived loudness**.
- Try Clear and Forward for tone and dynamics, and **Punchy (experimental)** for the new transient effect. Compare the same drum/percussion passage with the Transient slider at **0% and 35%**. Watch for pumping, artificial shimmer, cymbal grain and a reduced sense of ambience.
- Try the optional -18, -16 and -14 loudness-unit targets. The tool may not reach the target when it would breach its allowed gain or sample-peak limits. A louder result is not necessarily better.
- Try a trim, section gain, fade and undo/redo. Observe the pre-edit loudness warning as you drag the volume slider, then export edited WAV and MP3 and listen to both.
- Replace the song while cleaning/polishing to check stale audio never reappears under a different title.
- Test in your normal browser first; another browser or narrow window can help identify compatibility issues.

## What to report

For each track, record which preset you preferred, whether transient emphasis actually improved drum definition, whether shimmer/harshness increased, whether download and playback worked, and any console errors. Send findings to ChatGPT Coder-A or on the [v5d draft pull request](https://github.com/GSGrimoire/GS-SunoShimmerFree/pulls).

## Release boundaries

- v5a, v5b, v5c are independently code-review clear but not user-accepted or merged.
- v5d is an **additional experimental draft**, not yet independently reviewed.
- Transient emphasis is **off by default** except when explicitly choosing Punchy.
- Sample-peak safety is **not true-peak limiting** and applies before timeline section gain. Edited exports can clip.
- The spectrogram remains derived from Cleaned audio and is not a dedicated Polished spectrogram.
