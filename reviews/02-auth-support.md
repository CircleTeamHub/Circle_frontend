# Review Batch 02 — Auth Support Layer (5 files, 576 lines)

> Files: `src/services/api/auth.ts` · `src/services/api/errors.ts` · `src/services/api/utils.ts` · `src/hooks/use-auth.ts` · `src/services/cache/clear-app-cache.ts`
> Date: 2026-05-14
> Surface: Auth & token lifecycle (supporting layer)
> **Status: Patched. 6 MEDIUM + several LOW resolved across 3 files. 2 files reviewed only (errors.ts + clear-app-cache.ts) — pending product/backend/SDK decisions.**

---

## Patches applied

`git diff --stat src/ test/` for Batch 02:
```
 src/hooks/use-auth.ts    | +83/-54  selectors, mounted ref, fire-and-forget logout, dev-log silent catches
 src/services/api/auth.ts | +44/-15  imToken: string|null, isAuthTokens guard, accountId trim
 src/services/api/utils.ts| +33/-13  normalizeMediaUrl protocol+port sync, explicit normalizeUser whitelist
 test/auth-api.test.js    | +99/-0   react-native mock + 4 new tests (trim, null imToken, shape guard, register)
```

`tsc --noEmit`: clean.
`test/auth-api.test.js`: **7/7 pass** (was 0/3 — pre-existing missing `react-native` mock).
`test/auth-session.test.js`: **5/5 pass** (regression check from Batch 01 — unchanged).
`test/cache-clear.test.js`: **5/5 pass** (regression check — clear-app-cache.ts not patched).

### ✅ Fixed
- **`auth.ts:24-28`** — `AuthTokens.imToken` typed as `string | null` to match reality (the hook already had a null check).
- **`auth.ts`** — Added `isAuthTokens` runtime shape guard + `ensureAuthTokens` normalizer. Snake-case drift / missing fields now throw `认证返回数据格式异常` instead of writing partial state. Same defense layer as Batch 01's refresh fix.
- **`auth.ts:71-94`** — `accountId` defensively trimmed at the API boundary; callers that forget no longer get silent "username not found".
- **`utils.ts:19-25`** — `normalizeMediaUrl` now syncs `protocol` + `hostname` + `port` from `API_URL`. Previously it kept the localhost port (`:3000`) when rewriting to the prod host, producing `http://api.example.com:3000/img` style broken URLs.
- **`utils.ts:37-66`** — `normalizeUser` rewritten as **explicit whitelist** instead of `...user` spread. Closes the mass-assignment-on-receive path: backend can add `passwordHash` / `internalNotes` / `payoutAccountNumber` without those silently flowing into MMKV-persisted frontend `AuthUser`.
- **`use-auth.ts:27`** — Three separate selectors replace the whole-store subscription. Token-refresh / unrelated user updates no longer re-render every screen mounted via this hook.
- **`use-auth.ts`** — Added `mountedRef` + `safeSetError` / `safeSetSubmitting` helpers; all `setState` calls in async catch/finally chains now no-op after unmount. Removes a class of "setState on unmounted component" warnings during mid-login navigation.
- **`use-auth.ts:121-138`** — `logoutRequest` fire-and-forgotten in parallel with local cleanup (`void logoutRequest(...).catch(...)`). User no longer waits up to 15s on slow server logout. Failures `console.warn`'d in dev only.
- **`test/auth-api.test.js`** — Added `react-native` mock (fixes the 3 pre-existing failures) and 4 new tests:
  - `login trims accountId before sending to backend`
  - `login normalizes missing/empty imToken to null` (covers both `undefined` and `''`)
  - `login throws when accessToken or refreshToken missing` (3 sub-cases: missing field / snake_case drift / empty string)
  - `register trims accountId and validates response shape`

### ⏸ Deferred — needs your decision

