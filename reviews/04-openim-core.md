# Review Batch 04 — OpenIM Core (5 files, 1573 lines)

> Files: `src/im/client.ts` (824) · `src/im/listeners.ts` (185) · `src/im/mappers.ts` (317) · `src/components/app/session-bootstrap.tsx` (153) · `src/constants/config.ts` (94)
> Date: 2026-05-14
> Surface: OpenIM integration (the **highest-risk surface** in the repo — external SDK + WebSocket + global event listeners + race conditions + hot-reload edge cases)
> **Status: Patched. 11 MEDIUM + 4 LOW resolved across 5 files. 6 items deferred (1 HIGH promoted from #11, 4 MEDIUM, 1 LOW).**

---

## Patches applied

`git diff --stat`:
```
 src/components/app/session-bootstrap.tsx | +18/-9   selectors instead of whole-store sub
 src/constants/config.ts                  | +14/-3   NaN/range guard on OPENIM_LOG_LEVEL
 src/im/client.ts                         | +25/-7   HMR-stable logout handler ref, reset currentUserID on login fail, dev-warn silent failures
 src/im/listeners.ts                      | +33/-16  drop activeConversation fallback in C2C receipt, share handler ref
 src/im/mappers.ts                        | +34/-12  faceURL normalization, status type-guard, empty-URL image fallback
 test/im-client.test.js                   | +20/-3   default mocks for @/im/listeners + @/services/auth/session; fix stale dash-strip assertion
 test/im-client-chat-settings.test.js     | +29/-3   same default mocks; fix stale friend-card ex assertion
 7 files changed, 122 insertions(+), 51 deletions(-)
```

`tsc --noEmit`: clean.
**Tests**: was IM 3/13, → now IM **13/13** + auth-api 7/7 + auth-session 5/5 = **25/25 across all auth-adjacent test files.**

### ✅ Fixed

- **`client.ts:45`** — `registerLogoutHandler(logoutFromOpenIM)` (was a fresh arrow per module-eval). HMR no longer accumulates teardown handlers — Batch 01's dedup-by-reference now sees the same fn ref across reloads.
- **`client.ts:199-204`** — On login failure, also `setCurrentUserID(null)` so the store doesn't claim an identity for a session that never authenticated. Read-receipt routing + bubble alignment depend on this.
- **`client.ts:215-219`** — Silent SDK logout catch now `console.warn`s in dev (mirrors the Batch 01 `session.ts` fix).
- **`client.ts:309`** — `createGroupChat` no longer swallows `loadConversationList` failure silently — dev-warn surfaces the case where group is created but the conv list doesn't refresh.
- **`listeners.ts:127-141`** — **Removed the `activeConversation` fallback** in C2C read-receipt routing. Unrouted receipts now drop with a dev warning instead of marking msgIDs read in the wrong conversation.
- **`listeners.ts:89-96`** — Shared single `handleConversationsBatched` handler ref between `onConversationChanged` and `onNewConversation` (fewer closures, one less drift point).
- **`mappers.ts:179-192`** — `faceURL` runs through `normalizeMediaUrl` so OpenIM media on localhost-bound dev servers rewrites to the API_URL host (same fix Batch 02 applied to backend media URLs).
- **`mappers.ts:213-218`** — Type-guarded the `item.status` cast. Unknown values (SDK version drift) now read as `undefined` instead of pretending to be `1|2|3`.
- **`mappers.ts:294-313`** — Image message with empty URL no longer renders a broken-image bubble — falls through to a text bubble with the standard `[图片]` preview.
- **`session-bootstrap.tsx:24-37`** — Switched the whole-store destructure to per-field selectors. Token refresh / unrelated `setUser` calls no longer re-execute SessionBootstrap's effect dep-comparison.
- **`config.ts:79-91`** — `OPENIM_LOG_LEVEL` validated (`Number.isFinite` + range 0–5) before export. `EXPO_PUBLIC_OPENIM_LOG_LEVEL=verbose` no longer feeds `NaN` to the SDK init.
- **`test/im-client.test.js`** + **`test/im-client-chat-settings.test.js`** — Added `DEFAULT_TS_MODULE_STUBS` mock dispenser at the top of each file with no-op `@/im/listeners` and `@/services/auth/session` (fixes the 10 pre-existing `Cannot find module '@/im/listeners'` failures in one shot). Also fixed two stale behavior assertions:
  - `getOrCreateSingleConversation` test: expected `user-2` SDK call but client.ts strips dashes via `toImUserId` → updated to `user2`.
  - `sendFriendCardMessage` test: expected `ex: ''` but client.ts now serializes the `FriendCardExt` envelope → updated to expect `JSON.stringify({v:'friend-card-v1',persona:null,displayIcons:[]})`.

### ⏸ Deferred — added to top-level pending list as #14–#19

| # | Where | Why deferred |
|---|---|---|
| 14 | `session-bootstrap.tsx:100-128` + `use-auth.ts:69-72` | **HIGH (promoted from #11).** Both call sites need a shared `retry()` util — bigger change than a one-liner. Bootstrap path runs on every cold start → biggest UX impact. |
| 15 | `client.ts:513` `sendTransferCardMessage` | Needs product input on `MAX_TRANSFER_AMOUNT` + integer-only enforcement. |
| 16 | `client.ts:226-242` `loadConversationList` | Design call — cache-preserve vs current behavior. |
| 17 | `mappers.ts:72-99, 120-129` | i18n decision — thread `t()` or accept zh-only. |
| 18 | `client.ts:82` `getPlatformID` | Dead-code suspicion; want to grep-verify before deleting. |
| 19 | `config.ts:73-75` `REALTIME_WS_URL` default | Deriving from API_URL vs fail-fast in prod — needs deploy / SRE input. |

---

## Batch summary

The integration architecture is sound: the SDK is wrapped behind a single `client.ts` module with a singleton init promise, listeners are bound **before** `initSDK` (a deliberate choice to avoid `Sending xxx with no listeners` warnings during init), logout is orchestrated via the `registerLogoutHandler` pattern, and OpenIM userIDs are dash-stripped at the boundary (`toImUserId`/`fromImUserId`) because OpenIM v3.8 rejects UUID dashes. Mappers do the right thing — they decode `latestMsg` from a JSON string, filter system-notification message types from chat bubbles, and parse our two custom payloads (note-card, transfer-card).

The risks cluster in 4 places:

1. **Hot-reload corrodes the logout teardown.** `registerLogoutHandler(() => logoutFromOpenIM())` creates a fresh arrow per module evaluation — Batch 01's dedup-by-reference can't see two different arrows as the same. After 5 HMRs, the IM logout handler runs 5×.
2. **Bootstrap is one transient `/auth/me` away from nuking the session.** Same family as deferred item #11 in `use-auth.ts`, but in the path that runs on every app start.
3. **C2C read-receipt routing has an `activeConversation` fallback** that can mark messages read in the wrong conversation when the receipt is mis-shaped.
4. **OpenIM media URLs (avatars, group `faceURL`) are not normalized** through the same `normalizeMediaUrl` we hardened in Batch 02. Localhost-bound dev media URLs from OpenIM break the same way backend ones did.

---

# File 1 — `src/im/client.ts` (824 lines)

## Findings

### `L45` [MEDIUM · BUG · HMR] — `registerLogoutHandler(() => logoutFromOpenIM())` creates a fresh arrow each module evaluation
```ts
registerLogoutHandler(() => logoutFromOpenIM());
```
Batch 01's `session.ts` dedupes registered handlers by **reference identity**. This arrow is a new function expression every time the module re-evaluates (every HMR reload). After 5 hot reloads, `logoutFromOpenIM` runs 5 times on the next logout.

**Fix:** pass the function directly so the reference is stable across module re-eval (modulo the function declaration being hoisted to the same slot):
```ts
registerLogoutHandler(logoutFromOpenIM);
```
Or capture the unregister and run it in a hot-reload disposer if HMR is critical.

---

### `L199-201` [MEDIUM · BUG · STATE-DRIFT] — Login failure resets `connecting` but leaves stale `currentUserID` in store
```ts
} catch (error) {
  // ...
  useIMStore.getState().setConnecting(false);
  throw error;
}
```
`currentUserID` was set at L167 *before* the await. On failure, the store reports a userID for a session that never authenticated. Downstream components (chat bubble alignment, read-receipt routing) read `currentUserID` and may render under the wrong identity briefly until a retry succeeds.

**Fix:**
```ts
} catch (error) {
  // ... 10102 fast-path stays here ...
  useIMStore.getState().setConnecting(false);
  useIMStore.getState().setCurrentUserID(null);
  throw error;
}
```

---

### `L215-219` [MEDIUM · OBSERVABILITY] — Silent catch on SDK logout failure
```ts
try {
  await OpenIMSDK.logout();
} catch {
  // 忽略 SDK 登出失败，始终清空本地状态
}
```
Same pattern Batch 01 fixed in `session.ts`. If the SDK's logout repeatedly fails (e.g. native side stuck), we never notice. **Fix:** `console.warn` in dev (`if (__DEV__) console.warn(...)`).

---

### `L309-311` [MEDIUM · OBSERVABILITY] — `createGroupChat` swallows `loadConversationList` failure
```ts
await loadConversationList().catch(() => {
  // 创建成功但拉会话列表失败时静默忽略，UI 自己再触发重试
});
```
Group created → list refresh fails → silent. New conversation may not appear in UI until a manual refresh. Dev needs to see this.

**Fix:** dev-log in the catch.

---

### `L226-242` [MEDIUM · UX] — `loadConversationList` wipes store conversations to `[]` on init failure
```ts
if (!initialized) {
  useIMStore.getState().setConversations([]);
  return [];
}
```
A cached, valid conversation list is overwritten if init transiently fails (e.g. SDK file write error, brief network blip during init). User sees "no conversations" for the duration. Better: preserve the existing cache and return it; only clear on explicit teardown.

---

### `L501-537` [MEDIUM · INPUT-VALIDATION] — `sendTransferCardMessage` validates `amount > 0` but no upper bound, no integer check
Caller could send `Number.MAX_SAFE_INTEGER` or `1.5` (积分 is integer-only). Validation should be:
```ts
if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_TRANSFER_AMOUNT) {
  throw new Error('转账金额无效');
}
```
Deferred — needs product input on `MAX_TRANSFER_AMOUNT`.

---

### `L82` [LOW · DEAD-CODE] — `getPlatformID` is defined but never called
`initSDK` config at L125-132 doesn't pass `platformID`, and `auth.ts` has its own `getOpenIMPlatformID`. Likely vestigial. Confirm + delete (or document why it's kept).

---

### `L244-280` [LOW · DUPLICATION] — `getOrCreateSingleConversation` and `getOrCreateGroupConversation` are 95% identical
One helper with `sessionType` param + branching `sourceID` would halve the surface. Mechanical refactor.

---

### `L383-485, L501-579, L594-646` [LOW · DRY] — `offlinePushInfo` literal repeated 6 times across send-* functions
```ts
offlinePushInfo: {
  title: '新消息', desc: '[图片]', ex: '',
  iOSPushSound: 'default', iOSBadgeCount: true,
},
```
Extract a `offlinePush(desc, title = '新消息')` helper.

---

### `L501-579` [LOW · DUPLICATION] — Five `send*Message` functions share the same `recvID/groupID` branching, `await ensureOpenIMInitialized`, and offlinePush composition
Worth a `dispatchOpenIMMessage(message, sourceID, sessionType, push)` central helper that all 5 wrap. Not blocking.

---

### `L156-162` [LOW · API] — `loginToOpenIM` returns `false` for both "no imToken" and "unsupported platform"
Caller can't distinguish. Minor — current callers don't need to.

---

### `L539-579` [LOW · INPUT-VALIDATION] — `sendNoteCardMessage` accepts any string for `noteId` / `title` including empty
Receiver-side validation (`parseNoteCardPayload`) requires the fields to be strings but not non-empty. Empty propagates.

---

### `L73-87` [LOW · API] — Web-platform short-circuit silently sets store error
On web, every IM call sets `'OpenIM 仅支持 iOS/Android development build'` on the IM store error. UI may show this error even though the user is on web by design. Better: a single `IM_DISABLED` flag the UI can read once.

---

### `L77-79` [LOW · BUG] — `getOpenIMDataDir()` returns `${DocumentDirectoryPath}/openim` — **hardcoded path** (same finding flagged in Batch 02 cache cleanup)
If OpenIM SDK ever moves its data dir, this and `clear-app-cache.ts` both drift. Centralize.

---

### `L714-717` [LOW · POSITIVE] — `flattenSearchResult` handles both `searchResultItems` and `findResultItems`
Defensive against SDK version renames. Good.

## Test gaps for client.ts
- `test/im-client.test.js` and `test/im-client-chat-settings.test.js` currently **10/11 failing** (pre-existing): `Cannot find module '@/im/listeners'` — test scaffolding doesn't mock listeners.ts. Fix it.
- No test for 10102 "repeated login" fast-path
- No test for HMR-stable logout handler registration
- No test for `currentUserID` reset on login failure (regression for the fix above)

---

# File 2 — `src/im/listeners.ts` (185 lines)

## Findings

### `L127-136` [MEDIUM · BUG · CORRECTNESS] — C2C read-receipt routing can mis-attribute reads to the active conversation
```ts
let conversationID = receipt.conversationID;
if (!conversationID && receipt.userID) {
  const conv = conversations.find((c) => c.userID === receipt.userID);
  conversationID = conv?.conversationID;
}
if (!conversationID && activeConversation) {
  conversationID = activeConversation.conversationID;  // ← dangerous fallback
}
```
If a receipt arrives with **no** `conversationID` AND **no** matching `userID` in the cache, the code falls back to the active conversation and marks **those** msgIDs as read. The msgIDs were emitted by a different conversation — they almost never match — so usually this is a no-op. But under message-ID collisions (rare but real) it silently marks wrong messages read.

**Fix:** drop the fallback. If we can't route the receipt, log it in dev and continue:
```ts
if (!conversationID) {
  if (__DEV__) console.warn('[openim] unrouted C2C read receipt', receipt);
  continue;
}
useIMStore.getState().markMessagesRead(conversationID, ids);
```

---

### `L41-44` [MEDIUM · BUG · HMR] — Idempotent guard returns existing `unbindAll` but doesn't re-verify SDK actually still has the listeners
After HMR, the module re-evaluates → `unbindAll` may be a stale closure pointing to listener references the SDK already cleaned up internally. Subsequent calls return early without re-binding, so new bindings never happen. Result on HMR: listeners stop firing.

**Fix:** detect HMR-style re-eval and force re-bind:
```ts
if (unbindAll) {
  unbindAll();  // clean up the stale closure's bindings
}
// then bind fresh...
```
Or guard with a generation counter.

(Note: in practice, OpenIMSDK's `.off` referring to handlers that aren't bound silently no-ops, so the "double clean" is safe.)

---

### `L89-97` [LOW · DUPLICATION] — `handleConversationChanged` and `handleNewConversation` have identical bodies
```ts
const handleConversationChanged = (conversations: ConversationItem[]) => {
  useIMStore.getState().mergeConversations(conversations);
};
OpenIMSDK.on('onConversationChanged', handleConversationChanged);

const handleNewConversation = (conversations: ConversationItem[]) => {
  useIMStore.getState().mergeConversations(conversations);
};
OpenIMSDK.on('onNewConversation', handleNewConversation);
```
Share one reference:
```ts
const handleConversationsBatched = (cs: ConversationItem[]) =>
  useIMStore.getState().mergeConversations(cs);
OpenIMSDK.on('onConversationChanged', handleConversationsBatched);
OpenIMSDK.on('onNewConversation', handleConversationsBatched);
```

---

### `L79-87` [LOW · UX] — Token-expired handler navigates to `/(auth)/login` unconditionally
If user is mid-flow (composing message, file upload), abrupt navigation drops the work. No event surfaced for the screen to handle gracefully. Minor — token expiry is rare.

---

### `L161-167` [LOW · CORRECTNESS] — `handleUserStatusChanged` skips events with falsy `userID`
```ts
if (!status?.userID) return;
```
Good defensive check. But silently dropping — no dev log.

---

### `L94-97` [LOW · CORRECTNESS] — `onNewConversation` fires `mergeConversations` (right) but doesn't fetch full message preview if `latestMsg` is empty
Edge case: a fresh conversation may arrive with empty `latestMsg`. Preview will be blank until next message lands.

## Test gaps for listeners.ts
- No tests at all for listeners
- No regression test for the receipt-routing fix above

---

# File 3 — `src/im/mappers.ts` (317 lines)

## Findings

### `L185` [MEDIUM · BUG · UX] — `mapConversationItemToUI` doesn't normalize `faceURL` through `normalizeMediaUrl`
```ts
avatarUrl: item.faceURL || undefined,
```
Same family as the `api/utils.ts` fix in Batch 02. OpenIM media server is also commonly localhost-bound in dev. Physical iOS / Android dev sessions get broken avatar URLs.

**Fix:** import + apply:
```ts
import { normalizeMediaUrl } from '@/services/api/utils';
// ...
avatarUrl: normalizeMediaUrl(item.faceURL || null) || undefined,
```

---

### `L213` [LOW · BUG · TYPE-SAFETY] — Unsafe `as 1 | 2 | 3` cast on `item.status`
```ts
sendStatus: isSent ? (item.status as 1 | 2 | 3) : undefined,
```
OpenIM SDK may add or change message status values across versions (`0` = sending in some versions, `4` = revoked). Cast lies to the type system; downstream UI may render wrong icon for unknown values.

**Fix:** validate before cast:
```ts
const status = item.status;
const isValidStatus = status === 1 || status === 2 || status === 3;
// ...
sendStatus: isSent && isValidStatus ? status : undefined,
```

---

### `L294-308` [LOW · BUG · UX] — Image message with empty URL renders a broken-image box
```ts
const pic = item.pictureElem?.bigPicture ?? item.pictureElem?.sourcePicture ?? item.pictureElem?.snapshotPicture;
return {
  ...base,
  type: 'image',
  outgoing: isSent,
  imageUrl: pic?.url ?? '',  // ← empty string falls through
  // ...
};
```
If all three sizes have empty URL, we still render an `image` bubble with `imageUrl: ''`. RN `<Image>` shows an error placeholder. Better: fall back to a `'[图片]'` text bubble if URL is empty.

**Fix:** check `pic?.url` and fall through to the text-bubble branch.

---

### `L72-99` [LOW · I18N] — `formatTimestamp` hardcodes `zh-CN` locale and `'昨天'` literal
The app uses `i18next` elsewhere. This bypasses it. Will misformat for non-zh users when localization is enabled. Deferred — needs i18n decision.

---

### `L120-129` [LOW · I18N] — `getMessagePreview` hardcodes Chinese strings for system notification previews
Same issue as above. Deferred with the same decision.

---

### `L25-44` [LOW · BRITTLENESS] — `SYSTEM_NOTIFICATION_CONTENT_TYPES` enumerates SDK enum values explicitly
SDK version bump that adds a new system type → it renders as a normal `[消息]` bubble. The risk is bounded — falls back to a generic bubble, not a crash.

---

### `L50-68` [LOW · BUG] — `parseNoteCardPayload` requires `noteId` and `title` to be `string` but not non-empty
Empty `noteId` / `title` slip through, then `[笔记] ` (no title) shows in preview.

---

### `L154-158` [LOW · CORRECTNESS] — Transfer-card preview validates `amount > 0` but not integer or finite
Same family as the `sendTransferCardMessage` fix in client.ts. Receiver-side is more forgiving than sender-side.

## Test gaps for mappers.ts
- No tests for `mapConversationItemToUI` (especially the new `faceURL` normalization fix)
- No tests for `mapMessageItemToChatMessage` happy path or system-notification filtering
- No tests for transfer-card / note-card parsing

---

# File 4 — `src/components/app/session-bootstrap.tsx` (153 lines)

## Findings

### `L100-128` [HIGH · BUG · UX] — A single transient `/auth/me` failure on app open wipes the saved session
```ts
try {
  const user = await fetchCurrentUser();
  // ...
} catch {
  if (!cancelled) {
    await clearLocalSession();
  }
}
```
Bootstrap path runs on **every app open**. If the device is briefly offline (CDN flap, weak signal, server restart) when the user opens the app, `/auth/me` fails and **all locally-stored tokens are cleared**. User must log in again. Returning to the app the next time the network works should restore the session, not require a re-login.

This is the same root cause as deferred item #11 (`use-auth.ts:69-72`) but in the hot path. Promote both to a shared `retry(fn, { tries: 2, backoffMs: 400 })` util.

**Severity is HIGH here** because:
- Bootstrap runs every cold app start
- The cost is a forced re-login (and re-typing credentials)
- The failure rate scales with mobile-network flakiness

---

### `L25-33` [MEDIUM · PERF] — Whole-store subscription via destructuring `useAuthStore()`
```ts
const { accessToken, refreshToken, imToken, hasHydrated, isLoading, setUser, setLoading } = useAuthStore();
```
Same anti-pattern Batch 02 fixed in `use-auth.ts`. SessionBootstrap re-renders on every auth-state write (every token refresh, every `setUser`). It returns `null` so the render itself is cheap, but the effects re-run dep-comparison on each render. Use selectors.

---

### `L142-150` [MEDIUM · ARCHITECTURE] — Single component does 3 unrelated things
```ts
}, [
  accessToken, hasHydrated, imToken, isLoading,
  refreshToken, setLoading, setUser,
]);
```
The component owns: (1) connect/disconnect realtime, (2) AppState transition handling, (3) initial session bootstrap. These deps interact; debugging one effect requires understanding the other two. Split into `useRealtimeConnection`, `useAppStateRecovery`, `useSessionBootstrap`.

Refactor — defer.

---

### `L82-150` [LOW · STYLE] — Mid-await `cancelled` flag pattern vs. `AbortController`
The `cancelled` flag works but `AbortController` + `signal.aborted` is more idiomatic for cancellable async effects. Out of scope.

---

### `L60-73` [LOW · UX] — App-state-change effect only triggers realtime reconnect on `'active'`, not `'inactive'` / `'background'`
Disconnect on background transition would save device resources. Currently we rely on RN/iOS putting the socket to sleep. Probably fine.

## Test gaps for session-bootstrap.tsx
- No tests for the bootstrap flow at all
- Regression test for retry on `/auth/me` transient failure (after the shared retry lands)

---

# File 5 — `src/constants/config.ts` (94 lines)

## Findings

### `L79-81` [MEDIUM · BUG] — `OPENIM_LOG_LEVEL` becomes `NaN` if env var is non-numeric
```ts
export const OPENIM_LOG_LEVEL = Number(process.env.EXPO_PUBLIC_OPENIM_LOG_LEVEL ?? 3);
```
If a teammate sets `EXPO_PUBLIC_OPENIM_LOG_LEVEL=verbose` in `.env.local`, `Number("verbose")` is `NaN`. `NaN as LogLevel` passed to `initSDK` is undefined behavior on the native side.

**Fix:** validate range:
```ts
const rawLogLevel = Number(process.env.EXPO_PUBLIC_OPENIM_LOG_LEVEL ?? 3);
export const OPENIM_LOG_LEVEL = Number.isFinite(rawLogLevel) && rawLogLevel >= 0 && rawLogLevel <= 5 ? rawLogLevel : 3;
```

---

### `L73-75` [MEDIUM · BUG] — `REALTIME_WS_URL` default uses `ws://` and `API_PORT` even when API_URL is `https://`
```ts
export const REALTIME_WS_URL = trimTrailingSlash(
  process.env.EXPO_PUBLIC_REALTIME_WS_URL ?? `ws://${getDefaultHost()}:${API_PORT}/realtime`,
);
```
In production where `EXPO_PUBLIC_API_URL` is `https://api.example.com/api/v1`, if `EXPO_PUBLIC_REALTIME_WS_URL` is **not** set, the default falls back to `ws://api.example.com:3000/realtime` — wrong scheme, wrong port. The intent is "in prod, set the env var explicitly" — but the default should derive from API_URL to avoid silent dev/prod mismatch.

