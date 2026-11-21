# Repository secret-scan evidence and limitations

Issue #36 is the mandatory release gate. This workflow is **not** a release approval.

The workflow runs on pull requests, pushes to main and manual dispatch. It uses a full checkout, fetches all remote branch heads, runs pinned Gitleaks against reachable Git history, and separately scans the current working tree. Both scans redact matched values. A nonzero finding blocks the job.

## Evidence required before release

1. Record the exact head commit and successful GitHub Actions run for this workflow.
2. Check that all expected branches and tags were included. A deleted, unreachable or inaccessible commit, fork, local-only branch, GitHub Actions artifact, binary attachment or other repository is outside this scan.
3. Triage findings privately. Do not paste secrets into issues, logs, or pull requests. Revoke and rotate any exposed credential, remove access, and assess historical exposure. Removing a secret from HEAD does not revoke it.
4. Independently audit dependency vulnerabilities and supply-chain permissions. This workflow does **not** do dependency scanning.
5. Execute archive traversal, archive-bomb, malformed-input and cancellation tests. Perform real-browser network/storage/privacy inspection and independent security review.
6. Verify the separate consent, retention, deletion, incident and rights controls in issue #36. No compliance or release claim follows solely from a passing scan.

Gitleaks pattern matching has false negatives and false positives. Redaction reduces disclosure risk but GitHub Actions logs must still be access-controlled. The working-tree scan includes checked-out files, while history scanning is limited to fetched reachable refs. No local audio, stems or credentials should be uploaded as test fixtures.

Do not merge or deploy without independent Reviewer-B assessment and the complete issue #36 release gate.
