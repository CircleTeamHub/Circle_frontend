# Circle IM — Module Overview

> **Purpose:** scaffolding document for a systematic production-readiness code review.
> **How to use:** start at §1 (Suggested Review Order). Use §3 (Module Anatomy) as a lookup when you enter a module. §4 (Cross-Cutting Concerns) tells you where shared concerns actually live so you don't re-trace them per module.
> **Scope:** mobile Expo app only. Backend (`circle_be/src/chat`) reviewed separately.
> **Last surveyed:** 2026-05-14

---

## 1. Suggested Review Order (by risk surface)

| # | Surface | Why first | Entry files |
|---|---|---|---|
| 1 | **Auth & token lifecycle** | Token leak / refresh-loop / incomplete logout are foundational. Everything downstream assumes auth is correct. | `src/stores/authStore.ts`, `src/services/api/client.ts` (401→refresh), `src/services/auth/session.ts` (logout orchestrator) |
| 2 | **chat-core realtime** | socket.io 长连接 = 断线重连/已读水位/乐观消息对账的集中地。 | `src/chat-core/socket-manager.ts`, `src/chat-core/dispatcher.ts`, `src/components/app/session-bootstrap.tsx` (startup) |
| 3 | **Chat send / history** | Data loss, duplicate sends, file-upload presign mistakes. | `src/features/chat/screens/ChatDetailScreen.tsx`, `src/features/chat/chat-history.ts`, `src/chat-core/client.ts`, `src/chat-core/store.ts` |
| 4 | **Persistence & state hydration** | MMKV ↔ Zustand ↔ AsyncStorage migration is the kind of code that fails silently for months. | `src/storage/index.ts`, `app/_layout.tsx` (hydration), persisted stores |
| 5 | **API layer (18 domain files)** | Mostly read-after-the-fact. Looking for: missing 401/429 handling, response-shape drift, mass-assignment risk on PATCH. | `src/services/api/*.ts` |

Each surface ≈ 30–50 min for a focused review pass using `/expo-rn-production-review`-style methodology.

---

## 2. Repo at a Glance

| | |
|---|---|
| **Stack** | Expo 55, React Native 0.83.2, React 19.2, TypeScript 5.9 |
| **State** | Zustand 5.0 (some persisted via MMKV, some runtime-only) |
| **IM** | 自研 chat-core(socket.io-client,`/chat-ws`)|
| **Routing** | expo-router (file-based, 4 groups: `(auth)`, `(tabs)`, `(chat)`, `(social)`) |
| **Persistence** | MMKV (primary, sync) + AsyncStorage (legacy, migration in `_layout.tsx`) |
| **i18n** | i18next + react-i18next |
| **Rich text** | BlockNote (only in notes feature) |
| **Tests** | Node.js native `node:test` (no Jest/Vitest), ~50 test files |
| **Entry** | `app/_layout.tsx` → `app/index.tsx` → SessionBootstrap |

### Route map

| Group | Screens | Feature |
|---|---|---|
| `app/(auth)/` | login, register | Auth flow |
| `app/(tabs)/` | messages/, discover/, profile/ | Main app tabs |
| `app/(chat)/` | chat-detail, chat-info | Chat modal |
| `app/(social)/` | add-friend, create-post | Social modals |
| `app/` root | `index.tsx`, `search.tsx` | Bootstrap, unified search |

---

## 3. Module Anatomy

