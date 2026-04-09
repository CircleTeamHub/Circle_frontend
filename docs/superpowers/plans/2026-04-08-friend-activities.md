# Friend Activities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `新的朋友` into a full friend-activity inbox with per-item unread state and a contacts-tab red dot.

**Architecture:** Add a dedicated friend-activity model and APIs in the backend, keep friendship state and notification history separate, and expose typed frontend helpers that power the inbox list, activity detail page, and contacts-tab unread indicator. Rework the current `NewFriendsScreen` from a recent-friends list into an activity feed, and add a detail screen for request handling and read tracking.

**Tech Stack:** NestJS, Prisma, Expo Router, React Native, existing `apiClient`, Jest in backend, Node `node:test` in frontend, TypeScript.

---

## File Structure

- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/<timestamp>_friend_activities/migration.sql`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.controller.ts`
- Create: `/Users/yiboding/projects/circle_be/src/friend/dto/friend-activity.dto.ts`
- Test: `/Users/yiboding/projects/circle_be/src/friend/friend.service.spec.ts` or existing friend tests
- Modify: `/Users/yiboding/projects/circle_be/docs/frontend-api-guide.md`
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/friends.ts`
- Create: `/Users/yiboding/projects/circle-im/src/features/contacts/friend-activities.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/NewFriendsScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/FriendActivityDetailScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/app/(tabs)/contacts/new-friends/[id].tsx`
- Modify: `/Users/yiboding/projects/circle-im/app/(tabs)/_layout.tsx`
- Test: `/Users/yiboding/projects/circle-im/test/friend-activities.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/contacts-screen.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/add-friend-screen.test.js`

### Task 1: Backend Friend Activity Model And API

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/<timestamp>_friend_activities/migration.sql`
- Create: `/Users/yiboding/projects/circle_be/src/friend/dto/friend-activity.dto.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.controller.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.service.ts`
- Test: `/Users/yiboding/projects/circle_be/src/friend/*.spec.ts`

- [ ] **Step 1: Write the failing backend tests**

```ts
it('creates inbox activities when a request is sent, accepted, rejected, or withdrawn', async () => {
  await service.sendRequest(senderId, targetId, 'hi');
  expect(prisma.friendActivity.createMany).toHaveBeenCalled();
});

it('marks exactly one activity as read for the inbox owner', async () => {
  await service.markActivityRead(viewerId, activityId);
  expect(prisma.friendActivity.updateMany).toHaveBeenCalledWith({
    where: { id: activityId, viewerId },
    data: { readAt: expect.any(Date) },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/friend --runInBand`  
Expected: FAIL because activity model and service methods do not exist yet.

- [ ] **Step 3: Write minimal backend implementation**

```ts
enum FriendActivityType {
  REQUEST_RECEIVED,
  REQUEST_SENT,
  REQUEST_ACCEPTED_BY_OTHER,
  REQUEST_REJECTED_BY_OTHER,
  REQUEST_ACCEPTED_BY_ME,
  REQUEST_REJECTED_BY_ME,
  REQUEST_WITHDRAWN_BY_OTHER,
}
```

- [ ] **Step 4: Run backend tests to verify they pass**

Run: `pnpm test src/friend --runInBand`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle_be add prisma src/friend docs/frontend-api-guide.md
git -C /Users/yiboding/projects/circle_be commit -m "feat: add friend activity inbox backend"
```

### Task 2: Frontend Friend Activity API And Mapping Layer

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/friends.ts`
- Create: `/Users/yiboding/projects/circle-im/src/features/contacts/friend-activities.ts`
- Test: `/Users/yiboding/projects/circle-im/test/friend-activities.test.js`

- [ ] **Step 1: Write the failing frontend helper tests**

