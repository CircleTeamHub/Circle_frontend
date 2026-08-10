# Sentry Observability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-value Sentry privacy and reliability gaps in the mobile app and API without turning expected business failures into noisy events.

**Architecture:** Keep the existing manual, allowlisted reporting model. Add global SDK redaction to error events, breadcrumbs, transactions, and spans as a last line of defense; replace arbitrary exception messages with stable operation-based messages; attach only a privacy-safe internal user id; and report repeated realtime failures through lifecycle- or process-bounded dedupers. Expose the existing backend aggregation provider to non-HTTP code through a configured process-local reporting function. Tagged signed releases require source-map upload with one validated release/dist identity, while daily and ordinary local builds remain upload-disabled.

**Tech Stack:** Expo/React Native, TypeScript, Node test runner, NestJS, Jest, Sentry React Native/Node SDK, GitHub Actions.

---

### Task 1: Frontend global privacy boundary and release identity

**Files:**
- Modify: `src/observability/sentry.ts`
- Modify: `test/sentry-observability.test.js`

- [x] Add failing tests proving event, breadcrumb, transaction, and span hooks remove structured sensitive data and replace arbitrary exception text.
- [x] Add failing tests proving release/dist are resolved from build-time configuration and that user identity contains only an internal id.
- [x] Run `node --test test/sentry-observability.test.js` and confirm the new assertions fail for missing behavior.
- [x] Implement pure global sanitizers, release/dist resolution, and a no-throw `setSentryUserId` helper.
- [x] Re-run the focused test and confirm it passes.

### Task 2: Frontend realtime and call failure reporting

**Files:**
- Modify: `src/chat-core/socket-manager.ts`
- Modify: `src/realtime/client.ts`
- Modify: `src/features/call/screens/GroupCallScreen.tsx`
- Modify: `app/_layout.tsx`
- Modify: `test/chat-core-socket-manager.test.js`
- Modify: `test/chat-core-dispatcher.test.js`
- Modify: `test/realtime-client.test.js`
- Modify: `test/call-video-support.test.js`
- Modify: `test/sentry-observability.test.js`

- [x] Add failing behavioral tests for repeated chat connection errors, lifecycle reset, and deduplicated malformed chat payloads.
- [x] Add source-contract tests for malformed realtime payload/auth-frame failures, LiveKit load/room failures, and auth-user synchronization.
- [x] Run the focused tests and confirm they fail for the missing instrumentation.
- [x] Add stable `operation`/`kind` tags, bounded per-session reporting, and user synchronization without including tokens, payloads, room ids, or chat content.
- [x] Re-run the focused tests and confirm they pass.

### Task 3: Backend safe operational-error reporting

**Files:**
- Modify: `../circle_be/src/logging/error-aggregation.service.ts`
- Modify: `../circle_be/src/logging/error-aggregation.service.spec.ts`
- Modify: `../circle_be/src/setup.ts`

- [x] Add failing tests proving captured exception message/stack are sanitized, automatic integrations are disabled, and operational errors receive stable component/operation tags.
- [x] Run `npm test -- --runInBand src/logging/error-aggregation.service.spec.ts` in `circle_be` and confirm failure.
- [x] Implement a sanitized error copy plus a configured process-local `reportOperationalError` entry point backed by the existing provider.
- [x] Register the provider during `setupApp` and re-run the focused test.

### Task 4: Backend WebSocket and scheduler blind spots

**Files:**
- Modify: `../circle_be/src/chat/chat.gateway.ts`
- Modify: `../circle_be/src/realtime/realtime.gateway.ts`
- Modify: `../circle_be/src/call/call.cleanup.ts`
- Modify: `../circle_be/src/temp-chat/temp-chat.cleanup.ts`
- Modify: `../circle_be/src/auth/refresh-token.cleanup.ts`
- Modify focused specs beside each component.

- [x] Add failing assertions that unexpected handshake, send/read/presence, room-join/snapshot, batch-claim, and scheduler failures call `reportOperationalError` with allowlisted component/operation tags.
- [x] Run the focused Jest specs and confirm the new assertions fail.
- [x] Add process-wide bounded deduplication and report only terminal or recovered-but-actionable failure points; keep auth rejects, limits, disconnects, expected 4xx, and transient retries out of Sentry.
- [x] Re-run focused specs and confirm they pass.

### Task 5: Android release source maps

**Files:**
- Modify: `.github/workflows/android-release.yml`
- Verify: `.github/workflows/daily-android-build.yml`
- Modify: `.github/scripts/validate-android-release.js`
- Modify: `test/android-release-workflow.test.js`
- Modify: `test/sentry-build-config.test.js`
- Modify: `docs/android-release.md`

- [x] Add failing workflow/config tests requiring release/dist environment values and Sentry upload credentials for production publishing while allowing daily validation to remain non-uploading.
- [x] Run the two focused tests and confirm failure.
- [x] Enable source-map upload in the signed release job, bind release/dist to the release tag and Android version code, and keep daily/local builds upload-disabled.
- [x] Document the required GitHub secrets/variables and re-run focused tests.

### Task 6: Verification

- [x] Run frontend focused tests, `npm run typecheck`, `npm run lint`, `npm run expo:config`, `npm test`, and current-worktree behavior tests.
- [x] Run backend focused tests, `npm run build`, and `npm test -- --runInBand --watchman=false` (the backend has no separate `typecheck` script).
- [x] Review `git diff --check`, both repository diffs, and confirm no secret, user content, token, signed URL, or unrelated user change was introduced by this work.
