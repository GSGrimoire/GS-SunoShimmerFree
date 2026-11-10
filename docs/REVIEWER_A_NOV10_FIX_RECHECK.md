# Reviewer-A recheck: 10 November 2026 SSF audit fixes

**Request:** independently recheck five fixes after Reviewer-A's SSF-wide review.  
**Developer:** ChatGPT Coder-A  
**Do not merge:** production hotfix has been applied separately; feature PRs remain drafts pending browser and listening acceptance.

## Findings and corrective changes

| Severity | Finding | Fix location | Evidence |
|---|---|---|---|
| High | Production root A/B overlapping file-imports, obsolete decode and worker callbacks can put A audio under B metadata | \`main:app.js\`; source/clean generation identity checks after reads, decode, worker/inline messages and failures | \`tests/production_load_race_test.js\`; [successful safety workflow](https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42803594459) |
| Medium | PR #13 Auto Clean: Reset does not cancel in-flight diagnostic or queued Auto Polish | \`feature/sound-polish-v5e-auto-clean:app.js\`; Reset calls \`cancelAuto()\` before \`writeParams(DEFAULTS)\` | \`tests/polish_integration_test.js\` including reset in analysis and before queued Polish; [full success](https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42803282614) |
| Medium | PR #11 stem resampling: linear interpolation aliases 23 kHz at 48 kHz input to 21.1 kHz at 44.1 kHz output | \`feature/native-suno-stem-zip-v6:stem-resample.js\`; 64-tap Blackman-Harris windowed-sinc with 1,024 precomputed phases, imported by stem-ui and index.html | \`tests/stem_resample_test.js\`; [full latest band-limited check](https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42804104397) |
| Low | Aborting Auto Clean leaves stale status saying analysis is underway | \`feature/sound-polish-v5e-auto-clean:app.js\`; cancellation status updated on analysis/manual controls and queued-pass cancellation | integration test in same suite |
| Low | Online \`preview/**\` changes did not reliably trigger regressions | PR #13 workflow includes \`preview/**\` in push/pull request trigger lists; main has \`.github/workflows/production-preview.yml\` with preview path triggers and static worker resource checks | \`tests/preview_bundle_test.js\`; [green main preview check](https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42803775464) |

## Deployment boundaries

- Production root: v4 file-import race patched **directly in main** (without merging any stacked feature PR).
- Experimental browser site: https://gsgrimoire.github.io/GS-SunoShimmerFree/preview/ now contains the corrected v5e \`app.js\` snapshot. [GitHub Pages deployment succeeded](https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42803774673); metadata identifies the exact v5e source head. Other production root files are unchanged.
- Stem ZIP PR #11 is **not deployed to the online Auto Clean preview** and must be tested independently. This remains a draft feature, not a released capability.

## Independent review tasks

1. Reproduce selecting source A, then B, followed by A's late resolution/error and prior worker messages in **production**. Verify B audio and filename are consistent; check worker termination and inline fallback behavior.
2. Reproduce Reset with Auto Clean analyzing and with a queued Polish pass. Ensure later worker messages cannot overwrite the Reset settings, start extra Polish or leave status inaccurately running. Inspect what happens when Reset occurs after Auto Clean has already begun the re-cleaning step.
3. Inspect the band-limited resampler's alias rejection and passband tradeoffs. Check the quantitative regression and sample-rate mismatches, mono/stereo, and performance on long material. A synthetic 23 kHz sine is not a substitute for cymbal/voice listening.
4. Confirm preview safety workflows really trigger on \`preview/**\`, and that local module, worker and encoder dependencies are present. Deploy success and automated tests do not establish real browser acceptance.
5. Post severity-ranked pass/remaining-fix recommendations separately to PR #13 and PR #11; record any remaining production issue in a GitHub issue comment. Keep feature PRs draft and unmerged.

**Launch prompt:**

> You are ChatGPT Reviewer-A, independently rechecking the five 10 November 2026 SSF findings. Read docs/REVIEWER_A_NOV10_FIX_RECHECK.md on feature/sound-polish-v5e-auto-clean. Inspect the production main import-race patch, draft PR #13 Reset/cancel/status fixes, draft PR #11 band-limited stem resampling, and CI triggers for preview/**. Reproduce the reported failures and verify the fixes from source and tests, post severity-ranked findings and separate release recommendations. Do not merge. Coder-A will address new findings.
