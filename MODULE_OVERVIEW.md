# Circle IM — Module Overview

> **Purpose:** scaffolding document for a systematic production-readiness code review.
> **How to use:** start at §1 (Suggested Review Order). Use §3 (Module Anatomy) as a lookup when you enter a module. §4 (Cross-Cutting Concerns) tells you where shared concerns actually live so you don't re-trace them per module.
> **Scope:** mobile Expo app only (worktree `awesome-brattain-1c5f97`). Backend (`circle_be/src/openim`) reviewed separately.
> **Last surveyed:** 2026-05-14

---

## 1. Suggested Review Order (by risk surface)

| # | Surface | Why first | Entry files |
|---|---|---|---|
| 1 | **Auth & token lifecycle** | Token leak / refresh-loop / incomplete logout are foundational. Everything downstream assumes auth is correct. | `src/stores/authStore.ts`, `src/services/api/client.ts` (401→refresh), `src/services/auth/session.ts` (logout orchestrator) |
| 2 | **OpenIM integration** | External SDK + WebSocket = highest concentration of race conditions, missing cleanup, silent reconnect failures. | `src/im/client.ts` (init/login singleton), `src/im/listeners.ts` (event binding), `src/components/app/session-bootstrap.tsx` (startup) |
| 3 | **Chat core (send / history / preview)** | Data loss, duplicate sends, file-upload presign mistakes. | `src/features/chat/screens/ChatDetailScreen.tsx`, `src/features/chat/chat-history.ts`, `src/im/mappers.ts`, `src/stores/imStore.ts` |
| 4 | **Persistence & state hydration** | MMKV ↔ Zustand ↔ AsyncStorage migration is the kind of code that fails silently for months. | `src/storage/index.ts`, `app/_layout.tsx` (hydration), persisted stores |
| 5 | **API layer (18 domain files)** | Mostly read-after-the-fact. Looking for: missing 401/429 handling, response-shape drift, mass-assignment risk on PATCH. | `src/services/api/*.ts` |

Each surface ≈ 30–50 min for a focused review pass using `/expo-rn-production-review`-style methodology.

---

## 2. Repo at a Glance

