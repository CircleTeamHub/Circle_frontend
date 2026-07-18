# LiveKit Fallback and Sentry Navigation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure unavailable-call exits notify the backend and ensure push-navigation router exceptions cannot expose route or user text through Sentry.

**Architecture:** Reuse the existing idempotent `leaveActiveCall()` boundary for both `GroupCallScreen` fallback buttons. Canonicalize only `notification_navigate_failed` errors at the centralized notification-to-Sentry boundary while preserving the raw error for development-only console diagnostics and in-process deduplication.

**Tech Stack:** React Native, Expo Router, TypeScript, Node.js `node:test`, existing VM-based TypeScript test harness.

## Global Constraints

- Do not change normal LiveKit hangup or unmount behavior.
- Do not change the notification signature-budget lifecycle.
- Do not broaden or replace global Sentry sanitization.
- Do not copy the raw router error message, stack, cause, or custom properties into production telemetry.
- Keep fallback navigation immediate even if the backend leave request is slow or fails.

---

### Task 1: Route fallback call exits through the backend-aware teardown

**Files:**
- Modify: `test/call-lifecycle.test.js`
- Modify: `src/features/call/screens/GroupCallScreen.tsx`

**Interfaces:**
- Consumes: `leaveActiveCall(): Promise<void>` from `src/features/call/call-session-teardown.ts`.
- Produces: a component-local `handleFallbackBack(): void` callback used by both fallback back buttons.

- [ ] **Step 1: Write the failing fallback-exit regression test**

Append this test to `test/call-lifecycle.test.js`:

```js
test('GroupCallScreen fallback exits notify the backend before navigating back', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/features/call/screens/GroupCallScreen.tsx'),
    'utf8',
  );

  assert.doesNotMatch(src, /\bresetCallState\b/);
  assert.match(
    src,
    /const handleFallbackBack = useCallback\(\(\) => \{\s*void leaveActiveCall\(\);\s*router\.back\(\);\s*\}, \[\]\);/,
  );
  assert.equal(
    (src.match(/onPress=\{handleFallbackBack\}/g) ?? []).length,
    2,
    'both fallback back buttons must use the backend-aware exit',
  );
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
node --test test/call-lifecycle.test.js
```

Expected: FAIL in the new test because the screen still contains `resetCallState` and neither fallback button uses `handleFallbackBack`.

- [ ] **Step 3: Implement the minimal fallback callback**

In `GroupCallScreen`, remove the `resetCallState` store selector, add this hook before the conditional returns, and use it for both fallback buttons:

```ts
const handleFallbackBack = useCallback(() => {
  void leaveActiveCall();
  router.back();
}, []);
```

Replace both inline fallback `onPress` functions with:

```tsx
onPress={handleFallbackBack}
```

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run:

```bash
node --test test/call-lifecycle.test.js
```

Expected: all call lifecycle tests PASS with zero failures.

- [ ] **Step 5: Commit the call fix**

```bash
git add test/call-lifecycle.test.js src/features/call/screens/GroupCallScreen.tsx
git commit -m "fix(call): notify backend from fallback exits"
```

### Task 2: Canonicalize navigation failures before Sentry

**Files:**
- Modify: `test/notification-failure-reporting.test.js`
- Modify: `src/features/notifications/utils/report-failure.ts`

**Interfaces:**
- Consumes: `NotificationFailureEvent` and the existing `reportError(error, context)` sink.
- Produces: a private `errorForProductionReport(event, error): unknown` boundary that returns a constant `NotificationNavigationError` for `notification_navigate_failed` and otherwise returns the original error.

- [ ] **Step 1: Write the failing privacy regression test**

Add this test after the existing navigation-reporting test in `test/notification-failure-reporting.test.js`:

```js
test('navigation failures discard route and user text before Sentry', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();
  const rawError = new Error(
    'No route for /chat/detail?nickname=Alice&conversationID=conv-secret&messageID=msg-secret',
  );
  rawError.stack = `${rawError.message}\n    at /profile/Alice`;

  reportNotificationFailure('notification_navigate_failed', rawError, {
    notificationId: 'notification-1',
    source: 'system_push',
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].error.name, 'NotificationNavigationError');
  assert.equal(reports[0].error.message, 'Notification navigation failed');
  assert.doesNotMatch(
    `${reports[0].error.message}\n${reports[0].error.stack ?? ''}`,
    /Alice|conv-secret|msg-secret|\/chat\/detail|\/profile\//,
  );
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
node --test test/notification-failure-reporting.test.js
```

Expected: FAIL because `reportNotificationFailure` currently forwards the raw router error.

- [ ] **Step 3: Implement event-specific canonicalization**

Add this private helper after `failureSignature` in `report-failure.ts`:

```ts
function errorForProductionReport(
  event: NotificationFailureEvent,
  error: unknown,
): unknown {
  if (event !== 'notification_navigate_failed') return error;

  const safeError = new Error('Notification navigation failed');
  safeError.name = 'NotificationNavigationError';
  return safeError;
}
```

Keep deduplication based on the original error, then change only the final reporting call:

```ts
reportError(errorForProductionReport(event, error), {
  ...context,
  operation: 'notifications',
  kind: event,
});
```

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run:

```bash
node --test test/notification-failure-reporting.test.js
```

Expected: all notification failure reporting tests PASS with zero failures.

- [ ] **Step 5: Commit the telemetry fix**

```bash
git add test/notification-failure-reporting.test.js src/features/notifications/utils/report-failure.ts
git commit -m "fix(notifications): canonicalize navigation telemetry"
```

### Task 3: Full verification

**Files:**
- Verify only; no planned production changes.

**Interfaces:**
- Consumes: the completed Task 1 and Task 2 commits.
- Produces: fresh evidence that targeted behavior and repository checks pass.

- [ ] **Step 1: Run both targeted suites together**

```bash
node --test test/call-lifecycle.test.js test/notification-failure-reporting.test.js
```

Expected: all targeted tests PASS with zero failures.

- [ ] **Step 2: Run TypeScript and lint checks**

```bash
npm run typecheck
npm run lint
```

Expected: both commands exit 0 with no TypeScript or lint errors.

- [ ] **Step 3: Run the complete Node test suite**

```bash
npm test
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 4: Run behavior Jest**

```bash
npm run test:behavior
```

Expected: exit 0 with zero failed suites or tests.

- [ ] **Step 5: Check patch hygiene and branch status**

```bash
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: `git diff --check` exits 0; status shows the feature branch with no uncommitted changes.
