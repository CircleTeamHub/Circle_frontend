# PR 49 Review Follow-up

## Goal

Rebuild the useful session-refresh regression coverage from the stale
`pr-49-review` branch on top of current `main`, without reintroducing its
outdated notification-route code or replacing existing tests.

## Scope

- Keep the current notification routing implementation unchanged.
- Keep the current session-refresh tests, including concurrent requests in a
  newer session.
- Add a behavioral regression test proving that completion of an old refresh
  cannot clear the in-flight refresh promise owned by a newer session.
- Change `src/services/api/client.ts` only if the new regression test fails.

## Validation

Run the focused session-refresh test, TypeScript typecheck, lint, and the
repository's Node test suite. The result must contain no merge conflicts and
must preserve all current session-refresh coverage.
