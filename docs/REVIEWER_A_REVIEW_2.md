# Reviewer-A second pass: SSF v5a fixes from independent review

**Call-signs:** ChatGPT Coder-A = implementer; ChatGPT Reviewer-A = independent reviewer.  
**Date:** 2026-11-07.  
**Review target:** https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/3  
**Branch:** `feature/sound-polish-v5a` (compare its current head against `main`).  
**Initial review:** https://github.com/GSGrimoire/GS-SunoShimmerFree/pull/3#pullrequestreview-5815105086  
**Original handoff:** [REVIEWER_A_HANDOFF.md](./REVIEWER_A_HANDOFF.md).  
**Manual acceptance matrix:** [V5A_BROWSER_TEST_MATRIX.md](./V5A_BROWSER_TEST_MATRIX.md).

## Changes implemented by Coder-A

**H1 (High, stale Polished export):**
- `runPolish()` marks `st.polishing=true` and increments `st.polishRevision` *before* canceling exports, then refreshes controls.
- All attempts to export a Polished result are rejected when polishing is in progress or the current control settings differ from the rendered `st.polishApplied` preset, regardless of whether the button was artificially clicked.
- Asynchronous MP3 export captures the applied preset and polish revision. Worker messages are rejected when preset/revision changed, and obsolete exports are canceled. Re-polish cancels previously running exports.
- Added tests for an export in flight when re-polish begins, forced Polished click while processing, late completion of terminated worker and successful current-version export.

**M1 (Medium, asynchronous playback mode choice):**
- `setMode(m, userChoice)` increments a user-choice counter when a radio control or numeric shortcut is used. The initial counter is snapshotted when polishing starts.
- Successful polish now auto-previews only if the listener did not explicitly change modes during processing. Otherwise it preserves their selected version.
- Integration tests cover paused and playing states. Playback uses the existing scheduled-buffer restart when replacement audio becomes available.

**M2 (Medium, stale actionable interface during re-clean):**
- After `st.busy=true`, and on processing failure, the Polish controls are refreshed. Active cleaning disables Polish and stale Polished downloads; on error the retained previous Cleaned buffer may be polished again.
- Added integration coverage for re-clean success/failure state transitions.

**M3 (Medium, insufficient continuous integration coverage):**
- Added `tests/polish_integration_test.js`, a Node-based simulated browser using **actual app.js** and actual `edit.js` and `polish.js`, with controlled worker order, stale callbacks, and download checks.
- Continuous integration now reacts to app, interface, style, relevant processing and test files.
- Full workflow runs: tone tests, app-state integration, **actual MP3 codec and command-line regression with FFmpeg**, and existing editing engine tests using a synthetic WAV. Since the GitHub runner image lacked FFmpeg, the workflow explicitly installs it.
- Successful workflow run: https://github.com/GSGrimoire/GS-SunoShimmerFree/actions/runs/42420904857

**L1 (Low, incomplete keyboard hint):**
- The hint now correctly lists keys 1 Original, 2 Cleaned, 3 Polished and 4 Removed.

## Second-review requests

1. Independently verify that **H1 is fully resolved**, especially when an export starts just before a new polish pass and its completion callback arrives after the new version is ready. Investigate the behavior when the UI preset changes during MP3 export.
2. Verify mode preservation across both radio and keyboard shortcuts, while playing and paused. Note possible audible discontinuities from playback restart if observed.
3. Check cleaning re-entry and error transitions, UI disabled status, loaded-source replacement, and fallback handling.
4. Assess whether snapshot and generation tokens are applied consistently in browser callbacks and whether the tests could pass with an unhandled race.
5. Run full Node tests and inspect GitHub Actions log; distinguish simulated DOM coverage from real browser verification. Follow the browser matrix if feasible.
6. Give a new severity-ranked release recommendation; add a review comment to PR #3. **Do not merge**. Coder-A should handle any additional fixes.
7. The user must still conduct **level-matched listening acceptance** on real Suno music before merging. Tests do not establish audible preference.

## Future, explicitly out of scope

Native Suno stem ZIP import is specified in issue #4, not implemented in v5a. Avoid treating the memory/alignment constraints as a blocker for this pull request, while preserving the specification for future work.

## Suggested new-session opening instruction

> You are **ChatGPT Reviewer-A**, independent reviewer of GS-SunoShimmerFree. This is your **second review of PR #3** following Coder-A's fixes. Read `docs/REVIEWER_A_REVIEW_2.md` on the current `feature/sound-polish-v5a` branch, then the first review discussion and the updated diff. Reproduce the formerly High export race, assess asynchronous playback and re-clean interface state, check the expanded tests and report any remaining release blockers. Publish your findings on PR #3 but do not merge. Coder-A will implement further fixes.
