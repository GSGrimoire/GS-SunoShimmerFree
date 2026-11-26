# GS Vibe Studio: security and privacy threat model (draft)

Status: **proposal for independent review**, 21 November 2026. Owner security gate: [issue #36](https://github.com/GSGrimoire/GS-SunoShimmerFree/issues/36). This is not a compliance certification, completed audit, or permission to ship. Applies to the current local-first SSF and any future cloud, artificial intelligence, subscription, and training features.

## Trust boundaries and assets

| Boundary | Assets | Principal threats | Minimum control and verification |
| --- | --- | --- | --- |
| Untrusted local media to browser decoder | User WAV/MP3/ZIP, stem names, audio metadata | ZIP bombs, traversal, huge allocation, parser/decoder bugs, malicious filenames | Enforce compressed/uncompressed byte, entry count, depth, duration/channel/sample limits; reject path traversal, duplicates, encrypted/unsupported entries; cancellation and memory admission; test malformed archives |
| Browser origin and local project storage | Stems, edits, preferences, object URLs, cached audio | Cross-site scripting, stale data leaks, unintended persistence, malicious dependency | Content security policy, safe text rendering, dependency pinning/scans, explicit storage lifetime, revoke object URLs, clear temporary data; browser network/storage inspection |
| Browser to any remote endpoint | Audio excerpts, analysis features, prompts, user identifiers | Unexpected uploads, telemetry leakage, third-party training/retention | Default deny remote audio transmission; user action and separate purpose-specific permission; disclose destination/region/retention; network test proving no request during ordinary local import/edit/export |
| Optional account or storage service | Identity, billing references, projects, backups | Cross-account access, credential theft, insecure backups, orphaned copies | Least-privilege authorization and tenant-isolation tests, encryption in transit/at rest, scoped short-lived tokens, key rotation, access logs, deletion and backup expiry |
| External model providers | Audio, transcripts, prompts, model output | Unintended disclosure, provider reuse/training, prompt injection, unbounded costs | Separate explicit external-processing permission; vendor and data-transfer assessment; content minimization, tool allowlists, bounded calls, no secrets in prompts; do not equate processing consent with training consent |
| Voluntary training pipeline | Parameter corrections, ratings, selected excerpts, annotations, references | Invalid consent, rights infringement, reidentification, data poisoning, withdrawal failure | Separate granular opt-in for approved five dataset groups and individual audio types; rights/provenance validation, consent version, quality gates, deduplication, withdrawal/deletion workflow and disclosed model-unlearning limitations |
| Developer/agent/continuous integration access | Repository, secrets, logs, fixtures, release credentials | Supply-chain compromise, secret leakage, unreviewed changes, unauthorized deployment | Scoped credentials, secret scanning, branch ownership claims, independent pinned-head review, protected release gates, audit log; never place private user audio in public fixtures |

## Required design decisions before introducing server storage

1. Inventory every data category and purpose, data controller/processor, recipient, location, lawful basis, retention, deletion mechanism, and backup treatment.
2. Record a privacy impact assessment and whether a formal data protection impact assessment is legally required; obtain qualified European privacy/legal review before launch.
3. Publish a plain-language privacy notice, terms, copyright contribution policy, subprocessor list and incident-response contact. Do not claim compliance without evidence.
4. Keep cloud storage and artificial intelligence upload **off by default**. Audio contribution and external model processing each require independently revocable authorization.
5. Define account deletion, export, access, correction and erasure workflows, including request verification, processor propagation, restoration-safe deletion, and legal retention exceptions.
6. Define security incident detection, triage, containment, evidence retention, regulatory notification assessment, and recovery exercises. Treat legal deadlines as jurisdiction-specific and confirm with counsel.
7. Minimize analytics and logs; prohibit raw audio, transcripts, personal identifiers, tokens and prompts in ordinary diagnostics unless a narrowly approved, time-limited incident workflow requires them.

## Testable release gate

- [ ] Verify offline/local import, editing, playback and export emit **no audio or personal-data network requests** with developer tools or automated network interception; document exceptions.
- [ ] Test malicious ZIP paths, duplicate entries, excessive expansion, malformed headers, oversized sample rates/channel counts, cancellation and memory exhaustion; verify fail-closed behavior.
- [ ] Review all persistent browser storage, caches, service workers, downloads and object URLs for user-data lifecycle and cleanup.
- [ ] Run dependency and secret scans; investigate high-severity findings and document exceptions with expiry and owner.
- [ ] Test cross-site scripting paths and content security policy, including hostile stem names and metadata.
- [ ] Where accounts exist, verify authorization/tenant boundaries and deletion across primary storage, logs, backups and processors.
- [ ] Where external processing exists, test consent denial, withdrawal, vendor configuration and no-upload fallback.
- [ ] Where training exists, test provenance, rights checks, consent versions, dataset eligibility, withdrawal and model-unlearning disclosure.
- [ ] Independently review each security-sensitive source change against exact commit; obtain legal review for data-protection and rights representations.
- [ ] Record evidence, severity, responsible owner, mitigation and release decision; **unresolved high-severity issues block release**.

## Known limitations and immediate audit targets

This document records a **threat model**, not evidence that controls are implemented. Inspect current `main`, stem ZIP import branches, local persistence, any network libraries and the entire release dependency graph. Existing issue #18 identifies eight-minute ten-stem memory constraints and stacked draft branches. Do not infer security of unmerged branches from documentation or passing unit tests. Future Vibe Cleaning and Stem Constellation/video export are **out of near-term implementation scope** pending Claude's architecture review. The owner cannot guarantee absence of incidents or litigation; the defensible objective is prevention, minimization, detection, response and documented diligence.
