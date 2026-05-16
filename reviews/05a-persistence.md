# Review Batch 05a — Persistence & State Hydration (9 files, 902 lines)

> Files: `src/storage/index.ts` (71) · `app/_layout.tsx` (127) · `app/index.tsx` (31) · `src/stores/imStore.ts` (190) · `src/stores/friendActivityUnreadStore.ts` (44) · `src/stores/tabBadgeStore.ts` (57) · `src/stores/walletRealtimeStore.ts` (23) · `src/i18n/index.ts` (58) · `src/realtime/client.ts` (301)
> Date: 2026-05-15
> Surface: Persistence & state hydration (foundation layer — completes the auth + IM + storage triangle)
> **Status: 1 HIGH · 8 MEDIUM · 18 LOW.**

## Batch summary

The hydration order is well-designed: **MMKV migration → store rehydrate → i18n rehydrate → splash hide → render tree mounts → SessionBootstrap kicks off**. Zustand stores are kept slim and reasonably defensive (Map-based dedupe, message capping, change-detection in `markMessagesRead`). The realtime client has proper exponential-backoff reconnect with jitter, max-attempts cap, and registered logout teardown.

The risks cluster in 3 places:

1. **One HIGH:** if `migrateFromAsyncStorage()` ever rejects, the app sits on the splash screen **forever** — `setMigrated(true)` only runs in `.then()`, no `.catch()`. A single MMKV write failure on first launch (disk full, sandbox permission flap) bricks the app.
2. **Token in WebSocket URL query.** Realtime auth token lands in CDN / proxy / network-monitor logs because it's appended as a `?token=` query param instead of sent in an auth frame after connect.
3. **Silent failure paths** — same family Batch 01 cleaned up in `session.ts`: `realtime/client.ts:198-205, 230-232`, `friendActivityUnreadStore.ts:26-28`, the migration error path in `storage/index.ts:57-67`. None alone is a bug, together they make migration / reconnect failures invisible in dev.

---

# File 1 — `src/storage/index.ts` (71 lines)

## Findings

### `L51-71` [MEDIUM · BUG · DATA-LOSS-ADJACENT] — Migration `MIGRATION_FLAG` is set in `finally`, including on partial-copy failures
```ts
migrationPromise = (async () => {
  if (storage.getBoolean(MIGRATION_FLAG)) return;

  try {
    const entries = await AsyncStorage.multiGet([...LEGACY_KEYS]);
    for (const [key, value] of entries) {
      if (value !== null && !storage.contains(key)) {
        storage.set(key, value);
      }
    }
    await AsyncStorage.multiRemove([...LEGACY_KEYS]);
  } finally {
    storage.set(MIGRATION_FLAG, true);  // ← runs even if copy threw mid-loop
  }
})();
```
If `multiGet` throws mid-loop, `MIGRATION_FLAG` is still set true. Next launch sees the flag and **skips migration permanently**. Some keys may have made it to MMKV, others didn't — silently inconsistent.

**Fix:** set the flag only after the successful path completes. On failure, leave it false so the next launch retries:
```ts
try {
  const entries = await AsyncStorage.multiGet([...LEGACY_KEYS]);
  for (const [key, value] of entries) {
    if (value !== null && !storage.contains(key)) storage.set(key, value);
  }
  await AsyncStorage.multiRemove([...LEGACY_KEYS]);
  storage.set(MIGRATION_FLAG, true);  // ← only on full success
} catch (err) {
  if (__DEV__) console.warn('[storage] AsyncStorage → MMKV migration failed; will retry next launch', err);
  // do NOT set the flag; do NOT rethrow
}
```
Note: we explicitly swallow because the caller in `_layout.tsx` must always proceed (see HIGH below). The catch logs in dev so we notice during development.

---

### `L58-64` [LOW · OBSERVABILITY] — No completion log; can't tell from a session log whether migration ran
Even on success, no signal indicates that a migration actually happened. A one-line dev info log would let us correlate first-launch behavior in QA.

---

### `L32-39` [LOW · MAINTAINABILITY] — `LEGACY_KEYS` list lives here, but the same key names are duplicated in 6+ store/i18n files
If someone renames `'circle-im-auth'` in `authStore.ts`, `LEGACY_KEYS` here silently drifts. Either re-export from a single source of truth or add a comment block linking them.

## Test gaps for storage/index.ts
- No tests for `migrateFromAsyncStorage` (none at all in the test/ directory)
- Regression test for "migration failed → flag NOT set → next launch retries" (after the fix above)

