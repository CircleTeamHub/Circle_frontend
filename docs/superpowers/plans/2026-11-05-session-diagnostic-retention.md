# Session diagnostic retention implementation plan

> **For agentic workers:** Execute in this existing isolated branch with focused tests and an independent review. User authorization is to finish the logging and investigation procedure; do not merge, deploy, or replace the phone build without authorization.

**Goal:** Preserve a bounded, exportable, redacted explanation of session loss even after logout, re-login, app restart or unavailable Sentry transport.

**Architecture:** Keep the existing Sentry event. Save an independent local snapshot in the existing AsyncStorage dependency before the in-memory session/breadcrumbs are reset. Store only fixed causes, booleans, route templates, timing and random correlation IDs. Reuse one export button on the login and settings screens.

**Tech Stack:** TypeScript, AsyncStorage, existing HTTP diagnostic normalization, Sentry, Expo Clipboard, Node tests and Jest.

## Global constraints

- Do not change auth acceptance, refresh, revocation or teardown rules.
- Never persist tokens, passwords, account/device/message identifiers, headers, bodies, raw URLs or exception text in the diagnostic journal.
- Keep at most five incidents for 30 days and 20 HTTP attempts per incident.
- Keep normal account switching and user-initiated logout out of error reporting; label them in the local journal.
- Diagnostics must not block session cleanup when storage fails.
- Leave the original dirty worktree untouched.

## Task 1: Durable session evidence and export

**Files:**
- Create `src/observability/session-diagnostics.ts`, `test/session-diagnostics.test.js` and `src/components/app/session-diagnostics-button.tsx` with a focused behavior spec.
- Update `src/services/auth/session.ts`, `src/stores/authStore.ts`, `app/_layout.tsx` and existing logout callers with explicit causes.
- Update `src/utils/client-diagnostics.ts`, `src/observability/sentry.ts` and API malformed-refresh diagnostics.
- Mount the export button in `LoginScreen.tsx` and `AppSettingsScreen.tsx`, with translations in all five existing locales.
- Update `docs/observability.md` with exact collection/query/retention steps and evidence limits.

**Interfaces:**
```ts
recordSessionDiagnostic(reason: SessionDiagnosticReason, context?: SessionDiagnosticContext): string;
readSessionDiagnostics(): Promise<readonly SessionDiagnosticRecord[]>;
```

- [x] Write failing tests for restart retention, pre-clear HTTP snapshots, independent local retention with error reporting disabled, corrupt/injected persisted input, storage failure, bounded concurrent writes and expiry.
- [x] Implement a fixed-schema journal and whitelist reconstruction at its storage boundary. Reuse `safeHttpEndpoint`, `safeHttpRequestId`, `createHttpRequestId` and existing breadcrumb snapshots.
- [x] Wire all current automatic, startup and explicit user cleanup paths, retaining actual HTTP status and response-shape flags for malformed refresh results.
- [x] Test the export control: visible after an incident, copies only redacted JSON, reports a copy failure, and mount it on login/settings without requiring authentication.
- [x] Run focused tests, typecheck, lint and the full Node suite; run the affected behavior tests.
- [x] Request an independent correctness/privacy review and resolve actionable findings. Changes prepared for ready-for-review PR #336 with the final behavior and verified limits.

Final verification: 3568 Node tests, 42 targeted behavior tests, typecheck and lint passed. Review regressions cover Clipboard resolving false and temporary journal reads failing while writes remain available. The latter must never overwrite unknown previous incidents; recovery merges the retained memory and disk copies. No remaining P1/P2 review findings. New retention/export code requires a new App build; the previously installed private diagnostic APK contains the earlier Sentry-only diagnostics.

## Verification

```powershell
node --test test/session-diagnostics.test.js test/auth-session.test.js test/auth-store-hydration.test.js test/api-client-refresh-session.test.js test/sentry-observability.test.js test/diagnostics-sentry-breadcrumbs.test.js
npm run typecheck
npm run lint
npm test
npm run test:behavior -- --runInBand src/components/app/session-diagnostics-button.spec.tsx src/components/app/session-bootstrap.spec.tsx src/hooks/use-auth.spec.tsx
```

Expected: persistence survives a new module/runtime using the same backing store; exports contain no supplied secret or identifier canaries; failed native storage does not interrupt auth; all current auth regression tests continue to pass.
