# LiveKit fallback exit and notification navigation telemetry hardening

## Scope

Fix two existing production defects without changing unrelated call or notification behavior:

1. Leaving `GroupCallScreen` through either unavailable-state back button must notify the backend before local call state disappears.
2. A router exception raised while opening a push notification must not send route parameters or user-provided text to Sentry.

## Root causes

`GroupCallScreen` currently calls `resetCallState()` before `router.back()` in both fallback branches. Clearing `activeCall` makes the screen-unmount call to `leaveActiveCall()` a no-op, so the backend can retain a ghost `JOINED` member.

`PushNotificationRouteHandler` passes the raw router exception into `reportNotificationFailure`. Router messages and stacks may embed the notification-derived route, whose parameters can include user-provided text and identifiers. Generic URL/secret redaction cannot reliably recognize arbitrary route content.

## Design

### Fallback call exit

Add one `handleFallbackBack` callback in `GroupCallScreen`. It starts `leaveActiveCall()` and then navigates back immediately. Both fallback back buttons use this callback, and the screen no longer selects or directly invokes `resetCallState`.

`leaveActiveCall()` already synchronously captures the active call and marks its ID pending before its first await. Its existing idempotency guard therefore makes the subsequent unmount cleanup harmless, while its `finally` block clears only the call that was actually exited. Navigation remains immediate even when the backend is slow or offline.

### Safe navigation telemetry

Keep the raw exception in the existing development-only console path. At the production reporting boundary in `reportNotificationFailure`, replace errors for `notification_navigate_failed` with a new constant error carrying a fixed name and message. Do not copy the original message, stack, cause, or custom properties.

Other notification events retain their current errors. Stable event/context tags continue to provide grouping and the allowlisted notification ID/source context remains available.

## Testing

Follow red-green TDD:

- Extend the call lifecycle regression test to require both fallback exits to use `leaveActiveCall`, navigate back, and contain no direct `resetCallState` path.
- Add a notification failure reporting test whose raw router error message and stack contain a route, nickname, conversation ID, and message ID. Assert that the object passed to `reportError` has the fixed safe name/message and contains none of those values.
- Run the two targeted test files first, then typecheck, lint, the complete Node test suite, and behavior Jest when dependencies are available.

## Non-goals

- Changing normal LiveKit hangup or unmount behavior.
- Changing notification signature-budget lifecycle.
- Globally rewriting Sentry error sanitization.
- Preserving production router exception text or stack; preventing data exposure takes precedence for this event.