---

# File 2 — `app/_layout.tsx` (127 lines)

## Findings

### `L94-103` [HIGH · BUG · STARTUP] — Migration failure leaves the app stuck on splash screen forever
```ts
useEffect(() => {
  migrateFromAsyncStorage().then(() => {
    void useAuthStore.persist.rehydrate();
    void useChatPreferencesStore.persist.rehydrate();
    void useDiscoverFilterStore.persist.rehydrate();
    void useCircleNotificationStore.persist.rehydrate();
    rehydrateLanguageFromStorage();
    setMigrated(true);
  });
}, []);
```
`setMigrated(true)` lives **only** inside `.then()`. If `migrateFromAsyncStorage()` rejects (MMKV write failure on first launch, AsyncStorage permission flap, etc.), `.then()` never fires:
- `migrated` stays `false`
- L111-115: `SplashScreen.hideAsync()` never runs
- L118: `if (!loaded || !migrated) return null;` keeps returning null forever
- User sees the splash screen indefinitely — no error message, no retry, no log

After Batch 04 #14 (`retry` util), even bootstrap is resilient to transient failures. This path is **not** — a single migration error bricks the cold start.

**Fix:** add `.catch()` that logs and still flips `migrated=true` so the app proceeds (the worst case is that AsyncStorage data isn't migrated this launch, but the app boots and tries again later):
```ts
useEffect(() => {
  migrateFromAsyncStorage()
    .catch((err) => {
      if (__DEV__) console.warn('[startup] migration failed, continuing without migrated data', err);
    })
    .finally(() => {
      void useAuthStore.persist.rehydrate();
      void useChatPreferencesStore.persist.rehydrate();
      void useDiscoverFilterStore.persist.rehydrate();
      void useCircleNotificationStore.persist.rehydrate();
      rehydrateLanguageFromStorage();
      setMigrated(true);
    });
}, []);
```

---

### `L111-115` [MEDIUM · BUG] — `SplashScreen.hideAsync()` can fire twice if effect deps re-evaluate to the same true/true state
```ts
useEffect(() => {
  if (loaded && migrated) {
    SplashScreen.hideAsync();
  }
}, [loaded, migrated]);
```
React 18's strict mode in dev runs effects twice. `hideAsync` returns a Promise that rejects if the splash is already hidden (expo-splash-screen surfaces "Splash screen has been called multiple times"). In dev this prints a noisy unhandled-rejection. In prod with Strict Mode off, generally safe.

**Fix:** guard with a ref or `.catch` to swallow the redundant call:
```ts
useEffect(() => {
  if (loaded && migrated) {
    SplashScreen.hideAsync().catch(() => { /* already hidden */ });
  }
}, [loaded, migrated]);
```

---

### `L65` [LOW · UX] — `gestureEnabled: false` disables iOS swipe-back
Intentional (each screen has its own NavHeader), but worth a one-liner explaining why for future maintainers.

---

### `L29-32` [LOW · IMPORT-ORDER] — Side-effecting module-level calls
```ts
SplashScreen.preventAutoHideAsync();
silenceDomBridgeRejection();
```
At module evaluation. Works, but is brittle to import-order changes. Wrapping these in a single `bootstrap()` function called from `RootLayout`'s first useEffect would be more idiomatic.

## Test gaps for _layout.tsx
- No tests for the migration-then-rehydrate sequencing
- Regression test for the migration-failure-keeps-app-on-splash bug

---

# File 3 — `app/index.tsx` (31 lines)

## Findings

### `L7` [MEDIUM · PERF] — Whole-store subscription
```ts
const { isAuthenticated, isLoading } = useAuthStore();
```
Same anti-pattern Batch 02 & 04 fixed elsewhere. Token refresh / `setUser` re-renders the entry component — which calls `<Redirect>`. Redirect itself is cheap, but re-running the component runs the destructuring + theme hook + ternary on every auth state write.

**Fix:** selectors.

---

### `L18-22` [LOW · UX] — No fallback when `isLoading=false` but `isAuthenticated=false` for legitimate reasons
`<Redirect href="/(auth)/login" />` is the right call, but if redirect itself fails (e.g., transient navigation state), there's no fallback UI — user sees a blank screen. expo-router's Redirect typically doesn't fail, so low risk.

## Test gaps for index.tsx
- No tests; trivial enough that integration test of route navigation suffices.

---

# File 4 — `src/stores/imStore.ts` (190 lines)

## Findings

### `L60-67` [LOW · CORRECTNESS] — `compareConversations` has no stable tiebreaker
```ts
function compareConversations(left, right) {
  // ...
  return right.latestMsgSendTime - left.latestMsgSendTime;
}
```
Two conversations with the same `latestMsgSendTime` (group creation events arrive in bursts; system messages) compare equal → sort order depends on `Array.sort` stability (which is stable in modern engines, but **input order is not deterministic** — Map iteration order is insertion order, which depends on which conversation arrived first).

**Fix:** add `conversationID` as tiebreaker for deterministic ordering.

---

### `L178-187` [LOW · MEMORY] — `onlineStatusByUser` map is unbounded
Each subscribed user adds a permanent entry. After visiting many user profiles, the map accumulates. Not a leak (entries are small), but worth noting.

**Fix (defer):** add a "trim oldest" policy or only retain status for users currently visible.

---

### `L122-129` [LOW · CORRECTNESS] — `mergeConversations` does full-record replace, not field merge
If the SDK ever sends a partial conversation update (only the `unreadCount` field changed), it'd replace the entire ConversationItem with a sparse one. Looking at OpenIM docs, the SDK sends full records on `onConversationChanged`, so this is fine — but a comment would lock in the assumption.

## Test gaps for imStore.ts
- No store-level tests for any of the merge/sort/cap behavior
- No regression for the tiebreaker fix

---

# File 5 — `src/stores/friendActivityUnreadStore.ts` (44 lines)

## Findings

### `L26-28` [LOW · OBSERVABILITY] — Silent catch in `refresh`
```ts
try {
  const count = await fetchUnreadFriendActivityCount();
  set({ count });
  useTabBadgeStore.getState().setContactsUnread(count);
} catch {
  return get().count;
}
```
Network / 5xx failures swallowed silently. Add a dev warn (same pattern Batch 01 cleaned up).

---

### `L32-38` [MEDIUM · DRIFT] — `markRead` decrements by `new Set(activityIds).size` without knowing if those IDs were already unread
```ts
markRead: (activityIds) => {
  const uniqueCount = new Set(activityIds).size;
  const nextCount = Math.max(0, get().count - uniqueCount);
  set({ count: nextCount });
  useTabBadgeStore.getState().setContactsUnread(nextCount);
}
```
If the caller calls `markRead(['a','b','c'])` twice (re-tap, network retry), the count drops by 6 instead of 3. `Math.max(0, ...)` floors at 0, but the *real* unread count on the server may still be 3 → next refresh restores it, badge flickers.

The deeper issue: this is an optimistic local decrement without a "this id was actually unread" check. Best fix is to track unread IDs locally and dedupe properly, OR rely entirely on server-pushed count via `refresh()` / realtime `friend.activity.unread.changed`.

Deferred — needs design decision on local-state vs server-of-truth.

## Test gaps
- No tests for friendActivityUnreadStore

---

# File 6 — `src/stores/tabBadgeStore.ts` (57 lines)

## Findings

### `L41-45` [LOW · INPUT-VALIDATION] — Setters accept any number including negative / NaN
```ts
setMessagesUnread: (messagesUnread) => set({ messagesUnread }),
```
A bug elsewhere passing `-1` or `NaN` lands directly in the store. Defense in depth: clamp to `Math.max(0, count|0)`.

---

### `L46-54` [LOW · CORRECTNESS] — `applySnapshot` uses `??` not `||` (correct), but doesn't validate
A snapshot with `messagesUnread: -3` would land. Same fix as setters.

## Test gaps
- No tests for tabBadgeStore behavior or snapshot semantics

---

# File 7 — `src/stores/walletRealtimeStore.ts` (23 lines)

## Findings

### `L17-21` [LOW · INPUT-VALIDATION] — `setRealtimeBalance` accepts NaN / Infinity / negative
```ts
setRealtimeBalance: (balance) =>
  set((state) => ({
    balance,
    version: state.version + 1,
  })),
```
Realtime event handler already gates on `typeof === 'number'`, but doesn't filter NaN/Infinity. Store should defend at the boundary too.

**Fix:**
```ts
setRealtimeBalance: (balance) =>
  set((state) => {
    if (!Number.isFinite(balance) || balance < 0) return state;
    return { balance, version: state.version + 1 };
  }),
```

---

### `L4` [LOW · ARCHITECTURE] — `version` counter for change-detection
Tiny but useful pattern — note in case any new store needs the same.

---

# File 8 — `src/i18n/index.ts` (58 lines)

## Findings

### `L28-35` [LOW · BUG] — `i18n.init(...)` returns a Promise that's not awaited or `void`ed
```ts
i18n.use(initReactI18next).init({
  resources, lng: getInitialLanguage(), fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});
```
If init rejects (resource load failure), an unhandled promise rejection fires. i18next's defaults are pretty robust so this rarely happens, but TS-lint configurations typically flag this.

**Fix:** `void i18n.use(initReactI18next).init({...});`

---

### `L37-40` [LOW · BUG] — `setLanguage` doesn't await `i18n.changeLanguage(lang)`
```ts
export function setLanguage(lang: 'zh' | 'en') {
  i18n.changeLanguage(lang);   // returns Promise<TFunction>
  storage.set(LANGUAGE_KEY, lang);
}
```
`changeLanguage` is async (it may load lazy bundles). Writing the storage key before the language change resolves means a screen that reads `storage` during the window gets the new lang while `i18n.t()` returns old strings. Race is tiny but exists.

**Fix:** `void i18n.changeLanguage(lang);` and accept the eventual consistency. Or make `setLanguage` async and await both.

---

### `L9, L32` [LOW · CONSISTENCY] — `'@circle_im_language'` key duplicated in `storage/index.ts:38`
If renamed in one place, the other breaks silently.

---

# File 9 — `src/realtime/client.ts` (301 lines)

## Findings

### `L84-87` [MEDIUM · SECURITY] — Auth token passed as WebSocket URL query parameter
```ts
function buildRealtimeUrl(token: string) {
  const separator = REALTIME_WS_URL.includes('?') ? '&' : '?';
  return `${REALTIME_WS_URL}${separator}token=${encodeURIComponent(token)}`;
}
```
WebSocket handshakes start as HTTP — the full URL (including `?token=...`) is logged by:
- Reverse proxies (nginx, ALB, CloudFront)
- CDN access logs
- Server access logs
- Network observability tools
- Browser dev tools (visible in Network tab)

Better pattern: open the WS, then **send the token in the first frame** (auth frame), have the server respond with `auth.ok` / `auth.fail` before accepting other frames. Or use a short-lived ticket in the URL (token-exchange API issues a one-time WS ticket).

**Deferred** — needs backend cooperation (auth frame protocol on the server side).

---

### `L94-96` [MEDIUM · UX] — Silent giveup after `MAX_RECONNECT_ATTEMPTS` (10) — no state for "permanently failed"
```ts
if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
  return;
}
```
Total cumulative backoff over 10 attempts at 2^n with 30s cap is ≈ 3 min. After that, **realtime is silently dead until the next `connectRealtime` call** (which only fires on AppState→active or auth-token change). UI's `isRealtimeConnected` stays `false` but doesn't differentiate "trying to reconnect" from "given up". The badges just stop updating.

**Fix options:**
- Surface a 3-state flag: `'connected' | 'reconnecting' | 'failed'` on `tabBadgeStore`
- Auto-reset on AppState→active so a user backgrounding then foregrounding the app retries
- Show a UI banner when in `failed` state

Deferred — needs UX decision.

---

### `L154-196` [MEDIUM · DEAD-PATHS] — 3 realtime event types declared in the type union but handled as no-ops
```ts
case 'circle.post.interaction.created':
  return;
case 'circle.invitation.reviewed':
  return;
case 'system.notification.created':
  return;
```
These are typed but do nothing. Either (a) the UI subscribes to these elsewhere (then the type definition is documentation), or (b) they're incomplete (then the backend is wasting bandwidth). A comment explaining which would clarify intent.

Deferred — need to grep the codebase for subscribers + product input.

---

### `L171-178` [MEDIUM · INPUT-VALIDATION] — Wallet balance from realtime payload not validated against NaN / Infinity / negative
```ts
case 'wallet.balance.changed':
  if (typeof message.payload?.balance === 'number') {
    useWalletRealtimeStore.getState().setRealtimeBalance(message.payload.balance);
  }
  return;
```
`typeof 'number'` allows `NaN` and `Infinity`. Combined with the store's lack of validation (LOW finding above), bad payloads land in state and corrupt downstream UI.

**Fix:** add `Number.isFinite(payload.balance) && payload.balance >= 0` check, or do it in the store (best — defense at the store boundary).

---

### `L181-183` [MEDIUM · CORRECTNESS] — `system.notification.unread.changed` sets `profileUnread` AND `systemUnread` to the same count
```ts
case 'system.notification.unread.changed':
  badgeStore.setProfileUnread(message.payload?.count ?? 0);
  badgeStore.setSystemUnread(message.payload?.count ?? 0);
  return;
```
If they semantically differ (profile tab badge vs the specific "system" sub-counter), assigning the same value couples them. If they're the same, store one field. The duplication is either a bug or undocumented intent.

Deferred — needs product clarification.

---

### `L198-205` [LOW · OBSERVABILITY] — Silent catch on JSON parse failure
```ts
function handleSocketMessage(rawData: string) {
  try {
    const message = JSON.parse(rawData) as RealtimeEvent;
    handleRealtimeEvent(message);
  } catch {
    // Ignore malformed realtime messages to keep the connection alive.
  }
}
```
Keeping the connection alive is right. Logging in dev would surface backend protocol bugs.

---

### `L230-232` [LOW · OBSERVABILITY] — Silent catch in `recoverTabBadgeSnapshot`
Same pattern. Dev log would help diagnose stuck badges after AppState→active.

---

### `L154-196, L235-290` [LOW · ARCHITECTURE] — Module-level mutable globals
`socket`, `reconnectTimer`, `currentToken`, `manualDisconnect`, `reconnectAttempt`. After HMR, the module re-evaluates and resets all of these. The previous module instance's socket still exists but its callbacks reference dead state. Same family as the Batch 04 #14 logout-handler-arrow fix — but here the surface is bigger (5 module globals vs 1 function reference).

A class-based or factory-based encapsulation (`createRealtimeClient()` returning an object) would localize hot-reload damage. Refactor — deferred.

---

### `L301` [LOW · POSITIVE] — `registerLogoutHandler(disconnectRealtime)` correctly passes the function directly
After Batch 04's fix to `client.ts:45`, this file already does the right thing. Documenting it as a positive.

## Test gaps for realtime/client.ts
- `test/realtime-client.test.js` exists — check coverage
- No tests for the wallet payload validation, no tests for max-attempts giveup, no tests for HMR module-globals reset

---

# Patches proposed

Defensible without product input — applying now:

1. **`storage/index.ts:51-71`** — `MIGRATION_FLAG` only set on success; failures log in dev + don't poison next launch.
2. **`_layout.tsx:94-103`** — wrap migration in `.catch` + `.finally` so a single failure doesn't brick startup (the HIGH fix).
3. **`_layout.tsx:111-115`** — guard `hideAsync` against double-call.
4. **`index.tsx:7`** — selector subscription.
5. **`friendActivityUnreadStore.ts:26-28`** — dev-warn the silent catch.
6. **`realtime/client.ts:198-205, 230-232`** — dev-warn silent JSON parse / recovery failures.
7. **`realtime/client.ts:171-178`** — validate wallet balance (NaN / Infinity / negative).
8. **`walletRealtimeStore.ts:17-21`** — `Number.isFinite` + `>= 0` guard in the setter (defense in depth).
9. **`imStore.ts:60-67`** — `conversationID` tiebreaker for deterministic sort.
10. **`i18n/index.ts:28-35, 37-40`** — `void` the unawaited init / changeLanguage.

## Deferred — needs product / design / backend decision

| # | Where | Issue | Options |
|---|---|---|---|
| 20 | `realtime/client.ts:84-87` | Token in WebSocket URL query → logged by every proxy + CDN | A. Auth frame after connect (needs backend protocol). B. One-time WS ticket via token exchange. C. Accept current. |
| 21 | `realtime/client.ts:94-96` | Silent giveup after max reconnect attempts; UI never knows | A. 3-state flag (`connected`/`reconnecting`/`failed`). B. Auto-reset on AppState→active. C. UI banner on `failed`. |
| 22 | `realtime/client.ts:187-192` | 3 declared event types are no-op handlers | A. Implement. B. Document existing subscribers. C. Remove from type union. |
| 23 | `friendActivityUnreadStore.ts:32-38` | Optimistic `markRead` decrement drifts on double-call | A. Track unread IDs locally + dedupe. B. Rely on server-pushed authoritative count only. |
| 24 | `realtime/client.ts:181-183` | `profileUnread` and `systemUnread` set to identical value | A. Document as intentional. B. Collapse to one field. C. Differentiate semantics. |
