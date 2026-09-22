# Full-stack Observability Completion Plan

> **For agentic workers:** Use subagent-driven-development with task-scoped implementation and independent review. Keep changes local; do not commit or deploy during this request.

**Goal:** Make existing client diagnostics, Sentry, and Grafana/Prometheus useful, privacy-conscious, and testable across Circle frontend and backend.

**Architecture:** Extend existing bounded diagnostics and reporting boundaries. Link HTTP incidents with opaque per-attempt request IDs, keep low-cardinality route/event metadata, and repair proven collection/alerting defects. Preserve the existing error policy and optional monitoring stack.

**Tech Stack:** Expo 55 / React Native, TypeScript, Node tests, Jest, NestJS, Sentry, Prometheus, Grafana, Alertmanager, Loki/Alloy.

## Global constraints

- Preserve existing user changes and the previous backend observability worktree.
- No deployment, real Sentry events, outgoing alert notifications, cloud mutations, commits, or dependency upgrades.
- No request/response bodies, tokens, account/device identifiers, chat text, coordinates, raw dynamic routes, or arbitrary error text in new diagnostics.
- IDs must not appear in fingerprints or metric/collection labels. Existing approved correlation tags may remain searchable.
- Preserve API results, auth refresh ordering, session isolation, retries, and fatal versus recoverable process behavior.
- Run failing regression tests before production changes, then focused tests and full project checks.

## Task 1: Client request diagnostics and correlation

**Files:** `src/services/api/client.ts`, `api-error.ts`; small `src/observability/http-diagnostics.ts`; `src/utils/client-diagnostics.ts`; related Node tests.

**Interfaces:** `ApiError.requestId?: string`, `ApiError.durationMs?: number`; `requestId` is an opaque UUID associated with one HTTP attempt, never the logical retry group. Sentry report context receives `requestId`, `durationMs`, safe endpoint, method, status and failure kind.

- [x] Add failing tests for metadata-only dev logs, alphabetic dynamic IDs, request/body read errors, rejected correlation values, and refresh/retry attempt association.
- [x] Add safe terminal breadcrumbs with bounded timing and status. Use the response `X-Request-Id` when a valid UUID; generate a fresh request UUID for each outbound attempt. Preserve failure outcomes if telemetry throws.
- [x] Stop request/response body and arbitrary header logging; keep the old `logResponseBody` option source-compatible but never use it to expose bodies.
- [x] Test the real diagnostic module through the API client, including production no-console behavior. Existing auth refresh and timeout suites must stay green.

## Task 2: Frontend Sentry reliability and useful safe metadata

**Files:** `src/observability/sentry.ts`, `test/sentry-observability.test.js`, build configuration tests; add focused privacy regressions only as needed.

- [x] Prove DSN fails Expo static env substitution; use a direct `process.env.EXPO_PUBLIC_SENTRY_DSN` access while preserving injected configuration tests.
- [x] Resolve explicit/staging/release environment and validate sampling inputs. No DSN remains a no-op; initialization/wrapping must never crash the app.
- [x] Keep strictly validated trace IDs and bounded operational timing/measurement metadata through final sanitization. Keep account identity, native arbitrary context, exception prose, and span descriptions excluded.
- [x] Integrate Task 1 `requestId` and `durationMs`; correlation never alters issue grouping. Explain native SDK filtering boundaries rather than claiming JavaScript hooks sanitize native-only events.
- [x] Run focused Sentry/privacy/build tests, typecheck, lint and behavior tests.

## Task 3: Backend Sentry process and startup boundary

**Worktree:** `.codex-worktrees/circle-be-observability`.
**Files:** `src/logging/error-aggregation.service.ts`, `unhandled-rejection-guard.ts`, `src/main.ts`, `src/setup.ts`, minimal startup module, corresponding specs, production start configuration.

- [x] Reproduce real-SDK duplicate rejection capture and raw stderr with an in-memory transport in a child process.
- [x] Establish one rejection capture owner and safe fatal handling; recoverable rejection continues, uncaught exception flushes with a timeout and exits nonzero.
- [x] Initialize optional Sentry once before framework imports, including file/env config precedence, and report startup failures without printing raw `inspect(error)`.
- [x] Preserve validated exception mechanism and trace context; attach current job/run ID when relevant without importing business modules.
- [x] Expose `X-Request-Id` through existing CORS configuration. Enable production local source-map support and verify compiled stack mapping.
- [x] Run focused tests, backend portable suite, build and non-mutating lint. No live service tests without separate authorization.

## Task 4: Monitoring correctness and coverage

**Files:** existing backend `monitoring/` Prometheus rules, rule tests, Grafana dashboards and runbooks; application metric definitions only where the audit proves necessary.

- [x] Correct cron metric label collision with scrape `job`; rule tests must use actual post-scrape label sets and prove one healthy cron cannot hide another stalled/failing cron.
- [x] Audit target absence, alert delivery health, readiness probes, resource and dependency signals, and optional log pipeline health. Implement concrete gaps with alert scenarios and native configuration validation.
- [x] Keep required versus optional deployment topology explicit, avoid false-positive alerts for disabled optional components, and document operator-only configuration.

## Task 5: Review and verification

- [x] Independently review each changed area for privacy, false positives, lost events and business behavior regressions.
- [x] Run frontend `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:behavior`; backend build/lint/unit checks; native Prometheus rules/config tests.
- [x] Write a practical monitoring matrix and incident workflow distinguishing code readiness from real notification delivery, native crash reporting, live E2E and deployment verification.

## Progress

- Audit baseline: frontend 58 focused API/Sentry/diagnostic tests passed. Full frontend dependencies were incomplete and are being restored from the existing lockfile.
- Confirmed gaps: Expo DSN static substitution, missing error trace context, backend process double capture/raw stderr, late startup initialization, cron scrape label collision.
- Implementation and independent reviews completed locally. Review corrections include malformed-refresh correlation, throwing SDK wrap containment, real process mechanism flags, a referenced hard flush deadline, cron-isolation behavioral fixtures, and Alloy dashboard rates.
- Final frontend: `npm run ci` passes end-to-end (typecheck, Expo config, lint, full Node tests, and 283 behavior tests). The release-fixture tests explicitly resolve Git for Windows Bash and use controlled command stubs, while keyboard path assertions use platform-correct paths. `CHAT_DELIVERY_ID_CONFLICT` is mirrored with five-language copy; localization and cross-repository contract tests pass 19/19.
- Final backend: build and non-mutating ESLint pass; portable Jest 3677 pass, 7 existing skips (two Bash/Linux-specific files excluded). Monitoring Node contracts 29/29; pinned promtool 40 rules and behavioral fixtures pass; dev/prod config checks pass with expected absent file-discovery warnings in the isolated fixture.
- No deployment, real Sentry events, alert notifications, source-map upload, native crash, or live E2E. See `docs/observability-verification.md` for commands and residual boundaries.