| | |
|---|---|
| **Stack** | Expo 55, React Native 0.83.2, React 19.2, TypeScript 5.9 |
| **State** | Zustand 5.0 (some persisted via MMKV, some runtime-only) |
| **IM** | `@openim/rn-client-sdk` 3.8.3 (WebSocket-backed) |
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
| **src/im/** | OpenIM SDK wrapper & event binding | `client.ts` (init/login singleton, send), `listeners.ts` (onRecvNewMessage, onConnected, onUserOnlineStatus), `mappers.ts` | OpenIM SDK: `initSDK`, `login`, `getConversationListSplit`, `sendMessage`; WebSocket events | authStore, imStore, tabBadgeStore | SessionBootstrap, chat screens, messages list | OPENIM, MESSAGING, NETWORK |
| **src/services/api/** | HTTP to Circle Backend (18 domain files) | `client.ts` (interceptor + 401→refresh), `auth.ts`, `friends.ts`, `circles.ts`, `upload.ts`, `profile.ts`, `users.ts` | `EXPO_PUBLIC_API_URL/api/v1`; JWT Bearer; refresh on 401; `x-device-name` header | authStore (token), storage | All features | AUTH, NETWORK, MESSAGING, GROUP |
| **src/services/auth/** | Session lifecycle / logout orchestrator | `session.ts` (`clearLocalSession`, `registerLogoutHandler`) | OpenIM logout, store reset, MMKV clear | imStore, authStore, all Zustand stores | SessionBootstrap, auth, chat | AUTH, PERSISTENCE |
| **src/stores/** | Zustand state | `authStore.ts` (access/refresh/imToken + user, **persisted**), `imStore.ts` (conversations, messages, conn state, **runtime only**), `tabBadgeStore.ts`, `friendActivityUnreadStore.ts`, `walletRealtimeStore.ts` | MMKV via `mmkvJsonStorage` (authStore only) | storage | All UI, listeners, bootstrap | AUTH, PERSISTENCE, OPENIM |
| **src/storage/** | Persistence abstraction | `index.ts` (MMKV singleton id `'circle-im'`, MMKV-JSON adapter, AsyncStorage→MMKV migration) | react-native-mmkv, AsyncStorage (legacy keys: `circle-im-auth`, `chat-preferences`, `discover-filter`, `@circle_im_language`) | — | authStore, all `persist()` middleware | PERSISTENCE |
| **src/realtime/** | Wallet ticker only (chat realtime lives in `im/`) | `index.ts` | — | imStore | wallet features | NETWORK, OBSERVABILITY |
| **src/features/auth/** | Login/register UI | `screens/` | API: `/auth/register`, `/auth/login` (returns `accessToken`, `refreshToken`, `imToken`) | authStore, session, api/auth | `app/(auth)` | AUTH |
| **src/features/chat/** | Conversation & message handling | `chat-history.ts`, `chat-preview.ts`, `chat-info.ts`, `screens/ChatDetailScreen.tsx` (send text/media, presign upload) | OpenIM `sendMessage`, `getHistoryMessage`; API `/upload` presign, `/friends`, `/circles` | imStore, api | `app/(chat)`, `tabs/(messages)` | OPENIM, MESSAGING, NETWORK |
| **src/features/contacts/** | Friends list & friend activities | `contact-friends.ts`, `friend-activities.ts` | API: `/friends` (GET/POST/DELETE), `/friend-activities` | authStore, api | tabs, components | NETWORK, MESSAGING |
| **src/features/discover/** | Circles, posts, plaza, recommendations | `index.ts`, `store/use-discover-filter-store.ts` | API: `/circles`, `/moments`, `/plaza`, `/notifications` | api | `tabs/(discover)` | NETWORK, UI |
| **src/features/messages/** | Message list + grouping | `store/use-message-groups-store.ts` | OpenIM conv list & messages | imStore | tabs/(messages) | OPENIM, MESSAGING |
| **src/features/profile/** | Profile + app settings | `profile-edit-config.ts`, `screens/AppSettings*`, `AccountSecurity*`, `Appearance*` | API: `/user` (PATCH), `/profile` (GET) | authStore, api | `tabs/(profile)` | AUTH, PERSISTENCE, I18N |
| **src/features/user/** | User detail view | `profile-view.ts` | API: `/users/:id` | api | profile, social | NETWORK |
| **src/features/social/** | Friend requests | `send-friend-request.ts` | API: `/friends` POST | api | `app/(social)` | NETWORK |
| **src/features/search/** | Unified search (recent feature) | `index.ts` | TBD — likely api | api | `app/search.tsx` | UI, NETWORK |
| **src/features/notes/** | Notes / rich text (BlockNote) | `types.ts` | BlockNote core/react | — | notes screens | UI |
| **src/hooks/** | Custom hooks | `use-auth.ts` (currentUser, login/logout/register), `use-network-status.ts` | — | authStore, services | components, screens | AUTH, NETWORK |
| **src/components/ui/** | Shared UI primitives | `avatar`, `search-bar`, `auth-input`, `badge`, `menu-row`, `nav-header`, `divider`, `filter-tabs` | — | — | all screens | UI |
| **src/components/app/** | App-level glue | `session-bootstrap.tsx` (hydrate auth → init OpenIM → bind listeners) | OpenIM login | authStore, imStore, im/client, services | `app/_layout.tsx` | AUTH, OPENIM, PERSISTENCE |
| **src/theme/** | Design tokens + light/dark | theme context, palettes | — | — | all components | UI |
| **src/i18n/** | i18next config | language hydration from MMKV key `@circle_im_language` | — | storage | all screens | I18N |
| **src/utils/** | General helpers | (formatters, error mapping likely) | — | — | all modules | NETWORK, UI |
| **src/types/** | Shared TS types | User, Message, Conversation, etc. | — | — | all modules | — |
| **src/constants/** | Runtime config | `config.ts` (API_URL, OPENIM_API_URL, OPENIM_WS_URL from env + defaults) | Env: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_OPENIM_API_URL`, `EXPO_PUBLIC_OPENIM_WS_URL`; `expo-constants` | — | im/client, services/api | NETWORK |

---

## 4. Cross-Cutting Concerns

### Authentication & session
- **Token storage** → `authStore` (MMKV via `mmkvJsonStorage`). Fields: `accessToken` (short-lived), `refreshToken`, `imToken` (OpenIM bridge), `user`.
- **Refresh** → `src/services/api/client.ts` interceptor: on 401 → POST `/auth/refresh` → update authStore → retry original request.
- **Logout** → `src/services/auth/session.ts::clearLocalSession()`: OpenIM logout → store reset → MMKV clear (orchestrator pattern).
- **Bootstrap** → `src/components/app/session-bootstrap.tsx`: hydrate authStore → if logged in, `loginToOpenIM(imToken, imUserId)`.
- ⚠️ **Token storage is MMKV (encrypted on iOS, plaintext on Android by default).** Not `expo-secure-store`. Worth checking the threat model.

### OpenIM
- **Init** → `ensureOpenIMInitialized()` is a singleton Promise (init-once guard).
- **User-ID mapping** → backend UUIDs with dashes are stripped before passing to OpenIM (`abc-def` → `abcdef`). Mapping logic lives in `im/client.ts`.
- **Listeners** → `bindOpenIMListeners()` subscribes to `onConnecting`, `onConnected`, `onRecvNewMessage`, `onUserOnlineStatus`. ⚠️ verify cleanup on logout.
- **State** → `imStore` is runtime-only (not persisted) — relies on SDK reconnect to restore.

### Networking
- **Base URLs** (`src/constants/config.ts`):
  - Circle API: `EXPO_PUBLIC_API_URL` (default localhost:3000/api/v1)
  - OpenIM API: `EXPO_PUBLIC_OPENIM_API_URL` (default localhost:10002)
  - OpenIM WS: `EXPO_PUBLIC_OPENIM_WS_URL` (default localhost:10001)
- **Backend envelope**: `{ code, message, data }` (per `api-integration.md`). Backend rate-limit: 300/min/IP.
- **No `axios`** — likely raw `fetch` in `src/services/api/client.ts`. Verify timeout / abort handling.

### Persistence
- **MMKV** (primary, sync): authStore, language, theme, chat preferences, discover filter.
- **AsyncStorage** (legacy): migration happens on first launch in `app/_layout.tsx`.
- **Migration keys**: `circle-im-auth`, `circle-im-chat-preferences`, `circle-im-discover-filter`, `@circle_im_language`.
- ⚠️ Migration is one-shot — verify idempotence and failure handling.

### Observability
- **Logger**: no central logger. ~11 `console.log` in src/ (mostly `ChatDetailScreen` debug).
- **OpenIM log level**: `OPENIM_LOG_LEVEL` constant.
- ⚠️ No structured logs, no request-id, no error reporting (Sentry / Crashlytics not in deps).

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
- **Realtime wallet channel** (`src/realtime/index.ts`) — separate WebSocket? Reuse OpenIM? Unclear.
- **Error boundary** — app-level handling for IM disconnects / fatal errors not traced.
- **File upload security** — presign expiry, token leakage in upload URL, MIME validation.
- **Group permissions** — owner / admin / member checks; rely entirely on backend?
- **Search feature** — recent commit added it but implementation is thin; what's the API contract?
- **Offline behavior** — no offline queue visible; what happens to a send during disconnect?

---

## 7. Priority Files for Reviewer

**10-minute reads (must do before any pass):**
- `src/stores/authStore.ts` — token + user storage
- `src/im/client.ts` — OpenIM init/login/send
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
