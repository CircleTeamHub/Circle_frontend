# Session Refresh Request Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent an authenticated request from being refreshed or replayed under a different login session, then linearize PR #49 on current `origin/main`.

**Architecture:** `sessionEpoch` becomes a login-session generation that remains stable across token rotation. `apiClient` captures that generation before the first request, validates it before refresh and retry, and shares a refresh singleton only with callers from the same generation.

**Tech Stack:** TypeScript, Zustand, Node test runner, Expo typed routes, Git.

## Global Constraints

- Do not add dependencies or change API payloads.
- Do not clear or overwrite a newer login session from stale work.
- Do not replay an old endpoint/body with a newer session's token.
- Preserve same-session single-flight refresh and one automatic retry.
- Final history must be linear on current `origin/main`.

---

### Task 1: Request-Level Session Ownership

**Files:**
- Modify: `test/api-client-refresh-session.test.js`
- Modify: `test/auth-store-hydration.test.js`
- Modify: `src/services/api/client.ts`
- Modify: `src/stores/authStore.ts`

**Interfaces:**
- Consumes: `useAuthStore.getState().sessionEpoch`, `setSession`, `setTokens`, `clearSession`.
- Produces: request-level generation checks and a generation-owned refresh singleton.

- [ ] **Step 1: Extend the API harness with queued business responses**

Add a `requestResponses` queue. Non-refresh fetches consume a queued promise when present and otherwise retain the existing 401 default. Expose the queue from the harness so tests can defer the initial 401 and return successful retries.

```js
const requestResponses = [];

fetch: async (url, options) => {
  fetchCalls.push([url, options]);
  if (String(url).endsWith('/auth/refresh')) {
    const next = refreshResponses.shift();
    if (!next) throw new Error('missing refresh response');
    return next.promise;
  }
  const next = requestResponses.shift();
  return next
    ? next.promise
    : response(false, 401, { code: 1, message: 'expired', data: null });
},
```

- [ ] **Step 2: Write the failing pre-401 account-switch test**

Start a POST under account A with a deferred initial response, switch the harness to account B before resolving the response as 401, then assert the request rejects without calling `/auth/refresh` or replaying the POST.

```js
test('request is not refreshed or replayed after the session changes before its 401 response', async () => {
  const harness = loadApiClientHarness();
  const initial = deferred();
  harness.requestResponses.push(initial);

  const request = harness.apiClient('/wallet/transfer', {
    method: 'POST',
    body: { amount: 1 },
  });
  await waitFor(() => harness.fetchCalls.length === 1);

  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;
  initial.resolve(response(false, 401, { code: 1, message: 'expired', data: null }));

  await assert.rejects(request, /session changed/i);
  assert.equal(harness.fetchCalls.length, 1);
});
```

- [ ] **Step 3: Write same-session success and concurrent single-flight tests**

The success test returns 401, refresh success, then business success; assert the retry uses the refreshed Authorization header and the session generation is unchanged. The concurrency test starts two requests, holds one refresh deferred, and asserts only one refresh call occurs before both retries complete.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```text
node --test test/api-client-refresh-session.test.js test/auth-store-hydration.test.js
```

Expected: the pre-401 test fails because `/auth/refresh` and a retry occur under account B; the auth-store expectation fails because `setTokens` currently increments `sessionEpoch`.

- [ ] **Step 5: Make `sessionEpoch` stable across token rotation**

Update the state comment and remove `sessionEpoch` from the `setTokens` state patch. Update the auth-store test to expect no generation change from `setTokens`.

```ts
setTokens: ({ accessToken, refreshToken, imToken }) =>
  set((state) => ({
    accessToken,
    refreshToken,
    imToken:
      typeof imToken === 'string' && imToken.length > 0
        ? imToken
        : state.imToken,
    isAuthenticated: true,
  })),
```

- [ ] **Step 6: Add request and refresh ownership checks**

Add `refreshPromiseSessionEpoch`, a shared session-changed error factory, and an assertion helper. Pass the captured generation into `refreshAccessToken`. Share an existing promise only when its owner generation matches.

At the start of `apiClient`, capture the generation for authenticated retryable calls. Immediately before refresh and immediately before retry, assert the generation is still active.

```ts
const requestSessionEpoch =
  auth && retryOnAuthError ? useAuthStore.getState().sessionEpoch : null;

if (initialRequest.res.status === 401 && auth && retryOnAuthError) {
  assertSessionEpoch(requestSessionEpoch);
  const nextAccessToken = await refreshAccessToken(requestSessionEpoch);
  assertSessionEpoch(requestSessionEpoch);
  // retry with nextAccessToken
}
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```text
node --test test/api-client-refresh-session.test.js test/auth-store-hydration.test.js
npm run typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 8: Commit the behavior fix**

```text
git add src/services/api/client.ts src/stores/authStore.ts test/api-client-refresh-session.test.js test/auth-store-hydration.test.js
git commit -m "fix(auth): bind retries to the originating session"
```

### Task 2: Linear Rebase and Final Verification

**Files:**
- Verify: `src/features/discover/screens/DiscoverScreen.tsx`
- Verify: `src/features/notifications/utils/snackbar-route.ts`
- Verify: `test/snackbar-route.test.js`

**Interfaces:**
- Consumes: current `origin/main`, branch cut point `c5acca4`.
- Produces: a linear `fix/session-refresh-epoch` branch with no merge commits above `origin/main`.

- [ ] **Step 1: Refresh `origin/main` and create a temporary backup ref**

```text
git fetch origin main:refs/remotes/origin/main
git branch backup/session-refresh-epoch-pre-rebase HEAD
```

- [ ] **Step 2: Rebase branch-specific commits**

```text
git rebase --onto origin/main c5acca4
```

Resolve route conflicts by keeping literal typed routes without `as Href`. Preserve the request-ownership tests and implementation.

- [ ] **Step 3: Verify the rebased diff and history**

```text
git rev-list --merges origin/main..HEAD
git diff --check origin/main..HEAD
git diff --stat origin/main..HEAD
node --test --test-name-pattern="notification center routes stay checked" test/snackbar-route.test.js
```

Expected: no merge commits are printed, diff check exits 0, and the route regression passes.

- [ ] **Step 4: Run full CI**

```text
npm run ci
```

Expected: typecheck, Expo config, lint, Node tests, and Jest behavior tests all pass.

- [ ] **Step 5: Remove the temporary backup only after verification**

```text
git branch -D backup/session-refresh-epoch-pre-rebase
```

Do not push the rewritten published branch without explicit force-push approval.
