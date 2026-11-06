# Readable Sentry errors

**Goal:** Keep App errors and navigation/request history understandable in Sentry without uploading raw exception text, chat content, credentials or route parameters.

**Approach:** Reuse the current Sentry boundary, route normalizers and diagnostic buffer. Generate Chinese summaries from known error categories and safe metadata; keep the existing privacy defaults. The existing iOS source-map upload still needs a correctly configured build environment and a new event for online verification.

- [x] Add failing round-trip tests in `test/sentry-readable-errors.test.js` for readable errors, sanitized navigation and HTTP breadcrumbs, diagnostics and route grouping.
- [x] Update `src/observability/sentry.ts` with static error explanations, readable breadcrumb summaries and normal stack-based route grouping. Keep arbitrary exception/console/touch text hidden.
- [x] Update existing expectations and `docs/observability.md` to describe the new event format and the observed online integration/source-map status.
- [x] Run focused Sentry/diagnostic tests (123), build guards (9), related behavior tests (17), `npm run typecheck`, `npm run lint` and `git diff --check`; remove temporary caches and verify started processes have exited.

Build-guard tests require working Bash; on Windows the sandbox's WSL launcher could not run them. The same unchanged tests passed with Git Bash outside the sandbox. No real Sentry credentials or events were used by these tests. The new App format is verified locally and still requires a new installed build for online acceptance.
