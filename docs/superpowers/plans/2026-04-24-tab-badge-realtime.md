# Tab Badge Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace route-driven unread-count polling with a unified real-time tab badge system powered by OpenIM events for messages and backend WebSocket events for business unread counts.

**Architecture:** Add a frontend `tabBadgeStore` and a lightweight realtime client that hydrates unread snapshots and applies count-change events. Keep `messagesUnread` sourced from OpenIM, while `contactsUnread` and `discoverUnread` come from a new backend WebSocket gateway that emits latest counts on connect and after unread-affecting friend/circle mutations. HTTP unread-count endpoints remain recovery-only fallbacks.

**Tech Stack:** Expo Router, Zustand, native WebSocket/OpenIM SDK on frontend; NestJS, Prisma, raw `ws` WebSocket server on backend.

---

### Task 1: Write the execution-facing docs and constants

**Files:**
- Create: `docs/superpowers/plans/2026-04-24-tab-badge-realtime.md`
- Modify: `src/constants/config.ts`
- Test: `test/tab-badge-store.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/tab-badge-store.test.js` asserting the frontend has a `tabBadgeStore` and a realtime API URL constant.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tab-badge-store.test.js`
Expected: FAIL because the store or realtime URL constant does not exist yet.

- [ ] **Step 3: Add minimal config surface**

Add a `REALTIME_WS_URL` export in `src/constants/config.ts` derived from the existing API host.

- [ ] **Step 4: Run test to verify partial progress**

Run: `node --test test/tab-badge-store.test.js`
Expected: still FAIL until the store exists.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-24-tab-badge-realtime.md src/constants/config.ts test/tab-badge-store.test.js
git commit -m "docs: add realtime tab badge implementation plan"
```

### Task 2: Add the unified frontend tab badge store

**Files:**
- Create: `src/stores/tabBadgeStore.ts`
- Modify: `test/tab-badge-store.test.js`
- Test: `test/tab-badge-store.test.js`

- [ ] **Step 1: Write the failing test**

Extend `test/tab-badge-store.test.js` to assert the store exposes:

- `messagesUnread`
- `contactsUnread`
- `discoverUnread`
- `profileUnread`
- `setMessagesUnread`
- `applySnapshot`
- `setRealtimeConnected`
- `reset`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tab-badge-store.test.js`
Expected: FAIL because `src/stores/tabBadgeStore.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/stores/tabBadgeStore.ts` with a focused Zustand store containing numeric counts, realtime connection state, and minimal setters.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tab-badge-store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/tabBadgeStore.ts test/tab-badge-store.test.js
git commit -m "feat: add unified tab badge store"
```

### Task 3: Move messages tab badge to the unified store

**Files:**
- Modify: `src/im/listeners.ts`
- Modify: `app/(tabs)/_layout.tsx`
- Test: `test/tab-layout-badge.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/tab-layout-badge.test.js` asserting:

- tab layout reads from `useTabBadgeStore`
- tab layout no longer calls `refreshUnreadFriendActivityCount` from `segments`
- IM listeners write unread message updates into `tabBadgeStore`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tab-layout-badge.test.js`
Expected: FAIL because the tab layout still depends on `useFriendActivityUnreadStore`.

- [ ] **Step 3: Write minimal implementation**

Update:

- `src/im/listeners.ts` to mirror `onTotalUnreadMessageCountChanged` into `tabBadgeStore.setMessagesUnread`
- `app/(tabs)/_layout.tsx` to render badges from `tabBadgeStore`
- remove route-driven `refreshUnreadFriendActivityCount()` in tab layout

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tab-layout-badge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/im/listeners.ts app/\(tabs\)/_layout.tsx test/tab-layout-badge.test.js
git commit -m "feat: route messages badge through unified tab badge store"
```

### Task 4: Add backend realtime gateway and snapshot event

**Files:**
- Create: `/Users/yiboding/projects/circle_be/src/realtime/realtime.gateway.ts`
- Create: `/Users/yiboding/projects/circle_be/src/realtime/realtime.service.ts`
- Create: `/Users/yiboding/projects/circle_be/src/realtime/realtime.module.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/app.module.ts`
- Modify: `/Users/yiboding/projects/circle_be/package.json`
- Test: `/Users/yiboding/projects/circle_be/src/realtime/realtime.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add `src/realtime/realtime.service.spec.ts` asserting:

- snapshot payload includes `contactsUnread`, `discoverUnread`, `profileUnread`
- gateway/service can compute a snapshot for a user from friend and circle unread counts

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- realtime.service.spec.ts --runInBand`
Expected: FAIL because realtime module/service does not exist.

- [ ] **Step 3: Install minimal dependencies**

Add raw websocket dependencies:

- `ws`
- `@types/ws`

Do not add Socket.IO unless raw websocket proves insufficient.

- [ ] **Step 4: Write minimal implementation**

Create:

- `realtime.service.ts` for snapshot calculation and per-user broadcast helpers
- `realtime.gateway.ts` for auth, connection tracking, snapshot emit, and disconnect cleanup
- `realtime.module.ts`

