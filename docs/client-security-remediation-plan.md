# Client Remediation Plan — `circle-im` (Expo / React Native)

> **Status:** Living plan — C-01/C-02 client-side fixes have started landing.
> **Date:** 2026-07-02
> **Author:** Security/perf review follow-up

## Scope

All eight items are in the **`circle-im` mobile client**, not the `circle_be`
backend (whose separate audit produced findings F-01…F-12). Finding IDs here are
**C-01…C-08** to stay distinct from the backend findings. Each fix is grounded in
specific files re-verified during this review.

Two items connect back to the backend:

- **C-04 (money idempotency)** relies on the backend's existing `idempotency-key`
  support on `/coin/gift`.
- **C-01 (HTTPS/WSS)** is the client half of backend finding F-04 (transport / IP
  trust).

## Completed fixes

Updated 2026-07-04 on branch `fix/p2-transport-and-log-hardening`.

- **C-01 client runtime guard:** `src/constants/config.ts` now fails fast in
  release builds when required transport env vars are missing
  (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_OPENIM_API_URL`,
  `EXPO_PUBLIC_OPENIM_WS_URL`). This prevents a shipped build from silently
  falling back to development `localhost` / private-network defaults.
- **C-01 plaintext transport guard:** `src/constants/transport-security.ts`
  rejects public `http://` / `ws://` endpoints in release unless explicitly
  allowed with `EXPO_PUBLIC_ALLOW_INSECURE_TRANSPORT=1` or `true`. Dev builds and
  explicit local/private hosts remain supported for local development and internal
  testing.
- **C-01 realtime default hardening:** `REALTIME_WS_URL` is derived from
  `API_URL` when not explicitly set, mapping `https -> wss` and preserving the
  API host/port instead of falling back to a hardcoded dev-style websocket URL.
- **C-01 error hygiene:** transport guard errors now redact URL credentials,
  query strings, and fragments before throwing, so a bad env var cannot leak
  tokens or signed parameters into CI/crash logs.
- **C-02 release console stripping:** `babel.config.js` enables
  `babel-plugin-transform-remove-console` for production builds, stripping
  `console.log` / `warn` / `info` / `debug` while preserving `console.error`.
- **Related API error hygiene:** `src/features/profile/screens/MyIconsScreen.tsx`
  now maps API failures through `getApiErrorMessage` instead of displaying raw
  unknown backend messages.

Validation already run for these landed fixes:

- `npm run typecheck`
- `npm run expo:config`
- `npm run lint`
- `npm test` (944 passed)
- `npm run test:behavior` (6 passed)

Updated 2026-07-04 on branch `fix/local-data-backup-exclusion`.

- **C-06 Android backup backstop:** `app.json` now sets
  `expo.android.allowBackup=false`, preventing Android Auto Backup from copying the
  app's local data, including plaintext OpenIM message storage and MMKV-backed
  cached metadata.
- **C-06 iOS OpenIM backup exclusion:** `src/im/client.ts` now creates the OpenIM
  data directory with `NSURLIsExcludedFromBackupKey=true`, so the local OpenIM
  message/log directory is excluded from iCloud/iTunes backups when initialized.
- **C-06 regression coverage:** `test/native-branding-config.test.js` asserts the
  Android backup setting, and `test/im-client.test.js` asserts the OpenIM data
  directory is created with the iOS backup-exclusion option.

Remaining C-01/C-02 follow-ups:

- Native transport backstop is still pending: explicitly verify/lock iOS ATS and
  Android cleartext policy (`usesCleartextTraffic=false`) in native config.
- A release bundle artifact check is still pending: build/grep the production
  bundle to verify stripped `console.*` output in the final artifact.

---

## ⚠️ Cross-cutting prerequisite (verify before C-01 / C-08)

The client opens the realtime socket with the **token in the URL query string** —
[`src/realtime/client.ts:129`](../src/realtime/client.ts) `?token=${token}` — but
the backend `RealtimeGateway` uses **message-based auth** and deliberately removed
URL-token auth; `connectRealtime`'s `onopen` never sends an auth frame.

If that backend is the deployed one, the realtime channel (which carries **all
call-invite / `call.ended` events**) may not authenticate at all — which would
itself cause "ghost / missing call popups."

**Action:** Confirm the deployed WS auth contract first. It affects:

- **C-01** — a URL token over `ws://` is a plaintext credential leak.
- **C-08** — if the channel isn't authenticating, call events never arrive
  regardless of the store fix.

This is a *Needs-confirmation* item (cross-referencing two repos), not yet a
confirmed defect.

---

## C-01 — Enforce HTTPS/WSS in release builds

| Field | Detail |
|---|---|
| **Finding ID** | C-01 (client half of backend F-04) |
| **Files** | `src/constants/config.ts`; `app.json` (iOS `NSAppTransportSecurity`, Android network-security-config via `expo-build-properties` / config plugin); optionally `src/realtime/client.ts`, `src/im/client.ts` |
| **Before release?** | **Yes** |
| **Change type** | Client + **native config** |

**Approach:** Add a release-build guard in `config.ts`: when `!__DEV__`, assert
`API_URL`/`OPENIM_API_URL` start with `https://` and `REALTIME_WS_URL`/`OPENIM_WS_URL`
start with `wss://`; throw at module-eval (fail fast at launch) or route to a fatal
error screen. Keep the existing `http`/`ws` dev defaults gated behind `__DEV__`.
Native backstop: keep iOS ATS at its secure default (do **not** add
`NSAllowsArbitraryLoads`) and set Android `usesCleartextTraffic=false` explicitly.
`deriveRealtimeUrlFromApi` already maps `https→wss` — keep it.

- **Security impact:** JWT-bearing API traffic and the realtime token can never
  traverse cleartext in a shipped build; removes silent downgrade from a prod
  `http://` misconfig.
- **Perf/stability impact:** Negligible. Misconfigured build fails loudly at launch
  instead of silently failing every request.
- **Regression risk:** **Low–Medium.** A too-strict guard could brick a legitimately
  non-TLS internal staging build — gate the assertion on `!__DEV__` **and** an
  explicit `EXPO_PUBLIC_ALLOW_INSECURE=true` escape hatch for internal builds.
- **Required tests:** Unit-test the `config.ts` guard (https/wss pass; http/ws throw
  when not dev). Snapshot native config (ATS dict absent; Android cleartext=false).
- **Manual QA:** Release build against `http://` URL → clear fatal config error, not
  a blank/white screen. Against `https://`/`wss://` → normal login + realtime connect.

---

## C-02 — Strip or centralize `console.*` in release builds

| Field | Detail |
|---|---|
| **Finding ID** | C-02 |
| **Files** | `babel.config.js` (add plugin); optionally `src/observability/logger.ts` wrapper |
| **Before release?** | **Yes** (cheap, high hygiene value) |
| **Change type** | Client build config only |

**Approach:** Add `babel-plugin-transform-remove-console` in the production env only
(`env.production.plugins`), configured to keep `console.error`/`console.warn` (or
strip all). Most call sites are already `if (__DEV__)`-guarded (e.g. `logApiEvent`
returns early when not dev; listeners/realtime warns are `__DEV__`-gated), so this is
a backstop for the unguarded remainder among the ~138 call sites. Optionally route
intentional prod diagnostics through the existing Sentry `reportError`.

- **Security impact:** Removes residual risk of tokens/PII/message bodies reaching
  device logs, Metro, or screen recordings in release. The API client already
  redacts sensitive keys — this is defense-in-depth.
- **Perf/stability impact:** Small win (no string building for stripped calls). No
  behavior change if `error`/`warn` are kept.
- **Regression risk:** **Low.** Only risk is stripping a `console` whose side effect
  was load-bearing (anti-pattern; grep confirms all are logging-only).
- **Required tests:** Build-config test asserting the plugin is present in production
  env; CI bundle grep asserting no `console.log(` in the release bundle.
- **Manual QA:** Release build → device console shows no app `console.log` during
  login/chat/call; dev build unchanged.

---

## C-03 — Fix cross-account token/session contamination in the refresh singleton

| Field | Detail |
|---|---|
| **Finding ID** | C-03 (highest-severity client item) |
| **Files** | `src/services/api/client.ts` (`refreshPromise`, `refreshAccessToken`); `src/stores/authStore.ts` (add session epoch); `src/services/auth/session.ts` (reset on logout) |
| **Before release?** | **Yes** |
| **Change type** | Client only |

**Approach:** The module-level `refreshPromise` (`client.ts:226`) and
`refreshAccessToken` read `useAuthStore.getState()` and call
`setTokens`/`clearLocalSession` with **no account-identity guard**, so an in-flight
refresh started under account A can (a) `setTokens(...)` clobber account B's
freshly-logged-in tokens, or (b) on failure `clearLocalSession()` log B out.

Fix with a **session epoch**: add `sessionEpoch: number` to `authStore`, incremented
on every `setTokens`(login) and `clearSession`(logout). In `refreshAccessToken`,
capture `epochAtStart = getState().sessionEpoch` before the network call; after it
resolves, **only** call `setTokens`/`clearLocalSession` if
`getState().sessionEpoch === epochAtStart` — otherwise abort with a "session changed"
error and do not touch state. Also register a logout handler inside `client.ts` that
nulls `refreshPromise`, so a new account never awaits a stale in-flight refresh.
Optionally capture the userId a request was issued for and skip the 401-retry if the
active user changed.

- **Security impact:** Eliminates cross-account token overwrite and cross-account
  forced-logout — prevents account B operating with A's refreshed session or being
  silently signed out by A's stale request.
- **Perf/stability impact:** Negligible (one integer compare per refresh). Removes a
  class of hard-to-reproduce logout / "wrong account" bugs.
- **Regression risk:** **Medium** — touches the auth hot path. Mitigate with tests
  around concurrent-401 + mid-refresh logout/login; keep single-flight behavior for
  the common same-account case unchanged.
- **Required tests:** (1) two concurrent 401s trigger exactly one `/auth/refresh`;
  (2) logout during in-flight refresh → result discarded, B's tokens intact;
  (3) login as B during A's in-flight refresh → A's result does not overwrite B;
  (4) refresh failure under changed epoch does not call `clearLocalSession`.
- **Manual QA:** Log in as A, let the access token expire to trigger a 401,
  immediately log out and log in as B while the refresh is in-flight; confirm B stays
  logged in as B with B's data; repeat with rapid account switching.

---

## C-04 — Idempotency keys + safe retry for money POSTs

| Field | Detail |
|---|---|
| **Finding ID** | C-04 (pairs with backend coin-gift idempotency support) |
| **Files** | `src/services/api/coin.ts` (`sendCoinGift`, `rechargePoints`); calling hook/screen in `src/features`; optionally `src/services/api/client.ts` (generic `idempotencyKey` option) |
| **Before release?** | **Yes** (money correctness) |
| **Change type** | Client only (backend already supports it) |

**Approach:** `sendCoinGift` (`coin.ts:88`) currently sends **no** `idempotency-key`
header, but the backend `/coin/gift` **requires** one and dedupes on it. Generate a
stable key **once per logical money action** (e.g. `crypto.randomUUID()` created when
the user taps "send," held in the submit hook's state) and reuse it across retries —
both the app's internal 401-retry (which already preserves `options.headers`) and any
user-initiated "try again." Add a `sendCoinGift({ ..., idempotencyKey })` param
(default-generate if omitted). Apply the same to `rechargePoints` if that endpoint is
idempotent server-side. Keep the existing client-side `assertValidCoinAmount` guard.

- **Security impact:** Prevents double-spend/double-charge on retries or duplicate
  taps; closes the current gap where the required header is absent (gift may be
  failing outright today, or would double-charge if the header were added naively
  per-attempt).
- **Perf/stability impact:** Makes money POSTs safely retryable, improving
  weak-network UX. No measurable cost.
- **Regression risk:** **Low**, provided the key is generated at the action layer
  (not regenerated inside the retry). If generated per `apiClient` call it would
  defeat idempotency — call this out in review.
- **Required tests:** `sendCoinGift` sends an `idempotency-key` header; same key
  reused on the internal 401-retry; a fresh user action uses a new key. Integration:
  duplicate submit with same key → single charge; different key → two charges.
- **Manual QA:** Send a gift on a throttled / airplane-toggling network; verify the
  recipient is credited exactly once and the sender debited once; rapid double-tap
  "send" → one transaction.

---

## C-05 — Encrypt MMKV (tokens already in SecureStore)

| Field | Detail |
|---|---|
| **Finding ID** | C-05 |
| **Files** | `src/storage/index.ts` (`createMMKV` call); new key-provisioning helper using `expo-secure-store` |
| **Before release?** | **Recommended** (acceptable as early fast-follow if migration needs bake time) |
| **Change type** | Client only |

**Approach:** Tokens are **already** in `expo-secure-store` with
`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (good — not in MMKV). But the app-wide MMKV
(`createMMKV({ id: 'circle-im' })`, `index.ts:10`) is **unencrypted** and persists
all zustand stores + preferences (cached user profile from `setUser`, chat prefs,
drafts, etc.) in plaintext. Provision a random 16-byte key once, store it in
`expo-secure-store`, and pass it as `createMMKV({ id, encryptionKey })`. Handle
first-run migration of the existing unencrypted instance (MMKV v4 `recrypt`, or
read-through migrate to a new encrypted id). MMKV init is synchronous but SecureStore
reads are async — resolve the key during the existing async startup path
(`app/_layout.tsx` already awaits `migrateFromAsyncStorage`) before first MMKV use.

- **Security impact:** Renders cached PII/preferences unreadable via raw file access
  on rooted/jailbroken or forensically-imaged devices. Tokens already protected —
  this covers the rest.
- **Perf/stability impact:** Encryption overhead minimal. Main risk is the
  sync-vs-async key bootstrap; done wrong it adds a small startup await.
- **Regression risk:** **Medium** — key provisioning + migration of an existing
  plaintext store. A lost/rotated key makes old data unreadable; treat MMKV as a
  rebuildable cache and clear on key mismatch rather than crashing.
- **Required tests:** Key generated once and reused; MMKV opens with the key;
  migration handles "no existing key," "existing plaintext store," and "key present."
  Simulate key-missing → graceful reset, not crash.
- **Manual QA:** Fresh install → data persists across relaunch; upgrade over an
  existing plaintext install → prefs/session survive; inspect the MMKV file on a dev
  device → not human-readable.

---

## C-06 — Exclude plaintext chat DB + sensitive files from platform backups

| Field | Detail |
|---|---|
| **Finding ID** | C-06 |
| **Files** | `app.json` (`android.allowBackup` and/or `dataExtractionRules`/`fullBackupContent`); small native-dir exclusion near `src/im/client.ts:91` (`getOpenIMDataDir` = `${DocumentDirectoryPath}/openim`) |
| **Before release?** | **Yes** (privacy-sensitive, cheap) |
| **Change type** | **Native config** + tiny client bootstrap |

**Approach:** The OpenIM SDK writes a **plaintext local message DB** under
`DocumentDirectoryPath/openim`, which on iOS is **iCloud/iTunes-backed-up by
default**, and Android app data is backed up when `allowBackup` is unset (defaults
true). Two changes:

- **iOS:** set `NSURLIsExcludedFromBackupKey` on the `openim` data dir (and the MMKV
  file) right after `RNFS.mkdir(dataDir)` in `ensureOpenIMInitialized` — RNFS /
  `expo-file-system` can set the exclusion flag.
- **Android:** set `android.allowBackup: false`, or provide `dataExtractionRules`
  (Android 12+) / `fullBackupContent` (older) that exclude the OpenIM DB + MMKV files
  while still allowing benign backup. Prefer targeted rules over a blanket disable if
  you want to keep some backup UX.

- **Security impact:** Prevents unencrypted chat history and cached data from leaving
  the device via cloud/desktop backups (shared/family Apple IDs, seized backups).
  Complements C-05.
- **Perf/stability impact:** None at runtime.
- **Regression risk:** **Low.** `allowBackup:false` disables Android auto-backup/restore
  app-wide (acceptable for a chat app); targeted rules are safer but need correct path
  globs. iOS exclusion flag is per-file and low-risk.
- **Required tests:** Native config assertion (Android manifest `allowBackup=false` or
  rules present). Dev check that the exclusion flag is set on the openim dir after init.
- **Manual QA:** iOS: after using chat, run an encrypted local backup and confirm the
  `openim` DB is absent (or confirm the exclusion attribute via a device-file
  inspector). Android: `adb backup` / Auto Backup test → app data / chat DB not captured.

---

## C-07 — Unbind OpenIM listeners on logout

| Field | Detail |
|---|---|
| **Finding ID** | C-07 |
| **Files** | `src/im/listeners.ts` (expose the unbind); `src/im/client.ts` (`logoutFromOpenIM`, and the `bindOpenIMListeners()` call at line 135) |
| **Before release?** | **Yes** (multi-account correctness) |
| **Change type** | Client only |

**Approach:** `bindOpenIMListeners()` returns an `unbindAll` and is idempotent
(`if (unbindAll) return`), but `logoutFromOpenIM` (`client.ts:225`) **never calls it**
— it resets `initPromise` and the IM store but leaves all `OpenIMSDK.on(...)`
subscriptions attached. On the next login the guard makes `bindOpenIMListeners()` a
no-op, so stale handler closures stay bound across account switches. Fix: capture the
unbind ref where `bindOpenIMListeners()` is called (line 135) or export
`unbindOpenIMListeners()` from `listeners.ts`, and invoke it inside `logoutFromOpenIM`
(which already runs via the registered logout handler). Null the module `unbindAll`
so the next login rebinds cleanly against the fresh SDK session.

- **Security impact:** Prevents account A's message/conversation/read-receipt handlers
  from remaining live into account B's session. Handlers read `useIMStore.getState()`
  fresh, so impact is latent, but unbinding is the correct isolation boundary.
- **Perf/stability impact:** Removes duplicate/stale native subscriptions — fewer
  wasted handler invocations, lower risk of "no listeners registered" / double-handling
  warnings and memory retention across long multi-login sessions.
- **Regression risk:** **Low–Medium.** Must rebind on next login (verify the
  `initPromise=null` + rebind path re-runs `bindOpenIMListeners`). Keep bind before
  `initSDK` and unbind only in logout to avoid missing the `onConnectSuccess` burst.
- **Required tests:** `logoutFromOpenIM` calls unbind and nulls the ref; a subsequent
  `ensureOpenIMInitialized` rebinds; login→logout→login cycles don't accumulate
  handlers (spy `OpenIMSDK.on/off` counts balance).
- **Manual QA:** Log in as A, receive a message, log out, log in as B → no
  A-conversation snackbars/unread bleed; A's messages don't appear in B's stores;
  repeat several cycles watching for duplicate snackbars.

---

## C-08 — Call lifecycle leaks & ghost incoming-call popups

| Field | Detail |
|---|---|
| **Finding ID** | C-08 (see WS-auth prerequisite above) |
| **Files** | `src/features/call/store/use-call-store.ts`; `src/features/call/components/CallInviteHost.tsx`; `src/features/call/screens/GroupCallScreen.tsx`; `src/realtime/client.ts` (disconnect handling); register a logout handler |
| **Before release?** | **Yes** (UX-blocking + privacy) |
| **Change type** | Client only — **but** validate the WS-auth prerequisite first |

**Approach:** The store sets `incomingCall` on `call.invite` and clears it only on a
**matching** `call.ended`/`call.canceled` or `resetCallState` — there is **no
client-side expiry** and `resetCallState` is **not** wired to logout or WS disconnect.
So a missed `call.ended` (WS gap; reconnect gives up after
`MAX_RECONNECT_ATTEMPTS=10`) leaves the ring popup stuck forever, and an in-flight
invite can persist across logout. Fixes:

1. **Auto-expire the ring:** when `incomingCall` is set, start a timer to
   `incomingCall.expiresAt` (payload already carries it) that clears `incomingCall` if
   not accepted/rejected; clear the timer on accept/reject/ended. (Backend ring timeout
   is 45s; mirror it client-side as the safety net.)
2. **Clear on connection loss / logout:** register `resetCallState` as a
   `registerLogoutHandler`, and clear/re-validate `incomingCall` on realtime disconnect
   (or re-sync active-call state on reconnect) so a stale ring can't survive a reconnect
   gap or account switch.
3. **LiveKit teardown:** ensure `room.disconnect()` (`GroupCallScreen.tsx:260`) runs in
   a `useEffect` cleanup that fires on unmount **and** on `handleCallEnded`, and that
   mic/camera tracks + the audio session are released — so ending/leaving a call doesn't
   leave the mic hot or the WebRTC room connected in the background.

- **Security/privacy impact:** Prevents the mic/camera staying active after a call ends
  (a hardware privacy leak) and stops stale call context bleeding across accounts.
- **Perf/stability impact:** Fixes battery drain and memory/room leaks from undisposed
  LiveKit sessions; eliminates the stuck full-screen ghost popup that blocks the UI.
- **Regression risk:** **Medium** — call UX is stateful and timing-sensitive. Risk of
  dismissing a valid ongoing ring too early (tie the timer strictly to `expiresAt`, not
  a fixed short constant) or tearing down a re-used room. Test accept/reject/timeout/
  caller-cancel/network-drop paths.
- **Required tests:** Store unit tests: invite → auto-clears at `expiresAt`;
  `call.ended` with non-matching id does not clear the active ring but a matching one
  does; logout clears call state; disconnect clears/re-validates. Component test:
  `CallInviteHost` hides when `incomingCall` becomes null. LiveKit teardown test
  asserting `room.disconnect()` on unmount and on end.
- **Manual QA:** (a) Receive a call, let it ring past timeout with the caller
  force-closing the app → popup auto-dismisses. (b) Toggle airplane mode during an
  incoming ring → popup clears within the expiry window. (c) End a call → mic indicator
  turns off, no background audio/WebRTC session persists (check OS indicator). (d) Log
  out while a ring is showing → popup gone, no bleed into next account.

---

## Suggested sequencing

All before release except where noted.

1. **C-03** (session contamination) + **C-04** (money idempotency) — highest
   security/correctness, client-only, well-scoped.
2. **C-01** (HTTPS/WSS guard) + resolve the **WS-auth prerequisite** — unblocks a
   correct C-08.
3. **C-06** (backup exclusion) + **C-05** (MMKV encryption) — privacy at rest; C-06
   first (cheaper), C-05 can trail by days if migration needs bake time.
4. **C-07** (listener unbind) + **C-08** (call lifecycle) — multi-account + call
   correctness.
5. **C-02** (strip console) — cheap, land anytime.

## Change-type summary

| Item | Client | Native config | Backend |
|---|:---:|:---:|:---:|
| C-01 HTTPS/WSS | ✅ | ✅ | — |
| C-02 strip console | ✅ | — | — |
| C-03 refresh singleton | ✅ | — | — |
| C-04 money idempotency | ✅ | — | already supported |
| C-05 encrypt MMKV | ✅ | — | — |
| C-06 backup exclusion | ✅ | ✅ | — |
| C-07 unbind IM listeners | ✅ | — | — |
| C-08 call lifecycle | ✅ | — | verify WS auth |

No item requires new backend endpoints. C-04 uses the backend's existing idempotency
support. C-08 is gated on confirming the realtime WS auth contract (potential
client/backend alignment: send a `{ type: 'auth', token }` frame instead of the URL
token).
