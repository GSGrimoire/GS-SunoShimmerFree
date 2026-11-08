# Reviewer-A handoff: stabilization and stacked Sound Polish releases

**Date:** 2026-11-08  
**Implementer:** ChatGPT Coder-A  
**Independent reviewer:** ChatGPT Reviewer-A  
**Repository:** https://github.com/GSGrimoire/GS-SunoShimmerFree

## Review in this exact order

1. **PR #3: v5a clarity and presence + stabilization**  
   https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/3  
   Branch \`feature/sound-polish-v5a\`, base \`main\`.  
   Inspect Reviewer-A's second review H2 and L2, with fixes committed in the same branch. The identified H2 source A/source B overlap now uses \`sourceGeneration\` plus \`cleanGeneration\` identity guards in \`app.js\`, protecting file read/decode continuations, cleaning worker callbacks and inline fallback. The integration test uses distinguishable A/B samples and delayed failures, including obsolete worker progress/error/done. L2 expands the workflow trigger to codec, cleaning and edit dependencies.  
   Passing full workflow: https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42516849651  
   **Check:** reproduce overlapping file selections and old-worker callbacks independently. Verify that no stale error clears the new busy indicator, or old audio is exported under a new filename. Assess any stale-state edge cases missed by the synthetic tests.

2. **PR #6: v5b gentle dynamics**  
   https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/6  
   Branch \`feature/sound-polish-v5b-dynamics\`, base \`feature/sound-polish-v5a\`.  
   \`polish.js\` now has a stereo-linked root-mean-square envelope and soft-knee compressor after clarity/presence. Attack ~25 milliseconds, release ~220 milliseconds, ratio max 1.8:1, threshold ranges -12 to -16 decibels relative to full scale. Natural preset keeps dynamics off. There is no makeup gain. UI adds a single Dynamics slider within the existing Polished version; export is invalidated when settings change.  
   Passing full workflow: https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42517236840  
   **Check:** no unintended output modification at 0%, linked stereo balance, stable gain changes on sustained passages and transients, no numerical issues, no amplified shimmer or pumping on example Suno music. Tests are synthetic and are not a listening acceptance.

3. **PR #8: v5c integrated loudness**  
   https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/8  
   Branch \`feature/sound-polish-v5c-loudness\`, base \`feature/sound-polish-v5b-dynamics\`.  
   Adds \`loudness.js\` with K-weighted gated programme loudness (400-millisecond blocks, 100-millisecond hop; -70 absolute and -10 relative gates) and optional -18, -16 and -14 targets, default off. Scalar gain is bounded to +6/-12 decibels and sample-peak constrained to 0.97. It is **not a true-peak limiter**. Unsupported (>2 channels) or <400-millisecond files are not normalized. The UI labels constrained target achievements; the meter is approximate, not certified.  
   Passing full workflow after introducing independent FFmpeg reference test: https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42517612881  
   **Check:** validate matching to independent FFmpeg/other loudness meters on Suno songs (not just synthetic tones), gating behavior on intro/outro silence, target unattainable because of peaks, multi-channel and short-track safeguards, no stale export under new loudness target, and WAV/MP3 audio after timeline edits. Note that section gain can introduce clipping after normalization; no claim of a true-peak ceiling.

## Required review deliverable

- Post **separate release recommendations** on PR #3, #6 and #8.
- For each, list Critical / High / Medium / Low findings with exact source references, reproducible evidence and required fix.
- Confirm actual commands and tests run versus inferred behavior; synthetic tests do not prove browser playback, platform compatibility, or sound quality.
- Keep all PRs **draft and unmerged**. They are stacked and must be reviewed/accepted in order.
- Real browser and level-matched listening acceptance remain separate user actions. A passing automated workflow does not substitute for them.
- Ask Coder-A to fix any confirmed defects. Reviewer-A does not merge.
- Native Suno stem ZIP import remains future issue #4, not a blocker. Its exact alignment and memory budget are preserved; do not extrapolate the full-track buffer model across 12 stems.

## Launch prompt

> You are **ChatGPT Reviewer-A**, independent reviewer of GS-SunoShimmerFree. Read \`docs/REVIEWER_A_STACKED_REVIEW.md\` on branch \`feature/sound-polish-v5c-loudness\`. Review PR #3's H2 source-loading race fix and L2 workflow triggers, then review stacked PR #6 dynamics and PR #8 loudness as independent increments. Verify source and tests, prioritize correctness and release integrity, post findings to the corresponding pull requests, and do not merge. ChatGPT Coder-A will implement fixes.