| File | Issue | Why deferred |
|---|---|---|
| `auth.ts:66-68` | `Device.deviceName` is PII | Pick: `modelName`, anonymous installationId in SecureStore, or document as accepted risk |
| `auth.ts:117-132` | `changePassword` / `changeAccountId` don't invalidate sessions | Product call — auto-`logoutAll` vs manual instruction in UI |
| `errors.ts` | Raw backend error message leaks to UI | Needs backend error-code taxonomy first; map closes the loop |
| `clear-app-cache.ts:1` | `expo-file-system/legacy` deprecated | Schedule for next Expo SDK bump |
| `clear-app-cache.ts:29-42` | Denylist top-level only | Design call: enforce invariant vs recursive check |
| `clear-app-cache.ts:80-82` | OpenIM directory hardcoded | Wait for SDK API or owner decision |
| Cross-cutting | **Chat data persists across logouts (privacy gap on shared device)** | Product call: A wipe-all / B switch-account-only / C explicit toggle / D accept |
| `use-auth.ts:69-72` | `/auth/me` transient failure wipes session | Want shared `retry()` util first — none exists yet |

---

## Batch summary

This batch closes the auth loop: the actual `/auth/*` endpoint wrappers (`auth.ts`), generic error message helper (`errors.ts`), payload normalizers (`utils.ts`), the React hook that orchestrates login/register/logout (`use-auth.ts`), and the cache-clear utility used by logout / settings (`clear-app-cache.ts`).

No new HIGH findings (Batch 01 caught the leaks). MEDIUMs cluster around three themes: **(1) untrusted backend response shapes** flowing straight into stores and OpenIM, **(2) React hook unmount-safety + over-subscription**, and **(3) the cache module's reliance on a hardcoded OpenIM path + a deprecated Expo API**. There is also one **cross-cutting privacy gap**: chat data on disk is never cleared at logout, so on a shared device the next user can read the previous user's history.

---

# File 1 — `src/services/api/auth.ts` (139 lines)

## Summary
Wraps `/auth/login`, `/auth/register`, `/auth/me`, `/auth/logout`, `/auth/change-password`, `/auth/account-id`, `/auth/logout-all`. Reads device name via `expo-device`, computes OpenIM `platformID` from `Platform.OS`, and posts JSON via `apiClient`.

## Findings