```js
test('friend activity copy maps each activity type to user-facing text', () => {
  const { getFriendActivityCopy } = loadFriendActivities();
  assert.match(getFriendActivityCopy(activity), /请求添加你为好友/);
});

test('fetchUnreadFriendActivityCount reads the red-dot endpoint', async () => {
  const { fetchUnreadFriendActivityCount } = loadFriendsApi();
  await fetchUnreadFriendActivityCount();
  assert.equal(lastEndpoint, '/friend/activities/unread-count');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/friend-activities.test.js`  
Expected: FAIL because the helper module and endpoints do not exist yet.

- [ ] **Step 3: Write minimal frontend helper implementation**

```ts
export function hasUnreadFriendActivities(count: number) {
  return count > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/friend-activities.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/services/api/friends.ts src/features/contacts/friend-activities.ts test/friend-activities.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: add friend activity frontend helpers"
```

### Task 3: Contacts Tab Red Dot And Inbox Screen

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/app/(tabs)/_layout.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/NewFriendsScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/test/contacts-screen.test.js`

- [ ] **Step 1: Write the failing source tests**

```js
test('contacts tab reads friend activity unread count for the badge', () => {
  const source = read('app/(tabs)/_layout.tsx');
  assert.match(source, /fetchUnreadFriendActivityCount/);
  assert.match(source, /tabBarBadge/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/contacts-screen.test.js test/friend-activities.test.js`  
Expected: FAIL because tabs layout and inbox screen still use the old model.

- [ ] **Step 3: Write minimal tab badge and inbox implementation**

```ts
const unreadCount = await fetchUnreadFriendActivityCount();
options.tabBarBadge = unreadCount > 0 ? '' : undefined;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/contacts-screen.test.js test/friend-activities.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add app/(tabs)/_layout.tsx src/features/contacts/screens/NewFriendsScreen.tsx test/contacts-screen.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: add friend activity inbox and red dot"
```

### Task 4: Friend Activity Detail Screen

**Files:**
- Create: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/FriendActivityDetailScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/app/(tabs)/contacts/new-friends/[id].tsx`
- Modify: `/Users/yiboding/projects/circle-im/test/contacts-screen.test.js`

- [ ] **Step 1: Write the failing detail screen tests**

```js
test('friend activity detail screen supports pending request handling and read-only event states', () => {
  const source = read('src/features/contacts/screens/FriendActivityDetailScreen.tsx');
  assert.match(source, /acceptFriendRequest/);
  assert.match(source, /rejectFriendRequest/);
  assert.match(source, /markFriendActivityRead/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/contacts-screen.test.js test/friend-activities.test.js`  
Expected: FAIL because the detail screen and route do not exist yet.

- [ ] **Step 3: Write minimal detail implementation**

```ts
if (activity.type === 'REQUEST_RECEIVED' && activity.requestState === 'PENDING') {
  showAcceptReject = true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/contacts-screen.test.js test/friend-activities.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/features/contacts/screens/FriendActivityDetailScreen.tsx app/(tabs)/contacts/new-friends/[id].tsx test/contacts-screen.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: add friend activity detail flow"
```

### Task 5: End-To-End Verification

**Files:**
- Verify backend and frontend files above

- [ ] **Step 1: Run frontend tests**

Run: `node --test test/friend-activities.test.js test/contact-friends.test.js test/contacts-screen.test.js test/add-friend-screen.test.js test/user-profile-screen.test.js test/profile-api.test.js test/api-utils.test.js test/auth-api.test.js`  
Expected: PASS

- [ ] **Step 2: Run frontend typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 3: Run backend tests**

Run: `pnpm test src/friend src/user --runInBand`  
Expected: PASS

- [ ] **Step 4: Run backend typecheck**

Run: `pnpm exec tsc --noEmit`  
Expected: PASS

- [ ] **Step 5: Manual verification**

Verify:
- sending a friend request creates inbox items for both sides
- opening one activity marks only that activity as read
- contacts tab shows red dot when unread activities exist
- accepting / rejecting from detail page generates follow-up activities and preserves history

