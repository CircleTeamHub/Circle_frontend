# PR 49 Review Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the session-refresh singleton race regression coverage from the stale PR 49 review branch without reintroducing stale route code.

**Architecture:** Add one behavioral Node test to the existing API-client VM harness. The test creates an old refresh, starts a newer-session refresh, settles the old one, then proves a third request shares the newer refresh promise. Validation also regenerates Expo typed routes and keeps route helper return types narrow enough to avoid TypeScript union expansion.

**Tech Stack:** TypeScript, Node built-in test runner, Node `vm`, Expo/TypeScript tooling.

## Global Constraints

- Base all changes on current `origin/main`; do not merge `pr-49-review`.
- Preserve current notification routing and all existing session-refresh tests.
- Modify `src/services/api/client.ts` only when the added regression test demonstrates a production behavior failure.
- Validate with focused tests, `npm run typecheck`, `npm run lint`, and `npm test`.

---

### Task 1: Add the stale-refresh cleanup regression test

**Files:**
- Modify: `test/api-client-refresh-session.test.js` after the `logout handler drops an in-flight refresh singleton` test.
- Test: `test/api-client-refresh-session.test.js`.

**Interfaces:**
- Consumes: `loadApiClientHarness()`, `deferred()`, `waitFor()`, and `apiClient()` from the existing test harness.
- Produces: A regression test proving `refreshPromise` cleanup from an old session cannot clear the active refresh promise for a newer session.

- [x] **Step 1: Add the behavioral test without changing runtime code**

```js
test('settled stale refresh cleanup does not drop a newer in-flight refresh promise', async () => {
  const harness = loadApiClientHarness();
  const oldRefresh = deferred();
  const newRefresh = deferred();
  harness.refreshResponses.push(oldRefresh, newRefresh);

  const oldRequest = harness.apiClient('/profile/me');
  await waitFor(() => harness.fetchCalls.length === 2);

  const logoutHandler = harness.getLogoutHandler();
  assert.equal(typeof logoutHandler, 'function');
  logoutHandler();
  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;

  const newRequest = harness.apiClient('/wallet');
  await waitFor(() =>
    harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh')).length === 2,
  );

  oldRefresh.resolve(response(true, 200, {
    code: 0,
    message: 'ok',
    data: { accessToken: 'access-a-next', refreshToken: 'refresh-a-next' },
  }));
  await assert.rejects(oldRequest, /session changed/i);

  const thirdRequest = harness.apiClient('/settings');
  await waitFor(() => harness.fetchCalls.some(([url]) => String(url).endsWith('/settings')));

  newRefresh.resolve(response(true, 200, {
    code: 0,
    message: 'ok',
    data: { accessToken: 'access-b-next', refreshToken: 'refresh-b-next' },
  }));

  await assert.rejects(newRequest);
  await assert.rejects(thirdRequest);
  assert.equal(
    harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh')).length,
    2,
  );
});
```

- [x] **Step 2: Run the focused test**

Run: `node --test test/api-client-refresh-session.test.js`

Expected: PASS, including `settled stale refresh cleanup does not drop a newer in-flight refresh promise`. A third `/auth/refresh` request means the identity-based cleanup is broken.

- [x] **Step 3: Change runtime logic only if Step 2 fails**

Keep the cleanup identity guard in `src/services/api/client.ts`:

```ts
.finally(() => {
  if (refreshPromise === activeRefreshPromise) {
    refreshPromise = null;
    refreshPromiseSessionEpoch = null;
  }
});
```

Do not replace it with unconditional cleanup, because an old session can settle after a newer session has created its own refresh promise.

- [x] **Step 4: Commit the regression coverage**

```bash
git add test/api-client-refresh-session.test.js
git commit -m "test(auth): cover stale refresh cleanup race"
```

### Task 2: Verify the integration candidate

**Files:**
- Verify: `test/api-client-refresh-session.test.js` and the repository-wide checks.

**Interfaces:**
- Consumes: The Task 1 regression test and current `main` implementation.
- Produces: Evidence that the rebuilt follow-up branch is type-safe and test-clean without touching stale notification-route code.

- [x] **Step 1: Run static checks**

Run: `npm run typecheck`

Expected: exit code 0.

- [x] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit code 0 with no warnings.

- [x] **Step 3: Run the Node test suite**

Run: `npm test`

Expected: exit code 0.

- [x] **Step 4: Confirm the branch contains no stale route changes**

Run: `git diff --name-only origin/main...HEAD`

Expected: only `docs/superpowers/`, `test/api-client-refresh-session.test.js`, `src/components/ui/nav-header.tsx`, and `src/features/user/utils/routes.ts`.

### Task 3: Repair current-main typecheck blockers

**Files:**
- Modify: `src/components/ui/nav-header.tsx` and `src/features/user/utils/routes.ts`.
- Regenerate: `.expo/types/router.d.ts` through Expo CLI; the generated file remains untracked.

**Interfaces:**
- Consumes: Expo typed-route generation and the existing profile/chat route helpers.
- Produces: a clean `npm run typecheck` without weakening route validation.

- [x] **Step 1: Regenerate Expo typed routes**

Run: `npx expo customize tsconfig.json`

Expected: generated route types include the current messages circle, invitation, and verification files.

- [x] **Step 2: Keep helper return types finite**

Define the profile and chat-detail return unions in `src/features/user/utils/routes.ts`, then use them as the two helper return types. This preserves valid route shapes without propagating the full application-wide `Href` union into `ChatInfoScreen`.

- [x] **Step 3: Keep NavHeader dependencies a tuple**

Use `as const` on the `useCallback` dependency list in `src/components/ui/nav-header.tsx` so TypeScript does not infer one union across the fallback `Href`, navigation object, callback, and router object.