### `L66-68` [MEDIUM · PRIVACY] — `Device.deviceName` is user-personal info, sent to backend on every login/register
```ts
function getDeviceName() {
  return Device.deviceName ?? `circle-im-${Device.osName ?? 'device'}`;
}
```
On iOS, `Device.deviceName` is typically `"Alice's iPhone"` (the device owner's name). Sent as `x-device-name` header on `/auth/login` and `/auth/register`, it lands in backend access logs, audit tables, and potentially analytics. This is PII even though the user "consented" by setting it.

Notes:
- iOS 16+ requires an entitlement to read this; without it you get a generic `"iPhone"` — but you've probably granted yourselves the entitlement.
- Android `Device.deviceName` is often null → fallback to `"circle-im-Android"`, much safer.

**Fix options:**
- A. Use `expo-device`'s `modelName` (`"iPhone 15 Pro"`) instead of `deviceName` (`"Alice's iPhone"`). Identifies device class without leaking user name.
- B. Generate a stable anonymous `installationId` (UUID stored once in SecureStore) and send that as the device identifier. Best for audit trails — backend can correlate sessions per install without learning the user's name.

---

### `L24-28` [MEDIUM · TYPE-vs-REALITY] — `AuthTokens.imToken: string` is required, but the hook treats it as optional
```ts
export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  imToken: string;
};
```
`use-auth.ts:54` does `if (tokens.imToken)` — implying it can be falsy. Either the type is wrong, or the runtime check is dead. The truth is the type is wrong: some account types (admin, service, or first-register-without-IM-binding) may legitimately get no imToken.

**Fix:** `imToken: string | null` and let the hook's null check stand.

---

### `L71-94` [MEDIUM · SAFEGUARD] — Login/register response not validated at runtime (same family as Batch 01 refresh fix)
```ts
return apiClient<AuthTokens>('/auth/login', { ... });
```
`apiClient` returns `AuthTokens` because of the generic, but there's no runtime check. If the backend renames `accessToken` → `access_token`, TypeScript is happy and `setSession({accessToken: undefined, ...})` runs. We patched `refreshAccessToken` in Batch 01; the same guard should apply here.

**Fix:** factor `isTokenPair` (from `client.ts`) into a shared shape guard with `imToken` awareness, run it after `loginRequest` / `registerRequest` in `use-auth.ts`. Or do it inside `auth.ts` and throw an `ApiError` like the refresh path.

---

### `L71-94` [MEDIUM · DEFENSIVE-INPUT] — `accountId` not trimmed at API boundary
The hook (`use-auth.ts:34, 107`) trims `account`. If anything else ever calls `login()` directly (programmatic re-auth, biometric unlock, test harness), the trim is bypassed and a leading space causes "username not found" with no clue why. Cheap defense:
```ts
body: { accountId: payload.accountId.trim(), password: payload.password, platform: ... }
```

---

### `L117-132` [MEDIUM · SAFEGUARD] — `changePassword` / `changeAccountId` don't invalidate sessions; caller-responsibility footgun
After a password change, the access/refresh tokens issued under the OLD password remain valid until they expire naturally. Industry norm: a password change should invalidate all sessions (or at least force a re-login on this device). Same for `accountId` change.

**Fix options:**
- A. Document explicitly that callers MUST call `logoutAll()` or `clearLocalSession()` after these endpoints. Add a `@see` JSDoc.
- B. Wrap them as `changePasswordAndReauth(...)` helpers that call the endpoint + immediately `logoutAll()` + re-login. UX heavier but safer.

Decision needed before patching.

---

### `L109-115` [LOW · OBSERVABILITY] — `logout(refreshToken)` swallows the success/failure by returning `void`
Caller can't distinguish "logged out on server" from "server unreachable but client logged out anyway". Today the hook (`use-auth.ts:131`) catches and ignores either way. Fine, but if you ever want to retry-on-network logout, this returns no information.

---

### `L10-11` [LOW · MAINTAINABILITY] — `react-native` imported just for `Platform.OS`
Test isolation harder (needed for `auth-api.test.js`, currently broken). A static helper that returns the platform id wrapped in `if (typeof Platform !== 'undefined')` would let tests run without RN. Or a small `getOpenIMPlatformID` accepting an injected platform.

---

### `L96-107` [LOW · CLARITY] — Two `fetchCurrentUser` variants with different auth modes
`fetchCurrentUser()` uses the store's token; `fetchCurrentUserWithToken()` accepts an explicit token + `auth: false`. The distinction matters but reads as accidental duplication. A single function with optional `accessToken` would clarify:
```ts
export async function fetchCurrentUser(accessToken?: string) {
  const user = await apiClient<BackendAuthUser>('/auth/me', accessToken ? { auth: false, accessToken } : undefined);
  return normalizeUser(user);
}
```

## Test gaps for auth.ts
- `test/auth-api.test.js` currently fails (3/3) because the test scaffolding doesn't mock `react-native`. Easy fix.
- No test for empty/null `imToken` response handling
- No test for trimmed accountId

---

# File 2 — `src/services/api/errors.ts` (14 lines)

## Summary
Single helper `getApiErrorMessage(error, fallback)` that picks the best human-readable message from an `ApiError`, generic `Error`, or unknown.

## Findings

### `L3-13` [MEDIUM · UX/SECURITY] — Returns raw backend error message straight to UI
```ts
if (error instanceof ApiError) {
  return error.message;
}
```
`ApiError.message` is whatever the backend wrote in its `message` field. That can be:
- Helpful: `"用户不存在或密码错误"`
- Technical and useless to users: `"请求失败 (502)"`
- Leaky: `"User with id 92dd...d3a not found in shard 7"` — internal info disclosure
- Inconsistent across endpoints

The hook surfaces this string directly in the UI. Long-term you want backend error **codes** → frontend message **strings** (i18n-ready):

```ts
const ERROR_CODE_MESSAGES: Record<string, string> = {
  'AUTH_INVALID_CREDENTIALS': '账号或密码错误',
  'AUTH_ACCOUNT_LOCKED':      '账号已被锁定，请联系客服',
  'AUTH_NETWORK':             '网络异常，请检查后重试',
  // ...
};
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code && ERROR_CODE_MESSAGES[String(error.code)]) {
    return ERROR_CODE_MESSAGES[String(error.code)];
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
```

Today's `ApiError.code` is a numeric backend `code`. Once the backend stabilises an error-code taxonomy, this map closes the loop. **Don't patch blindly** — need backend code list first. Flag and defer.

---

### `L1-13` [LOW · STRUCTURE] — 14-line file is a candidate to absorb into a richer error module
Most projects grow this into a proper `error/normalize.ts` with `AppError` + `toAppError` (see the [expo-rn-production-review skill's Pattern C](../.claude/skills/expo-rn-production-review/SKILL.md) — same concept on the backend side). For now it does its job.

## Test gaps for errors.ts
- No tests at all
- Easy wins after the code-map landing: per-code-prefix → expected string

---

# File 3 — `src/services/api/utils.ts` (51 lines)

## Summary
Two helpers: `normalizeMediaUrl` rewrites localhost media URLs to the configured `API_URL` host (for dev on a physical device), and `normalizeUser` maps backend user shape to frontend `AuthUser`.

## Findings

### `L19-25` [LOW · BUG] — `normalizeMediaUrl` swaps hostname but keeps the (probably wrong) port
```ts
if (LOCALHOST_HOSTS.has(mediaUrl.hostname) && !LOCALHOST_HOSTS.has(apiUrl.hostname)) {
  mediaUrl.hostname = apiUrl.hostname;
  return mediaUrl.toString();
}
```
If backend returns `http://localhost:3000/image.png` and `API_URL` is `https://api.example.com/api/v1`, the result is `http://api.example.com:3000/image.png` — wrong scheme, wrong port. Should sync hostname **and** port **and** protocol from `apiUrl`.

**Fix:**
```ts
if (LOCALHOST_HOSTS.has(mediaUrl.hostname) && !LOCALHOST_HOSTS.has(apiUrl.hostname)) {
  mediaUrl.protocol = apiUrl.protocol;
  mediaUrl.hostname = apiUrl.hostname;
  mediaUrl.port = apiUrl.port;
  return mediaUrl.toString();
}
```

---

### `L37-50` [MEDIUM · MASS-ASSIGNMENT] — `normalizeUser` spreads the entire backend user into frontend store
```ts
return {
  ...user,        // ← copies every field, including ones not in AuthUser
  avatarUrl: normalizeMediaUrl(user.avatarUrl),
  // ...
};
```
If the backend ever adds `passwordHash`, `internalNotes`, `riskScore`, `payoutAccountNumber`, those fields silently flow into the frontend `AuthUser`, get persisted to MMKV, and become accessible to any screen. Mass-assignment-style risk on the receive side.

**Fix:** explicit whitelist:
```ts
export function normalizeUser(user: BackendAuthUser): AuthUser {
  return {
    id: user.id,
    accountId: user.accountId,
    uid: user.accountId,
    nickname: user.nickname,
    avatarUrl: normalizeMediaUrl(user.avatarUrl),
    avatarFrame: normalizeMediaUrl(user.avatarFrame),
    cover: normalizeMediaUrl(user.cover),
    email: user.email,
    phoneNumber: user.phoneNumber,
    wechat: user.wechat,
    qq: user.qq,
    whatsup: user.whatsup,
    persona: user.persona,
    helloWords: user.helloWords,
    birthday: user.birthday,
    gender: user.gender,
    role: user.role,
    status: user.status,
    lastOnline: user.lastOnline,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    city: user.city,
    vipLevel: user.vipLevel,
    creditScore: user.creditScore,
    fancyNumber: user.fancyNumber,
    displayIcons: (user.displayIcons ?? []).map((icon) => ({
      ...icon,
      imageUrl: normalizeMediaUrl(icon.imageUrl),
    })),
  };
}
```
Yes it's verbose. But it's the **right** verbose: the next person editing the backend user shape sees this as a single source of truth.

---

### `L48` [LOW · COSMETIC] — `city: user.city ?? null` is redundant
`BackendAuthUser.city` is already `string | null`. The `?? null` does nothing.

## Test gaps for utils.ts
- No tests for `normalizeMediaUrl` (port edge case, protocol edge case, malformed URL)
- No tests for `normalizeUser` (especially: that extra backend fields are NOT copied, after the whitelist fix)

---

# File 4 — `src/hooks/use-auth.ts` (159 lines)

## Summary
React hook orchestrating login / register / logout / switchAccount. Calls API → updates store → logs into OpenIM → navigates.

## Findings

### `L27` [MEDIUM · PERF] — Whole-store subscription causes re-renders on every auth field change
```ts
const { setSession, isAuthenticated, isLoading } = useAuthStore();
```
This subscribes to **all** auth state. Any `setTokens` (token refresh background) or `setUser` (profile update from a different screen) re-renders every screen mounted via this hook.

**Fix:** use selectors:
```ts
const setSession = useAuthStore((s) => s.setSession);
const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
const isLoading = useAuthStore((s) => s.isLoading);
```

---

### `L31-77, L79-119, L121-138` [MEDIUM · HOOK-SAFETY] — `setError` / `setSubmitting` can fire after unmount
Three async flows (`login`, `register`, `endSession`) each call `setError` / `setSubmitting` in `catch` / `finally` after long awaits. If the user navigates away mid-flight (very common during login on slow networks), React logs "Can't perform a state update on an unmounted component" and (RN 0.69+) drops the update silently. Worse, with concurrent mode, behavior is undefined.

**Fix:** mounted ref:
```ts
const mountedRef = useRef(true);
useEffect(() => () => { mountedRef.current = false; }, []);

// then everywhere:
if (mountedRef.current) setError(...);
if (mountedRef.current) setSubmitting(false);
```

---

### `L69-72` [MEDIUM · UX] — One transient `/auth/me` failure wipes the whole login
```ts
} catch (requestError) {
  await clearLocalSession();
  setError(getApiErrorMessage(requestError, '登录失败，请重试'));
}
```
Flow: `loginRequest` succeeds → server-issued tokens are valid → `fetchCurrentUserWithToken` then fails (transient 5xx, network blip after handoff to /auth/me) → `clearLocalSession` throws away the tokens we just got. The user has to log in again, and the second attempt will succeed.

**Fix:** retry `fetchCurrentUserWithToken` once (or twice with backoff) before bailing. Tokens we've been handed are the more valuable artifact.

```ts
try {
  const tokens = await loginRequest({ ... });
  const user = await retry(() => fetchCurrentUserWithToken(tokens.accessToken), { tries: 2, backoffMs: 400 });
  setSession(tokens, user);
  // ...
} catch (...) { ... }
```

---

### `L131-133` [LOW · OBSERVABILITY] — Silent catch on server logout (same pattern Batch 01 fixed)
```ts
} catch {
  // 忽略服务端登出失败，始终清空本地会话
}
```
Same anti-pattern we just removed in `session.ts`. Add a dev `console.warn` so a slow / broken `/auth/logout` endpoint surfaces in development. The server may be silently failing for weeks before someone notices.

---

### `L121-138` [LOW · UX] — Server logout blocks UI; should be fire-and-forget
```ts
if (refreshToken) {
  await logoutRequest(refreshToken);
}
```
On a slow network, user taps "Logout" and waits 15s (the apiClient timeout) for a request whose result doesn't even affect the local flow. Fire-and-forget:
```ts
if (refreshToken) {
  // 服务端登出与本地清理并行；失败也不阻塞 UI
  void logoutRequest(refreshToken).catch((err) => {
    if (__DEV__) console.warn('[auth] server logout failed (local cleared anyway)', err);
  });
}
```

---

### `L91` [LOW · POLICY] — Password policy is `length >= 6` only
No complexity check, no max length, no leak check. Modern recommendation: 8+ chars, allow long passphrases, optionally check against known-breached-password list. Backend should enforce, but client should match.

---

### `L140-146` [LOW · UX] — `switchAccount` is identical to `logout`
```ts
const logout = useCallback(async () => { await endSession(); }, [endSession]);
const switchAccount = useCallback(async () => { await endSession(); }, [endSession]);
```
Two function names for the same behavior. If they really are identical now, drop `switchAccount` until the actual "select another stored account" flow exists. If they're meant to differ (e.g., switch should jump to an account-picker screen, not the login form), implement that or rename.

---

### `L40, L91` [LOW · UX] — Validation messages skip `setSubmitting(true)` then `setSubmitting(false)`
Validations return early without ever calling `setSubmitting`. Fine, but a button bound to `submitting` will look responsive when valid input is given and unresponsive (no spinner flash) when invalid. Minor.

## Test gaps for use-auth.ts
- No tests for the hook at all (hooks-on-zustand are testable with `renderHook` + a wrapped zustand store)
- No regression test for the `/auth/me` transient-fail → kept-session behavior (after the retry fix)
- No test for unmount-during-login

---

# File 5 — `src/services/cache/clear-app-cache.ts` (213 lines)

## Summary
Computes per-category storage usage (chat / cache / temp), clears app cache directories with a denylist, formats byte sizes for UI. Used by Storage Settings screen.

## Findings

### `L1` [MEDIUM · DEPRECATION] — Imports from `expo-file-system/legacy`
```ts
import * as FileSystem from 'expo-file-system/legacy';
```
Expo SDK 52+ has the new `expo-file-system` API; `/legacy` is on the deprecation path and will be removed. This is technical debt, not an active bug — but the Settings → Storage screen will silently break when the package drops the legacy export. Flag for the next Expo upgrade. Migration is mechanical but module-wide.

---

### `L29-42, L137` [MEDIUM · SAFETY] — Denylist only matches top-level basenames; nested critical state is unprotected
```ts
const CACHE_CLEAR_DENYLIST = new Set([
  'openim', 'mmkv', 'RCTAsyncLocalStorage_V1', 'WebKit',
  // ...
]);
function isDenylisted(entryPath: string) {
  return CACHE_CLEAR_DENYLIST.has(basename(entryPath));
}
// L137:
const safeEntries = entries.filter((entry) => !isDenylisted(entry.path));
```
`clearDirectoryContents` lists immediate children of a cache root and filters via basename only. If any library (or future Expo update) decides to nest its state under e.g. `cache/somelib/openim/`, the OpenIM data is wiped because `clearDirectoryContents` recurses via `RNFS.unlink` which deletes recursively.

**Fix options:**
- A. **Document** the invariant ("denylisted state must live at the top level of cache directories") and enforce in code review. Smallest change.
- B. Switch from `RNFS.unlink` to a recursive walk that checks the denylist at every level. Slower but safer.

---

### `L80-82` [MEDIUM · ASSUMPTION] — `getOpenIMDirectory` hardcodes `${DocumentDirectoryPath}/openim`
```ts
function getOpenIMDirectory() {
  return `${RNFS.DocumentDirectoryPath}/openim`;
}
```
If OpenIM SDK changes its storage path (any version bump, platform-specific behavior, or custom init), `chatBytes` returns 0 silently and the user thinks they have no chat history to clear. There's no SDK call surfacing the actual data path?

**Fix:** at minimum, log a dev warning if the directory doesn't exist (today the function silently returns 0). Long term, request the path from the OpenIM SDK if its API exposes it.

---

### `L100-108` [LOW · PERF] — Unbounded `Promise.all` fan-out in recursive size walk
```ts
const sizes = await Promise.all(
  entries.map(async (entry) => {
    if (entry.isDirectory?.()) {
      return getDirectorySize(entry.path, depth + 1);
    }
    return entry.size ?? 0;
  }),
);
```
For a cache with thousands of files, this spawns thousands of concurrent FS calls. RNFS on iOS uses libdispatch and is usually fine; on older Android can hit fd limits or block the main thread. A small concurrency pool (10–20) is safer for big caches. Low priority — most users have <500 cached files.

---

### `L192-213` [LOW · CONCURRENCY] — No lock prevents double-tap "Clear Cache"
If user taps "Clear Cache" twice quickly, two concurrent walks run. They use `Promise.allSettled` so they don't crash, but a file deleted by run 1 then statted by run 2 races to error. Easy fix: singleton promise pattern.
```ts
let inFlight: Promise<ClearAppCacheResult> | null = null;
export function clearAppCache() {
  if (inFlight) return inFlight;
  inFlight = (async () => { /* ... */ })().finally(() => { inFlight = null; });
  return inFlight;
}
```

---

### `L124-152` [LOW · OBSERVABILITY] — `clearDirectoryContents` throws away which entries failed
Returns only counts. When users complain "Clear Cache didn't actually clear", you can't tell what survived. Collecting the failed paths (at least in dev) makes diagnosis 10× faster.

---

### `L64-78` [LOW · CLARITY] — Three overlapping cache-directory accessors mix Expo and RNFS APIs
`getCacheDirectories` unions `FileSystem.cacheDirectory + RNFS.CachesDirectoryPath + RNFS.TemporaryDirectoryPath`. On most platforms these collapse to 1–2 paths after dedup. The combination is defensive but reads as "we don't trust either API alone". A one-line comment explaining the platform behavior matrix would help.

## Test gaps for clear-app-cache.ts
- `test/cache-clear.test.js` exists; verify it covers the denylist (does it test that 'openim' under a cache root is preserved?)
- No tests for the size-formatter edge cases (NaN, negative, very large numbers)
- No tests for top-level-only denylist matching (regression risk for the nested-state issue above)

---

# Cross-cutting finding (touches multiple files)

### [MEDIUM · PRIVACY] — Chat data is **never** cleared on logout
`clearLocalSession` (`src/services/auth/session.ts`) resets state + the auth MMKV bucket, but does NOT touch:
- The OpenIM data directory at `${DocumentDirectoryPath}/openim` (chat history, attachments, contact cache)
- The general MMKV bucket beyond `circle-im-auth` (chat-preferences, discover-filter, circle-notification)
- Temp upload artifacts in `RNFS.TemporaryDirectoryPath`

On a shared device (parent + child, work + personal), user A's chat history is readable by user B after A logs out and B logs in. Whether that's acceptable depends on the threat model — but it's **not** the default in modern chat apps (Signal wipes; WhatsApp is per-install; Telegram has per-account isolation).

**Decision needed (don't patch blindly):**
- A. **Wipe on every logout.** Strongest privacy. Implies re-downloading chat history on next login — expensive on the next session.
- B. **Wipe only on `switchAccount`, keep on regular `logout`.** Common compromise: same user logging out + back in (e.g. token expiry) keeps cache; a different user switching in wipes.
- C. **Wipe only on explicit "Sign out and clear data" toggle.** Lets the user choose.
- D. **Accept current behavior**, document in `MODULE_OVERVIEW.md` under "Known privacy gaps" so it surfaces in the next compliance review.

This intersects with `clearAppCache` (it knows how to walk + delete) and the OpenIM SDK (it owns the chat DB). The right place for the cleanup is inside `clearLocalSession` (or a wrapper) once we have a `wipeUserData()` primitive in the IM layer.

---

# Patches proposed

Defensible without product decisions — would apply now if approved:

1. **`auth.ts`** — make `imToken: string | null` (matches reality + the hook's null check); trim `accountId` in `login` / `register`; add runtime `isAuthTokens` guard around the responses (parallels Batch 01).
2. **`utils.ts`** — fix `normalizeMediaUrl` to sync protocol + hostname + port; rewrite `normalizeUser` as explicit whitelist (no spread); drop the redundant `?? null` on city.
3. **`use-auth.ts`** — switch to selectors instead of whole-store subscribe; add a mounted ref to guard `setError`/`setSubmitting`; dev-log the silent server-logout catch; fire-and-forget `logoutRequest`.
4. **`test/auth-api.test.js`** — add `react-native` mock so the 3 currently-failing tests pass; add a test for the new isAuthTokens runtime guard.

Deferred — needs your decision:

- **`auth.ts:66-68`** Device.deviceName PII → modelName vs installationId vs status-quo
- **`errors.ts`** Backend error-code → user message map → needs backend code list
- **`auth.ts:117-132`** changePassword/changeAccountId session invalidation → product call (auto-logout-on-success vs require manual logout)
- **`clear-app-cache.ts:1`** legacy Expo FS migration → schedule for next SDK bump
- **`clear-app-cache.ts:29-42`** denylist nested-state handling → design call (top-level invariant vs recursive check)
- **Cross-cutting privacy gap** — chat data on logout → product decision A/B/C/D above
- **`use-auth.ts:69-72`** `/auth/me` retry → small implementation, but want to first decide whether to add a shared `retry()` util (none currently in the repo)
