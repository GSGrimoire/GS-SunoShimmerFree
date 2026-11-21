# Local-first network privacy smoke test

This is a **limited, optional test harness**, not a privacy certification. The browser script uses an independently installed Playwright and Chromium environment. It never sends audio to an external test service, and refuses non-loopback application URLs.

## Run

1. Prepare a synthetic, rights-free WAV file. Do not use private music.
2. Serve the current application on a loopback HTTP origin, for example `python3 -m http.server 8000`.
3. Install Playwright and Chromium in an isolated test environment, then run:

```sh
node tests/security/privacy-network-smoke.mjs http://127.0.0.1:8000 ./synthetic.wav
```

The harness records baseline network requests, then uses the first file input to import the WAV. It fails if the import causes a request to an external origin or a non-GET/HEAD request. It reports request metadata only, not request bodies, user files or tokens. The 2-second observation interval is a **smoke test**, not proof of absence of delayed uploads. It does not exercise export, editing, storage, consent, external artificial intelligence, service-worker behavior or non-network data leaks. Service workers are blocked in this harness; test actual production service-worker behavior separately.

## Required independent follow-up

- Review baseline third-party requests (including font hosts) and decide whether to self-host them. Existing `index.html` preconnects to Google Fonts. A page may contact third parties even if audio itself stays local.
- Add automated coverage for edit, export, cancellation, page reload and delayed network calls. Inspect browser storage and developer tools network logs in an actual deployment.
- Validate the harness against the current page's file input and against a deliberately injected upload to ensure it fails closed.
- Confirm no secrets, private audio or personal data are stored in logs. Do not represent this test as legal compliance.

Security gate: issue #36.