Deferred — needs decision on whether to derive (parse API_URL) or fail-fast (throw in prod if not set).

---

### `L46` [LOW · DX] — `localhost` fallback fails silently on physical iOS device without Expo dev server
A dev running a release-style build on a physical device without setting `EXPO_PUBLIC_API_URL` gets `http://localhost:3000` — points at the device itself. Network errors with no context. A `__DEV__ + console.warn` if Expo dev host isn't detected would help.

---

### `L31-33` [LOW · BUG] — `getExpoDevHost` breaks on IPv6 hostUri
```ts
return Constants.expoConfig?.hostUri?.split(':')[0] ?? null;
```
For an IPv6 host `[fe80::1]:8081`, `split(':')[0]` returns `[fe80`. Real-world incidence is near zero.

---

### `L85-94` [LOW · CONFIG] — `LIMITS` are hardcoded — no override path
Reasonable defaults; if marketing wants to lift VIP photo count, a per-tier override would be a separate concern. Note only.

## Test gaps for config.ts
- `test/config.api-url.test.js` covers `API_URL`; nothing for `OPENIM_*` or `REALTIME_WS_URL`
- No regression test for the NaN log-level guard

---

# Patches proposed

Defensible without product input — applying now:

1. **`client.ts:45`** — Pass `logoutFromOpenIM` directly to `registerLogoutHandler` (stable HMR ref).
2. **`client.ts:199-201`** — Reset `currentUserID` on login failure.
3. **`client.ts:217`** — Dev-warn on silent SDK logout failure.
4. **`client.ts:309`** — Dev-warn on silent `loadConversationList` failure inside `createGroupChat`.
5. **`listeners.ts:127-136`** — Drop `activeConversation` fallback in C2C read-receipt routing (mis-attribution risk).
6. **`listeners.ts:89-97`** — Share handler ref between `onConversationChanged` and `onNewConversation`.
7. **`mappers.ts:185`** — Normalize `faceURL` through `normalizeMediaUrl` (matches Batch 02 fix).
8. **`mappers.ts:213`** — Type-guard the `item.status` cast.
9. **`mappers.ts:294-308`** — Fall back to text bubble if image URL is empty.
10. **`session-bootstrap.tsx:25-33`** — Switch to selectors (matches Batch 02 use-auth.ts pattern).
11. **`config.ts:79-81`** — Guard NaN log level.
12. **`test/im-client.test.js`** — Add missing `@/im/listeners` mock so the 10 pre-existing failures pass.

