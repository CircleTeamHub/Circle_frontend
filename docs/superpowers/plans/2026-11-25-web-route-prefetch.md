# Web route splitting and prefetch implementation plan

> **For agentic workers:** Execute the tasks below in order with test-driven-development and a final independent code review.

**Goal:** Render the Web login with a smaller initial bundle, then warm other page code after an authenticated page is usable without mounting those pages or requesting their business data.

**Architecture:** Enable production async routes only on Web. Generate a build-scoped list of exported async JavaScript assets, and prefetch them at low priority after authenticated navigation commits. Keep prefetch separate from the router's screen preload API, which can mount screens.

**Tech stack:** Expo SDK 55 / Metro, Expo Router, React 19, TypeScript, Node tests and Jest, existing Chrome export smoke.

## Constraints

- Preserve native route loading and auth/bootstrap behavior.
- No new dependencies, service workers, private account data or credentials in asset metadata.
- Prefetch failures must not block navigation; user navigation remains the normal loading path.
- Stop pending background work on logout, unmount or a hidden document. Keep concurrency bounded.

## Task 1: Split the production Web route graph

- [x] Add and run a failing test for `asyncRoutes: { web: 'production', default: false }`.
- [x] Configure the existing `expo-router` plugin in `app.json`; export and measure initial scripts versus the current 13,770,317-byte main bundle (2,938,838 bytes gzip).
- [x] Address measured eager dependencies only where they materially prevent login reduction.

## Task 2: Warm exported code after authenticated page commit

- [x] Add failing build tests: emitted metadata excludes initial scripts, contains only existing same-origin hashed JavaScript, and remains tied to its HTML build.
- [x] Add the export preparation script and hook it into `export:web` before source map cleanup.
- [x] Add behavior tests for auth gating, delayed/serial prefetch, no script execution or screen mounting, failure handling and cleanup.
- [x] Implement a Web-only prefetch host with a native no-op, mounted in the committed tab homepage. Use classic-script resource preloading without importing/rendering route modules; Chrome verified cache reuse. Safari uses the same standard preload path but has not been tested on a real device.

## Task 3: Verify delivery and document limits

- [x] Extend the existing browser smoke to verify login does not fetch all route chunks, authenticated prefetch warms code without route data requests, and navigation can use warmed code.
- [ ] Verify normal login/register/deep links plus existing startup diagnostics, typecheck, lint and focused tests; use fresh CI for the full suites.
- [x] Document resource cache requirements and preserving prior hashed assets across releases.
- [ ] Obtain independent production-readiness review, commit and open a ready-for-review PR with measured results. Stop temporary processes and verify they exited.