Register the module in `app.module.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- realtime.service.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/realtime src/app.module.ts
git commit -m "feat: add realtime badge gateway"
```

### Task 5: Emit friend unread updates from backend mutations

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.module.ts`
- Test: `/Users/yiboding/projects/circle_be/src/friend/friend.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add assertions in `friend.service.spec.ts` that:

- sending a friend request emits the recipient’s latest unread count
- marking a friend activity read emits the viewer’s latest unread count

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- friend.service.spec.ts --runInBand`
Expected: FAIL because no realtime broadcast happens yet.

- [ ] **Step 3: Write minimal implementation**

Inject `RealtimeService` into `FriendService` and after unread-affecting writes, compute the latest unread count and broadcast:

- `friend.activity.unread.changed`

Payload:

```json
{ "count": 3, "changedAt": "..." }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- friend.service.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/friend/friend.service.ts src/friend/friend.module.ts src/friend/friend.service.spec.ts
git commit -m "feat: broadcast friend unread badge updates"
```

### Task 6: Emit circle unread updates from backend mutations

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/src/circle/circle.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/circle/circle.module.ts`
- Test: `/Users/yiboding/projects/circle_be/src/circle/circle.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add assertions in `circle.service.spec.ts` that marking a circle activity as read broadcasts the latest unread count for that user.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- circle.service.spec.ts --runInBand`
Expected: FAIL because no realtime emit occurs yet.

- [ ] **Step 3: Write minimal implementation**

Inject `RealtimeService` into `CircleService` and broadcast:

- `circle.activity.unread.changed`

after unread-affecting updates.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- circle.service.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/circle/circle.service.ts src/circle/circle.module.ts src/circle/circle.service.spec.ts
git commit -m "feat: broadcast circle unread badge updates"
```

### Task 7: Add frontend realtime client and recovery logic

**Files:**
- Create: `src/realtime/client.ts`
- Modify: `src/components/app/session-bootstrap.tsx`
- Modify: `src/services/auth/session.ts`
- Test: `test/realtime-client.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/realtime-client.test.js` asserting:

- the realtime client connects with the current access token
- `badge.snapshot` maps into `tabBadgeStore.applySnapshot`
- friend/circle unread events map into the correct store setters
- logout/disconnect resets realtime connection state

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/realtime-client.test.js`
Expected: FAIL because the realtime client module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/realtime/client.ts` using native `WebSocket`.

Responsibilities:

- build the realtime URL from `REALTIME_WS_URL`
- authenticate on connect
- parse `badge.snapshot`
- parse `friend.activity.unread.changed`
- parse `circle.activity.unread.changed`
- expose `connectRealtime()` and `disconnectRealtime()`

Update `session-bootstrap.tsx` to connect after auth bootstrap and disconnect on session clear.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/realtime-client.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/client.ts src/components/app/session-bootstrap.tsx src/services/auth/session.ts test/realtime-client.test.js
git commit -m "feat: add realtime client for tab badges"
```

### Task 8: Replace tab polling with snapshot/bootstrap recovery

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `src/stores/friendActivityUnreadStore.ts`
- Modify: `src/features/contacts/screens/NewFriendsScreen.tsx`
- Test: `test/tab-layout-badge.test.js`

- [ ] **Step 1: Write the failing test**

Extend `test/tab-layout-badge.test.js` to assert:

- tab layout no longer imports `useFriendActivityUnreadStore`
- New Friends screen still refreshes its own inbox count when focused
- tab layout badges render from `messagesUnread`, `contactsUnread`, and `discoverUnread`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tab-layout-badge.test.js`
Expected: FAIL because the tab layout still uses route-driven count refresh.

- [ ] **Step 3: Write minimal implementation**

Keep `useFriendActivityUnreadStore` only for inbox-screen-local flows if still needed, but remove it from tab layout ownership.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tab-layout-badge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/\(tabs\)/_layout.tsx src/stores/friendActivityUnreadStore.ts src/features/contacts/screens/NewFriendsScreen.tsx test/tab-layout-badge.test.js
git commit -m "refactor: stop route-driven tab badge polling"
```

### Task 9: Verify end-to-end behavior

**Files:**
- Test only

- [ ] **Step 1: Run targeted frontend tests**

Run:

```bash
cd /Users/yiboding/projects/circle-im
node --test test/tab-badge-store.test.js test/tab-layout-badge.test.js test/realtime-client.test.js test/my-icons-screen.test.js test/profile-screen-card.test.js test/user-icon-row.test.js
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

Run:

```bash
cd /Users/yiboding/projects/circle-im
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run targeted backend tests**

Run:

```bash
cd /Users/yiboding/projects/circle_be
npm test -- realtime.service.spec.ts friend.service.spec.ts circle.service.spec.ts auth.service.spec.ts public-user.dto.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run backend build**

Run:

```bash
cd /Users/yiboding/projects/circle_be
npm run build
```

Expected: PASS.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: add realtime tab badge system"
```
