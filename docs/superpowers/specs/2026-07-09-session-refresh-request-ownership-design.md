# Session Refresh Request Ownership Design

## Context

The existing refresh guard prevents an in-flight refresh from overwriting a
newer session. It does not protect the earlier window where an authenticated
business request starts under account A, the active session changes, and the
old request later receives a 401. In that case the retry path can refresh and
replay the old endpoint and body with account B's token.

The branch also has overlapping merge history with `main`. Its source tree
passes locally, while GitHub's synthetic merge restores two `as Href` casts and
fails the route regression test.

## Decision

Treat `sessionEpoch` as a login-session generation, not a token-generation
counter.

- Increment it when `setSession` activates a login session.
- Increment it when `clearSession` ends a login session.
- Do not increment it when `setTokens` rotates credentials inside the same
  login session.

Every authenticated `apiClient` call captures the generation before its first
request. If the generation changes before refresh begins or before the request
is retried, reject with the existing localized session-changed `ApiError` and do
not refresh or replay the endpoint.

The refresh singleton records the generation that owns it. A caller may share
the singleton only when its generation matches. This preserves one refresh for
concurrent 401 responses in one session without making a newer session await an
older session's refresh.

## Error Handling

Session-change failures are expected 401-class client errors. They must not
clear the newer session and must not be reported as unexpected server failures.
Refresh failures still clear local session state only when the refresh belongs
to the currently active generation.

## Testing

Regression coverage will prove:

1. A request started under account A is not refreshed or replayed after the
   session changes before its initial 401 response.
2. A normal same-session refresh rotates tokens and retries the request once.
3. Concurrent same-session 401 responses share exactly one refresh.
4. Existing stale-success, stale-failure, and logout-reset cases remain green.
5. The GitHub route regression remains green after rebasing onto current
   `origin/main`.

## Rebase Strategy

The effective auth baseline is already present in current `origin/main` through
PR #46, and PR #50 later placed the typed-routes fix in that baseline. After the
fix is committed and verified, rebuild the branch as a linear series on current
`origin/main`, preserving only the request-ownership hardening, tests, and this
design/plan. Verify the route regression against the updated baseline. Keep a
temporary local backup ref until the rebased tree and full CI have been
verified.