## Deferred — needs product / architectural decision (added to top-level pending list)

| # | Where | Issue | Options |
|---|---|---|---|
| 14 | `session-bootstrap.tsx:100-128` + `use-auth.ts:69-72` (same root) | Transient `/auth/me` failure wipes the saved session on app open AND login | Add a shared `retry(fn, { tries: 2, backoffMs: 400 })` util in `src/utils/retry.ts`, wrap both call sites. **Promotes #11 to HIGH** because bootstrap runs on every cold start. |
| 15 | `client.ts:513` `sendTransferCardMessage` | No upper bound / integer check on `amount` | Pick a `MAX_TRANSFER_AMOUNT`, add `Number.isInteger` check. Product input. |
| 16 | `client.ts:226-242` `loadConversationList` init-failure | Overwrites cached conversations with `[]` | A. Keep cache on init failure. B. Show stale-data banner. C. Current behavior. |
| 17 | `mappers.ts:72-99, 120-129` | Hardcoded Chinese strings + `zh-CN` locale | i18n decision: thread `t()` through mappers, or accept zh-only. |
| 18 | `client.ts:82` `getPlatformID` | Defined but never called | Verify with `grep -r` then delete (or document why kept). |
| 19 | `config.ts:73-75` `REALTIME_WS_URL` default | Hard-codes `ws://`+`:3000` even when API_URL is `https://...` | A. Derive from `API_URL`. B. Throw in prod if env unset. C. Current. |
