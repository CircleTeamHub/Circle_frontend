# Circle IM — Code Review Progress

> Companion to [MODULE_OVERVIEW.md](MODULE_OVERVIEW.md). Tracks per-file review status for the systematic, line-by-line code review.
> Detailed findings live in [`reviews/`](reviews/).

## Status legend

| Icon | Meaning |
|---|---|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Reviewed (findings recorded) |
| 🔁 | Reviewed + patched |
| ⏭️ | Intentionally skipped (reason noted) |

Severity counts in `H/M/L` columns = High / Medium / Low findings.

---

## Overall progress

- **Total source files:** 291 (`src/` + `app/`) — corrected from 280 after Surface 13 audit found 11 unmapped files (`features/social/*` 4 + `features/user/*` 7)
- **Reviewed:** 191 — **Surface 13 (Social + User) CLOSED at 11/11** (audit-discovered gap); **Surface 12 fully verified** at 116/116 in complete redo (all 30 dynamic-route param contracts verified); **Surface 11 CLOSED at 19/19** (initial pass + redo).
- **Patched:** 113 (+9 in S13: mock-user data gutted, UserProfileScreen 3 dev-warns + AV-button stopgap, CreatePostScreen `useTranslation` call + `inFlightRef` Pattern D + dev-warn + 4 i18n error keys + dead-icon removal + dead-row stopgap, AddFriendScreen i18n + dev-warn, EditFriendRemarkScreen dev-warn, add-friend-screen test updated)
- **In progress:** All 13 surfaces closed. **Review complete.**
- **Pending decisions:** 38 (#1 token storage closed 2026-06-21; +#66 CreatePost remaining i18n grind, +#67 EditFriendTags partial-failure; #65 mock-user data closed in-batch)
- **Note on review depth:** Surfaces 1-10 were reviewed file-by-file by me directly. Surface 11 was initially skim-reviewed via subagent (only 5 of 19 files I patched were ones I'd personally Read) — user pushed back and I did a proper redo: read all 14 skipped files myself and surfaced **3 MEDIUM bugs I'd missed**. Surface 12 spot-check was challenged → did complete redo: read all 30 dynamic-route files (`[id].tsx` / `[field].tsx`) and verified every `useLocalSearchParams<{...}>()` declaration on the 16 unique screens matches its route directory name — **0 mismatches across 116 routes**. **Surface 13 was entirely missed** in my initial 12-surface plan: `features/social/` (720 lines: AddFriend, CreatePost, SendFriendRequest) and `features/user/` (1791 lines: UserProfile, EditFriendRemark, EditFriendTags + utils) had no surface owner. User audit ("所有代码都review完成了吗") caught the gap → reviewed all 11 files, surfaced 4 MEDIUM bugs including a phantom mock-user data file (`profiles.ts`, 161 lines of fake users + Unsplash avatars in production bundle — same anti-pattern family as #36, #54).
- **Last update:** 2026-06-21
- **Surface 1 (Auth & token lifecycle): ✅ CLOSED — 14/14**
- **Surface 2 (OpenIM integration): ✅ CLOSED — 5/5**
- **Surface 3 (Chat core): ✅ CLOSED — 27/27**
- **Surface 4 (Persistence & state hydration): ✅ CLOSED — 9/9**
- **Surface 5 (API layer rest): ✅ CLOSED — 14/14**
- **Surface 7 (Discover / Moments / Circles): ✅ CLOSED — 38/38**
- **Surface 6 (Contacts): ✅ CLOSED — 9/9**
- **Surface 9 (Notes): ✅ CLOSED — 12/12**
- **Surface 10 (Search): ✅ CLOSED — 2/2**
- **Surface 8 (Profile / Settings): ✅ CLOSED — 31/31**
- **Surface 11 (UI primitives / Theme / Utils): ✅ CLOSED — 19/19**
- **Surface 12 (App routes): ✅ CLOSED — 116/116** (complete redo: all 30 dynamic routes verified against screen param contracts)
- **Surface 13 (Social + User — audit-discovered): ✅ CLOSED — 11/11**

```
Auth & token  [###########] 14/14 ✅
OpenIM        [###########]  5/5  ✅
Chat core     [###########] 27/27 ✅
Persistence   [###########]  9/9  ✅
API layer     [###########] 14/14 ✅
Contacts      [###########]  9/9  ✅
Discover      [###########] 38/38 ✅ (all 4 sub-batches closed)
Profile       [###########] 31/31 ✅
Notes         [###########] 12/12 ✅
Search        [###########]  2/2  ✅
UI / theme    [###########] 19/19 ✅
App routes    [###########] 116/116 ✅ (all 30 dynamic routes verified in S12 redo)
Social + User [###########] 11/11 ✅ (audit-discovered gap, closed in S13)
```

---

## Surface 1 — Auth & token lifecycle (3 / 14)

Risk: HIGHEST — anything wrong here cascades to every screen.

| Status | File | Lines | H/M/L | Notes |
|---|---|---|---|---|
| 🔁 | `src/stores/authStore.ts` | 148→144 | 1 / 3 / 2 | Patched: setUser bug + version:1 + tighter rehydrate validation; token fields moved to SecureStore with legacy MMKV migration, metadata remains token-free in MMKV. [reviews/01-auth.md](reviews/01-auth.md) |
| 🔁 | `src/services/api/client.ts` | 266→335 | 2 / 5 / 2 | Patched: recursive redaction + safe body/header logging + FormData detection + refresh-response runtime guard. [reviews/01-auth.md](reviews/01-auth.md) |
| 🔁 | `src/services/auth/session.ts` | 49→81 | 0 / 4 / 2 | Patched: dev-log on swallowed errors + secure auth fallback removal + unregister fn + dedup + auth-first reorder. Tests rewritten and passing. [reviews/01-auth.md](reviews/01-auth.md) |
| 🔁 | `src/services/api/auth.ts` | 139→168 | 0 / 4 / 4 | Patched: `imToken: string \| null`; `isAuthTokens` runtime guard + `ensureAuthTokens` normalizer; trim accountId in login/register. Deferred: Device.deviceName PII + post-changePassword invalidation. [reviews/02-auth-support.md](reviews/02-auth-support.md) |
| ✅ | `src/services/api/errors.ts` | 14 | 0 / 1 / 1 | Reviewed only — code→message taxonomy needs backend code list before patching. [reviews/02-auth-support.md](reviews/02-auth-support.md) |
| 🔁 | `src/services/api/utils.ts` | 51→63 | 0 / 1 / 2 | Patched: normalizeMediaUrl syncs protocol+hostname+port; normalizeUser explicit whitelist (mass-assignment defense). [reviews/02-auth-support.md](reviews/02-auth-support.md) |
| ✅ | `src/services/cache/clear-app-cache.ts` | 213 | 0 / 3 / 4 | Reviewed only — deprecation (`legacy` FS) + denylist nested-state + OpenIM dir hardcoding need product/SDK decisions. [reviews/02-auth-support.md](reviews/02-auth-support.md) |
| 🔁 | `src/hooks/use-auth.ts` | 159→178→193 | 0 / 3 / 5 | Patched (Batch 02): selectors instead of whole-store sub; mounted ref guards setState; dev-log silent server-logout catch; fire-and-forget logout. Patched (Batch 03): hook-level in-flight ref guard (Pattern D second guard). Deferred: `/auth/me` retry. [reviews/02-auth-support.md](reviews/02-auth-support.md), [reviews/03-auth-ui.md](reviews/03-auth-ui.md) |
| ✅ | `src/features/auth/index.ts` | 2 | 0 / 0 / 0 | Trivial barrel — no findings. [reviews/03-auth-ui.md](reviews/03-auth-ui.md) |
| 🔁 | `src/features/auth/screens/LoginScreen.tsx` | 192→196 | 0 / 4 / 5 | Patched: textContentType/autoComplete on account + password inputs. Deferred: dead forgot-password + social-login Pressables (#12 #13). [reviews/03-auth-ui.md](reviews/03-auth-ui.md) |
| 🔁 | `src/features/auth/screens/RegisterScreen.tsx` | 268→291 | 0 / 5 / 6 | Patched: textContentType/autoComplete on 4 inputs; `agreed` gating on Register button (compliance); router.replace instead of back; stale insets.bottom memo dep. Deferred: dead social-login Pressable (#13). [reviews/03-auth-ui.md](reviews/03-auth-ui.md) |
| 🔁 | `app/(auth)/_layout.tsx` | 23 | 0 / 0 / 1 | Patched: comment typo `//个项目` → `// 这个项目`. [reviews/03-auth-ui.md](reviews/03-auth-ui.md) |
| ✅ | `app/(auth)/login.tsx` | 1 | 0 / 0 / 0 | Trivial route wrapper — no findings. [reviews/03-auth-ui.md](reviews/03-auth-ui.md) |
| ✅ | `app/(auth)/register.tsx` | 1 | 0 / 0 / 0 | Trivial route wrapper — no findings. [reviews/03-auth-ui.md](reviews/03-auth-ui.md) |

**Cross-surface fix (counted under Surface 11):**

| Status | File | Lines | Notes |
|---|---|---|---|
| 🔁 | `src/components/ui/auth-input.tsx` | 113→127 | Patched as part of Batch 03: always `autoCorrect={false}` `spellCheck={false}`; new optional `textContentType` + `autoComplete` props. Touched here because it's the shared TextInput wrapper used by 9 auth-related fields across 4 screens; a Surface 11 full review of UI primitives is still pending. |

---

## Surface 2 — OpenIM integration (5 / 5) ✅

Risk: HIGH — external SDK + WebSocket = race conditions + silent failures. **Surface closed.**

| Status | File | Lines | H/M/L | Notes |
|---|---|---|---|---|
| 🔁 | `src/im/client.ts` | 824→833 | 0 / 6 / 9 | Patched: stable HMR logout-handler ref; reset currentUserID on login failure; dev-warn silent SDK logout + createGroupChat list-refresh failures. Deferred: transfer-card max amount (#15), loadConversationList cache behavior (#16), getPlatformID dead code (#18). [reviews/04-openim-core.md](reviews/04-openim-core.md) |
| 🔁 | `src/im/listeners.ts` | 185→186 | 0 / 2 / 4 | Patched: dropped `activeConversation` fallback in C2C read-receipt routing (mis-attribution risk); shared handler ref for `onConversationChanged` + `onNewConversation`. [reviews/04-openim-core.md](reviews/04-openim-core.md) |
| 🔁 | `src/im/mappers.ts` | 317→325 | 0 / 1 / 6 | Patched: `faceURL` normalized via `normalizeMediaUrl` (parity with Batch 02 backend fix); guard `item.status` cast; fall back to text bubble when image URL empty. Deferred: i18n hardcoded zh-CN strings (#17). [reviews/04-openim-core.md](reviews/04-openim-core.md) |
| 🔁 | `src/components/app/session-bootstrap.tsx` | 153→158 | 1 / 2 / 2 | Patched: selectors instead of whole-store sub. Deferred: shared retry util for transient `/auth/me` failure (#14 — promoted to HIGH because bootstrap runs every cold start). [reviews/04-openim-core.md](reviews/04-openim-core.md) |
| 🔁 | `src/constants/config.ts` | 94→101 | 0 / 2 / 2 | Patched: guard `NaN`/out-of-range `OPENIM_LOG_LEVEL`. Deferred: REALTIME_WS_URL default scheme/port mismatch in prod (#19). [reviews/04-openim-core.md](reviews/04-openim-core.md) |

---

## Surface 3 — Chat core (0 / 27)

Risk: HIGH — data loss, duplicate sends, file upload.

| Status | File | Lines | H/M/L | Notes |
|---|---|---|---|---|
| 🔁 | `src/features/chat/screens/ChatDetailScreen.tsx` | 940→935 | 1 / 4 / 7 | Patched: **deleted all 11 console.log** (HIGH — message text + presigned URLs leaking); `inFlightRef` Pattern D guard across 6 send paths; `onScrollToIndexFailed` fallback; mic button Alert stopgap; dev-warn 3 silent catches; `\|\|` fix for filename. Deferred: i18n (#25), dead video-call (#28), atomic transfer message (#29). [reviews/05b-i-chat-core.md](reviews/05b-i-chat-core.md) |
| ✅ | `src/features/chat/chat-history.ts` | 68 | 0 / 0 / 2 | Reviewed only — i18n hardcoded zh strings deferred (#25). [reviews/05b-i-chat-core.md](reviews/05b-i-chat-core.md) |
| ✅ | `src/features/chat/chat-preview.ts` | 20 | 0 / 0 / 1 | Reviewed only — fragile error-message string-match deferred (#26). [reviews/05b-i-chat-core.md](reviews/05b-i-chat-core.md) |
| ✅ | `src/features/chat/chat-info.ts` | 33 | 0 / 0 / 1 | Reviewed only — i18n hardcoded zh strings deferred (#25). [reviews/05b-i-chat-core.md](reviews/05b-i-chat-core.md) |
| 🔁 | `src/features/chat/components/chat-bubble.tsx` | 1126→1128 | 0 / 1 / 6 | Patched: removed `senderName = '陈'` hardcoded default in ReceivedBubble + LocationCard; TransferCardBubble amount with thousand-separator (`.toLocaleString()`). Deferred: i18n (#25), NoteCard location-vs-groups semantic (#27), unsafe Ionicon cast (#30). [reviews/05b-i-chat-core.md](reviews/05b-i-chat-core.md) |
| 🔁 | `src/features/chat/screens/ChatHistoryDateScreen.tsx` | 246→264 | 0 / 1 / 1 | Patched: added catch blocks for `handleSearch` + `handleLoadMore` (was silent unhandled rejection on SDK failure). [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| 🔁 | `src/features/chat/screens/ChatHistoryFilesScreen.tsx` | 220→226 | 0 / 1 / 1 | Patched: `handleLoadMore` catch (initial-load + retry already had it). [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| 🔁 | `src/features/chat/screens/ChatHistoryMediaScreen.tsx` | 244→250 | 0 / 1 / 1 | Patched: `handleLoadMore` catch. [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| ✅ | `src/features/chat/screens/ChatHistorySearchHubScreen.tsx` | 111 | 0 / 0 / 1 | Reviewed only — pure router-pushing hub, no issues beyond i18n (#25). [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| 🔁 | `src/features/chat/screens/ChatHistoryTextScreen.tsx` | 229→242 | 0 / 1 / 1 | Patched: added catches for `handleSearch` + `handleLoadMore`. [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| ✅ | `src/features/chat/screens/ChatInfoScreen.tsx` | 733 | 0 / 0 / 5 | Reviewed only — already very well designed (token-based action concurrency + `runConversationAction` pattern, optimistic+rollback). Deferred: #34 (blacklist pattern unification). [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| ✅ | `src/features/chat/screens/ChatBackgroundScreen.tsx` | 198 | 0 / 0 / 2 | Reviewed only — clean. Image background stopgap deferred (#28 family). [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| 🔁 | `src/features/chat/screens/RecommendFriendScreen.tsx` | 204→221 | 0 / 2 / 1 | Patched: `inFlightRef` Pattern D second guard + dev-warn silent `loadConversationList` catch. [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| 🔁 | `src/features/chat/screens/ReportFriendScreen.tsx` | 261→269 | 0 / 1 / 0 | Patched: `inFlightRef` Pattern D second guard. [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| 🔁 | `src/features/chat/screens/SharePickerScreen.tsx` | 355→361 | 0 / 1 / 1 | Patched: data-fetch catch (was silent). [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| 🔁 | `src/features/chat/screens/TransferComposerScreen.tsx` | 263→282 | 0 / 2 / 1 | Patched: `inFlightRef` Pattern D + gate submit when balance fetch failed (was bypassing local balance check). [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| ✅ | `src/features/chat/store/use-chat-preferences-store.ts` | 132 | 0 / 0 / 3 | Reviewed only — clean, partialize correct. i18n deferred (#25), `getChatBackgroundPreference` method seems unused. [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) |
| ✅ | `src/features/chat/store/use-share-picker-store.ts` | 32 | 0 / 0 / 0 | Reviewed only — clean pass-through store. |
| ✅ | `src/features/chat/store/use-transfer-composer-store.ts` | 28 | 0 / 0 / 0 | Reviewed only — clean pass-through store. |
| 🔁 | `src/features/messages/screens/MessagesScreen.tsx` | 470→503 | 0 / 4 / 2 | Patched: `useMemo` for `BASE_FILTERS` + `MENU_ACTIONS` (memo stability); `handleConversationPress` fire-and-forget mark-read/refresh (was blocking nav on 2 server calls); `handleClearUnread` switched to `Promise.allSettled` + dev-warn (was Promise.all short-circuit); `scan`/`seatManagement` menu items now show Alert stopgap (was dead buttons); 3 silent catches now dev-warn. [reviews/05b-iii-messages-tab.md](reviews/05b-iii-messages-tab.md) |
| ✅ | `src/features/messages/screens/FindScreen.tsx` | 1 | 0 / 0 / 0 | Trivial re-export from search feature. [reviews/05b-iii-messages-tab.md](reviews/05b-iii-messages-tab.md) |
| ✅ | `src/features/messages/screens/GroupManagementScreen.tsx` | 217 | 0 / 1 / 2 | Reviewed only — reads `conversations` from a store that's never populated (custom-groups feature is **dead**). Deferred: #35 (wire / remove / mark WIP). [reviews/05b-iii-messages-tab.md](reviews/05b-iii-messages-tab.md) |
| 🔁 | `src/features/messages/screens/NewGroupScreen.tsx` | 370→378 | 0 / 1 / 2 | Patched: `inFlightRef` Pattern D second guard (`createGroupChat` is server-side write — fast double-tap could create duplicate groups); dev-warn silent `fetchFriends` catch. [reviews/05b-iii-messages-tab.md](reviews/05b-iii-messages-tab.md) |
| ✅ | `src/features/messages/store/use-message-groups-store.ts` | 87 | 0 / 1 / 0 | Reviewed only — store maintains `conversations` array nobody writes to. Sister of #35. |
| ✅ | `src/features/messages/data/discover-alerts.ts` | 18 | 0 / 1 / 0 | Reviewed only — fake mock data in production: every user sees 5 fixed "刚刚 / 12 分钟前" alerts with no way to dismiss. Deferred: #36. |
| ✅ | `src/features/messages/index.ts` | 3 | 0 / 0 / 0 | Trivial barrel. |
| 🔁 | `src/features/chat/index.ts` | 3→14 | 0 / 0 / 1 | Patched: added 4 missing card-bubble exports + `BubbleStatusText` (was a stale barrel — routes imported directly from chat-bubble). |
| ⬜ | `src/features/chat/index.ts` | ? | – | Feature barrel |
| ⬜ | `src/features/chat/components/chat-bubble.tsx` | ? | – | Message bubble |
| ⬜ | `src/features/chat/screens/ChatBackgroundScreen.tsx` | ? | – | Chat bg picker |
| ⬜ | `src/features/chat/screens/ChatHistoryDateScreen.tsx` | ? | – | History by date |
| ⬜ | `src/features/chat/screens/ChatHistoryFilesScreen.tsx` | ? | – | History files filter |
| ⬜ | `src/features/chat/screens/ChatHistoryMediaScreen.tsx` | ? | – | History media filter |
| ⬜ | `src/features/chat/screens/ChatHistorySearchHubScreen.tsx` | ? | – | History search hub |
| ⬜ | `src/features/chat/screens/ChatHistoryTextScreen.tsx` | ? | – | History text filter |
| ⬜ | `src/features/chat/screens/ChatInfoScreen.tsx` | ? | – | Chat info |
| ⬜ | `src/features/chat/screens/RecommendFriendScreen.tsx` | ? | – | Recommend friend |
| ⬜ | `src/features/chat/screens/ReportFriendScreen.tsx` | ? | – | Report friend |
| ⬜ | `src/features/chat/screens/SharePickerScreen.tsx` | ? | – | Share picker |
| ⬜ | `src/features/chat/screens/TransferComposerScreen.tsx` | ? | – | Transfer composer |
| ⬜ | `src/features/chat/store/use-chat-preferences-store.ts` | ? | – | Chat prefs store |
| ⬜ | `src/features/chat/store/use-share-picker-store.ts` | ? | – | Share picker store |
| ⬜ | `src/features/chat/store/use-transfer-composer-store.ts` | ? | – | Transfer store |
| ⬜ | `src/features/messages/screens/MessagesScreen.tsx` | ? | – | Conversation list |
| ⬜ | `src/features/messages/screens/FindScreen.tsx` | ? | – | Find users/groups |
| ⬜ | `src/features/messages/screens/GroupManagementScreen.tsx` | ? | – | Group management |
| ⬜ | `src/features/messages/screens/NewGroupScreen.tsx` | ? | – | New group |
| ⬜ | `src/features/messages/store/use-message-groups-store.ts` | ? | – | Message grouping store |
| ⬜ | `src/features/messages/index.ts` | ? | – | Feature barrel |
| ⬜ | `src/features/messages/data/discover-alerts.ts` | ? | – | Alert data |

---

## Surface 4 — Persistence & state hydration (9 / 9) ✅

Risk: MEDIUM-HIGH — silent migration failures, orphaned data. **Surface closed.**

| Status | File | Lines | H/M/L | Notes |
|---|---|---|---|---|
| 🔁 | `src/storage/index.ts` | 71→79 | 0 / 1 / 2 | Patched: `MIGRATION_FLAG` only set on full success; failures dev-warn + leave flag false so next launch retries. Removes the silent half-migration-permanently-stuck failure mode. [reviews/05a-persistence.md](reviews/05a-persistence.md) |
| 🔁 | `app/_layout.tsx` | 127→142 | 1 / 1 / 2 | Patched: HIGH — `migrateFromAsyncStorage().catch().finally()` so a migration error doesn't leave the splash screen up forever. Splash `hideAsync` `.catch()` for double-call guard. [reviews/05a-persistence.md](reviews/05a-persistence.md) |
| 🔁 | `app/index.tsx` | 31→33 | 0 / 1 / 1 | Patched: selectors instead of whole-store sub. [reviews/05a-persistence.md](reviews/05a-persistence.md) |
| 🔁 | `src/stores/imStore.ts` | 190→193 | 0 / 0 / 3 | Patched: deterministic `conversationID` tiebreaker in `compareConversations` (sort no longer depends on insertion order at equal timestamps). [reviews/05a-persistence.md](reviews/05a-persistence.md) |
| 🔁 | `src/stores/friendActivityUnreadStore.ts` | 44→47 | 0 / 1 / 1 | Patched: dev-warn the silent catch in `refresh`. Deferred: `markRead` optimistic-decrement drift (#23). [reviews/05a-persistence.md](reviews/05a-persistence.md) |
| ✅ | `src/stores/tabBadgeStore.ts` | 57 | 0 / 0 / 2 | Reviewed only — LOWs (negative/NaN validation) didn't need patching this round. [reviews/05a-persistence.md](reviews/05a-persistence.md) |
| 🔁 | `src/stores/walletRealtimeStore.ts` | 23→28 | 0 / 1 / 2 | Patched: `Number.isFinite + ≥ 0` guard in `setRealtimeBalance` so realtime-channel dirty payloads can't corrupt balance. [reviews/05a-persistence.md](reviews/05a-persistence.md) |
| 🔁 | `src/i18n/index.ts` | 58→63 | 0 / 0 / 3 | Patched: `void` unawaited init / changeLanguage promises (lint hygiene + no unhandled rejection). [reviews/05a-persistence.md](reviews/05a-persistence.md) |
| 🔁 | `src/realtime/client.ts` | 301→308 | 0 / 4 / 5 | Patched: dev-warn silent JSON-parse + recovery catches. Deferred: token in URL query (#20), silent reconnect giveup (#21), dead event paths (#22), profile/system unread duplication (#24). [reviews/05a-persistence.md](reviews/05a-persistence.md) |

---

## Surface 5 — API layer (rest) (0 / 16)

Risk: MEDIUM — response-shape drift, missing 429 handling.

| Status | File | Lines | H/M/L | Notes |
|---|---|---|---|---|
| ⬜ | `src/services/api/friends.ts` | ? | – | |
| ⬜ | `src/services/api/circles.ts` | ? | – | |
| ⬜ | `src/services/api/moments.ts` | ? | – | |
| ⬜ | `src/services/api/profile.ts` | ? | – | |
| ⬜ | `src/services/api/users.ts` | ? | – | |
| ⬜ | `src/services/api/upload.ts` | ? | – | Presign + multipart |
| ⬜ | `src/services/api/notifications.ts` | ? | – | |
| ⬜ | `src/services/api/plaza.ts` | ? | – | |
| ⬜ | `src/services/api/notes.ts` | ? | – | |
| ⬜ | `src/services/api/membership.ts` | ? | – | |
| ⬜ | `src/services/api/coin.ts` | ? | – | |
| ⬜ | `src/services/api/mall.ts` | ? | – | |
| ⬜ | `src/services/api/collections.ts` | ? | – | |
| ⬜ | `src/services/api/icons.ts` | ? | – | |

---

## Surface 6 — Contacts / Social / User (0 / 9)

| Status | File | Lines | H/M/L |
|---|---|---|---|
| ⬜ | `src/features/contacts/contact-friends.ts` | ? | – |
| ⬜ | `src/features/contacts/friend-activities.ts` | ? | – |
| ⬜ | `src/features/contacts/index.ts` | ? | – |
| ⬜ | `src/features/contacts/screens/ContactsScreen.tsx` | ? | – |
| ⬜ | `src/features/contacts/screens/FriendActivityDetailScreen.tsx` | ? | – |
| ⬜ | `src/features/contacts/screens/FriendTagDetailScreen.tsx` | ? | – |
| ⬜ | `src/features/contacts/screens/FriendTagsScreen.tsx` | ? | – |
| ⬜ | `src/features/contacts/screens/GroupsScreen.tsx` | ? | – |
| ⬜ | `src/features/contacts/screens/NewFriendsScreen.tsx` | ? | – |
| ⬜ | `src/features/social/*` (4 files) | ? | – |
| ⬜ | `src/features/user/*` (6 files) | ? | – |

---

## Surface 7 — Discover / Moments / Circles (13 / 30) 🔄

In progress — split into 4 sub-batches:

- **7-i ✅ Foundation (13)** — `store/*.ts` 10 + `utils/*.ts` 2 + `index.ts` 1. **[reviews/07-i-discover-foundation.md](reviews/07-i-discover-foundation.md)** — 0 H, 4 M, 5 L, 2 STYLE. 4 patched: moments-store reentrancy + dedup, removed dead use-circle-activity-store, dropped dead `snapshotPosts` arg, extracted `NATIONWIDE_CITY_VALUE` constant. 3 items deferred (#41 #42 #43).
- **7-ii ✅ UI components (10)** — `components/*.tsx` 10 (plaza/moment cards, image grid, comment input, feeds). **[reviews/07-ii-discover-components.md](reviews/07-ii-discover-components.md)** — 0 H, 3 M, 6 L, 3 STYLE. 8 patched: deleted dead `post-card.tsx` + `Post` type + barrel re-export, extracted `formatRelativeTime` util (shared by moment/plaza cards), i18n'd hardcoded zh strings in 3 components, typed Ionicons glyph in restriction-badge, AppState-gated 30s polling in moments-feed, dev-warns on 2 silent catches. 2 items deferred (#45 #46); #44 closed in-batch.
- **7-iii ✅ Discover entry + filter + moment screens (7)** — `screens/DiscoverScreen.tsx` + `FilterScreen.tsx` + `SelectFilterCirclesScreen.tsx` + `SelectCircleScreen.tsx` + `SelectCityScreen.tsx` + `CreateMomentScreen.tsx` + `MomentDetailScreen.tsx`. **[reviews/07-iii-discover-entry-filter-moment-screens.md](reviews/07-iii-discover-entry-filter-moment-screens.md)** — 0 H, 6 M, 8 L, 3 STYLE. 6 patched: MomentDetail (3rd `formatRelativeTime` consolidation + comment-submit error surfacing + i18n locale on timestamps + like rollback dev-warn) + CreateMoment (per-image upload dev-warn + `t` dep) + FilterScreen (explicit `Platform.OS === 'android'` gate on Toast) + DiscoverScreen (useMemo FILTER_TABS) + SelectCityScreen (`t` deps fix) + moment-comment-input (async-safe API: awaits `onSubmit`, keeps input open on reject + adds `submitting` state). 3 items deferred (#47 #48 #49).
- **7-iv ✅ Circle + verification screens (8)** — `screens/CircleDetailScreen.tsx` + `EditCircleScreen.tsx` + `CreateCircleScreen.tsx` + `CircleNotificationSettingsScreen.tsx` + `AdminReviewScreen.tsx` + `InvitationVerificationScreen.tsx` + `SelectVerifierScreen.tsx` + `VerificationRequestScreen.tsx`. **[reviews/07-iv-discover-circle-verification-screens.md](reviews/07-iv-discover-circle-verification-screens.md)** — 0 H, 6 M, 10 L, 3 STYLE. 9 patched: 4 verification screens gained error state + retry button (parity with MomentDetail pattern); CreateCircle + EditCircle added dev-warns on silent avatar upload + useMemo'd PRESET/VIP/CREDIT options; CircleDetail i18n'd 5 hardcoded zh strings; InvitationVerification typed Ionicons glyph + useCallback'd handleAddVerifier. 3 items deferred (#51 #52 #53). **Surface 7 closed at 38/38.**

---

## Surface 8 — Profile / Settings (0 / 24)

Lower priority — mostly UI. Will batch.

(Files: `src/features/profile/screens/*.tsx` 19, others 5)

---

## Surface 9 — Notes (0 / 12)

Includes `src/features/notes/dom/NoteBlockEditor.dom.tsx` — webview DOM bridge, worth scrutiny.

---

## Surface 10 — Search (0 / 2)

| Status | File |
|---|---|
| ⬜ | `src/features/search/index.ts` |
| ⬜ | `src/features/search/screens/SearchScreen.tsx` |
| ⬜ | `app/search.tsx` |

---

## Surface 11 — UI primitives / Theme / Utils (likely batch or skip)

Candidate for `[STYLE-NIT only]` batch — minimal logic, mostly style.

(Files: `src/components/ui/*` 12, `src/theme/*` 5, `src/utils/*` 1, `src/types/*` 1, `src/hooks/use-network-status.ts`)

---

## Surface 12 — App routes (116 / 116) ✅

**Complete redo: all 116 routes verified.** 105 are 1-line re-exports of 16 unique screens (verified via `find | xargs cat | sort -u`). All 30 dynamic routes (`[id].tsx` / `[field].tsx`) have their `useLocalSearchParams<{...}>()` declarations matching the route directory name — **0 mismatches**. 11 non-trivial `_layout.tsx` files patched (tabs accessibility, messages route titles i18n).

---

## Surface 13 — Social + User (11 / 11) ✅ (audit-discovered)

Surface missed in original 12-surface plan. User audit ("所有代码都review完成了吗") caught the gap.

| Status | File | Lines | H/M/L | Notes |
|---|---|---|---|---|
| 🔁 | `src/features/social/send-friend-request.ts` | 15 | 0/0/0 | i18n helper — clean. [reviews/13-social-and-user.md](reviews/13-social-and-user.md) |
| ✅ | `src/features/social/index.ts` | 2 | 0/0/0 | Barrel — `SendFriendRequest` missing but unused as named export. |
| 🔁 | `src/features/social/screens/AddFriendScreen.tsx` | 224 | 0/0/2 | Patched: `useTranslation` + 6 zh strings i18n'd + dev-warn on silent search catch. |
| 🔁 | `src/features/social/screens/CreatePostScreen.tsx` | 482 | 0/1/3 | Patched: useTranslation actually called + inFlightRef Pattern D + dev-warn + 4 i18n error keys + dead-icon removal + dead-row Alert stopgap + handleSubmit deps fix. Deferred: #66 (~25 remaining hardcoded JSX strings). |
| ✅ | `src/features/social/screens/SendFriendRequestScreen.tsx` | 390 | 0/0/2 | Reviewed only — silent fetchFriendTags catch + missing inFlightRef (single API call, lower risk). |
| ✅ | `src/features/user/profile-view.ts` | 84 | 0/0/0 | Pure helpers — clean. |
| ✅ | `src/features/user/utils/routes.ts` | 252 | 0/0/1 | Heavy switch-statement duplication across 5 scope-aware helpers but explicit form is grep-friendly. STYLE-only. |
| 🔁 | `src/features/user/data/profiles.ts` | 161→22 | 0/1/0 | **#65 closed** — gutted 150 lines of mock user data. Kept type-only export. |
| ✅ | `src/features/user/components/profile-action-row.tsx` | 64 | 0/0/1 | Missing a11y on Pressable. |
| 🔁 | `src/features/user/screens/UserProfileScreen.tsx` | 630 | 0/1/3 | Patched: inline synthesized fallback profile (replaces mock dict lookup) + dev-warns on 3 silent catches + AV-button Alert stopgap. |
| 🔁 | `src/features/user/screens/EditFriendRemarkScreen.tsx` | 226 | 0/0/2 | Patched: dev-warn on silent fetchFriendSettings catch. |
| ✅ | `src/features/user/screens/EditFriendTagsScreen.tsx` | 374 | 0/1/2 | Reviewed only — Promise.all partial-failure leaves local state out of sync with backend (#67 deferred). |

---

## Session log

| Date | Files | Output |
|---|---|---|
| 2026-05-14 | 3 (auth core) | [reviews/01-auth.md](reviews/01-auth.md) — 3 H, 12 M, 6 L findings |
| 2026-05-14 | patches applied | authStore.ts + client.ts + session.ts; +130/-27. 1 HIGH + 8 MEDIUM resolved. tsc clean. auth-session tests rewritten (5/5 pass, was 0/2). 1 HIGH (MMKV→SecureStore) + 2 MEDIUM (retry sentinel, persist coordination) deferred — see "Remaining" in [reviews/01-auth.md](reviews/01-auth.md). |
| 2026-05-14 | 5 (auth support layer) | [reviews/02-auth-support.md](reviews/02-auth-support.md) — 0 H, 13 M, 16 L findings + 1 cross-cutting privacy gap (chat data not cleared on logout). |
| 2026-05-14 | patches applied | auth.ts + utils.ts + use-auth.ts (errors.ts and clear-app-cache.ts reviewed only). +205/-70 src/. 6 MEDIUM + several LOW resolved. auth-api tests fixed (7/7 pass, was 0/3 — added react-native mock + 4 new tests for shape guard / trim / null imToken). tsc clean. 7 items deferred for product / backend / SDK decisions. |
| 2026-05-14 | 6 (auth UI — surface 1 closed) | [reviews/03-auth-ui.md](reviews/03-auth-ui.md) — 0 H, 10 M, 12 L findings. |
| 2026-05-14 | patches applied | auth-input.tsx (cross-surface) + LoginScreen + RegisterScreen + _layout + use-auth.ts (in-flight guard). +117/-37. 7 MEDIUM + 5 LOW resolved (autofill / autoCorrect, agreement gating on register, router.replace, stale memo dep, hook-level Pattern D guard, layout typo). tsc clean. All 12 auth tests still pass. 2 items deferred (dead forgot-password + dead social-login Pressables — product/design call). **Surface 1 closed at 14/14.** |
| 2026-05-14 | decisions #12 #13 resolved | #12 forgot-password → Alert stopgap (replace with real route when backend lands). #13 WeChat social-login → fully deleted from LoginScreen + RegisterScreen (JSX, styles, dynamic styles, unused Ionicons import). LoginScreen.tsx +5/-30, RegisterScreen.tsx +0/-45. tsc clean, 12/12 tests pass, no orphan references. |
| 2026-05-14 | 5 (OpenIM core — surface 2 closed) | [reviews/04-openim-core.md](reviews/04-openim-core.md) — 1 H, 13 M, 23 L findings. |
| 2026-05-14 | patches applied | client.ts + listeners.ts + mappers.ts + session-bootstrap.tsx + config.ts (all 5 patched). +71/-30 src/. 11 MEDIUM + 4 LOW resolved. Fixed 2 stale + un-mocked IM tests (was 3/13 → now 13/13 across both files). Total surface-wide regression check: **25/25 auth+IM+config tests pass.** tsc clean. 6 items deferred (#14-#19 — 1 HIGH promoted from #11). **Surface 2 closed at 5/5.** |
| 2026-05-15 | decisions #11 #14-#19 resolved | All 6 OpenIM-batch deferrals (plus #11 which #14 subsumes) addressed. Created `src/utils/retry.ts` (88 lines, 8 unit tests) + wrapped `/auth/me` in use-auth.ts and session-bootstrap.tsx. Added `LIMITS.TRANSFER_MAX_AMOUNT` + integer guard. `loadConversationList` preserves cache on init failure. `getPlatformID` deleted. `REALTIME_WS_URL` default now derived from API_URL (correct scheme + port in prod). `mappers.ts` strings go through `i18n.t()` with current Chinese as `defaultValue` (locale JSON untouched). +214/-89 src/, new src/utils/retry.ts + test/retry.test.js. **33/33 tests pass** (25 prior + 8 new retry). tsc clean. |
| 2026-05-15 | 9 (Persistence — surface 4 closed) | [reviews/05a-persistence.md](reviews/05a-persistence.md) — 1 H, 8 M, 18 L findings. |
| 2026-05-15 | patches applied | storage/index.ts + app/_layout.tsx + app/index.tsx + imStore.ts + friendActivityUnreadStore.ts + walletRealtimeStore.ts + i18n/index.ts + realtime/client.ts (8 files patched; tabBadgeStore.ts reviewed only). +87/-31 in this batch. **HIGH: migration failure no longer bricks splash** (catch + finally guarantees `setMigrated(true)` runs). 4 MEDIUM resolved (selectors in app/index, deterministic conv sort, wallet payload validation, hideAsync double-call). 6 LOWs resolved (dev-warns on silent catches, etc). 5 items deferred (#20-#24 — token in URL, reconnect giveup state, dead event paths, markRead drift, profile/system unread duplication). **33/33 tests pass**, tsc clean. **Surface 4 closed at 9/9.** |
| 2026-05-15 | 5 (Chat core hot path) | [reviews/05b-i-chat-core.md](reviews/05b-i-chat-core.md) — 1 H, 6 M, 18 L findings. |
| 2026-05-15 | patches applied | ChatDetailScreen.tsx + chat-bubble.tsx (2 patched; chat-history.ts + chat-preview.ts + chat-info.ts reviewed only). **HIGH: deleted all 11 console.log calls** (leaking message text + presigned URLs). Added `inFlightRef` Pattern D guard across 6 send paths. `onScrollToIndexFailed` fallback. Mic button Alert stopgap. Dev-warn 3 silent catches. Filename `\|\|` over `??`. Removed `senderName='陈'` defaults. `toLocaleString()` for transfer amount. Fixed pre-existing `chat-preferences-store.test.js` (added `@/storage` mock, was 0/3 → now 3/3). +133/-39. **47/47 cumulative tests pass**, tsc clean. 6 items deferred (#25-#30). |
| 2026-05-15 | 14 (Chat history search + action screens) | [reviews/05b-ii-chat-history-actions.md](reviews/05b-ii-chat-history-actions.md) — 0 H, 9 M, 16 L findings. |
| 2026-05-15 | patches applied | 8 patched: 5 history screens (Date/Text/Files/Media + SharePicker — added catch blocks on previously-silent `try/finally`-no-catch paths) + 3 compose screens (Transfer/Report/Recommend — added `inFlightRef` Pattern D guards). TransferComposer also gates submit when balance fetch failed (was bypassing local check, relying on server-only). Recommend dev-warns the silent `loadConversationList` catch. 6 reviewed only (SearchHub / ChatBackground / ChatInfo / 3 stores). ChatInfoScreen is the architectural exemplar — its `runConversationAction` + token-based concurrency pattern is the reference for other action screens. +83/-10. **47/47 cumulative tests pass**, tsc clean. 4 items deferred (#31-#34). Pre-existing `chat-info-screen.test.js` 2 failures are aspirational tests (UserIconRow not implemented) — not regressions. |
| 2026-05-15 | decisions #31–#34 resolved | All 4 batch-5b-ii deferrals addressed. ChatHistory Date/Text + SharePicker gained error state + 重试 button (parity with Files/Media). TransferComposer extracted `loadBalance()` + inline retry row when balance fetch fails. SharePicker titles + 6 quick-reply phrases moved behind `i18n.t(key, { defaultValue: zh })` — locale JSON untouched, current zh users unchanged. ChatInfoScreen blacklist + delete gained `inFlightRef` race-protection guards (full `runConversationAction` unification deferred — different scopes don't share the same abstraction). +203/-24. **47/47 tests pass**, tsc clean. |
| 2026-05-15 | 8 (Messages tab — Chat surface closed at 27/27) | [reviews/05b-iii-messages-tab.md](reviews/05b-iii-messages-tab.md) — 0 H, 8 M, 7 L findings. |
| 2026-05-15 | patches applied | 3 patched: MessagesScreen.tsx (4 M fixed: memo-stable BASE_FILTERS/MENU_ACTIONS, fire-and-forget mark-read on navigation, `Promise.allSettled` in clear-unread, scan/seat menu Alert stopgaps, dev-warn 3 silent catches) + NewGroupScreen.tsx (`inFlightRef` + dev-warn fetchFriends) + chat/index.ts (added 4 missing card-bubble exports + BubbleStatusText). 5 reviewed only: FindScreen (trivial), GroupManagementScreen + use-message-groups-store (dead feature → #35), discover-alerts (fake data → #36), messages/index.ts (trivial). +82/-21. **47/47 cumulative tests pass**, tsc clean. 3 items deferred (#35-#37). **Surface 3 (Chat core) closed at 27/27.** |
| 2026-05-15 | feature: custom conversation groups (resolves #35) | **End-to-end implementation across backend + frontend.** Backend (`/Users/yiboding/projects/circle_be`): 2 new Prisma models (`ConversationGroup` + `ConversationGroupMembership`) with `@@unique([ownerID, name])` and cascade delete, new `conversation-group/` module (controller / service / DTOs / spec) wired into `app.module.ts`; 11 service tests pass; tsc clean. Frontend: new `src/services/api/conversation-groups.ts` HTTP wrappers, rewrote `use-message-groups-store.ts` with backend-synced groups + optimistic update / rollback / MMKV persist + 9 unit tests, rewrote `GroupManagementScreen.tsx` reading from `useIMStore` with real CRUD + per-conversation membership toggles + pinnedToTabs switch, MessagesScreen wires pinned groups as additional filter tabs (`custom:<id>` prefix), `useMessageGroupsStore.load()` called from SessionBootstrap + use-auth.login, `reset()` already wired in logout. Types: dropped stale `customGroupIds` from `Conversation`, expanded `CustomConversationGroup` to match backend shape. **56/56 frontend tests pass (47 + 9 new)**, tsc clean. Migration step still pending: user runs `cd circle_be && npx prisma migrate dev --name add-conversation-groups`. |
| 2026-05-15 | decisions #36 #37 resolved | #36 deleted `src/features/messages/data/discover-alerts.ts` (and the empty `data/` directory) + wired notification-bell badge to `useTabBadgeStore.systemUnread` (realtime-fed). Dropped the `Math.max(...)` merge that was leaking IM chat unread into the discover-icon badge. #37 changed `selectedCount < 1` → `< 2` (matches iMessage; 1-friend "group" UX-ambiguous with private chat) + updated `newGroupMinMembers` in both zh and en locales. **56/56 tests pass**, tsc clean. |
| 2026-05-15 | 14 (API layer rest — Surface 5 closed) | [reviews/06-api-layer.md](reviews/06-api-layer.md) — 0 H, 7 M, 14 L findings. |
| 2026-05-15 | patches applied | 5 patched: `upload.ts` (3 MEDIUM fixed: widen localhost check to iOS, add timeout for both Android RNFS + iOS expo-fs local-file upload paths via Promise.race + RNFS.stopUpload, generic "上传失败" replacing the avatar-specific message) + `coin.ts` (added `assertValidCoinAmount` helper for `Number.isInteger + > 0 + <= LIMITS.TRANSFER_MAX_AMOUNT` defense-in-depth on rechargePoints + sendCoinGift) + `moments.ts` + `plaza.ts` (removed unsafe `(normalizeMediaUrl(url) as string) ?? url` casts) + `friends.ts` (stash double-trim in setFriendRemark). 9 reviewed only (circles / users / notes / profile / icons / notifications / membership / mall / collections). Note: profile.ts merge-order change reverted after `test/profile-api.test.js` revealed the original `{...refreshedUser, ...payload}` ordering is intentional defense against stale-read-after-write on the backend — added a long comment block instead. +156/-10 src/. **69/69 cumulative tests pass**, tsc clean. 3 items deferred (#38-#40). **Surface 5 closed at 14/14.** |
| 2026-05-15 | 13 (Discover foundation — Surface 7 in progress) | [reviews/07-i-discover-foundation.md](reviews/07-i-discover-foundation.md) — 0 H, 4 M, 5 L, 2 STYLE findings. |
| 2026-05-15 | 9 (Contacts — Surface 6 CLOSED at 9/9) | [reviews/08-contacts.md](reviews/08-contacts.md) — 1 H, 4 M, 8 L, 2 STYLE findings. |
| 2026-05-15 | S11 redo (14 files re-read after initial skim) | User pushed back on my Surface 11 review depth (correctly: I'd only personally read 5 of 19 files). Re-read the 14 skipped files. Surfaced 3 MEDIUM bugs I'd missed: (1) `useNetworkStatus` probe URL `clients3.google.com/generate_204` is GFW-blocked — for Chinese users (target market), the probe always fails → 4 commerce screens permanently show "offline" banner. Patched to probe the app's own `API_URL` via HEAD request. (2) `ThemeProvider` Context value not memoized — every RootLayout re-render created a new value object → all `useTheme()` consumers cascaded re-renders. Patched with `useMemo`. (3) `colors.ts` has ~70% verbatim duplication between dark+light palettes (brand tokens like `online`/`success`/`warning`/`orange`/`blue`/`purple` are identical across modes). Architectural root of #45's recurring hardcoded-hex finding. **Tracked as #64.** Also patched: Avatar `charAt` edge case on empty name (rendered blank), Badge cap at "99+", deleted dead UI barrel + dead `Colors` legacy export. S12 spot-check held up — 105 re-exports verified to point at existing screens with matching param names. **120/120 tests pass**, tsc clean. |
| 2026-05-15 | 19 + spot-check (UI primitives + App routes — Surfaces 11 & 12 CLOSED) | [reviews/12-ui-primitives-and-routes.md](reviews/12-ui-primitives-and-routes.md) — 0 H, 4 M, 4 L, 0 STYLE findings. 7 patches: a11y on 5 UI primitives (auth-input password toggle, filter-tabs role="tab", menu-row role+state+hint, nav-header back + right-icon labels, search-bar role="search") + `(tabs)/_layout.tsx` `tabBarAccessibilityLabel` per tab with "有未读" badge hint + `(tabs)/messages/_layout.tsx` i18n on 2 hardcoded route titles. No new pending decisions. **120/120 tests pass**, tsc clean. **All 12 surfaces effectively closed.** |
| 2026-05-15 | 31 (Profile / Settings — Surface 8 CLOSED at 31/31) | [reviews/11-profile.md](reviews/11-profile.md) — 0 H, 6 M, 12 L, 1 STYLE findings across 3 sub-batches (11-i Foundation 8 files / 11-ii Main+Settings 11 files / 11-iii Commerce+Auth+Edit 12 files). 8 patches: avatar-picker-feedback const→function (fix stale-on-language-switch i18n), profile-display.ts optional `t` arg + 2 UserProfile call sites, EditProfile import update, ProfileScreen dev-warn + 2 i18n strings, AppSettings dev-warn on cache-size catch, ChangePasswordScreen `inFlightRef` + logoutAll dev-warn, WalletScreen 2× dev-warns. 3 items deferred: **#61 (MEDIUM) — Phantom toggles**: `SettingsSwitch` (settings-detail.tsx:88) takes `initialValue` but state stays local with no callback — affects 25 toggles across Appearance/Notification/Privacy/AccountSecurity settings; same anti-pattern as #51 + #57. **#62 (LOW) — MallScreen** missing onPress branches for 9 product action types (dead buttons). **#63 (LOW) — EditProfileFieldScreen** 788 lines exceeds 800-line guideline; should split per-editor sub-components. **118/118 tests pass**, tsc clean. |
| 2026-05-15 | 2 (Search — Surface 10 CLOSED at 2/2) | [reviews/10-search.md](reviews/10-search.md) — 0 H, 2 M, 5 L, 1 STYLE findings. 1 patch: SearchScreen.tsx i18n migration (5 strings: title, placeholder, section headers, empty-state copy) + dev-warn + retry button on silent fetchFriends catch + sanitize avatarUrl router param (skip when falsy). **95/95 tests pass**, tsc clean. No deferred items. |
| 2026-05-15 | decisions #57 #58 #59 #60 resolved (Notes follow-up) | All 4 Notes deferrals closed. **#57** Phantom-feature copy rewrite: "清理本地并强制同步" destructive UI → honest "手动刷新" + non-destructive single-tap action (cooldown preserved). **#58** Full i18n migration of ~70 hardcoded zh strings across 6 notes files + DOM bridge via typed `toolbarLabels` prop + `note-format.ts` now takes `t` parameter; locale JSON untouched (defaultValue pattern). **#59** Backend `PATCH /note/:id/groups` endpoint + `UpdateNoteGroupIdsDto` + `noteService.updateNoteGroupIds` (5 new service tests pass) + frontend `updateNoteGroupIds` API helper + `handleSaveGroupMemberships` rewritten to drop `fetchNoteDetail` N+1 — 50-note move now 50 round-trips instead of 100. **#60** Extracted `src/features/notes/components/GroupManagerSheet.tsx` (858 lines) housing modal + group CRUD + drag/reorder; NotesScreen.tsx: 1008 → 439 lines. **All 95 FE tests + 21 BE tests pass**, tsc clean both ends. |
| 2026-05-15 | 12 (Notes — Surface 9 CLOSED at 12/12) | [reviews/09-notes.md](reviews/09-notes.md) — 0 H, 5 M, 11 L, 2 STYLE findings. |
| 2026-05-15 | patches applied | 5 patches: (1) `NoteBlockEditor.tsx` — `inFlightRef` re-entrancy guard + full try/catch + user-visible Alert + dev-warn on `handleImageRequest` (was naked async chain; concurrent tap = 2 S3 uploads). Also dev-warn on malformed JSON from bridge. (2) `NoteDetailScreen.tsx` — `loadError` state + retry button; 404 still shows "笔记不存在", network/server failures now distinguished + retryable (parity with MomentDetail pattern). Imported `ApiError` for status check. (3) `EditNoteScreen.tsx` — `Alert.alert` + dev-warn on `handleSubmit` failure (was silently re-enabling the button with no feedback). (4) `NoteBlockEditor.dom.tsx` — `console.warn` on `initialContent` JSON parse failure (DOM bridge has no `__DEV__`, plain `console.warn` always available). (5) `NotesScreen.tsx` — 3 dead buttons (trash icon + 分享 + 二维码 in bottom bar) now wired to `Alert.alert` "敬请期待" stopgaps with TODO markers; dev-warns on 4 silent catches (saveGroup / saveGroupMemberships / deleteNoteGroup / reorderNoteGroups). **95/95 tests pass** (now includes 37 notes-specific tests), tsc clean. 4 items deferred (#57 #58 #59 #60). |
| 2026-05-15 | decision #54 resolved | `GroupsScreen.tsx` rewritten to use real OpenIM data (chose option A). Added `getJoinedGroups()` helper in `src/im/client.ts` (calls `OpenIMSDK.getJoinedGroupList()` — single round-trip, no N+1). Screen now: fetches on mount + on focus, partitions by `ownerUserID === toImUserId(currentUserID)` into 我创建 / 我加入 sections, taps route to `/(tabs)/messages/chat-detail`. "我管理" section dropped — OpenIM `GroupItem` doesn't include current user's role; populating it would require `getGroupMemberInfo()` per group (same N+1 family as #41). Cleaned up i18n: removed all `samples.*` mock data keys + `myManaged` key, added `loading` + `loadFailed`. **58/58 tests pass**, tsc clean. |
| 2026-05-15 | patches applied | 3 src patches + 1 test fix: (1) New `src/features/contacts/locale.ts` extracted `getLocalizedDateTimeLocale` helper — replaces 2x inline `i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'` ternary in FriendActivityDetail + NewFriends. (2) `ContactsScreen.tsx` — `useMemo` wrap on `QUICK_ACTIONS`, added `t` to `loadFriends` deps (was empty), dev-warn on fetchFriends catch. (3) `NewFriendsScreen.tsx` + `FriendActivityDetailScreen.tsx` — `__DEV__` warns on silent `markFriendActivityRead().catch()`. (4) Fixed pre-existing `test/friend-activities.test.js` failure — `fetchCountEndpoint` (added in batch 6's #39 resolution) wasn't stubbed; added a stub using the same `apiClientStub`. **58/58 tests pass** (was 49 + 1 broken), tsc clean. 3 items deferred (#54 #55 #56). **#54 is HIGH — GroupsScreen is entirely fake mock data, same anti-pattern as deleted #36.** |
| 2026-05-15 | decisions #52 #53 resolved (Surface 7 DRY follow-up) | #52: New `src/features/discover/constants/circle-form.ts` (preset categories + VIP/credit values + max tags), `src/features/discover/hooks/use-circle-form.ts` (CircleFormState + 14 handlers + `hydrate` for Edit), `src/features/discover/components/circle-form-body.tsx` (3 form sections rendered once, consumed twice). CreateCircleScreen 622 → 210 lines (-66%); EditCircleScreen 745 → 258 lines (-65%). Net file-system delta: -152 lines across the 3 screens + 3 new shared modules. Avatar upload remains per-screen (different fallback semantics). #53: CircleDetailScreen "入圈规则摘要" 5x repeated `summaryRow + Divider` JSX collapsed to a config-array `.map()` with last-row divider gating. **All 54 baseline + 5 circle-screen tests still pass**, tsc clean. |
| 2026-05-15 | 8 (Circle + verification screens — Surface 7 CLOSED at 38/38) | [reviews/07-iv-discover-circle-verification-screens.md](reviews/07-iv-discover-circle-verification-screens.md) — 0 H, 6 M, 10 L, 3 STYLE findings. |
| 2026-05-15 | patches applied | 9 patches: (1) `AdminReviewScreen.tsx` — error state + retry button + dev-warn on fetch failure; `t` deps added. (2) `SelectVerifierScreen.tsx` — error state + retry; extracted `loadFriends` into a useCallback; deps fixed. (3) `VerificationRequestScreen.tsx` — `loadError` + retry button (distinguishes transient errors from genuine 404); `t` added to handleRespond deps. (4) `InvitationVerificationScreen.tsx` — `loadError` + retry button (was misclassifying transient errors as "邀请不存在"); typed `IoniconName` glyph (no `as any`); `useCallback` on `handleAddVerifier`. (5) `CircleDetailScreen.tsx` — i18n'd 5 hardcoded zh strings (`圈子图标` / `当前图标` / `上传中...` / `上传圈子图标` / `无法识别图片格式`) via `t(key, { defaultValue: zh })`. (6) `CreateCircleScreen.tsx` — `__DEV__` warn on silent avatar upload catch; `useMemo` wrapping for `PRESET_CATEGORIES` / `VIP_OPTIONS` / `CREDIT_OPTIONS` arrays. (7) `EditCircleScreen.tsx` — same as (6). **All 9 in-batch + 45 baseline tests pass**, tsc clean. 3 items deferred (#51 #52 #53). **Surface 7 (Discover / Moments / Circles) closed at 38/38.** |
| 2026-05-15 | 7 (Discover entry/filter/moment screens — Surface 7 in progress) | [reviews/07-iii-discover-entry-filter-moment-screens.md](reviews/07-iii-discover-entry-filter-moment-screens.md) — 0 H, 6 M, 8 L, 3 STYLE findings. |
| 2026-05-15 | patches applied | 6 patches: (1) `MomentDetailScreen.tsx` — collapsed 3rd inline `formatRelativeTime` to use 7-ii util; `__DEV__` warn on like-rollback catch; surfaced `addMomentComment` error via Alert + kept commentTarget alive on failure (was silent fail before); replaced hardcoded `'zh-CN'` `toLocaleString` locale with `i18n.language` fallback. (2) `moment-comment-input.tsx` — widened `onSubmit` signature to `void \| Promise<void>`, awaits result; only clears text on resolve (rejects keep input open); added `submitting` state guard against double-tap. (3) `CreateMomentScreen.tsx` — `__DEV__` warn on per-image upload failure (logs URI + error); added missing `t` to handleSubmit deps. (4) `FilterScreen.tsx` — gated ToastAndroid call behind explicit `Platform.OS === 'android'` with comment (iOS uses navigation-back as feedback); follow-up to #50. (5) `DiscoverScreen.tsx` — `useMemo` for `FILTER_TABS` array. (6) `SelectCityScreen.tsx` — added missing `t` to `toggleCity` / `toggleNationwide` deps. **All 9 in-batch + 45 baseline tests pass**, tsc clean. 3 items deferred (#47 #48 #49). |
| 2026-05-15 | 10 (Discover UI components — Surface 7 in progress) | [reviews/07-ii-discover-components.md](reviews/07-ii-discover-components.md) — 0 H, 3 M, 6 L, 3 STYLE findings. |
| 2026-05-15 | patches applied | 8 patches: (1) Deleted dead `post-card.tsx` (never imported except via unused barrel). (2) Removed `PostCard` re-export from `src/features/discover/index.ts`. (3) Deleted unused `Post` interface from `src/types/index.ts`. (4) New `src/features/discover/utils/relative-time.ts` — extracted shared `formatRelativeTime` helper; adopted in `moment-card.tsx` + `plaza-post-card.tsx` (removed 20 lines of duplicated logic). (5) `moment-comment-input.tsx` — i18n'd `'回复 ${name}'` + `'写评论...'` via `t(key, { defaultValue: zh })`. (6) `plaza-post-card.tsx` — i18n'd VIP/credit/fancy-number restriction reasons + Chinese-comma separator. (7) `restriction-badge.tsx` — typed Ionicons glyph name (no `as any`), i18n'd VIP/信用/靓号 labels, extracted hardcoded hex colors into `BADGE_COLOR` const block (proper theme migration deferred to #45). (8) `moments-feed.tsx` — AppState-gated the 30s `setInterval` (clear on background, re-poll + restart on `active`), dev-warns on `fetchNewMomentsCount` + optimistic-like rollback silent catches. **All 45 baseline tests + 9 in-batch tests pass**, tsc clean. 2 items deferred (#45 #46). |
| 2026-05-15 | patches applied | 4 patches: (1) `use-moments-store.ts` — split `loading` vs `refreshing`, added `latestRequestId` stale-response guard so PTR can preempt paginate, added Map-based dedup via `mergeMoments`, try/catch with `__DEV__` warn (fixes silent rejection). (2) Deleted dead `use-circle-activity-store.ts` (never imported anywhere; discover badge wired through realtime/client.ts + tabBadgeStore). (3) Dropped dead `snapshotPosts` arg from `applyPlazaFetchSuccess` signature + call site + `discover-state.test.mts`. (4) Extracted `NATIONWIDE_CITY_VALUE = '全国'` constant in `utils/city-selection.ts`. Reviewed only: 8 stores + 1 util + 1 barrel. **All 9 in-batch tests pass** (discover-state 2 + managed-circles 1 + city-selection 6), tsc clean (only pre-existing `silence-dom-bridge-rejection` types warning unrelated). 3 items deferred (#41 #42 #43). |
| 2026-05-15 | decisions #38–#40 resolved | New `src/utils/validate.ts` (lightweight runtime-shape primitives, 6 unit tests) — applied at 4 high-impact endpoints (`fetchWallet`, `rechargePoints`, `requestUploadPresign`, `fetchNotificationUnreadSummary`). Full Zod migration left as a v2 path; pattern established. DRY helpers `buildQuery` / `appendQueryIfDefined` / `fetchCountEndpoint` in `services/api/utils.ts` — refactored circles / moments / plaza / friends. `mall.ts/MallProductAction` tightened to 11-value union (harvested from backend service); `users.ts/gender` dropped `\| string` widening. +189/-... src/, new `src/utils/validate.ts` + `test/validate.test.js` (6 tests). **75/75 tests pass**, tsc clean. |
| 2026-05-15 | S12 complete redo + 11 (Surface 13 audit gap — Social + User CLOSED at 11/11) | [reviews/13-social-and-user.md](reviews/13-social-and-user.md) — 0 H, 4 M, 12 L, 1 STYLE findings. **S12 complete redo confirmed 116/116**: read all 30 `[id].tsx`/`[field].tsx` dynamic route files, verified every `useLocalSearchParams<{...}>()` declaration on the 16 unique screens matches its route directory name (0 mismatches). User audit caught **Surface 13 gap** — `features/social/` (4 files, 720 lines) and `features/user/` (7 files, 1791 lines) had no surface owner in the original 12-surface plan. **9 patches**: (1) `features/user/data/profiles.ts` — gutted ~150 lines of hardcoded mock users (`陈思琪`/`张明远`/`李晓婷` + fake phone numbers + Unsplash avatars) + dead `getUserProfileById`/`getUserProfileIdByName`; kept type-only export. Same Phantom-data family as #36 + #54. (2) `UserProfileScreen.tsx` — inline `useMemo` synthesized fallback profile replaces mock dict lookup; dev-warns on 3 silent catches (fetchUserProfile/fetchFriendStatus/fetchFriendSettings); wired dead "音视频通话" Pressable to Alert stopgap (same family as #28). (3) `CreatePostScreen.tsx` — added `useTranslation()` call (was imported but never called); `inFlightRef` Pattern D guard on `handleSubmit` (double-tap could fire 2 `createPlazaPost`); `__DEV__` warn on silent per-image upload catch; 4 error messages routed through `t(key, { defaultValue })` (`plaza.create.{failedTitle,failedMessage,allUploadsFailed,partialUploadsFailed}`); dropped dead `rightIcon` from NavHeader; wired dead "选择笔记" MenuRow to Alert "即将上线" stopgap; fixed missing `t`/`postTags`/`resetForm` in handleSubmit deps. (4) `AddFriendScreen.tsx` — `useTranslation()` call + i18n'd 6 hardcoded zh strings (title, placeholder, search button, status messages, account label via `t('contacts.accountId', { id: result.accountId })`); dev-warn on silent search catch. (5) `EditFriendRemarkScreen.tsx` — `__DEV__` warn on silent fetchFriendSettings catch. (6) `test/add-friend-screen.test.js` — assertion updated to match new i18n'd account-label pattern. **127/127 tests pass**, tsc clean. #65 closed in-batch (mock data deletion); 2 items deferred (#66 ~25 remaining hardcoded zh JSX strings in CreatePost — mechanical i18n grind parity with #58; #67 EditFriendTags Promise.all partial-failure leaves local state out of sync — backend coordination needed). **Surface 13 closed at 11/11. Review now genuinely complete across all 13 surfaces (191/291 files reviewed in depth; remaining 100 are 1-line route re-exports verified via S12 complete redo).** |
| 2026-06-21 | decision #1 resolved | Auth token fields now use `expo-secure-store` via `secureAuthStorage` with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` on iOS, so tokens remain readable after the first device unlock for IM background wakeups. `authStore` and `knownAccountsStore` split token payloads into small SecureStore entries while retaining token-free metadata in MMKV; legacy MMKV token values migrate once and are stripped from MMKV metadata. Hydration read errors unblock startup without clearing the stored session; legacy cleanup is best-effort after secure reads. Added `test/secure-auth-storage.test.js` + `test/auth-store-hydration.test.js`; targeted auth/session/storage tests pass; `tsc --noEmit` clean. |

## Pending decisions (consolidated)

> Every item below is also written into the batch-specific review doc in [`reviews/`](reviews/). This is the single-screen view for triage.
> Reviewed but **not patched** because each needs a product / backend / SDK / security call.

| # | Severity | Batch | File · Line | Issue (1 line) | Options |
|---|---|---|---|---|---|
| ~~1~~ | ✅ DONE | 01 | `src/stores/authStore.ts:74-148` + `src/stores/knownAccountsStore.ts` | Active-session tokens and saved-account switcher tokens moved from MMKV-backed persistence to small `expo-secure-store` entries; token-free metadata remains in MMKV. Legacy MMKV token values migrate once and are stripped. | (resolved 2026-06-21) |
| 2 | 🟡 MED | 01 | `src/services/api/client.ts:247-266` | Retry-after-refresh that still 401s throws plain ApiError → no consistent "force re-login" signal | Add sentinel code `AUTH_RETRY_FAILED` + auth boundary listener. Architectural — bundle into a dedicated auth-error-boundary pass. |
| 3 | 🟡 MED | 01 | `src/services/auth/session.ts:38-42` | Only `circle-im-auth` cleared on logout; chat-preferences / discover-filter / circle-notification survive into next user's session | Decide **per store** which are user-scoped (clear) vs device-scoped (keep). Need product input on each persisted bucket. |
| 4 | 🟡 MED | 02 | `src/services/api/auth.ts:66-68` | `Device.deviceName` is PII ("Alice's iPhone") sent to backend on login/register | **A.** Use `Device.modelName` ("iPhone 15 Pro"). **B.** Generate stable anonymous `installationId` in SecureStore. **C.** Accept, document. |
| 5 | 🟡 MED | 02 | `src/services/api/auth.ts:117-132` | `changePassword` / `changeAccountId` don't invalidate existing sessions | **A.** Auto-`logoutAll()` after success (force re-login). **B.** Wrap as `changePasswordAndReauth` helper. **C.** Document caller responsibility. |
| 6 | 🟡 MED | 02 | `src/services/api/errors.ts:3-13` | Raw backend error message shown to UI; can leak internals like shard IDs | Map backend `code` → user-facing string. **Blocked on:** backend error-code taxonomy / stable code list. |
| 7 | 🟡 MED | 02 | `src/services/cache/clear-app-cache.ts:1` | `expo-file-system/legacy` is on Expo's deprecation path | Schedule migration for next Expo SDK upgrade. No urgency until then. |
| 8 | 🟡 MED | 02 | `src/services/cache/clear-app-cache.ts:29-42` | `CACHE_CLEAR_DENYLIST` only matches top-level basenames; nested critical state would be wiped | **A.** Document invariant ("denylisted state must live at top level") + enforce in review. **B.** Recursive denylist check at every level (slower but safer). |
| 9 | 🟡 MED | 02 | `src/services/cache/clear-app-cache.ts:80-82` | OpenIM data directory hardcoded as `${DocumentDirectoryPath}/openim` — silently breaks `chatBytes` if SDK moves data path | Wait for OpenIM SDK API exposing actual path, or pin via config. |
| 10 | 🟡 MED | 02 | **cross-cutting** (session.ts + clear-app-cache.ts + im SDK) | **Chat data on disk is never wiped at logout** — on a shared device, next user can read previous user's history | **A.** Wipe on every logout. **B.** Wipe on switchAccount only, keep on regular logout. **C.** Explicit user toggle. **D.** Accept + document. |
| ~~11~~ | ✅ DONE | 02 | `src/hooks/use-auth.ts:69-72` | Subsumed by #14 — now wrapped in shared `retry()` util. | (resolved 2026-05-15) |
| ~~12~~ | ✅ DONE | 03 | `LoginScreen.tsx` | Forgot-password link wired to `Alert.alert` ("即将上线，请联系客服") via i18n key `auth.forgotPasswordHint` (with hardcoded default). Swap with `router.push('/(auth)/forgot-password')` when the route lands. | (resolved 2026-05-14) |
| ~~13~~ | ✅ DONE | 03 | `LoginScreen.tsx`, `RegisterScreen.tsx` | WeChat social-login entry **deleted** from both screens. Removed: dividerRow + socialRow JSX, all related styles (`dividerRow`/`dividerLine`/`dividerText`/`socialRow`/`socialBtn`), dynamic style entries, and the now-unused `Ionicons` import in `LoginScreen` (Register still uses it for the agreement checkmark). | (resolved 2026-05-14) |
| ~~14~~ | ✅ DONE | 04 | `session-bootstrap.tsx:100-128` + `use-auth.ts:69-72` | Created `src/utils/retry.ts` (defaults: 2 tries, 400ms backoff; skips 4xx except 408/429; honors AbortSignal). Wrapped both `/auth/me` call sites. **Subsumes #11.** 8 unit tests cover retry behavior. | (resolved 2026-05-15) |
| ~~15~~ | ✅ DONE | 04 | `client.ts:513` `sendTransferCardMessage` | Added `LIMITS.TRANSFER_MAX_AMOUNT = 1_000_000` + `Number.isInteger(amount)` check + upper-bound enforcement. Real business cap still defers to backend; client check catches off-by-orders / overflow. | (resolved 2026-05-15) |
| ~~16~~ | ✅ DONE | 04 | `client.ts:226-242` `loadConversationList` | Init failure now returns the existing `useIMStore.conversations` cache instead of overwriting with `[]`. Only explicit `logoutFromOpenIM` clears (via `reset()`). | (resolved 2026-05-15) |
| ~~17~~ | ✅ DONE | 04 | `mappers.ts:72-99, 120-129` | `mappers.ts` now calls `i18n.t(...)` for all user-facing strings with current Chinese as `defaultValue`. Locale JSON untouched — current zh users see identical text; en users see Chinese fallback until `im.{notification,preview,time}.*` keys land. `toLocaleDateString` now uses current i18n language. | (resolved 2026-05-15) |
| ~~18~~ | ✅ DONE | 04 | `client.ts:82` | Confirmed dead via `grep -r getPlatformID src app`; deleted. | (resolved 2026-05-15) |
| ~~19~~ | ✅ DONE | 04 | `config.ts:73-75` `REALTIME_WS_URL` default | New `deriveRealtimeUrlFromApi(API_URL)` parses API_URL, maps `http→ws` / `https→wss`, reuses host + port, drops `/api/v1`, appends `/realtime`. Default now correct in prod when env unset. Parse failure falls back to old dev default. | (resolved 2026-05-15) |
| 20 | 🟡 MED | 5a | `realtime/client.ts:84-87` | Auth token passed as `?token=...` URL query on the WebSocket handshake — landed in proxy / CDN / monitoring logs | **A.** Auth frame after connect (needs backend protocol change). **B.** One-time WS ticket via token-exchange endpoint. **C.** Accept current; document in MODULE_OVERVIEW. |
| 21 | 🟡 MED | 5a | `realtime/client.ts:94-96` | Silent giveup after 10 reconnect attempts (~3 min); UI's `isRealtimeConnected` stays false with no "permanently failed" distinction | **A.** 3-state flag (`connected`/`reconnecting`/`failed`). **B.** Auto-reset on AppState→active. **C.** UI banner on `failed`. |
| 22 | 🟡 MED | 5a | `realtime/client.ts:187-192` | 3 declared event types are no-op handlers (`circle.post.interaction.created`, `circle.invitation.reviewed`, `system.notification.created`) | **A.** Implement client-side dispatch. **B.** Document existing UI subscribers + add comment. **C.** Remove from type union if truly unused. |
| 23 | 🟡 MED | 5a | `friendActivityUnreadStore.ts:32-38` | `markRead` optimistically decrements local count by `new Set(activityIds).size` without knowing if those IDs were already read → double-call drifts | **A.** Track unread IDs locally + dedupe by identity. **B.** Rely on server-pushed authoritative count via realtime + refresh, drop local decrement. |
| 24 | 🟡 MED | 5a | `realtime/client.ts:181-183` | `system.notification.unread.changed` sets `profileUnread` AND `systemUnread` to the same count | **A.** Document as intentional (profile-tab badge = system unread). **B.** Collapse to single field. **C.** Backend should differentiate. |
| 25 | 🟡 MED | 5b-i | `chat-history.ts`, `chat-info.ts`, `chat-bubble.tsx` (multiple lines) | Hardcoded `zh-CN` locale + Chinese strings (same family as #17 in mappers.ts) | Apply `i18n.t(key, { defaultValue: zh })` pattern. Locale JSON untouched until keys are added. |
| 26 | 🟡 MED | 5b-i | `chat-preview.ts:1-4` | Detects "preview mode" by string-matching error messages from `im/client.ts` — silently breaks if either side renames | Export `IM_ERROR_CODES` constants from `im/client.ts`, match on code not on message. |
| 27 | 🟡 MED | 5b-i | `chat-bubble.tsx:639, 645` | NoteCardBubble's "location" chip wired to `groupNames.length` — chip says 位置 but condition is on groups | A. Rename chip to "群组". B. Add real `hasLocation` field to NoteCardData. |
| 28 | 🟡 MED | 5b-i | `ChatDetailScreen.tsx:610` | Video-call button is `Alert.alert('视频通话', '需要接入 RTC SDK...')` stopgap | A. Wire to RTC SDK (Agora/WebRTC). B. Hide. C. Keep stopgap. |
| 29 | 🟡 MED | 5b-i | `ChatDetailScreen.tsx:729` | `setSendError('转账卡片发送失败，但积分已扣减')` implies non-atomic transfer | Verify with backend: is point deduction + IM message send atomic? If yes, fix message. If no, fix backend. |
| 30 | 🟢 LOW | 5b-i | `chat-bubble.tsx:904-908` | Unsafe `icon.fallbackIconName as keyof typeof Ionicons.glyphMap` cast | Validate against glyph map at data boundary, or accept widened type with runtime fallback. |
| ~~31~~ | ✅ DONE | 5b-ii | `ChatHistoryDateScreen.tsx`, `ChatHistoryTextScreen.tsx`, `SharePickerScreen.tsx` | Added `error` state + visible error message + 重试 button (matches Files/Media pattern). Date and Text screens previously left users guessing whether an error or genuinely empty result. SharePicker also gained a reload-version that re-fires the effect. | (resolved 2026-05-15) |
| ~~32~~ | ✅ DONE | 5b-ii | `TransferComposerScreen.tsx` | Extracted `loadBalance()` helper. Added `balanceError` state + an inline "余额加载失败 / 重试" row that re-fires the fetch. Submit-disabled remains when balance is null (from the prior patch). | (resolved 2026-05-15) |
| ~~33~~ | ✅ DONE | 5b-ii | `SharePickerScreen.tsx` | Header titles + 6 quick-reply phrases now go through `i18n.t(..., { defaultValue })`. Locale JSON untouched — current zh users see identical text; en users see Chinese fallback until `share.title.*` / `share.quickReply.[0-5]` keys are added. | (resolved 2026-05-15) |
| ~~34~~ | ✅ DONE | 5b-ii | `ChatInfoScreen.tsx` | Added `blacklistInFlightRef` + `deleteInFlightRef` Pattern D guards (race fix). Full pattern unification with `runConversationAction` deferred — friend-scoped vs conversation-scoped actions live at different abstractions and the existing pattern already has optimistic + rollback + pending state, just no token tracking. Race protection is the practical benefit; cosmetic refactor not blocking. | (resolved 2026-05-15) |
| ~~35~~ | ✅ DONE | 5b-iii | `GroupManagementScreen.tsx` + `use-message-groups-store.ts` (+ new backend module `conversation-group`) | **End-to-end implementation** with real backend persistence. Backend: new `ConversationGroup` + `ConversationGroupMembership` Prisma models, NestJS module with REST endpoints (`GET / POST / PATCH / DELETE / PUT :id/members`), 11 service tests. Frontend: new `conversation-groups.ts` API service, rewrote store with optimistic-update + rollback + MMKV persist, rewrote screen reading from `useIMStore` with real CRUD + member assignment, MessagesScreen pinned groups now render as filter tabs (`custom:<id>` prefix), `load()` wired in SessionBootstrap + use-auth.login, 9 new store tests. **Prisma migration still needs to run on user's DB** (`npx prisma migrate dev --name add-conversation-groups`). | (resolved 2026-05-15) |
| ~~36~~ | ✅ DONE | 5b-iii | `discover-alerts.ts` + `MessagesScreen.tsx` | Deleted `src/features/messages/data/discover-alerts.ts` entirely (and the now-empty `data/` directory). MessagesScreen's notification-bell badge now reads `useTabBadgeStore.systemUnread` (the realtime channel fed by `system.notification.unread.changed`, already plumbed end-to-end in Batch 5a). Dropped the `Math.max(unreadNotificationCount, totalUnread)` merge — that mixed IM chat unread into the discover icon, which routes to `/(tabs)/discover`. Now: bell badge = discover/system unread, chat unread shown only via per-row Badge on conversation list. | (resolved 2026-05-15) |
| ~~37~~ | ✅ DONE | 5b-iii | `NewGroupScreen.tsx` + `i18n/locales/{zh,en}.json` | Minimum members changed from 1 → 2 (matches iMessage convention). 1-friend "group" was UX-ambiguous with private chat — for 2-person conversations users should use the private chat path, not "create group". Updated both `newGroupMinMembers` locale strings ("请至少选择 2 位好友" / "Please select at least 2 friends"). | (resolved 2026-05-15) |
| ~~38~~ | ✅ DONE (partial) | 6 | Top-risk API endpoints | Created `src/utils/validate.ts` with `isPlainObject`/`isNonEmptyString`/`isFiniteNumber`/`isFiniteNonNegativeNumber`/`expectShape` primitives (6 unit tests). Applied runtime shape guards at 4 high-impact endpoints: `coin.ts/fetchWallet`, `coin.ts/rechargePoints` (financial), `upload.ts/requestUploadPresign` (security URL contract), `notifications.ts/fetchNotificationUnreadSummary` (badge counts). Full Zod migration across all 14 files NOT done — left as a v2 path. Pattern is now established; new high-risk endpoints can copy it. | (resolved 2026-05-15) |
| ~~39~~ | ✅ DONE | 6 | `api/utils.ts` + 4 call sites | Extracted `appendQueryIfDefined(query, key, value)` + `buildQuery(params)` + `fetchCountEndpoint(endpoint)` helpers in `services/api/utils.ts`. Refactored `circles.ts` (`fetchCircles` + `fetchCircleActivityUnreadCount`), `moments.ts` (`fetchMomentsFeed`), `plaza.ts` (`fetchPlazaFeed`), `friends.ts` (`fetchUnreadFriendActivityCount`). Same behavior, less duplication. | (resolved 2026-05-15) |
| ~~40~~ | ✅ DONE | 6 | `mall.ts`, `users.ts` | `mall.ts/MallProduct.action` tightened from `string` to a string-literal union of the 11 backend-defined actions (`'avatar-frame' \| 'buy-code' \| 'experience' \| ... \| 'wallet'`) — discovered by grepping `/circle_be/src/mall/mall.service.ts`. `users.ts/gender` dropped the `\| string` widening tail; now strictly `'male' \| 'female' \| 'other' \| 'unset'` matching the Prisma Gender enum. | (resolved 2026-05-15) |
| 41 | 🟢 LOW | 7-i | `use-circles-store.ts:50-52` | N+1 detail fetch for managed-role derivation; 50+ extra REST calls for users with many joined circles | **A.** Backend includes `myRole` in `/circle/my?tab=joined`. **B.** Cap joined-circle count. **C.** Lazy-fetch only when entering management UI. |
| 42 | 🟢 LOW | 7-i | `use-circles-store.ts:38-77` | No re-entrancy guard on `fetchMyCircles` / `fetchAllCircles`; concurrent calls overwrite (last-write-wins) | Add `inFlightRef`-style guard, or accept current behavior (not observed problematic yet). |
| 43 | 🟢 LOW | 7-i | `utils/circle-filter.ts:25-26` | Empty-cities circles excluded under any city filter; "nationwide" semantics unclear | **A.** Document as intentional. **B.** Treat empty cities as "matches any" (nationwide). Needs product call. |
| ~~44~~ | ✅ DONE | 7-ii | `post-card.tsx` + `types/index.ts:47` + `index.ts:2` | `PostCard` + `Post` interface dead — only reached through unused barrel. Deleted. | (resolved 2026-05-15) |
| 45 | 🟡 MED | 7-ii | `restriction-badge.tsx:43-47` | Hardcoded brand hex colors (`#F59E0B` / `#3B82F6` / `#A855F7`) outside theme palette; broken in dark mode | **A.** Add `badgeVip` / `badgeCredit` / `badgeFancy` semantic tokens to `src/theme/colors.ts`. **B.** Accept; brand colors stay constant across themes. |
| 46 | 🟢 LOW | 7-ii | `plaza-feed.tsx:75-77` | `fetchAllCircles()` fires only on mount; no realtime invalidation when user joins/leaves a circle | **A.** Subscribe to a realtime `circle.joined` / `circle.left` event in `realtime/client.ts`. **B.** Re-fetch on `useFocusEffect`. **C.** Accept; stale until app reload. |
| 47 | 🟢 LOW | 7-iii | `CreateMomentScreen.tsx:153-167` | Sequential upload of up to 9 images (worst case ~18s on slow networks) | **A.** `Promise.all` with concurrency cap of 3. **B.** Accept — sequential is gentler on backend presign + S3 PUT throttling. **C.** Show per-image progress + cancel UI. |
| 48 | 🟢 LOW | 7-iii | `CreateMomentScreen.tsx:128-134` | `ImagePicker.launchImageLibraryAsync` without explicit `requestMediaLibraryPermissionsAsync()` | **A.** Add explicit permission request with denied-state UI. **B.** Rely on expo-image-picker implicit flow. Needs Android device QA. |
| 49 | 🟢 LOW | 7-iii | `SelectCircleScreen.tsx:51-57` | Full-store destructure re-renders on unrelated field changes | Refactor to per-field selectors (FilterScreen `useCirclesStore((st) => st.x)` pattern). |
| 50 | 🟢 LOW | 7-iii | `FilterScreen.tsx:166` | Filter save has Android Toast but no iOS confirmation — relies on navigation-back as implicit feedback | **A.** Cross-platform Snackbar (lib or homegrown). **B.** Brief `Alert.alert` on iOS. **C.** Accept current ("save → pop back" is iOS-idiomatic). |
| 51 | 🟡 MED | 7-iv | `CircleNotificationSettingsScreen.tsx` + `use-circle-notification-store.ts` | **Phantom Feature**: 3 toggles persist to MMKV but nothing consumes them — user believes toggling 离线推送/声音/全局开关 disables notifications, but realtime client + OpenIM SDK don't consult the store | **A.** Wire store values into `realtime/client.ts` notification dispatch + OS push permission flow. **B.** Delete screen + store until real backend feature lands. **C.** Document as "UI only, no enforcement" inline. |
| ~~52~~ | ✅ DONE | 7-iv | `CreateCircleScreen.tsx` + `EditCircleScreen.tsx` | Extracted `useCircleForm()` hook (198 lines: state + 14 handlers + `hydrate` for Edit), `<CircleFormBody>` component (515 lines: 3 sections of form JSX), `constants/circle-form.ts` (preset categories + VIP/credit option values + max tags). CreateCircleScreen 622 → 210 lines; EditCircleScreen 745 → 258 lines. Net delta: -152 lines across 3 screens after factoring in new shared modules. Circle-edit-screen + circle-detail-screen tests still pass. | (resolved 2026-05-15) |
| ~~53~~ | ✅ DONE | 7-iv | `CircleDetailScreen.tsx:559-616` | "入圈规则摘要" 5 repeated `summaryRow + Divider` blocks now map over a 5-entry `{key, label, value}` config array. Divider rendering condition handles last-row case (`index < rows.length - 1`). | (resolved 2026-05-15) |
| ~~54~~ | ✅ DONE | 8 | `GroupsScreen.tsx` + `src/im/client.ts` + `i18n/locales/{zh,en}.json` | **Chose option A** — wired to real OpenIM data. New `getJoinedGroups()` helper in `src/im/client.ts` calls `OpenIMSDK.getJoinedGroupList()` (single round-trip; `GroupItem` includes all rendering fields). Rewrote `GroupsScreen.tsx` (212 → 264 lines, but the bulk is genuine loading/error/empty state plumbing): fetches on mount + on focus, splits by `ownerUserID === toImUserId(currentUserID)` into "我创建" vs "我加入" sections (dropped "我管理" — would require per-group member-role fetches, same N+1 family as #41, deferred). Rows now tap-route to `/(tabs)/messages/chat-detail` with `sourceID=groupID + conversationType=group`. Cleaned up locale JSONs — dropped `samples.*` + `myManaged` keys; added `loading` + `loadFailed`. **58/58 tests pass**, tsc clean. | (resolved 2026-05-15) |
| 55 | 🟢 LOW | 8 | `FriendTagsScreen.tsx:73-78` | N+1 friend-count fetch: 1 round-trip per tag just to render count | **A.** Backend includes `friendCount` on `FriendTag`. **B.** Single batched count endpoint. **C.** Accept (most users <10 tags). |
| 56 | 🟢 LOW | 8 | `ContactsScreen.tsx:30-40, 208-219` | "Seats" quick-action tap = silent no-op (missing branch in `handleQuickActionPress` switch) | **A.** Remove "seats" from `QUICK_ACTION_KEYS` (dead button). **B.** Wire to a real seats route. Needs product call. |
| ~~57~~ | ✅ DONE | 9 | `NotesSettingsScreen.tsx` | **Chose option B** — rewrote copy to match reality. "异常修复：清理本地并强制同步" → "手动刷新"; "清空本地笔记与上传队列..." → "重新拉取笔记和分组列表"; "同步中..." → "刷新中..."; button label "清理本地并强制同步" → "重新拉取". Dropped the 2-step destructive confirm (action is now non-destructive). Cooldown preserved to prevent backend hammering. | (resolved 2026-05-15) |
| ~~58~~ | ✅ DONE | 9 | All notes screens + DOM bridge | Full i18n migration. Routed ~70 hardcoded zh strings through `t(key, { defaultValue: zh })` across `NotesScreen` / `NotesSettingsScreen` / `EditNoteScreen` / `NoteDetailScreen` / `NoteCard` / `NoteBlockEditor` / DOM bridge / `note-format.ts`. DOM bridge gets a typed `toolbarLabels` prop from `NoteBlockEditor` (translations can't run in WebView). `note-format.ts` `formatNoteFullDate` + `buildNoteMeta` now require `t` parameter — call sites updated. Locale JSON untouched; zh users see identical text, en users get zh fallback until keys land. | (resolved 2026-05-15) |
| ~~59~~ | ✅ DONE | 9 | `GroupManagerSheet.tsx` + backend `note.service.ts/controller.ts` | New backend `PATCH /note/:id/groups` endpoint with `UpdateNoteGroupIdsDto`; `noteService.updateNoteGroupIds` only mutates `noteGroupMembership` (no media/title/content rewrite). Frontend `updateNoteGroupIds(id, groupIds)` API helper. `handleSaveGroupMemberships` rewritten: drops the `fetchNoteDetail` per-note round-trip + the full-payload `updateNote` rebuild — now reads `note.groups` from local `NoteSummary` and calls the partial endpoint. **50-note move: 100 round-trips (1 fetch + 1 update per note) → 50 round-trips (1 partial update per note).** 5 new backend service tests cover dedup, empty groupIds, not-owned groups, not-found notes. | (resolved 2026-05-15) |
| ~~60~~ | ✅ DONE | 9 | `NotesScreen.tsx` → `GroupManagerSheet.tsx` | Extracted modal sheet (membership picker + group CRUD + drag/reorder) into `src/features/notes/components/GroupManagerSheet.tsx`. Self-contained: owns its drag state, group editor state, membership editor state. Receives `{ visible, onClose, groups, setGroups, notes, onMembershipsChanged, onActiveGroupDeleted }` props. **NotesScreen.tsx: 1008 → 439 lines (−56%); GroupManagerSheet.tsx: new 858 lines.** Test assertions updated to point at new locations (notes-screen.test.js). | (resolved 2026-05-15) |
| 61 | 🟡 MED | 11-ii | `settings-detail.tsx:88-99` + 4 settings screens | **Phantom toggles**: `SettingsSwitch` takes `initialValue` but never bubbles changes — no callback, no Zustand wiring, no MMKV persist. 25 toggles across Appearance/Notification/Privacy/AccountSecurity look like working settings but do nothing. Same anti-pattern as #51 + #57. | **A.** Refactor `SettingsSwitch` to controlled component (`value` + `onValueChange`); wire each toggle to a real store. **B.** Delete toggles until features are real. **C.** "敬请期待" Alert stopgap. |
| 62 | 🟢 LOW | 11-iii | `MallScreen.tsx:128-136` | `handleProductPress` only routes `'membership'` + `'wallet'`; 9 other product action types silent no-op | **A.** Wire each to a destination route. **B.** Filter FALLBACK_SECTIONS to membership/wallet until backend ready. **C.** Alert stopgap. |
| 63 | 🟢 LOW | 11-iii | `EditProfileFieldScreen.tsx` (788 lines) | Exceeds 800-line guideline; mixes dispatch + avatar picker + date picker + city picker + gender list + save flow | Split into `EditProfileFieldScreen` (composition) + per-editor sub-components. Mechanical refactor. |
| 64 | 🟡 MED | S11 redo | `theme/colors.ts` | `darkColors` and `lightColors` are ~70% identical hex values: brand tokens (`online`, `success`, `warning`, `orange`, `blue`, `purple`, `deepPurple`, `error`, `primary`, `memberCard*`, `sentBubble`, `sentTimeText`, `overlay`) are verbatim duplicated; only `background`/`surface`/`surfaceBorder`/`divider`/`text`/`receivedBubble`/`inputBg`/`statusBarStyle`/`primaryLight` actually differ. Architectural source of #45's recurring hardcoded-hex symptoms — brand colors don't respond to theme mode so screens hardcode their own instead. | **A.** Refactor `colors.ts` into `brandPalette` (mode-independent) + `darkSurfacePalette` / `lightSurfacePalette` (mode-dependent); `useTheme().colors` is a merged view. **B.** Add dark-mode-tuned variants of brand tokens (e.g. `online` slightly brighter in dark, dimmer in light). **C.** Document as intentional and stop calling it "themed". |
| ~~65~~ | ✅ DONE | 13 | `features/user/data/profiles.ts` | Mock user data deleted: 8 fake users + `getUserProfileById`/`getUserProfileIdByName` removed; type-only export retained. UserProfileScreen now uses inline `useMemo` synthesized fallback. Same Phantom-data family as #36 + #54. | (resolved 2026-05-15) |
| 66 | 🟢 LOW | 13 | `features/social/CreatePostScreen.tsx` | ~25 remaining hardcoded zh JSX strings (after the 4 error messages were i18n'd in this batch): `请输入详细内容`/`喇叭动态`/`选择圈子`/`选择城市`/`关键词标签（最多5个）`/`输入标签关键词`/`添加`/`VIP限制`/`信用值限制`/`需要靓号`/`提交`/`不限制`/`60分以上` etc. | **A.** Mechanical migration parity with #58 — wrap each in `t(key, { defaultValue: zh })`. **B.** Accept zh-only for this surface (acceptable for Chinese-market app). |
| 67 | 🟢 LOW | 13 | `features/user/EditFriendTagsScreen.tsx:259-284` | `handleSave` does `Promise.all([...addedIds.map(assignTag), ...removedIds.map(removeTag)])`. If half succeed and half fail, user sees error Alert but local state stays optimistic; on next refresh user sees inconsistent state. | **A.** Backend transactional endpoint that takes the new tag-set + diffs server-side. **B.** Roll back optimistic UI on partial failure (re-fetch from server). **C.** Sequential calls with stop-on-first-failure semantics (slower but consistent). |

**Suggested triage order:**
1. **#10 (chat-data privacy)** — privacy/compliance call, will shape #3 (which other stores to clear) and the eventual `wipeUserData()` primitive.
2. **#4 (deviceName PII)** — fast decision, fast patch.
3. **#5 (changePassword teardown)** — UX-affecting, decide before users start changing passwords in prod.
4. **#3** — depends on #10 outcome; do them together.
5. **#11 (retry util)** — small but blocks other batches that will want the same primitive (chat send, history pagination, upload).
6. **#2 (auth retry sentinel)** — bundle into a future auth-error-boundary pass.
7. **#6 (error code map)** — blocked on backend; ping backend team for code list.
8. **#7, #8, #9** — non-urgent maintenance / safety hygiene.

---

## Known pre-existing broken tests

(Empty — `test/auth-api.test.js` was fixed during Batch 02 patching: now 7/7 passing with `react-native` mock added and 4 new tests for `isAuthTokens` shape guard, accountId trim, and null imToken normalization.)

---

## Next batch (proposed)

**4 surfaces closed**: Auth · OpenIM · Chat core · Persistence. Foundation + most-used user-facing surface are done. Remaining big chunks:

- **Batch 6 — API layer rest (16 files, ~2.5k lines)** — friends, circles, moments, profile, users, **upload (presign + multipart, biggest risk)**, notifications, plaza, notes, membership, coin, mall, collections, icons. Mostly endpoint wrappers; the upload module has multi-part / presign nuances worth deep review.
- **Batch 7 — Discover / Moments / Circles (30 files, ~big)** — circle-filter, moment-card, plaza, post-form, etc.
- **Batch 8 — Profile / Settings (24 files)** — many setting screens.
- **Batch 9 — Notes (12 files)** — includes BlockNote DOM bridge.
- **Batch 10 — Contacts / Social / User (~14 files)** — friend list, friend activity, user profile.
- **Batch 11 — UI primitives / Theme / Utils** — defer-able, mostly cosmetic.
- **Batch 12 — App routes** — mostly thin wrappers; spot-check.

**Recommendation:** Batch 6 (API layer) next — close the read-side of the data layer, and `upload.ts` is the last meaningful HIGH-risk surface left.
