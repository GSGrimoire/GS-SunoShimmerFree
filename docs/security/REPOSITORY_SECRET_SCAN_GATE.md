# Repository secret-scan evidence and limitations

Issue #36 is the mandatory security release gate. This workflow is **not** release approval.

The workflow runs on pull requests, pushes to main and manual dispatch. It installs Gitleaks v8.24.3 using its declared Go module path and records the reported version. A non-shallow checkout fetches accessible remote branch heads, tags and GitHub pull-request head/merge refs into local refs. It logs the exact checked-out revision, branch/pull-request/tag ref counts and reachable commit count without logging matched secret values. The history scan uses `gitleaks git --log-opts="--all"` over **fetched reachable commits**, with default Git patch traversal. It does not guarantee a complete scan of every historical blob, including blobs excluded by patch semantics. The snapshot scan creates a temporary archive of **tracked HEAD files only**, then scans that directory; untracked files, generated outputs and ignored files are excluded. Both commands use `--redact`. The snapshot step still runs when the history scan fails, and the final step fails unless both scans succeed.

## Evidence required before release

1. Record the exact revision, Gitleaks version, branch/tag/pull-request ref counts, reachable commit count, and the outcomes of **both** scans on the corrected exact head. Verify a completed GitHub Actions job, not merely successful workflow parsing or installation.
2. Check that expected refs were fetched. Pull-request refs may be unavailable or deleted; unreachable/deleted commits, local-only refs, fork-only commits not exposed by GitHub, GitHub Actions artifacts, binary attachments and other repositories remain outside coverage. The fetched history is not the same as all repository objects or all possible historical secrets.
3. Triage findings privately. Do not paste secrets into issues, logs or pull requests. Revoke and rotate any exposed credential and assess historical exposure; removing a secret from HEAD does not revoke it.
4. Independently audit dependency vulnerabilities and supply-chain permissions. Pin third-party GitHub Actions to independently reviewed immutable revisions before release; the present workflow still references major-version action tags.
5. Execute archive traversal, archive-bomb, malformed-input and cancellation tests. Perform real-browser network/storage/privacy inspection and independent security review.
6. Verify separate consent, retention, deletion, incident and rights controls in issue #36. No compliance or release claim follows solely from a passing scan.

Gitleaks pattern matching has false negatives and false positives. Redaction reduces disclosure risk but GitHub Actions logs still require access control. No local audio, stems or credentials should be uploaded as test fixtures.

Do not merge or deploy without independent Reviewer-B assessment and the complete issue #36 release gate.