| Module | Purpose | Key files | External surface | Depends on | Used by | Risk tags |
|---|---|---|---|---|---|---|
| **src/chat-core/** | 自研聊天数据层 | `socket-manager.ts`(连接/重连/已读水位)、`dispatcher.ts`、`store.ts`(会话+消息)、`client.ts`(发送门面)、`api.ts`(REST 冷路径) | socket.io `chat:*` 事件 + `/api/v1/chat/*` | authStore, chat store | SessionBootstrap, chat screens, messages list | MESSAGING, NETWORK |
| **src/services/api/** | HTTP to Circle Backend (18 domain files) | `client.ts` (interceptor + 401→refresh), `auth.ts`, `friends.ts`, `circles.ts`, `upload.ts`, `profile.ts`, `users.ts` | `EXPO_PUBLIC_API_URL/api/v1`; JWT Bearer; refresh on 401; `x-device-name` header | authStore (token), storage | All features | AUTH, NETWORK, MESSAGING, GROUP |
| **src/services/auth/** | Session lifecycle / logout orchestrator | `session.ts` (`clearLocalSession`, `registerLogoutHandler`) | store reset, MMKV clear | authStore, all Zustand stores | SessionBootstrap, auth, chat | AUTH, PERSISTENCE |
| **src/stores/** | Zustand state | `authStore.ts` (access/refresh + user, **persisted**), `tabBadgeStore.ts`, `friendActivityUnreadStore.ts`, `walletRealtimeStore.ts`(会话/消息态在 `src/chat-core/store.ts`) | MMKV via `mmkvJsonStorage` (authStore only) | storage | All UI, bootstrap | AUTH, PERSISTENCE |
| **src/storage/** | Persistence abstraction | `index.ts` (MMKV singleton id `'circle-im'`, MMKV-JSON adapter, AsyncStorage→MMKV migration) | react-native-mmkv, AsyncStorage (legacy keys: `circle-im-auth`, `chat-preferences`, `discover-filter`, `@circle_im_language`) | — | authStore, all `persist()` middleware | PERSISTENCE |
| **src/realtime/** | Wallet ticker only (chat realtime lives in `chat-core/`) | `index.ts` | — | — | wallet features | NETWORK, OBSERVABILITY |
| **src/features/chat/** | Conversation & message handling | `chat-history.ts`, `screens/ChatDetailScreen.tsx` (send text/media, presign upload) | chat-core client/api; API `/upload` presign, `/friends`, `/circles` | chat-core store, api | `app/(chat)`, `tabs/(messages)` | MESSAGING, NETWORK |
| **src/features/contacts/** | Friends list & friend activities | `contact-friends.ts`, `friend-activities.ts` | API: `/friends` (GET/POST/DELETE), `/friend-activities` | authStore, api | tabs, components | NETWORK, MESSAGING |
| **src/features/discover/** | Circles, posts, plaza, recommendations | `index.ts`, `store/use-discover-filter-store.ts` | API: `/circles`, `/moments`, `/plaza`, `/notifications` | api | `tabs/(discover)` | NETWORK, UI |
| **src/features/messages/** | Message list + grouping | `store/use-message-groups-store.ts` | chat-core 会话列表 + 分组 REST | chat-core store | tabs/(messages) | MESSAGING |
| **src/features/profile/** | Profile + app settings | `profile-edit-config.ts`, `screens/AppSettings*`, `AccountSecurity*`, `Appearance*` | API: `/user` (PATCH), `/profile` (GET) | authStore, api | `tabs/(profile)` | AUTH, PERSISTENCE, I18N |
| **src/features/user/** | User detail view | `profile-view.ts` | API: `/users/:id` | api | profile, social | NETWORK |
| **src/features/social/** | Friend requests | `send-friend-request.ts` | API: `/friends` POST | api | `app/(social)` | NETWORK |
| **src/features/search/** | Unified search (recent feature) | `index.ts` | TBD — likely api | api | `app/search.tsx` | UI, NETWORK |
| **src/features/notes/** | Notes / rich text (BlockNote) | `types.ts` | BlockNote core/react | — | notes screens | UI |
| **src/hooks/** | Custom hooks | `use-auth.ts` (currentUser, login/logout/register), `use-network-status.ts` | — | authStore, services | components, screens | AUTH, NETWORK |
| **src/components/ui/** | Shared UI primitives | `avatar`, `search-bar`, `auth-input`, `badge`, `menu-row`, `nav-header`, `divider`, `filter-tabs` | — | — | all screens | UI |
| **src/components/app/** | App-level glue | `session-bootstrap.tsx` (hydrate auth → connect realtime/chat) | connectChat/connectRealtime | authStore, chat-core, services | `app/_layout.tsx` | AUTH, PERSISTENCE |
| **src/theme/** | Design tokens + light/dark | theme context, palettes | — | — | all components | UI |
| **src/i18n/** | i18next config | language hydration from MMKV key `@circle_im_language` | — | storage | all screens | I18N |
| **src/utils/** | General helpers | (formatters, error mapping likely) | — | — | all modules | NETWORK, UI |
| **src/types/** | Shared TS types | User, Message, Conversation, etc. | — | — | all modules | — |
| **src/constants/** | Runtime config | `config.ts` (API_URL, CHAT_WS_URL from env + defaults) | Env: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_CHAT_WS_URL`; `expo-constants` | — | chat-core, services/api | NETWORK |

---

## 4. Cross-Cutting Concerns

### Authentication & session
- **Token storage** → `authStore` (SecureStore + MMKV metadata). Fields: `accessToken` (short-lived), `refreshToken`, `user`.
- **Refresh** → `src/services/api/client.ts` interceptor: on 401 → POST `/auth/refresh` → update authStore → retry original request.
- **Logout** → `src/services/auth/session.ts::clearLocalSession()`: store reset → MMKV clear (orchestrator pattern).
- **Bootstrap** → `src/components/app/session-bootstrap.tsx`: hydrate authStore → `/auth/me` 校验 + connectRealtime/connectChat(长连接不依赖 /auth/me 成功)。
- ⚠️ **Token storage is MMKV (encrypted on iOS, plaintext on Android by default).** Not `expo-secure-store`. Worth checking the threat model.

### chat-core(自研聊天)
- **连接** → `connectChat(accessToken, userId)`:socket.io 连 `/chat-ws`,auth payload 带 app JWT;断线自动重连+已读水位补投。
- **发送** → `sendWithOptimism`:d(clientMessageId)幂等,乐观三态,ack 落 height。
- **登出** → SessionBootstrap effect 在 accessToken 清空时 `disconnectChat()`。
### Networking
- **Base URLs** (`src/constants/config.ts`):
  - Circle API: `EXPO_PUBLIC_API_URL` (default localhost:3000/api/v1)
- **Backend envelope**: `{ code, message, data }` (per `api-integration.md`). Backend rate-limit: 300/min/IP.
- **No `axios`** — likely raw `fetch` in `src/services/api/client.ts`. Verify timeout / abort handling.

### Persistence
- **MMKV** (primary, sync): authStore, language, theme, chat preferences, discover filter.
- **AsyncStorage** (legacy): migration happens on first launch in `app/_layout.tsx`.
- **Migration keys**: `circle-im-auth`, `circle-im-chat-preferences`, `circle-im-discover-filter`, `@circle_im_language`.
- ⚠️ Migration is one-shot — verify idempotence and failure handling.

### Observability
- **Sentry** (`src/observability/sentry.ts`): dormant until `EXPO_PUBLIC_SENTRY_DSN` / `extra.sentryDsn` is set. Every event is rebuilt from an allowlist in `beforeSend` (sanitized stack, redacted message, route-shaped transaction names, no account identity).
- **Handled failures** (`src/observability/report-failure.ts`): `reportHandledFailure(operation, kind, error)` is the only allowed outlet for a business `catch` block — dev console + local breadcrumb + deduplicated Sentry report. `ApiError` / `ChatSendError` / `CreditPolicyError` / `UserFacingError` are treated as expected and never reach Sentry from here (the API client and chat send path decide that themselves).
- **Render errors**: `RouteErrorBoundary` (exported as `ErrorBoundary` from `app/_layout.tsx`) reports what expo-router catches; `silenceDomBridgeRejection` forwards filtered unhandled rejections (it replaces Sentry's own tracker hook).
- **Breadcrumbs**: `logClientDiagnostic` buffers allowlisted keys only; they leave the device solely as context of a Sentry report and are cleared on logout.
- **Dev-only output**: `devWarn` (`src/utils/dev-log.ts`). Direct `console.*` calls are forbidden by `test/handled-failure-coverage.test.js`.
- ⚠️ No request-id propagation to the backend yet (backend generates one; the app does not send `x-request-id`).

---

## 5. Test Landscape

- **Framework:** Node.js native `node:test` (no Jest/Vitest). TypeScript compiled to JS before running.
- **Count:** ~50 test files in `test/`.
- **Covered:** API layers, session/logout, store ops, chat history, friend activities, profile edits, some UI primitives (chat bubble, nav header, badge).
- **Style:** inline mocks, VM-based isolation in a few session tests, no mocking framework.
- **Notable gaps:**
  - Listener cleanup on logout
  - WebSocket reconnect behavior
  - Token refresh race conditions
  - File upload presign + failure paths
  - Group permission boundaries
  - i18n language switching

---

## 6. Known Gaps & Open Questions

- **Token storage threat model** — MMKV vs `expo-secure-store`. Decision rationale not documented.
- **Error boundary** — app-level handling for IM disconnects / fatal errors not traced.
- **File upload security** — presign expiry, token leakage in upload URL, MIME validation.
- **Group permissions** — owner / admin / member checks; rely entirely on backend?
- **Search feature** — recent commit added it but implementation is thin; what's the API contract?
- **Offline behavior** — no offline queue visible; what happens to a send during disconnect?

---

## 7. Priority Files for Reviewer

**10-minute reads (must do before any pass):**
- `src/stores/authStore.ts` — token + user storage
- `src/im/listeners.ts` — message delivery + cleanup
- `src/services/auth/session.ts` — logout coordination
- `src/components/app/session-bootstrap.tsx` — startup orchestration
- `src/services/api/client.ts` — HTTP interceptor / refresh
- `app/_layout.tsx` and `app/index.tsx` — entry, hydration, migration

**5-minute follow-ups:**
- `src/constants/config.ts` — env defaults
- `src/storage/index.ts` — MMKV setup + migration
- `src/services/api/auth.ts` — auth endpoint contracts
- `src/features/chat/screens/ChatDetailScreen.tsx` — main message-send surface
