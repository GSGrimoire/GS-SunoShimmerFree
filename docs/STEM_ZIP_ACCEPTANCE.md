# Native Suno stem ZIP workspace: implementation and review gate

This feature is **not released**. It is implemented on a draft branch stacked on the v5c Sound Polish branch. It must be reviewed, run in actual browsers and exercised with private Suno audio before merge.

## Entry points and isolation

- Drop a ZIP anywhere on the browser page, select it using the upload picker, or choose **Import stems ZIP** in the header. Existing WAV, MP3, FLAC and other single-track audio still follow the existing page.
- The stem workspace is an isolated, dismissible modal. It does not overwrite the previous full-track buffers, edit history or export state.
- ZIP inspection reads the end-of-directory and central directory using local File slices. It **does not upload audio** or read every stem during import.
- The ZIP reader handles ordinary single-disk ZIP32 with stored or raw-DEFLATE entries. Native browser DecompressionStream('deflate-raw') is required. Chrome 103+, Firefox 113+, Safari 16.4+ have this feature. ZIP64, multi-disk, encryption, unsupported compression, symlinks, duplicate files, traversal paths, overlarge archives, and CRC-mismatched payloads are rejected.
- Limits: archive <= 1 GiB, <= 256 entries, central directory <= 4 MiB, individual file <= 160 MiB, total expanded size <= 1 GiB, and compression ratio <= 250. Extraction is one entry at a time with output preallocated to the declared size and checked against CRC32.

## Stem model

- WAV and MP3 with the same stem path are grouped into **one** logical stem; WAV is selected automatically when available. Arbitrary custom instrument names and UTF-8 paths are supported; no fixed set of instruments is presumed.
- ZIP archives with MP3-only stems are valid. MP3 is lossy and can contain encoder padding or latency. **Never assume exact sample alignment between independent MP3 and WAV stems.**
- Enabled, Mute, Solo, mix gain, Clean, Polish and per-stem clarity/presence/dynamics/target parameters are independent and reversible until compiling.
- Preview one stem or reconstruct a full mix by summing enabled, unmuted stems (Solo takes precedence). This reconstruction keeps channel index zero aligned and does **not** guess temporal offsets.
- Each chosen stem is unpacked, decoded, optionally cleaned/polished in a worker, and mixed **sequentially**, with decoded data discarded afterward. The app does not retain all 11 or 12 stems simultaneously in decoded memory. The compiled stereo mix is capped at 96 MiB of sample arrays.
- If decoded lengths differ by more than 25 milliseconds or native sample rates differ, the application blocks the mix unless the user explicitly enables zero-padding/trimming and rate conversion. Smaller length differences are reported. No automatic time shifting is performed.
- When explicitly enabling a sample-rate mismatch, the conversion uses a **64-tap band-limited, windowed-sinc** filter with precalculated phases. High-frequency energy beyond the lower sample rate's Nyquist limit is attenuated instead of aliasing into the audible band. The highest valid frequencies are rolled off slightly as the price of this protection. This operation may be computationally expensive on long stems and has not yet been listened to in a browser.
- The compiled mix and individual previews are downloadable as 16/24/32-bit WAV or 192/256/320 kilobit-per-second MP3. The default is **32-bit float WAV** to preserve peaks above full scale. Integer WAV and MP3 exports warn before clipping if the mix exceeds full scale. The MP3 encoder runs in a separate worker.

## Acceptance matrix, required before merge

1. On a current Chrome, Firefox, Safari and a representative mobile device, drop a standard ZIP **anywhere** on the published test page and choose one from the file picker. Confirm that the existing single-track editor still opens WAV and MP3 normally.
2. On a **private local testing session**, use the supplied *The Greyseam Hum Stems.zip*. It contains 11 MP3 files: Lead Vocals, Drums, Bass, Guitar, Keyboard, Percussion, Strings, Synth, Other, Brass and Woodwinds. Confirm the workspace lists exactly those 11, with no WAV pair required. Do not commit or upload this ZIP or its extracted audio to public GitHub.
3. Use the earlier private 12-stem WAV+MP3 reference if available. Confirm duplicates are grouped and the WAV option wins. Verify that the 211.2-second WAV stem lengths are retained and no MP3 encoder delay is silently applied as a time correction.
4. Preview each stem. With all enabled, compare a reconstructed mix to the corresponding original audio at **matched loudness**. Listen to the beginning and end for MP3 encoder delay, silence/padding, sync errors and clipping. Repeat with Solo and Mute.
5. Enable only Clean on a stem, only Polish on a stem, and both. Verify other stems remain untouched. Verify that changing a parameter invalidates the compiled preview/export and that cancellation/new archive selection cannot restore stale results.
6. Export a stem and a mixed track as 32-bit float WAV, 24-bit WAV and 320-kilobit MP3. Reimport the WAV/MP3 results, check duration, channel count, listening quality and clipped-output warnings. Confirm no silent normalization or automatic limiting of the sum.
7. Simulate malformed and malicious archives: traversal, symlinks, encrypted entries, corrupt checksums, duplicate names, high compression ratio, many files, ZIP64 and false-size headers. The application must display a controlled error and not upload content.
8. Use a full-sized ~380-megabyte reference archive to inspect peak memory. Verify that closing the workspace, cancelling processing and replacing the ZIP stop worker activity and release decoded resources. The memory budget is a safety estimate, not proof of mobile reliability.
9. Test browsers without raw-DEFLATE streaming and with workers blocked: show an actionable error rather than silently losing data.
10. Opt into a 48,000-to-44,100 sample-rate mismatch. Confirm 23-kilohertz input energy is not folded into 21.1 kilohertz in the resulting mix. Listen to high-frequency cymbals/strings and inspect performance on long stems. The synthetic regression is `node tests/stem_resample_test.js`.

## Known limitations to assess

- It is a sequential, memory-bounded reconstruction workflow, **not** a sample-accurate multitrack editing or time-stretching environment.
- MP3 decoder output is determined by the browser's decoder; if MP3 stems have different gapless metadata, users must listen and confirm alignment. An explicit mismatch setting only pads/trims at the end; it does not discover/correct encoder delay.
- Repeated compilation after changing controls can be computationally expensive. Compiled mix is discarded when controls change, and no decoded-stem cache persists.
- No browser sound-quality validation has yet occurred. Automated JavaScript tests use synthetic fixtures and cannot certify real Suno playback.
- This is a draft implementation for independent review. **Do not merge or mark released** solely on the basis of a green automated workflow.
