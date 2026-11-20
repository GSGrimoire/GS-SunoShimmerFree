# SunoShimmerFree: cross-session engineering checkpoint

**Recorded:** 20 November 2026. **Repository:** `GSGrimoire/GS-SunoShimmerFree`. This checkpoint can become stale; verify actual GitHub state on entry.

## Owner direction and target

The full product goal is an **automated, local-first, browser-based music studio**, not merely a shimmer remover. Automatic analysis and safe suggested repairs lead into a multitrack manual studio, mixing, mastering and export. **Monday morning, 23 November 2026** is a target for the strongest validated deliverable, not permission to skip reviews or ship incomplete functionality as finished.

See [product plan](docs/STUDIO_PRODUCT_PLAN.md) and [agent gate](docs/SSF_AGENT_GATE.md); umbrella [issue #18](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/18). Older product roadmap [#2](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/2) remains useful for background.

## Existing work

- Current production `main`: single-track cleaning/editor/export.
- Sound Polish drafts: #3 → #6 → #8 → #10 → #13 → #14.
- Stem ZIP workspace draft #11 (stacked on #8), and excerpt preview/passage attenuation draft **#17** (stacked on #11).
- **First next task:** different-session **ChatGPT-2 | SSF Independent Reviewer** examines PR #17 at latest exact head. Initial reported head: `4cff86b28980400664935096be643b120a48b79a`. Synthetic GitHub checks passed on that head, but independent review and real-browser listening are **not established**.
- [#16](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/16): real-world Viking-shimmer research and selective stem muting. The ten eight-minute MP3 stems at [example-files/viking-shimmer](https://github.com/GSGrimoire/GS-SunoShimmerFree/tree/main/example-files/viking-shimmer) were byte-verified against the original ZIP. The 96 MiB compiled mix limit is a product blocker for complete eight-minute multistem work.

## Do not misstate status

- **Active SSF hourly agent tasks (20 November 2026):** Reviewer at **:45** each hour (first 19:45 CET, ID `Automation_8d670f00137c8191898f82cf3d3e8556`); coder at **:15** each hour (first 20:15 CET, ID `Automation_648c71194ba48191a65b9b8239c4f93a`), Europe/Copenhagen, around the clock. Both were verified enabled. This is a **30-minute stagger**, not a 20-minute recurrence. Actual successful GitHub review/coding work still requires verification after the first runs. Portfolio-wide gates at :00/:30 are unchanged; avoid concurrent edit collisions.
- Drafts are not merged or deployed. No full studio is verified. Do not merge or publish solely on tests or a deadline.
- Reviewer and coder need separate sessions; a common GitHub account is not formal distinct-account approval.
- Actual browser and human level-matched listening must validate any claimed shimmer improvement and release.

## Safe next actions

1. Re-fetch source and PR graph, then review #17 independently and post a consolidated pinned verdict.
2. Send defects to ChatGPT-1 coder for one bounded correction attempt and re-review; do not let author approve its own work.
3. Confirm baseline architecture and choose the smallest end-to-end project/timeline/streaming increment from #18.
4. Update this file after meaningful accepted changes, preferably in the same reviewable pull request. Keep GitHub issue #18 current.

**Record future session:** role, date, issue, branch, base/head SHA, validation evidence, next action and remaining blockers.
