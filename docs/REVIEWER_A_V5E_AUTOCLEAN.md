# Reviewer-A handoff: SSF v5e Auto Clean

**Date:** 2026-11-09  
**Developer:** ChatGPT Coder-A  
**Review:** ChatGPT Reviewer-A, independent  
**Branch:** \`feature/sound-polish-v5e-auto-clean\`  
**Base:** \`feature/sound-polish-v5d-transients\`, which is still draft PR #10. Earlier versions v5a to v5c remain unmerged.  
**Roadmap:** issue #12  
**Production:** root GitHub Pages app remains unchanged; a separate /preview/ snapshot is for testing only.

## What Auto Clean does

A new button **Analyze & Auto Clean** appears after importing a regular WAV or MP3. Initial normal cleaning still runs on load. Clicking Auto Clean starts a separate analysis worker and transfers copies of at most 16 distributed, bounded windows from the original source. No complete second copy of a long track is transferred. No remote model or audio upload is involved.

Pure module \`auto-clean.js\` computes elementary indicators:
- repeated flat-topped samples at high level, a possible clipping/hard-limiting indicator;
- isolated large one-sample deviations, a *click-like* discontinuity but also possibly legitimate percussion;
- excess high-frequency energy in quieter sampled passages, a *candidate* for hiss/shimmer but not conclusive;
- sustained low-mid dominance, a *candidate* for reduced clarity but may reflect bass-heavy production.

The result displays evidence and explicitly states limitations. In particular, this algorithm cannot tell whether a distorted kick is from intentional saturation, a damaged render, compression, or clipping. It cannot reconstruct missing samples. In the absence of sufficiently strong *repairable* indicators it recommends **no automatic processing**.

For cases with persistent quiet high-frequency energy, it selects a restrained static/shimmer pass. For significant low-mid dominance, it selects at most 25% clarity and performs a subsequent Polished pass automatically. It never auto-enables dynamics, transient emphasis, presence boost or target loudness. Manual controls remain available.

## Technical changes and review points

- \`auto-clean.js\`: bounded sampling, 4 low-pass accumulators per channel, window energy ratios, flat-peak and impulsive event counting, threshold-based conservative rule set. Check whether features are meaningful, whether thresholds spuriously select settings on musical transients, and whether gain-sensitive cues are adequately qualified.
- \`auto-clean-worker.js\`: browser-local asynchronous analysis with no network access.
- \`app.js\`: new \`autoGeneration\` and source-identity guards, worker termination on source replacement and manual control edits, asynchronous chain from auto analysis to cleaning and optional tone Polish. Check staleness/races, focus/keyboard accessibility, duplicate input events, auto no-op and fallback when workers fail. Existing WAV/MP3 export guards must still hold.
- \`index.html\` and \`style.css\`: button, status, explanatory report. The report uses \`textContent\` exclusively for worker output.
- \`tests/auto_clean_test.js\`: synthetic clean, quiet noise, hard clipping/flat-tops, isolated clicks, low-mid-heavy sine, bounded hourly audio sample copying, invalid inputs.
- \`tests/polish_integration_test.js\`: uses actual app.js with worker/document stubs; tests Auto Clean, no-op, override of risky controls, source replacement, manual cancellation during analysis/queued polishing, and error recovery.
- \`.github/workflows/sound-polish.yml\`: Auto Clean tests in full regression suite, source/worker paths as triggers, includes Auto Clean scripts in downloadable artifact.

## Required independent cases

1. Verify repeated clipped percussive waveforms produce an **uncertain diagnostic**, not false de-clipping or automatic transient/presence boosts.
2. Verify clean source and click-only source cause no extra cleanup. Test false positives with intentional distorted guitars and cymbal-only music, and document heuristic limitations.
3. Verify noisy quiet passages select restrained settings. Ensure source working buffers are not modified by the diagnostic module.
4. Verify worker failures and transfer fallback, especially source replacement while the fallback timer is pending and controls changed during auto-cleaning.
5. Check that manual changes after diagnosis and before the finish of re-cleaning cancel pending Auto Polish. Check displayed metadata and exported samples correspond to the selected track.
6. Compare all prior version behavior when Auto Clean is never clicked. The old manual pipeline should be unchanged.
7. Inspect online-preview isolation: it must not modify the production root and it must contain \`auto-clean-worker.js\` and its imports. Actual browser tests and level-matched listening are still mandatory.

## Evidence, limits and review deliverable

[Successful GitHub Actions regression for the feature pipeline](https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42702290524). Verify latest head run after docs change if available. Includes older tone, dynamics, transients, loudness/FFmpeg, MP3 and editor tests.

No claims are made of recovering damaged drums or objectively improving the subjective quality of all Suno tracks. The diagnosis can miss brief artifacts outside sampled windows. It does not use source separation. The Suno multi-stem ZIP importer remains future issue #4.

Post independent severity-ranked findings and a release recommendation to the v5e draft pull request. Do not merge any stacked pull requests. Coder-A will address confirmed defects. User performs actual-browser and level-matched listening acceptance.

**Kickoff prompt:**

> You are ChatGPT Reviewer-A, independent reviewer of GS-SunoShimmerFree Auto Clean. Read \`docs/REVIEWER_A_V5E_AUTOCLEAN.md\` on \`feature/sound-polish-v5e-auto-clean\`, review the actual draft pull request against \`feature/sound-polish-v5d-transients\`, independently exercise the analysis metrics and one-click UI/worker pipeline, verify stale-source/manual-cancellation behavior and evidence limits, and post severity-ranked findings to the pull request. Do not merge. Coder-A will implement fixes.
