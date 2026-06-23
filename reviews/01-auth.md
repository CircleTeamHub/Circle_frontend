# Review Batch 01 — Auth Core (3 files, 463 lines)

> Files: `src/stores/authStore.ts` · `src/services/api/client.ts` · `src/services/auth/session.ts`
> Date: 2026-05-14
> Surface: Auth & token lifecycle (highest risk)
> **Status: Patched (2 HIGH + 8 MEDIUM resolved). 2 MEDIUM deferred → see [Patches applied](#patches-applied) section below.**

---

## Patches applied

`git diff --stat src/`:
```
 src/services/api/client.ts   | 93 ++++++++++++++++++++++++++++++++++++++------
 src/services/auth/session.ts | 47 ++++++++++++++++++----
 src/stores/authStore.ts      | 17 ++++----
 3 files changed, 130 insertions(+), 27 deletions(-)
```

`tsc --noEmit`: clean (only the pre-existing `silence-dom-bridge-rejection.ts` declaration warning, unrelated).
`test/auth-session.test.js`: rewritten — **5/5 pass** (was 0/2 pre-patch — old assertions referenced pre-refactor direct imports of `@/im/client` / `@/realtime/client`).

### ✅ Fixed
- **`authStore.ts`** — `setUser` no longer escalates `isAuthenticated`/`isLoading` (was a latent bug for the 6 profile-update call sites).
- **`authStore.ts`** — `persist` now has `version: 1` (locks shape; future migrations have a baseline).
- **`authStore.ts`** — Rehydrate validation requires non-empty string tokens, not just truthy. Survives corrupted MMKV writes.
- **`authStore.ts` + `knownAccountsStore.ts`** — auth tokens moved from MMKV-backed persistence to `expo-secure-store`; non-secret metadata remains in MMKV with token fields stripped. Legacy MMKV token values migrate once and are removed from MMKV metadata. **Closes HIGH #3 (tokens in MMKV).**
- **`client.ts`** — `redactSensitiveFields` is now recursive + array-aware + case-insensitive. Closed the leak path through the `{ data: { accessToken } }` envelope used by every login/refresh response.
- **`client.ts`** — `SENSITIVE_KEYS` expanded: `authorization`, `cookie`, `idToken`, `apiKey`, `secret`.
- **`client.ts`** — New `safeBodyTextForLog` used in `readPayload`: response bodies are parsed-then-redacted before logging instead of dumped raw. **Closes HIGH #1 (login response leak in dev console).**
- **`client.ts`** — New `safeHeadersForLog` used in request log: caller-supplied `Authorization` / cookie headers no longer leak.
- **`client.ts`** — New `serializeRequestBody` detects `FormData`/`URLSearchParams`/`Blob`/`ArrayBuffer` and skips `JSON.stringify`. `Content-Type` is only set when we own the serialization — fetch will now set the multipart boundary correctly. Unblocks upload flows that previously sent empty bodies through this client.
- **`client.ts`** — `refreshAccessToken` runs `isTokenPair` runtime guard before calling `setTokens`. Backend rename / snake_case drift now throws a clear "刷新返回数据格式异常" instead of writing `Bearer undefined`.
- **`session.ts`** — Per-handler errors are collected and `console.warn`ed (dev only) at end of `clearLocalSession` instead of silently swallowed.
- **`session.ts`** — Store reset is **auth-first** now: `clearSession` runs before dependent-store resets. Prevents the race where a subscriber to "data went empty" fires a refetch while `isAuthenticated` is still true.
- **`session.ts`** — Belt-and-suspenders: if `persist.clearStorage` throws, falls back to `secureAuthStorage.removeItem('circle-im-auth')`, clearing SecureStore and the legacy MMKV key. Tokens cannot remain on disk after a "successful" logout, which was the worst failure mode in this file.
- **`session.ts`** — `registerLogoutHandler` returns an `unregister` function and dedupes by reference — HMR / test code can no longer accumulate handlers.
- **`test/auth-session.test.js`** — Rewritten to match the post-refactor handler-pattern. New coverage:
  - Auth-first reset ordering (regression test)
  - SecureStore fallback path when `persist.clearStorage` fails (new safeguard coverage)
  - `unregister` removes handler
  - Idempotent re-registration (HMR safety)

### ⏸ Deferred — needs your decision before patching

- **MEDIUM (client.ts) — Retry-after-refresh sentinel error.** When refresh succeeds but the retried request still 401s, we currently throw `ApiError(status=401)` to the caller. Best fix is a sentinel (`code: 'AUTH_RETRY_FAILED'`) that an auth boundary listens for and forces re-login. Architectural — defer to a dedicated auth-error-boundary pass.
- **MEDIUM (session.ts) — Other persisted stores not coordinated.** `clearLocalSession` clears `circle-im-auth` only. `circle-im-chat-preferences`, `circle-im-discover-filter`, `circle-im-circle-notification` likely persist user-scoped data that should be cleared on logout. Theme + language are device-scoped, should NOT be cleared. **Needs product decision per store; do not patch blindly.**

---

## Batch summary

These three files together form the **complete auth/session lifecycle** for the mobile app:

- **`authStore.ts`** — persisted Zustand store holding tokens + user.
- **`api/client.ts`** — fetch wrapper with auto Bearer injection + 401 → refresh → retry.
- **`auth/session.ts`** — logout orchestrator that runs registered teardown hooks then clears state + persistence.

The architecture is reasonable: refresh is a singleton promise (good concurrency), teardown uses a registration pattern to break import cycles (good), and auth tokens now use SecureStore with legacy MMKV migration. Non-secret auth metadata stays in MMKV after token stripping so SecureStore size limits do not break profile or multi-account persistence. The remaining deferred auth-core risks are architectural: auth-retry sentinel handling and which non-auth persisted stores should be wiped on logout.

**Severity totals: 3 HIGH · 12 MEDIUM · 6 LOW**

---

# File 1 — `src/stores/authStore.ts` (148 lines)

## Summary
Persisted Zustand store. Exports `useAuthStore` with `accessToken`, `refreshToken`, `imToken`, `user`, `isAuthenticated`, plus actions. `secureAuthStorage` splits persistence: token fields go to SecureStore, while `user` / `isAuthenticated` stay in MMKV metadata with tokens stripped. Old MMKV token values migrate once and are removed from MMKV metadata. On rehydrate, sets `hasHydrated=true` and clears session if tokens are incomplete.

## Findings

### `L74-148` [HIGH · SAFEGUARD] — Tokens persisted to MMKV, not SecureStore
**Resolved 2026-06-21:** `authStore` and `knownAccountsStore` now use `secureAuthStorage`; tokens are split into small SecureStore entries with one-shot legacy MMKV migration and stale-token removal from MMKV metadata. iOS uses `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so tokens remain readable after the first device unlock for IM background wakeups.

Original finding: `partialize` wrote `accessToken`, `refreshToken`, `imToken` to MMKV via `mmkvJsonStorage`. MMKV is **unencrypted by default on Android** (iOS uses Keychain-backed storage internally, less risky). A rooted device or a malicious backup tool can extract these tokens.

**Chosen fix:** switched auth token fields to `expo-secure-store` while keeping non-secret metadata in MMKV. This is stronger than storing raw tokens in MMKV and avoids SecureStore large-value failures from full profile / multi-account JSON payloads.

**Why:** Token theft is the single highest-impact mobile vuln. Even if the app doesn't process payments today, the chat history these tokens unlock is sensitive.

---

### `L106-111` [MEDIUM · BUG] — `setUser` sets `isAuthenticated: true` unconditionally
```ts
setUser: (user) =>
  set({ user, isAuthenticated: true, isLoading: false }),
```
If any code path calls `setUser` without first calling `setSession`/`setTokens`, `isAuthenticated` flips true while `accessToken` is `null`. Downstream `useAuth` consumers then think the user is authenticated and may request protected resources, which 401 immediately and trigger a refresh that has no `refreshToken` either → `clearLocalSession` → user kicked back to login mid-flow.

**Fix:** remove `isAuthenticated: true` from `setUser`. Identity should always be set together with tokens via `setSession`. If `setUser` is meant as a profile-update path, it should only mutate `user`.

---

### `L113-121` [LOW · MAINTAINABILITY] — `clearSession` doesn't reset `hasHydrated`
By design, but worth a one-line comment so a future reader doesn't "fix" it. `hasHydrated` is process-lifetime (false → true once on rehydrate, then stays true forever). The flag is "MMKV has been read at least once", not "we have a valid session".

---

### `L127-146` [MEDIUM · SAFEGUARD] — No persist `version` / `migrate` function
Zustand persist supports `version: number` + `migrate: (state, fromVersion) => state`. None set. If `AuthUser` adds a required field (e.g. a new tier), hydration of old state silently produces a `user` with missing fields → runtime crashes deep in UI when `user.newField.foo` is accessed.

**Fix:**
```ts
version: 1,
migrate: (persisted, fromVersion) => {
  if (fromVersion < 1) {
    // shape migration here
  }
  return persisted as AuthState;
},
```

---

### `L130-136` [LOW · CLARITY] — `isAuthenticated` is derivable; persisting it risks drift
`isAuthenticated` is always `Boolean(accessToken && refreshToken)` in practice. Storing it as an independent persisted field means a future write that only updates tokens (without setting the flag) could create a state where `accessToken` exists but `isAuthenticated` is false. Today the setters keep them in sync, but it's a footgun.

**Fix (optional):** drop `isAuthenticated` from `partialize`. Compute it in a selector: `useAuthStore((s) => Boolean(s.accessToken && s.refreshToken))`.

---

### `L17-44` [LOW · TYPING] — `role: string` / `status: string` should be string-literal unions
Same file uses `gender: 'male' | 'female' | 'other' | 'unset'` (good). `role` and `status` are wide `string`, so any consumer that does `if (user.role === 'admin')` has no compile-time guarantee the comparison is meaningful.

**Fix:** define `type UserRole = 'admin' | 'member' | ...` in `src/types/index.ts` after confirming the backend's enum.

---

### `L142-144` [MEDIUM · SAFEGUARD] — Doesn't validate token shape (just truthiness)
```ts
if (!state?.accessToken || !state?.refreshToken) {
  state?.clearSession();
}
```
Good defensive check, but doesn't validate that tokens are well-formed strings. If MMKV ever stores corrupted JSON (rare but possible after a crash mid-write), `accessToken` could be `{}` and pass the truthy check, then explode at first network call with `Authorization: Bearer [object Object]`.

**Fix:**
```ts
const valid = typeof state?.accessToken === 'string' && state.accessToken.length > 10
           && typeof state?.refreshToken === 'string' && state.refreshToken.length > 10;
if (!valid) state?.clearSession();
```

## Test gaps for authStore
- No test that `setUser` does NOT escalate `isAuthenticated` (after the fix above)
- No test for the rehydrate-corrupted-tokens path
- No test for partial fields in rehydrated state (missing `imToken`)

---

# File 2 — `src/services/api/client.ts` (266 lines)

## Summary
Generic HTTP client. Auto-injects Bearer token from `authStore`, scrubs sensitive fields in dev logs, retries once on 401 with refresh-token singleton promise. Throws `ApiError` for non-2xx or non-zero `code`.

## Findings

### `L86-104` [HIGH · SECURITY] — Successful response body logged verbatim (tokens leak in dev)
```ts
async function readPayload<T>(res: Response): Promise<ApiResponse<T> | null> {
  const text = await res.text();
  logApiEvent('response', { status: res.status, ok: res.ok, body: text });
  // ...
}
```
The `text` passed to `logApiEvent` is the raw response body. Login / register / refresh responses contain `accessToken`, `refreshToken`, `imToken` — all printed to console in dev. Anyone with Metro logs, adb logcat, or a screen recording captures the tokens. Doubly bad: `formatLogData` (which applies redaction) is **not** called here.

**Fix:**
```ts
function safeBodyForLog(text: string): string {
  if (!text) return text;
  try {
    const parsed = JSON.parse(text);
    return formatLogData(parsed) as string; // applies (recursive) redaction
  } catch {
    return '[non-json body]';
  }
}
// then:
logApiEvent('response', { status: res.status, ok: res.ok, body: safeBodyForLog(text) });
```
(Combine with the recursive-redaction fix below.)

---

### `L34-43` [HIGH · SECURITY] — `redactSensitiveFields` only scrubs top-level keys
```ts
function redactSensitiveFields(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    redacted[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : v;
  }
  return redacted;
}
```
**Bug:** if `value` is `{ data: { accessToken: '...' } }`, only top-level keys are checked. `data.accessToken` is NOT redacted — and the API response envelope is `{ code, message, data }`, so every login response has tokens one level deep.

Also: arrays of objects (e.g. an audit-log response) pass through with element fields un-scrubbed.

**Fix (recursive):**
```ts
const SENSITIVE_KEYS = new Set([
  'password', 'token', 'accessToken', 'refreshToken', 'imToken',
  'authorization', 'cookie', 'idToken', 'apiKey', 'secret',
]);
function redactSensitiveFields(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactSensitiveFields(v);
  }
  return out;
}
```

---

### `L136-143` [MEDIUM · SECURITY] — Request headers logged verbatim
```ts
logApiEvent('request', { url, method, auth, hasAccessToken: Boolean(accessToken), headers, body: formatLogData(body) });
```
`headers` is the caller-supplied `headers` argument. If a caller passes a custom `Authorization` (e.g. a presigned upload URL or third-party API), it lands in console. Also: `Authorization: Bearer ...` injected on L154 doesn't show here, but any custom auth does.

**Fix:** scrub headers before logging:
```ts
function safeHeaders(h: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}
// then:
logApiEvent('request', { ..., headers: safeHeaders(headers), ... });
```

---

### `L150-159` [MEDIUM · BUG] — Body is always `JSON.stringify`ed; breaks FormData uploads
```ts
...(body ? { body: JSON.stringify(body) } : {}),
```
`JSON.stringify(formData)` returns `"{}"` (FormData has no enumerable own properties). Any multipart upload that tries to go through this client silently sends an empty body. The `upload.ts` API file is likely doing its own fetch to work around this — verify in the next batch.

**Fix:** detect FormData / Blob / ArrayBuffer / URLSearchParams and skip stringify:
```ts
function serializeBody(body: unknown): { body: BodyInit; contentType?: string } | null {
  if (body == null) return null;
  if (body instanceof FormData) return { body }; // browser sets multipart boundary
  if (body instanceof URLSearchParams) return { body, contentType: 'application/x-www-form-urlencoded' };
  if (body instanceof Blob || body instanceof ArrayBuffer) return { body: body as BodyInit };
  return { body: JSON.stringify(body), contentType: 'application/json' };
}
```
And conditionally apply `Content-Type` based on the result.

---

### `L218-232` [MEDIUM · SAFEGUARD] — Refresh response shape not validated at runtime
```ts
const tokens = unwrapResponse(res, payload);
setTokens(tokens);
```
`tokens` is typed `{ accessToken: string; refreshToken: string }` but unwrapResponse returns whatever `data` happens to be at runtime. If the backend ever returns `{ access_token, refresh_token }` (snake_case), TypeScript is happy, `setTokens({ accessToken: undefined, refreshToken: undefined })` is called, the user appears authenticated with `Bearer undefined`, then every subsequent request 401s and re-triggers refresh in a loop until the singleton catches itself.

**Fix:** add a runtime guard:
```ts
function isTokenPair(x: unknown): x is { accessToken: string; refreshToken: string } {
  return !!x && typeof x === 'object'
    && typeof (x as any).accessToken === 'string' && (x as any).accessToken.length > 0
    && typeof (x as any).refreshToken === 'string' && (x as any).refreshToken.length > 0;
}
if (!isTokenPair(tokens)) {
  await clearLocalSession();
  throw new ApiError('刷新返回数据格式异常，请重新登录', 401);
}
```

---

### `L247-266` [MEDIUM · RESILIENCE] — Refresh-then-retry can loop on persistent 401
```ts
if (initialRequest.res.status === 401 && auth && retryOnAuthError) {
  const nextAccessToken = await refreshAccessToken();
  const retryRequest = await executeRequest<T>(endpoint, { ...options, retryOnAuthError: false }, nextAccessToken);
  return unwrapResponse(retryRequest.res, retryRequest.payload);
}
```
Refresh succeeds → retry → if retry also returns 401 (race with concurrent logout, or backend revoked tokens between refresh and retry), the request throws `ApiError(status=401)` to the caller. Caller code throughout the app doesn't know this means "kick to login screen". Need a consistent signal.

**Fix:** on a retry that still 401s, run `clearLocalSession()` and throw a sentinel error code (e.g. `code: 'AUTH_RETRY_FAILED'`) the auth boundary listens for.

---

### `L29-30` [LOW · CLARITY] — `isDev` falls back to `false` outside RN
```ts
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
```
Fine, but if this file ever runs in a node test environment, `__DEV__` is undefined → `isDev=false` → no logs in tests. Some test patterns explicitly want to log. Add a way to force-enable in test if needed.

---

### `L102-103` [LOW · CLARITY] — Empty-body 200 OK silently becomes `undefined`
```ts
} catch {
  throw new ApiError('服务返回了无效数据', res.status);
}
```
Plus L202: `return (payload as T | null) ?? (undefined as T);` — callers typed as returning `T` may receive `undefined` at runtime, which TypeScript will not catch. For 204 No Content endpoints this is desired; for typed responses it's silent failure. Consider distinguishing void endpoints in the type.

---

### `L228, L258` [LOW · MAINTAINABILITY] — Dead option `retryOnAuthError` passed to `executeRequest`
`executeRequest` does not read `retryOnAuthError`; only `apiClient` does at L251. Passing it in nested calls is harmless but misleading. Drop it from the spread for clarity.

## Test gaps for client.ts
- No test that login response is **not** logged in plain text (regression test for the leak)
- No test for FormData body path (currently breaks)
- No test for refresh response with wrong shape (snake_case backend regression)
- No test for retry-after-refresh still 401 path
- No test for 204 / empty body responses

---

# File 3 — `src/services/auth/session.ts` (49 lines)

## Summary
Logout orchestrator. Other modules register teardown handlers via `registerLogoutHandler`. `clearLocalSession` runs all handlers, resets four stores, clears auth, then clears SecureStore-backed auth persistence.

## Findings

### `L44-48` [MEDIUM · BUG (high impact if it fires)] — Silent failure of persist clearStorage leaves tokens on disk
```ts
try {
  await (useAuthStore as PersistCapableAuthStore).persist?.clearStorage?.();
} catch {
  // 持久化层清理失败时，内存态也已清空，不阻断登出流程
}
```
Original finding: the intent (don't block logout) is right, but the failure was silent. If persistence clearing failed (disk full, permission, native crash), the in-memory state was cleared **but** the persisted tokens could remain. On next app start, `onRehydrateStorage` (authStore L137-145) would read them back and re-authenticate the "logged out" user.

**Fix:** at minimum log the error in dev and emit a telemetry event. Ideally, also overwrite tokens explicitly as a fallback:
```ts
try {
  await (useAuthStore as PersistCapableAuthStore).persist?.clearStorage?.();
} catch (err) {
  if (__DEV__) console.warn('[session] persist.clearStorage failed', err);
  // belt-and-suspenders: clear SecureStore and legacy MMKV copies directly
  try {
    await secureAuthStorage.removeItem('circle-im-auth');
  } catch {/* truly unrecoverable, but at least we tried twice */}
}
```

---

### `L30-36` [MEDIUM · OBSERVABILITY] — Per-handler errors swallowed silently
```ts
for (const handler of logoutHandlers) {
  try {
    await handler();
  } catch {
    // 单个 teardown 失败时继续跑剩下的
  }
}
```
"Continue running other handlers" is the right policy. But silently? If the IM logout handler throws (network down, SDK in weird state), nobody knows. Next login will then attempt to init OpenIM on a session that wasn't properly closed → undefined behavior in the SDK.

**Fix:** log in dev, and collect failures to emit one warning at the end:
```ts
const failures: unknown[] = [];
for (const handler of logoutHandlers) {
  try { await handler(); } catch (err) { failures.push(err); }
}
if (__DEV__ && failures.length > 0) {
  console.warn('[session] logout handlers failed', failures);
}
```

---

### `L22-26` [MEDIUM · BUG (latent)] — No deduplication / unregister for handlers
```ts
const logoutHandlers: LogoutHandler[] = [];
export function registerLogoutHandler(handler: LogoutHandler) {
  logoutHandlers.push(handler);
}
```
Two pain points:
1. **HMR / re-evaluated modules** can call `registerLogoutHandler` again. After 5 hot reloads, the IM teardown runs 5 times on logout. OpenIM `logout()` on an already-logged-out session may throw or just no-op — both inflate the next finding's failure count.
2. **Tests** that import these modules accumulate handlers across test cases.

**Fix:** return an unregister function and (optionally) dedupe by reference:
```ts
export function registerLogoutHandler(handler: LogoutHandler): () => void {
  if (logoutHandlers.includes(handler)) return () => unregister(handler);
  logoutHandlers.push(handler);
  return () => unregister(handler);
}
function unregister(h: LogoutHandler) {
  const i = logoutHandlers.indexOf(h);
  if (i >= 0) logoutHandlers.splice(i, 1);
}
```

---

### `L38-42` [MEDIUM · COORDINATION] — Store reset ordering not guaranteed safe vs. listeners
```ts
useMessageGroupsStore.getState().reset();
useFriendActivityUnreadStore.getState().reset();
useTabBadgeStore.getState().reset();
useWalletRealtimeStore.getState().reset();
useAuthStore.getState().clearSession();
```
Between the first reset and `clearSession`, `useAuthStore` still reports `isAuthenticated=true`. Any subscriber that reacts to `messageGroups` going empty (e.g., a UI that triggers a re-fetch while still authenticated) could fire a request that's destined to be discarded. Low probability, but the order should be **clear auth first, then dependent stores**:
```ts
useAuthStore.getState().clearSession();
useMessageGroupsStore.getState().reset();
// ...etc
```
That way, downstream subscribers see "not authenticated" before "data is empty" and bail out of refetches.

---

### `L7-11, L45` [LOW · MAINTAINABILITY] — Fragile cast to access `persist`
```ts
type PersistCapableAuthStore = typeof useAuthStore & {
  persist?: { clearStorage?: () => Promise<void> | void; };
};
// ...
(useAuthStore as PersistCapableAuthStore).persist?.clearStorage?.();
```
Zustand exports proper types for `StoreApi & { persist: PersistApi }` via `zustand/middleware`. Importing those types would remove the local `PersistCapableAuthStore` and the `?` chain.

**Fix:**
```ts
import type { StoreApi } from 'zustand';
// useAuthStore from zustand persist already exposes `.persist`; type it inline
await useAuthStore.persist.clearStorage();
```
(Verify `useAuthStore.persist` is non-optional in this zustand version.)

---

### `L1-6, L38-42` [LOW · ARCHITECTURE] — Other persisted stores not coordinated
`session.ts` clears these stores' in-memory state but doesn't clear their **persisted** data: e.g. `use-chat-preferences-store`, `use-discover-filter-store` likely persist to MMKV too. On logout, the next user inherits the previous user's preferences.

**Decision needed (don't patch blindly):** which persisted state is user-scoped vs. device-scoped?
- User-scoped (clear on logout): chat preferences, discover filter, draft messages, message groups
- Device-scoped (keep on logout): theme, language, accessibility

Once decided, add a `clearStorage()` call per user-scoped persisted store in `clearLocalSession`. This is **future work** — flag and move on for now.

## Test gaps for session.ts
- No test for `clearStorage` failure path
- No test for register-then-unregister handler behavior (post-fix)
- No test for handler error collection / reporting
- No test that store reset ordering is auth-first

---

# Patches proposed

I have NOT applied any patches yet — awaiting your approval. If approved, I would apply in this order:

1. **`authStore.ts`** — fix `setUser`, add `version: 1`, tighten rehydrate validation, narrow `role`/`status` types (skip until product confirms enum)
2. **`api/client.ts`** — recursive redaction (covers L34, L86, L136), runtime guard for refresh response, FormData detection, expand SENSITIVE_KEYS
3. **`session.ts`** — dev-log error in catches, return unregister fn, reorder to auth-first, fallback removeItem after persist.clearStorage failure
4. **Token-storage fix** — resolved 2026-06-21 with `expo-secure-store` token splitting + legacy MMKV token migration/removal.

**Risk if not patched:** Remaining HIGH dev-log leaks have been patched. The remaining deferred MEDIUM issues are latent architecture gaps that can cause "stuck-in-login-loop" or cross-account local-data symptoms when they fire.

Tell me whether to apply (1)-(3) now, or wait until you've reviewed all auth-related batches.
