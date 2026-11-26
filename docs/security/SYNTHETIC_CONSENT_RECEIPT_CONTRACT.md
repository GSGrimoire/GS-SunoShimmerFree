# Synthetic consent receipt contract: review-only prototype

This test-only contract supports the design discussion in issue #36. It is **not** wired to production and does not collect, store, revoke or enforce real consent. It does not authorize external processing or training. The user must still explicitly authorize each operation at the point of use.

The fixture models five independently optional training groups: processing decisions, perceptual preferences, rights-cleared audio examples, artifact annotations and rights-cleared reference examples. Each group requires explicit per-type choices. Processing transfer permission is a separate field and defaults to false. A receipt includes a version, pseudonymous subject, timestamp, rights attestation and optional revocation timestamp. A revoked receipt cannot retain enabled processing transfer or training flags.

The validator rejects unrecognized fields to avoid inadvertently carrying raw audio, account identifiers or free-form telemetry in receipts. It does **not** guarantee that a real system does not transmit or retain data elsewhere. A pseudonym is not anonymity. Consent version strings and rights attestations are not proof of valid consent or ownership.

## Unresolved design and release gates

- Determine lawful bases, notice text, per-purpose and per-processor authorization, storage location, retention duration, deletion schedule and audit access with legal/privacy review.
- Define append-only consent events and revocation propagation, including queued transfers, processor deletion requests, backups and model-training irreversibility disclosure.
- Define separate source audio upload authorization, training contributions, and access/export/delete mechanisms. A revocation timestamp is not proof that deletion has occurred.
- Obtain independent security review and browser/network evidence. Do not ship a consent user interface or training pipeline based on this test-only fixture.

No user audio, personal data or network calls are used by these tests.
