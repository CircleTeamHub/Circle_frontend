# AGENTS.md

## Repository context

This repository is a production Expo / React Native application using Expo Router, TypeScript, React 19, Zustand, OpenIM, LiveKit, Sentry, i18n, and native device capabilities.

Primary verification commands:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:behavior`
- `npm run ci`

## Review guidelines

Perform a strict production-readiness review of each pull request. Focus on real correctness, security, privacy, reliability, performance, testing, and long-term maintainability risks. Review the changed diff in the context of the surrounding code, but keep comments tied to actionable issues in the PR.

Prioritize high-impact findings. Flag P0/P1 issues clearly, and include P2 issues only when they are concrete and likely to matter in production. Do not nitpick formatting, naming, or style unless it can cause a bug, maintenance risk, user-visible regression, or unsafe behavior.

For every finding, include:

- The specific risk or bug.
- Why it matters in production.
- The concrete condition, input, state, or user flow that triggers it when applicable.
- A focused fix direction.
- A test that should cover the issue when a test is reasonable.

Do not rewrite code or propose broad architectural rewrites during review. Recommend minimal, high-value fixes that preserve the PR's intent. Only make code changes when explicitly asked with a follow-up such as `@codex fix ...`.

### Correctness and state consistency

- Check for broken user flows, incorrect assumptions, missing edge cases, stale closures, unsafe async ordering, race conditions, and inconsistent Zustand or component state.
- Pay close attention to auth/session bootstrap, account switching, route guards, realtime message state, unread counts, notification state, call state, optimistic updates, and cache invalidation.
- Verify cleanup for subscriptions, timers, event listeners, websocket/realtime listeners, push notification listeners, media resources, and pending async work.
- Check that optimistic UI updates have rollback or reconciliation paths when API calls fail or realtime events arrive out of order.

### Security and privacy

- Flag leaked tokens, security codes, PII, request bodies, user identifiers, device identifiers, media URLs, or private chat content in logs, errors, analytics, Sentry breadcrumbs, screenshots, or persisted storage.
- Verify sensitive auth material uses secure storage and is not copied into AsyncStorage, MMKV, query strings, navigation params, logs, or client-visible errors.
- Check authorization-sensitive UI flows for trusting client-side state too much. Client checks do not replace backend authorization, but the app must not expose unsafe actions, IDs, or stale permissions casually.
- Review file upload, media rendering, deeplink, QR/scan, WebView, clipboard, camera, location, notification, and share flows for unsafe input handling or privacy leaks.
- Treat dependency or native config changes as security-sensitive when they affect transport, storage, permissions, code loading, build tooling, or network behavior.

### API, reliability, and failure handling

- Check API call error handling, timeout behavior, retry safety, cancellation, idempotency, duplicate submission, and partial failure behavior.
- Do not suggest retries for non-idempotent operations unless the PR also adds deduplication or idempotency keys.
- Verify request and response mapping handles missing, null, malformed, legacy, and newly added fields safely.
- Check that user-facing errors are actionable without exposing internal details.
- Important flows such as login, registration, security code changes, wallet/coin actions, friend requests, group/circle management, chat send/forward/transfer, notifications, and calls need stronger failure handling and tests.

### Performance and scalability

- Look for unnecessary rerenders, unstable dependencies, expensive work in render paths, unbounded list rendering, missing memoization where it matters, repeated API calls, N+1 request patterns, large synchronous storage operations, and media processing on hot UI paths.
- For lists and feeds, check stable keys, pagination, refresh behavior, empty/loading/error states, image sizing, memory usage, and scroll performance.
- For realtime, notification, and call flows, check event storms, duplicate listeners, throttling/debouncing needs, and whether background/foreground transitions are handled safely.
- Suggest optimizations only when they are justified by a plausible production bottleneck.

### UX correctness and accessibility

- Check mobile layout behavior across small screens, safe areas, keyboard states, orientation changes, loading states, disabled states, and network/offline states.
- Verify navigation routes, params, back behavior, modals/sheets, tab badges, deep links, and permission prompts remain coherent.
- Review touch targets, accessibility labels where useful, color contrast, text overflow, and i18n coverage for user-facing strings.

### Observability and debugging

- Important failure paths should include enough context for production debugging without logging secrets or PII.
- Prefer structured, redacted diagnostics for auth, API, realtime, notification, upload, and call failures.
- Flag swallowed errors, generic catch blocks, missing Sentry context for critical failures, and noisy logs that would hide real issues.

### Testing expectations

- Require focused tests for changed business logic, reducers/stores, auth/session behavior, API mappers, idempotency utilities, validation, notification routing, realtime state handling, and critical UI flows.
- For regressions, request tests that would fail before the fix.
- Do not ask for broad snapshot tests as a substitute for behavior tests.
- If a change is hard to test, explain why and suggest a smaller seam or helper extraction only when it materially improves testability.

### Review output style

- Lead with findings, ordered by severity.
- Keep summaries brief and secondary.
- Be direct and specific; avoid vague feedback like "improve error handling" without naming the exact path and failure mode.
- Avoid speculative comments. If a concern depends on an assumption, state the assumption.
- Prefer one precise comment over many overlapping comments.

